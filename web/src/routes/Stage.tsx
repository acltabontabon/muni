import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import * as Popover from '@radix-ui/react-popover'
import { ArrowRight, MonitorPlay, Pause, Play } from 'lucide-react'
import { ApiError, patch, post, put } from '@/api/client'
import type { CheckinView, Experiment, SharedEntry, SprintDetail, StageSnapshot, ThemeView, VotingState } from '@/api/types'
import { PHASE_LABEL, categoryMeta } from '@/lib/categories'
import { applyAppearance } from '@/lib/prefs'
import { useStage } from '@/lib/stage'
import { talkTime } from '@/lib/talk-time'
import { fairBudget, votePurse } from '@/lib/votes'
import { isHere } from '@/lib/attendance'
import { cueFor, type Cue as CueLine, type CueAction, type CueState } from '@/lib/cue'
import { shortDate } from '@/lib/schedule'
import { Button, Dialog, Spinner, fmtClock, useCountdown, useDocumentTitle, useTimeUp, useToast } from '@/ui'
import { ReconnectingBar } from '@/ui/status'
import { ExperimentEditor } from '@/ui/experiments'
import { ConfirmDialog, useSprintControl } from '@/ui/sprint-bar'
import { BehindLine, CouldntLoad, NoteField, PastExperiment, RetroMap, Thought, TopicHorizon, VERDICTS, worthKeeping } from '@/ui/retro'
import { ASK, CheckinResult, kindWord } from '@/ui/checkin'
import { Mark } from '@/brand/Mark'
import { Face } from '@/ui/faces'
import { isLocked } from '@/lib/e2ee/keyring'

type Command = ReturnType<typeof useStage>['command']

/**
 * Keys the stage takes, and when it doesn't. Only a plain key, pressed rather than held, that
 * nothing else has handled: ⌘/Alt+← is the browser's Back, and a held arrow would race through the
 * topics. While someone types, or something is open over the stage (the thoughts, a dialog, a
 * menu), the keys are theirs.
 */
function stageKey(e: KeyboardEvent): 'forward' | 'back' | 'present' | null {
  if (e.defaultPrevented || e.repeat || e.metaKey || e.altKey || e.ctrlKey) return null
  const t = e.target instanceof Element ? e.target : null
  if (t?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return null
  if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return null
  if (e.key === 'ArrowRight') return 'forward'
  if (e.key === 'ArrowLeft') return 'back'
  if (e.key.toLowerCase() === 'h') return 'present'
  return null
}

/**
 * The shared stage: the retro in four steps, each one question. Look back (did last time's
 * experiments help?), choose (what matters most?), talk (one topic at a time), agree (what will
 * we try?). The steps do their own housekeeping on the server: choosing opens the vote, talking
 * closes it and follows its order, a topic opened counts as discussed. What's left for the
 * facilitator is the conversation, and the one next step.
 *  - facilitating (default for the facilitator): the controls sit where they're used
 *  - presenting (?mode=present, or H): no controls at all, for the shared screen
 * Participants get the presenting layout, and their own phone for voting and adding.
 */
export function Stage() {
  const { sprintId = '' } = useParams()
  // Another sprint's stage is another retro: nothing on screen carries over.
  return <StageRoom key={sprintId} sprintId={sprintId} />
}

function StageRoom({ sprintId }: { sprintId: string }) {
  const nav = useNavigate()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const st = useStage(sprintId)
  const { sprint, stage, grouping, votes, experiments, previous, command } = st
  const [reader, setReader] = useState<string | null>(null) // theme id, or 'ungrouped'
  // Asking to end the retro: Agree's button or the cue's.
  const [ending, setEnding] = useState(false)
  useDocumentTitle(sprint ? `${sprint.name} · retro` : 'Retro')
  useEffect(() => {
    applyAppearance({ force: (params.get('theme') as 'light' | 'dark' | null) ?? 'dark' })
    return () => applyAppearance({ force: null })
  }, [params])

  const fac = !!stage?.is_facilitator
  const presenting = params.get('mode') === 'present' || !fac
  const phases = useMemo(() => stage?.phases ?? [], [stage?.phases])
  const phaseIdx = stage ? phases.indexOf(stage.phase) : 0
  const themes = useMemo(() => (grouping?.themes ?? []).filter((t) => !t.parked), [grouping?.themes])
  const ungrouped = useMemo(() => grouping?.ungrouped ?? [], [grouping?.ungrouped])
  // The talk's topics: the agenda (the vote's order), then whatever isn't in a theme.
  const topics = useMemo(() => {
    const byId = new Map(themes.map((t) => [t.id, t]))
    const listed = (stage?.agenda ?? []).map((a) => byId.get(a.theme_id)).filter((t): t is ThemeView => !!t)
    const ids: string[] = (listed.length ? listed : themes).map((t) => t.id)
    return ungrouped.length ? [...ids, 'ungrouped'] : ids
  }, [stage?.agenda, themes, ungrouped.length])

  const setPresenting = useCallback(
    (on: boolean) => {
      const p = new URLSearchParams(params)
      if (on) p.set('mode', 'present')
      else p.delete('mode')
      setParams(p, { replace: true })
    },
    [params, setParams],
  )
  const run = useCallback(
    async (c: Parameters<Command>[0]) => {
      const r = await command(c)
      if (!r.ok) toast(r.message ?? '', 'danger')
    },
    [command, toast],
  )
  const toStep = useCallback((p: string | undefined) => (p ? run({ type: 'set_phase', phase: p }) : undefined), [run])
  const topicAt = stage?.current_theme_id ? topics.indexOf(stage.current_theme_id) : -1
  const forward = useCallback(() => {
    if (stage?.phase === 'talk' && topicAt >= 0 && topicAt < topics.length - 1) run({ type: 'set_topic', theme_id: topics[topicAt + 1] })
    else if (phaseIdx < phases.length - 1) toStep(phases[phaseIdx + 1])
  }, [stage?.phase, topicAt, topics, run, phaseIdx, phases, toStep])
  // ← mirrors →: within the talk it goes back a topic, and only from the first topic back a step.
  const back = useCallback(() => {
    if (stage?.phase === 'talk' && topicAt > 0) run({ type: 'set_topic', theme_id: topics[topicAt - 1] })
    else if (phaseIdx > 0) toStep(phases[phaseIdx - 1])
  }, [stage?.phase, topicAt, topics, run, phaseIdx, phases, toStep])

  // Keys drive the room only while it's running (a paused or finished retro takes no commands).
  const running = !!stage && !stage.ended_at && !stage.cancelled && sprint?.status === 'live'
  const phase = running ? stage.phase : null
  const topic = phase === 'talk' ? stage?.current_theme_id ?? null : null
  const shownPosition = useRef<{ phase: string; topic: string | null } | null>(null)
  useLayoutEffect(() => {
    if (!phase) return
    const before = shownPosition.current
    shownPosition.current = { phase, topic }
    // A new question begins below the rail. Updates within that question leave readers and
    // people typing exactly where they are; first load also keeps the browser's scroll position.
    if (before && (before.phase !== phase || before.topic !== topic)) window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [phase, topic])
  // Another facilitator is leading: this screen follows, and its controls wait for "Take over".
  const leading = !!stage?.you_control || !!stage?.controller_stale
  const controls = fac && !presenting && leading
  useEffect(() => {
    if (!fac || !running) return
    const onKey = (e: KeyboardEvent) => {
      const k = stageKey(e)
      if (!k) return
      if (k !== 'present' && !leading) return
      e.preventDefault()
      if (k === 'forward') forward()
      else if (k === 'back') back()
      else setPresenting(!presenting)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fac, running, leading, forward, back, presenting, setPresenting])

  if (st.revoked) return <Centered><p>Your access to this sprint ended.</p></Centered>
  if (st.error) return <Centered><CouldntLoad message={st.error} onRetry={st.reload} /></Centered>
  if (!sprint || !st.ready) return <Centered><Spinner /></Centered>
  const done = ['completed', 'archived'].includes(sprint.status) || (!!stage?.ended_at && !stage.cancelled)
  if (stage && !done && !running) return <Paused sprint={sprint} fac={fac} onRestarted={st.putSprint} />
  if (!stage || done)
    return (
      <Centered>
        <Mark size={40} className="text-ink" />
        <h1 className="font-display mt-4 text-2xl">{done ? <>The retro is <em className="retro-em">done</em>.</> : sprint.name}</h1>
        <p className="mt-2 text-ink-soft">{done ? 'What the team will try, and what it said, is on the sprint’s page.' : fac ? 'The retro hasn’t started yet. Start it from the sprint’s page.' : 'The retro hasn’t started yet.'}</p>
        <div className="mt-6 flex gap-2">
          <Button variant={fac || done ? 'primary' : 'ghost'} onClick={() => nav(`/sprints/${sprintId}`)}>{done ? 'See the outcomes' : 'Back to the sprint'}</Button>
        </div>
      </Centered>
    )

  const readerTheme = reader && reader !== 'ungrouped' ? themes.find((t) => t.id === reader) ?? null : null
  // The note's own answer is shown at once; the themes (where Agree finds the ideas) follow the room's hint.
  const saveNote = async (themeId: string, field: 'takeaway' | 'could_try', value: string) => {
    try {
      st.putStage(await put<StageSnapshot>(`/api/sprints/${sprintId}/meeting/notes/${themeId}`, { [field]: value }))
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Couldn’t save', 'danger')
      throw e
    }
  }

  return (
    <div className="stage retro min-h-dvh text-ink" data-presenting={presenting || undefined} data-cue={(controls && running) || undefined}>
      <Rail stage={stage} name={sprint.name} controls={controls} onStep={toStep} onForward={forward} topics={topics} topicAt={topicAt} themes={themes} sprintId={sprintId} onPresent={st.putStage} command={command} />
      <Arrivals key={String(fac)} stage={stage} />
      <main className="retro-main">
        <ReconnectingBar status={st.live} />
        {st.stale && st.live !== 'reconnecting' ? <BehindLine onRetry={st.reload} /> : null}
        {stage.phase === 'look_back' ? <LookBack n={phaseIdx + 1} stage={stage} previous={previous} wins={worthKeeping([...themes.flatMap((t) => t.entries), ...ungrouped])} controls={controls} onVerdict={async (e, status) => { try { st.putPrevious(await patch<Experiment[]>(`/api/sprints/${sprintId}/experiments/previous/${e.id}`, { status })) } catch (err) { toast(err instanceof ApiError ? err.message : 'Couldn’t save', 'danger') } }} /> : null}
        {stage.phase === 'choose' ? <Choose n={phaseIdx + 1} stage={stage} themes={themes} ungrouped={ungrouped} votes={votes} controls={controls} sprintId={sprintId} budget={sprint.vote_budget} onRead={setReader} onVotes={st.putVotes} /> : null}
        {stage.phase === 'talk' ? <Talk n={phaseIdx + 1} stage={stage} themes={themes} ungrouped={ungrouped} topics={topics} controls={controls} command={run} onNote={saveNote} sprintId={sprintId} checkins={{ list: st.checkins, put: st.putCheckin }} /> : null}
        {stage.phase === 'agree' ? <Agree n={phaseIdx + 1} themes={themes} experiments={experiments} controls={controls} sprintId={sprintId} participants={sprint.participants} onChange={() => void st.refresh('experiments')} checkins={{ list: st.checkins, put: st.putCheckin }} ending={ending} setEnding={setEnding} onEnd={async () => { try { await post(`/api/sprints/${sprintId}/transition`, { to: 'completed' }); nav(`/sprints/${sprintId}`) } catch (e) { toast(e instanceof ApiError ? e.message : 'Couldn’t end the retro', 'danger') } }} /> : null}
      </main>
      {controls && running ? <CueDock stage={stage} themes={themes} topics={topics} topicAt={topicAt} previous={previous} votes={votes} budget={sprint.vote_budget} experiments={experiments} checkins={{ list: st.checkins, put: st.putCheckin }} sprintId={sprintId} run={run} onForward={forward} onEnd={() => setEnding(true)} /> : null}
      <div className="retro-corner">
        {fac ? (
          <>
            {!stage.you_control && !presenting ? <button className="retro-chip retro-chip--warn" onClick={() => run({ type: 'take_control' })}>{stage.controller_name ? `${stage.controller_name} is leading · take over` : 'Take over'}</button> : null}
            {!presenting ? <a href={`/sprints/${sprintId}/room`} target="_blank" rel="noopener" className="retro-chip">Your own votes and answers</a> : null}
            <button className="retro-chip" onClick={() => setPresenting(!presenting)} aria-pressed={presenting} title="H">
              <MonitorPlay className="size-3.5" /> {presenting ? 'Presenting · show controls' : 'Present on this screen'}
            </button>
          </>
        ) : (
          <Link to={`/sprints/${sprintId}/room`} className="retro-chip">Vote and add privately</Link>
        )}
      </div>
      <Dialog open={!!reader} onOpenChange={(o) => !o && setReader(null)} title={reader === 'ungrouped' ? 'Not in a theme' : readerTheme?.title ?? ''} description={reader === 'ungrouped' ? `${ungrouped.length} ${ungrouped.length === 1 ? 'thought' : 'thoughts'}, exactly as written.` : readerTheme?.question || undefined} wide>
        <ul className="retro-thoughts retro-thoughts--reader">{(reader === 'ungrouped' ? ungrouped : readerTheme?.entries ?? []).map((e) => <Thought key={e.id} e={e} compact />)}</ul>
      </Dialog>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="stage grid min-h-dvh place-items-center px-6 text-center text-ink"><div className="flex flex-col items-center">{children}</div></div>
}

/**
 * The facilitator paused the retro (from the sprint's page). Nothing here should pass for live, and
 * nothing can be sent: the facilitator's way back is starting it again, which opens the first step
 * for everyone, with what the room noted and agreed so far kept.
 */
function Paused({ sprint, fac, onRestarted }: { sprint: SprintDetail; fac: boolean; onRestarted: (d: SprintDetail) => void }) {
  const nav = useNavigate()
  const control = useSprintControl({ id: sprint.id, status: sprint.status, encryption: sprint.encryption }, { online: true, onChanged: onRestarted })
  const canStart = fac && sprint.allowed_transitions.includes('live')
  return (
    <Centered>
      <Mark size={40} className="text-ink" />
      <h1 className="font-display mt-4 text-2xl">The retro is <em className="retro-em">paused</em>.</h1>
      <p className="mt-2 max-w-md text-ink-soft">{canStart ? 'What the room noted and agreed so far is kept. Start it again when the team is ready: everyone’s screen follows, from the first step.' : 'It carries on here when the facilitator starts it again. What the room noted so far is kept.'}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {canStart ? <Button variant="primary" busy={control.busy === 'live'} onClick={() => control.run({ kind: 'transition', to: 'live', label: 'Start the retro again', confirm: 'start' })}>Start the retro again…</Button> : null}
        <Button variant={canStart ? 'ghost' : 'primary'} onClick={() => nav(`/sprints/${sprint.id}`)}>Back to the sprint</Button>
      </div>
      {control.confirming ? <ConfirmDialog kind="start" s={sprint} busy={!!control.busy} onCancel={control.cancel} onConfirm={() => control.transition(control.confirming!)} /> : null}
    </Centered>
  )
}

// ---------- the rail: where the retro is, and the one next step ----------
function Rail({ stage, name, controls, onStep, onForward, topics, topicAt, themes, sprintId, onPresent, command }: { stage: StageSnapshot; name: string; controls: boolean; onStep: (p: string) => void; onForward: () => void; topics: string[]; topicAt: number; themes: ThemeView[]; sprintId: string; onPresent: (s: StageSnapshot) => void; command: Command }) {
  const idx = stage.phases.indexOf(stage.phase)
  const nextStep = stage.phases[idx + 1]
  const nextTopic = stage.phase === 'talk' && topicAt >= 0 && topicAt < topics.length - 1 ? topics[topicAt + 1] : null
  const nextLabel = nextTopic ? `Next topic` : nextStep ? PHASE_LABEL[nextStep] : null
  const here = stage.attendance.filter(isHere)
  // Who else is here is the facilitator's to know: a screen that's only told about you says nothing.
  const others = stage.attendance.some((a) => !a.is_you)
  return (
    <header className="retro-rail">
      <div className="retro-rail-in">
        <div className="retro-name"><Mark size={20} reflect={false} /><span>{name}</span></div>
        <ol className="retro-steps" aria-label="The retro">
          {stage.phases.map((p, i) => {
            const state = i === idx ? 'now' : i < idx ? 'done' : 'next'
            const label = <><span className="retro-step-n">{i + 1}</span>{PHASE_LABEL[p]}</>
            return (
              <li key={p} data-state={state}>
                {controls && i !== idx ? <button onClick={() => onStep(p)} title={`Go to ${PHASE_LABEL[p]}`}>{label}</button> : <span aria-current={i === idx ? 'step' : undefined}>{label}</span>}
              </li>
            )
          })}
        </ol>
        <div className="retro-rail-end">
          {controls ? (
            <People stage={stage} sprintId={sprintId} onPresent={onPresent} command={command} />
          ) : others ? (
            <span className="retro-room retro-room--still">
              <span className="retro-room-faces" aria-hidden>{here.slice(0, 5).map((a) => <Face key={a.account_id} a={a} state={a.connected ? 'on' : 'here'} />)}</span>
              <span className="retro-room-n">{here.length}<span> here</span></span>
            </span>
          ) : null}
          {controls && nextLabel ? (
            <Button size="sm" variant="primary" onClick={onForward} title="→">
              {nextTopic ? <>{nextLabel}<span className="retro-next-sub">{themes.find((t) => t.id === nextTopic)?.title ?? 'Not in a theme'}</span></> : <>Next: {nextLabel}</>} <ArrowRight className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  )
}

type Attendee = StageSnapshot['attendance'][number]
/** Where someone is, in words: connected now, here without a device, or not here yet. */
const whereabouts = (a: Attendee) => (a.connected ? 'connected now' : a.present ? 'here · not connected' : 'not here yet')

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name

/**
 * Arrivals on the stage while the room gathers (the first step): a plain line each, for a few
 * seconds, said once per person. Only arrivals after the first look count — opening the stage
 * doesn't announce everyone already there. Later in the retro, and whenever someone leaves or
 * reconnects, the faces in the rail say it quietly: a shared screen never calls someone out.
 */
function useArrivals(attendance: Attendee[], gathering: boolean) {
  const seen = useRef<Set<string> | null>(null)
  const timers = useRef(new Set<number>())
  const [lines, setLines] = useState<{ key: string; text: string; face: Attendee }[]>([])
  useEffect(() => {
    const connected = attendance.filter((a) => a.connected && !a.is_you)
    if (!seen.current) {
      seen.current = new Set(connected.map((a) => a.account_id))
      return
    }
    const fresh = connected.filter((a) => !seen.current!.has(a.account_id))
    fresh.forEach((a) => seen.current!.add(a.account_id))
    if (!gathering || !fresh.length) return
    const said = fresh.map((a) => ({ key: `${a.account_id}:${Date.now()}`, text: `${firstName(a.display_name)} is here.`, face: a }))
    setLines((l) => [...l, ...said].slice(-3))
    // Each line leaves on its own clock, even if someone else arrives meanwhile.
    const t = window.setTimeout(() => {
      timers.current.delete(t)
      setLines((l) => l.filter((x) => !said.includes(x)))
    }, 5200)
    timers.current.add(t)
  }, [attendance, gathering])
  useEffect(() => {
    const all = timers.current
    return () => all.forEach((t) => window.clearTimeout(t))
  }, [])
  // Moving on from gathering clears what's still being said.
  useEffect(() => {
    if (!gathering) setLines([])
  }, [gathering])
  return lines
}

/** The lines as people arrive, under the rail. */
function Arrivals({ stage }: { stage: StageSnapshot }) {
  const lines = useArrivals(stage.attendance, stage.phase === 'look_back')
  return (
    <div className="retro-arrivals" aria-live="polite">
      {lines.map((l) => (
        <p key={l.key} className="retro-arrival" data-kind="in">
          <Face a={l.face} state="on" size="lg" /> <span>{l.text}</span>
        </p>
      ))}
    </div>
  )
}

/**
 * Who's in the retro, live: a monogram per person, lit while their stage or phone is open. The
 * facilitator can mark someone here who has no device in the room.
 */
function People({ stage, sprintId, onPresent, command }: { stage: StageSnapshot; sprintId: string; onPresent: (s: StageSnapshot) => void; command: Command }) {
  const toast = useToast()
  const [saving, setSaving] = useState<string | null>(null)
  const people = [...stage.attendance].sort((a, b) => Number(b.connected) - Number(a.connected) || Number(b.present) - Number(a.present) || a.display_name.localeCompare(b.display_name))
  const connected = people.filter((a) => a.connected).length
  // One number everywhere: here is connected, or marked here without a device (lib/attendance).
  const here = people.filter(isHere).length
  // The answer is the stage as it is now: shown at once, with nothing read again.
  const mark = async (a: Attendee) => {
    setSaving(a.account_id)
    try {
      onPresent(await post<StageSnapshot>(`/api/sprints/${sprintId}/meeting/attendance/${a.account_id}`, { present: !a.present }))
    } catch (e) {
      toast(e instanceof ApiError ? e.message : `Couldn’t change whether ${firstName(a.display_name)} is here`, 'danger')
    } finally {
      setSaving(null)
    }
  }
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="retro-room" aria-label={`Who’s here: ${here} of ${people.length}`}>
          <span className="retro-room-faces" aria-hidden>
            {people.slice(0, 5).map((a) => <Face key={a.account_id} a={a} state={a.connected ? 'on' : a.present ? 'here' : 'away'} />)}
          </span>
          <span className="retro-room-n">{here}<span> of {people.length} here</span></span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="retro-pop anim-rise">
          <p className="retro-pop-title">Who’s here <span>{here} of {people.length}{connected !== here ? ` · ${connected} connected` : ''}</span></p>
          <p className="retro-pop-hint">Lit while someone has the retro open, on the stage or their phone. Tick someone who’s in the room without a device.</p>
          <ul className="retro-pop-list">
            {people.map((a) => (
              <li key={a.account_id}>
                <label>
                  <input type="checkbox" checked={isHere(a)} disabled={a.connected || saving === a.account_id} aria-label={`${a.display_name} is here`} onChange={() => void mark(a)} />
                  <Face a={a} state={a.connected ? 'on' : a.present ? 'here' : 'away'} />
                  <span className="retro-pop-name">{a.display_name}{a.is_you ? ' (you)' : ''}<small data-state={a.connected ? 'on' : undefined}>{whereabouts(a)}{a.is_facilitator ? ' · facilitating' : ''}</small></span>
                </label>
              </li>
            ))}
          </ul>
          {!stage.you_control ? <button className="retro-pop-action" onClick={async () => { const r = await command({ type: 'take_control' }); if (!r.ok) toast(r.message ?? 'Couldn’t take over', 'danger') }}>Take over leading</button> : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function Head({ n, kicker, title, sub }: { n: number; kicker: string; title: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="retro-head">
      <p className="retro-kicker"><span>{String(n).padStart(2, '0')}</span>{kicker}</p>
      <h1 className="retro-title">{title}</h1>
      {sub ? <p className="retro-sub">{sub}</p> : null}
    </div>
  )
}

// ---------- 1 · Look back ----------
function LookBack({ n, stage, previous, wins, controls, onVerdict }: { n: number; stage: StageSnapshot; previous: Experiment[]; wins: SharedEntry[]; controls: boolean; onVerdict: (e: Experiment, status: string) => void }) {
  return (
    <section>
      <Head n={n} kicker="Look back" title={previous.length ? <>Last time, we said we’d <em>try</em>…</> : <>Your first retro <em>here</em>.</>} sub={previous.length ? 'Did it help? “Inconclusive” and “not tried yet” are honest answers.' : 'What you agree to try today comes back to this screen next time, to see if it helped.'} />
      {stage.opening_question && !isLocked(stage.opening_question) ? (
        <p className="retro-opening"><span className="retro-note-label">While everyone arrives</span><em>{stage.opening_question}</em></p>
      ) : null}
      {/* The steps and their times are news once: after that, the rail says where the retro is. */}
      {previous.length ? null : <RetroMap phases={stage.phases} plan={stage.plan} now={stage.phase} />}
      <div className="retro-two">
        {previous.length ? (
          <ol className="retro-exps">{previous.map((e) => <PastExperiment key={e.id} e={e} onVerdict={controls ? (s) => onVerdict(e, s) : undefined} />)}</ol>
        ) : (
          <p className="retro-quiet">Nothing to look back on yet.</p>
        )}
        <aside>
          <h2 className="retro-col-title">Worth keeping <span>{wins.length || ''}</span></h2>
          {wins.length ? <ul className="retro-thoughts">{wins.slice(0, 6).map((e) => <Thought key={e.id} e={e} compact />)}</ul> : <p className="retro-quiet">Nobody marked a thought proud of or keep this time.</p>}
          {wins.length > 6 ? <p className="retro-more">and {wins.length - 6} more</p> : null}
        </aside>
      </div>
    </section>
  )
}

// ---------- 2 · Choose ----------
const nWord = (n: number) => ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] ?? String(n)

function Choose({ n: step, stage, themes, ungrouped, votes, controls, sprintId, budget, onRead, onVotes }: { n: number; stage: StageSnapshot; themes: ThemeView[]; ungrouped: SharedEntry[]; votes: ReturnType<typeof useStage>['votes']; controls: boolean; sprintId: string; budget: number; onRead: (id: string) => void; onVotes: (v: VotingState) => void }) {
  const toast = useToast()
  const round = votes?.current ?? null
  const closed = votes?.previous.find((r) => r.status === 'closed') ?? null
  const totals = !round ? closed?.totals ?? null : null
  const max = totals ? Math.max(1, ...Object.values(totals)) : 1
  const list = totals ? [...themes].sort((a, b) => (totals[b.id] ?? 0) - (totals[a.id] ?? 0)) : themes
  const { reach, per } = talkTime(stage.plan, themes.length)
  // What a person can cast: the round's budget (never more than half the topics), one vote per topic.
  const purse = round ? votePurse(round, themes.map((t) => t.id)) : null
  const each = purse?.size ?? fairBudget(budget, themes.length)
  const votesWord = `${nWord(each)} ${each === 1 ? 'vote' : 'votes'}`
  // Who could be voting: the people here (lib/attendance), the same count as the rail's.
  const people = Math.max(stage.attendance.filter(isHere).length, round?.voters ?? 0, 1)
  const single = themes.length <= 1
  // Back at Choose after the talk began: moving on returns to the topic in hand.
  const resumes = stage.current_theme_id ? (stage.current_theme_id === 'ungrouped' ? 'Not in a theme' : themes.find((t) => t.id === stage.current_theme_id)?.title ?? null) : null
  const [revoting, setRevoting] = useState(false)
  const [reopening, setReopening] = useState(false)
  const voteAgain = async () => {
    setReopening(true)
    try {
      onVotes(await post<VotingState>(`/api/sprints/${sprintId}/votes/rounds`, {}))
      setRevoting(false)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Couldn’t open voting', 'danger')
    } finally {
      setReopening(false)
    }
  }
  const time = reach >= themes.length ? <>There’s time for all {nWord(themes.length)}, about {per} minutes each.</> : <>There’s time for about <strong>{nWord(reach)}</strong> of these {nWord(themes.length)}.</>
  const sub = !themes.length
    ? 'Nothing was written this sprint, so there’s nothing to choose between.'
    : single
    ? 'There’s only one topic, so there’s nothing to choose between. Move on and talk about it.'
    : totals
      ? <>The votes are in. The talk starts at the top and goes down the list — there’s time for about <strong>{nWord(reach)}</strong>.</>
      : <>Everyone has <strong>{votesWord}</strong>, for what they most want to talk about. The most-voted go first. {time}</>
  return (
    <section>
      <Head n={step} kicker="Choose" title={<>What matters <em>most</em>?</>} sub={sub} />
      <div className="retro-two">
        <div>
          <ol className="retro-topics">
            {list.map((t, i) => {
              const n = totals?.[t.id] ?? 0
              return (
                <li key={t.id} className="retro-topic" data-beyond={(totals && i >= reach) || undefined}>
                  {totals && i === reach && list.length > reach ? <p className="retro-cutline"><span>about where the time runs out</span></p> : null}
                  <span className="retro-topic-n">{i + 1}</span>
                  <div className="retro-topic-body">
                    <h3 className="retro-topic-title">{t.title}</h3>
                    {t.question ? <p className="retro-topic-q">{t.question}</p> : null}
                    <p className="retro-topic-meta">
                      <Mix mix={t.category_mix} />
                      <button className="retro-link" onClick={() => onRead(t.id)}>{t.entry_count} {t.entry_count === 1 ? 'thought' : 'thoughts'}</button>
                    </p>
                  </div>
                  {totals ? (
                    <div className="retro-tally" aria-label={`${n} ${n === 1 ? 'vote' : 'votes'}`}>
                      <span className="retro-tally-n">{n}</span>
                      <span className="retro-tally-line"><span style={{ width: `${(n / max) * 100}%` }} /></span>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ol>
          {ungrouped.length ? <p className="retro-aside-line">Not in a theme: <button className="retro-link" onClick={() => onRead('ungrouped')}>{ungrouped.length} {ungrouped.length === 1 ? 'thought' : 'thoughts'}</button> — talked about after the themes, if there’s time.</p> : null}
        </div>
        <aside className="retro-margin">
          {round && controls && !single ? (
            <div className="rm-block rm-block--lead">
              <p className="retro-note-label">Votes so far</p>
              <p className="rm-big">{round.voters ?? 0}<span> of {people} here</span></p>
              <span className="rm-dots" aria-hidden>{Array.from({ length: people }, (_, i) => <i key={i} data-on={i < (round.voters ?? 0) || undefined} />)}</span>
              <p className="rm-text rm-quiet">{purse && purse.left < purse.size ? `Your own: ${purse.size - purse.left} cast, on your phone.` : 'Your own votes go on your phone — never on this screen.'}</p>
            </div>
          ) : null}
          {!single && !totals ? (
            <div className="rm-block rm-block--voting">
              <p className="retro-note-label">Voting</p>
              <p className="rm-text"><strong>{votesWord[0].toUpperCase() + votesWord.slice(1)} each</strong>{each > 1 ? ', one per topic' : ''}, {controls ? 'on phones' : 'on your phone'}. Private: nobody sees whose are whose, not even the facilitator. The counts appear when the room moves on.</p>
              {!controls ? <p className="rm-text rm-quiet">No phone? Use Vote and add privately.</p> : null}
            </div>
          ) : null}
          {totals ? (
            <div className="rm-block">
              <p className="retro-note-label">What happens next</p>
              {resumes ? (
                <p className="rm-text">The talk picks up where it left off, at <strong>{resumes}</strong>.</p>
              ) : (
                <p className="rm-text">The talk opens <strong>{list[0]?.title}</strong> first, with about {per} minutes on the clock — guidance, not a cut-off.</p>
              )}
              {controls ? <p className="rm-text rm-quiet"><button className="retro-link" onClick={() => setRevoting(true)}>Vote again</button> — clears these votes and opens a new round{resumes ? ', and the talk starts again from its top' : ''}.</p> : null}
            </div>
          ) : null}
        </aside>
      </div>
      <Dialog open={revoting} onOpenChange={(o) => !reopening && setRevoting(o)} title="Vote again?" description="Everyone’s votes are cleared and a new round opens on phones. Moving on counts the new votes, and the talk follows their order from the top.">
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" disabled={reopening} onClick={() => setRevoting(false)}>Keep these votes</Button>
          <Button variant="primary" busy={reopening} onClick={voteAgain}>Vote again</Button>
        </div>
      </Dialog>
    </section>
  )
}

function Mix({ mix }: { mix: Record<string, number> }) {
  const parts = Object.entries(mix).filter(([, n]) => n > 0)
  return (
    <span className="retro-mix" aria-hidden>
      {parts.flatMap(([c, n]) => Array.from({ length: Math.min(n, 12) }, (_, i) => <i key={`${c}${i}`} style={{ background: categoryMeta(c).color }} />))}
    </span>
  )
}

// ---------- 3 · Talk ----------
interface Checkins {
  list: CheckinView[]
  put: (c: CheckinView) => void
}

/** Opening and sharing check-ins, from the facilitator's side. */
function useAsking(sprintId: string, checkins: Checkins) {
  const toast = useToast()
  const open = async (themeId: string, kind: 'topic' | 'action', renew = false) => {
    try {
      checkins.put(await post<CheckinView>(`/api/sprints/${sprintId}/checkins`, { theme_id: themeId, kind, renew }))
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Couldn’t ask', 'danger')
    }
  }
  const share = async (c: CheckinView) => {
    try {
      checkins.put(await post<CheckinView>(`/api/sprints/${sprintId}/checkins/${c.id}/share`))
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Couldn’t share the answers', 'danger')
    }
  }
  return { open, share }
}

/** The current topic's check-ins: asked about the topic, and about its idea as it's worded now. */
function topicChecks(stage: StageSnapshot, checkins: CheckinView[]) {
  const id = stage.current_theme_id
  const topic = id ? checkins.find((c) => c.theme_id === id && c.kind === 'topic') ?? null : null
  const action = id ? checkins.find((c) => c.theme_id === id && c.kind === 'action') ?? null : null
  // An idea reworded after it was checked: its answers were about other words, so they aren't its answers.
  const reworded = !!action && !!stage.notes.could_try && action.could_try !== stage.notes.could_try
  return { topic, action, reworded }
}

/**
 * The talk. The topic's own thoughts come first — they're what the room is there to talk about —
 * then what the room said along the way: check-ins shared, and what was added from phones. When one
 * of those arrives, the screen brings it into view.
 */
function Talk({ n, stage, themes, ungrouped, topics, controls, command, onNote, sprintId, checkins }: { n: number; stage: StageSnapshot; themes: ThemeView[]; ungrouped: SharedEntry[]; topics: string[]; controls: boolean; command: (c: Parameters<Command>[0]) => void; onNote: (themeId: string, field: 'takeaway' | 'could_try', value: string) => Promise<void>; sprintId: string; checkins: Checkins }) {
  const current = stage.current_theme_id
  const theme = current && current !== 'ungrouped' ? themes.find((t) => t.id === current) ?? null : null
  const pos = current ? topics.indexOf(current) : -1
  const title = (id: string) => (id === 'ungrouped' ? 'Not in a theme' : themes.find((t) => t.id === id)?.title ?? '')
  const asking = useAsking(sprintId, checkins)
  const { topic: topicCheck, action: actionCheck, reworded } = topicChecks(stage, checkins.list)
  const said = useRef<HTMLDivElement>(null)
  // What the room said, as a key: it changes when a check-in is shared or something added is shown.
  const heard = `${current}:${topicCheck?.status}:${reworded ? '' : actionCheck?.status}:${theme?.context.length ?? 0}`
  const lastHeard = useRef(heard)
  useEffect(() => {
    const before = lastHeard.current
    lastHeard.current = heard
    // A new topic starts at the top; only something new within the same topic is brought into view.
    if (before === heard || before.split(':')[0] !== heard.split(':')[0]) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    said.current?.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' })
  }, [heard])
  if (!current || pos < 0)
    return (
      <section>
        <Head n={n} kicker="Talk" title={<>Where do we <em>start</em>?</>} />
        {topics.length ? (
          <ol className="retro-topics">
            {topics.map((id, i) => (
              <li key={id} className="retro-topic">
                <span className="retro-topic-n">{i + 1}</span>
                <div className="retro-topic-body"><h3 className="retro-topic-title">{controls ? <button className="retro-link" onClick={() => command({ type: 'set_topic', theme_id: id })}>{title(id)}</button> : title(id)}</h3></div>
              </li>
            ))}
          </ol>
        ) : <p className="retro-quiet">No thoughts to talk through.</p>}
      </section>
    )
  const entries = theme ? theme.entries : ungrouped
  const moments = [topicCheck, reworded ? null : actionCheck].filter((c): c is CheckinView => !!c)
  const shared = moments.filter((c) => c.status === 'shared' && c.results?.responded)
  const asked = moments.filter((c) => c.status === 'open')
  return (
    <section key={current} className="retro-talk anim-rise">
      <TopicHorizon topics={topics} current={current} discussed={stage.discussed_theme_ids} titleOf={title} onPick={controls ? (id) => command({ type: 'set_topic', theme_id: id }) : undefined} />
      <div className="retro-talk-main">
        <p className="retro-kicker retro-kicker--now"><span>{String(n).padStart(2, '0')}</span>Now talking about · topic {pos + 1} of {topics.length}{typeof theme?.votes === 'number' && theme.votes > 0 ? ` · ${theme.votes} ${theme.votes === 1 ? 'vote' : 'votes'}` : ''}</p>
        <h1 className="retro-talk-title">{theme ? theme.title : 'Not in a theme'}</h1>
        {theme?.question ? <p className="retro-talk-q">{theme.question}</p> : !theme ? <p className="retro-talk-q">The thoughts nobody grouped, exactly as written.</p> : null}
        {asked.map((c) => <Moment key={c.id} c={c} />)}
        <ul className="retro-thoughts retro-thoughts--talk">{entries.map((e) => <Thought key={e.id} e={e} />)}</ul>
        <div ref={said} className="retro-said">
          {shared.length || theme?.context.length ? <h2 className="retro-col-title retro-said-title">What the room said <span>without names</span></h2> : null}
          {shared.map((c) => <Moment key={c.id} c={c} />)}
          {theme?.context.length ? (
            <ul className="retro-thoughts retro-said-added">
              {theme.context.map((c) => (
                <li key={c.id} className="retro-thought retro-thought--added anim-rise">
                  <span className="retro-cat">{kindWord(c.kind) || 'added'}</span>
                  <div className="retro-words"><p className="retro-text">{c.body}</p></div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      <aside className="retro-margin">
        <Clock stage={stage} controls={controls} command={command} />
        {theme ? (
          <div className="rm-block">
            <Note label="We’ll remember" value={stage.notes.takeaway} controls={controls} placeholder="What the room takes from this, in a line" onSave={(v) => onNote(theme.id, 'takeaway', v)} />
            <div className="retro-note-group">
              <Note label="We could try" value={stage.notes.could_try} controls={controls} placeholder="An idea to try — it waits for Agree" onSave={(v) => onNote(theme.id, 'could_try', v)} />
              {controls && stage.notes.could_try ? <AskControl c={reworded ? null : actionCheck} idle={reworded ? 'Check this wording with the room' : 'Check it with the room'} onOpen={() => asking.open(theme.id, 'action', reworded)} onShare={asking.share} /> : null}
            </div>
            {!controls && !stage.notes.takeaway && !stage.notes.could_try ? <p className="rm-text rm-quiet">What the room will remember, and ideas to try, appear here.</p> : null}
          </div>
        ) : null}
        {controls && theme ? (
          <div className="rm-block">
            <p className="retro-note-label">Ask the room</p>
            <div className="retro-asks"><AskControl c={topicCheck} idle="Ask how it showed up" onOpen={() => asking.open(theme.id, 'topic')} onShare={asking.share} /></div>
          </div>
        ) : null}
        {!controls ? <p className="rm-text rm-quiet">On your phone: add an example, another view or a question — without your name.</p> : null}
      </aside>
    </section>
  )
}

/** What the room sees of a check-in: that it's been asked, or what came back. */
function Moment({ c }: { c: CheckinView }) {
  if (c.status === 'open')
    return (
      <p className="ci-live">
        <span className="ci-live-label">On everyone’s phone</span> <em>{ASK[c.kind].question}</em>
        {c.kind === 'action' && c.could_try ? <> — “{c.could_try}”</> : null}
      </p>
    )
  if (!c.results?.responded) return null
  return (
    <div className="ci-moment anim-rise" data-kind={c.kind}>
      <p className="retro-note-label">{c.kind === 'topic' ? 'How it showed up' : 'Would trying it help?'}</p>
      {c.kind === 'action' && c.could_try ? <p className="ci-subject">“{c.could_try}”</p> : null}
      <CheckinResult c={c} />
    </div>
  )
}

/**
 * The facilitator's side of a check-in, in one line: ask; while it's open, how many have answered
 * and a way to share; once shared, what came back. The cue suggests when — this is always here.
 */
function AskControl({ c, idle, onOpen, onShare }: { c: CheckinView | null; idle: string; onOpen: () => void; onShare: (c: CheckinView) => void }) {
  if (!c) return <button className="retro-link retro-ask-quiet" onClick={onOpen}>{idle}</button>
  if (c.status === 'open')
    return (
      <p className="retro-asking">
        <span className="retro-asking-n">{c.answers ? `${c.answers} ${c.answers === 1 ? 'answer' : 'answers'} so far` : 'Asked · no answers yet'}</span>
        <button className="retro-link" onClick={() => onShare(c)}>Share answers</button>
      </p>
    )
  return <p className="retro-ask-hint">{c.results?.responded ? `Shared · ${c.results.responded} ${c.results.responded === 1 ? 'answer' : 'answers'}` : 'Shared · no answers came in'}</p>
}

/** A topic's timebox: guidance, never a cut-off. */
function Clock({ stage, controls, command }: { stage: StageSnapshot; controls: boolean; command: (c: Parameters<Command>[0]) => void }) {
  const remaining = useCountdown(stage.timer.ends_at ?? null, stage.timer.remaining_secs)
  if (!stage.timer.total_secs) return null
  const over = remaining === 0 && stage.timer.running
  return (
    <div className="retro-clock" data-over={over || undefined} data-paused={!stage.timer.running || undefined}>
      <span className="retro-clock-n">{fmtClock(remaining)}</span>
      <span className="retro-clock-label">{over ? 'time’s up — keep going if it matters' : stage.timer.running ? 'for this topic' : 'paused'}</span>
      {controls ? (
        <span className="retro-clock-do">
          <button onClick={() => command(stage.timer.running ? { type: 'timer_pause' } : { type: 'timer_resume' })} aria-label={stage.timer.running ? 'Pause' : 'Resume'}>{stage.timer.running ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}</button>
          <button onClick={() => command({ type: 'timer_adjust', delta_secs: 120 })} aria-label="Two more minutes">+2</button>
        </span>
      ) : null}
    </div>
  )
}

function Note({ label, value, controls, placeholder, onSave }: { label: string; value: string; controls: boolean; placeholder: string; onSave: (v: string) => Promise<void> }) {
  if (!controls && !value) return null
  return (
    <div className="retro-note">
      <p className="retro-note-label">{label}</p>
      {controls ? <NoteField value={value} onSave={onSave} placeholder={placeholder} label={label} /> : <p className="retro-note-text">{value}</p>}
    </div>
  )
}

// ---------- the cue: one line to say, one thing to do ----------
const CUE_SAY = 'muni.cue.say'
function readSay() {
  try {
    return localStorage.getItem(CUE_SAY) !== 'off'
  } catch {
    return true
  }
}

/**
 * The facilitator's cue, docked at the foot of their screen and never on the presenting one: the
 * line to say next and the one thing to do (lib/cue.ts reads the room). A first retro can be run
 * from it alone; the lines can be turned off once they're second nature, and the rest of the stage
 * works the same either way.
 */
function CueDock({ stage, themes, topics, topicAt, previous, votes, budget, experiments, checkins, sprintId, run, onForward, onEnd }: { stage: StageSnapshot; themes: ThemeView[]; topics: string[]; topicAt: number; previous: Experiment[]; votes: ReturnType<typeof useStage>['votes']; budget: number; experiments: Experiment[]; checkins: Checkins; sprintId: string; run: (c: Parameters<Command>[0]) => Promise<void>; onForward: () => void; onEnd: () => void }) {
  const [say, setSay] = useState(readSay)
  const asking = useAsking(sprintId, checkins)
  // Only the moment time is up matters here: the clock beside it does the ticking.
  const timeUp = useTimeUp(stage.timer.ends_at ?? null, stage.timer.remaining_secs)
  const idx = stage.phases.indexOf(stage.phase)
  const nextStep = stage.phases[idx + 1] ? PHASE_LABEL[stage.phases[idx + 1]] : null
  const theme = stage.phase === 'talk' && stage.current_theme_id && stage.current_theme_id !== 'ungrouped' ? themes.find((t) => t.id === stage.current_theme_id) ?? null : null
  const checks = topicChecks(stage, checkins.list)
  const round = votes?.current ?? null
  const totals = !round ? votes?.previous.find((r) => r.status === 'closed')?.totals ?? null : null
  const counted = !!totals
  // The most-voted topic, as the talk will open it (ties keep the themes' order).
  const top = totals ? [...themes].sort((a, b) => (totals[b.id] ?? 0) - (totals[a.id] ?? 0))[0]?.title ?? null : null
  const here = stage.attendance.filter(isHere).length
  const title = (id: string | undefined) => (!id ? null : id === 'ungrouped' ? 'Not in a theme' : themes.find((t) => t.id === id)?.title ?? null)
  const asked = (c: CheckinView | null) => (c ? { status: c.status, answers: c.answers } : null)
  const state: CueState | null =
    stage.phase === 'look_back'
      ? { phase: 'look_back', undecided: previous.filter((e) => !(VERDICTS as readonly string[]).includes(e.status)).map((e) => e.change_to_try), decided: previous.filter((e) => (VERDICTS as readonly string[]).includes(e.status)).length, here, total: stage.attendance.length, next: nextStep }
      : stage.phase === 'choose'
        ? { phase: 'choose', topics: themes.length, votes: round ? votePurse(round, themes.map((t) => t.id)).size : fairBudget(budget, themes.length), voters: round?.voters ?? null, people: Math.max(here, round?.voters ?? 0, 1), counted, top, next: nextStep }
        : stage.phase === 'talk' && stage.current_theme_id
          ? {
              phase: 'talk',
              grouped: !!theme,
              question: theme?.question || null,
              takeaway: stage.notes.takeaway,
              couldTry: stage.notes.could_try,
              topicCheck: asked(checks.topic),
              actionCheck: checks.reworded ? null : asked(checks.action),
              waiting: !!stage.has_unreleased_context,
              over: !!stage.timer.total_secs && timeUp,
              nextTopic: topicAt >= 0 && topicAt < topics.length - 1 ? title(topics[topicAt + 1]) : null,
              next: nextStep,
            }
          : stage.phase === 'agree'
            ? { phase: 'agree', experiments: experiments.length, ideas: themes.filter((t) => t.could_try).length, ownerless: experiments.filter((e) => !e.owner_account_id).length }
            : null
  if (!state) return null
  const cue = cueFor(state)
  const focus = (label: string) => {
    const el = document.querySelector<HTMLTextAreaElement>(`.retro-margin textarea[aria-label="${label}"]`)
    el?.focus()
    el?.scrollIntoView?.({ block: 'nearest' })
  }
  const act = (a: CueAction) => {
    if (a === 'next') onForward()
    else if (a === 'end') onEnd()
    else if (a === 'release') void run({ type: 'release_context' })
    else if (a === 'more_time') void run({ type: 'timer_adjust', delta_secs: 120 })
    else if (a === 'write_remember') focus('We’ll remember')
    else if (a === 'write_try') focus('We could try')
    else if (a === 'ask_topic' && theme) void asking.open(theme.id, 'topic')
    else if (a === 'ask_action' && theme) void asking.open(theme.id, 'action', !!checks.action)
    else if (a === 'share_topic' && checks.topic) void asking.share(checks.topic)
    else if (a === 'share_action' && checks.action) void asking.share(checks.action)
  }
  const toggle = () => {
    setSay(!say)
    try {
      localStorage.setItem(CUE_SAY, say ? 'off' : 'on')
    } catch {
      /* remembered for this visit only */
    }
  }
  return <CueCard cue={cue} say={say} onToggle={toggle} onAct={act} />
}

function CueCard({ cue, say, onToggle, onAct }: { cue: CueLine; say: boolean; onToggle: () => void; onAct: (a: CueAction) => void }) {
  const line = say ? cue.say : null
  return (
    <aside className="cue" aria-label="Your cue">
      <div className="cue-head">
        <p className="cue-label">Your cue <span>only on your screen · H to present</span></p>
        <button className="cue-toggle" aria-pressed={say} onClick={onToggle}>{say ? 'Hide lines to say' : 'Show lines to say'}</button>
      </div>
      <div aria-live="polite">
        <div className="cue-body anim-rise" key={`${cue.say}|${cue.act?.do}|${cue.alt?.do}`}>
          {line ? <p className="cue-say">“{line}”</p> : null}
          {cue.hint ? <p className="cue-hint">{cue.hint}</p> : null}
        </div>
      </div>
      {cue.act || cue.alt ? (
        <div className="cue-do">
          {cue.act ? <button className="cue-act" onClick={() => onAct(cue.act!.do)}>{cue.act.label}{cue.act.do === 'next' ? <ArrowRight className="size-4" aria-hidden /> : null}</button> : null}
          {cue.alt ? <button className="cue-alt" onClick={() => onAct(cue.alt!.do)}>{cue.alt.label}</button> : null}
        </div>
      ) : null}
    </aside>
  )
}

// ---------- 4 · Agree ----------
/** How far the room has got: at most three is the aim, so the count is said against it. */
const agreedCount = (n: number) => (n === 0 ? 'none yet' : n <= 3 ? `${n} of up to 3` : `${n} — more than most teams can carry`)

function Agree({ n, themes, experiments, controls, sprintId, participants, onChange, onEnd, checkins, ending, setEnding }: { n: number; themes: ThemeView[]; experiments: Experiment[]; controls: boolean; sprintId: string; participants: { account_id: string; display_name: string; is_facilitator: boolean; is_you: boolean }[]; onChange: () => void; onEnd: () => Promise<void>; checkins: Checkins; ending: boolean; setEnding: (on: boolean) => void }) {
  const ideas = themes.filter((t) => t.could_try || t.takeaway)
  const tryable = ideas.filter((t) => t.could_try)
  const asking = useAsking(sprintId, checkins)
  // The idea in the form: it fills the change in place, keeping whatever else was already typed there.
  const [seed, setSeed] = useState<{ text: string; themeId: string } | null>(null)
  // Ending takes a moment, and everyone's screen moves with it: once asked, it isn't asked twice.
  const [closing, setClosing] = useState(false)
  const end = async () => {
    if (closing) return
    setClosing(true)
    try {
      await onEnd()
    } finally {
      setClosing(false)
    }
  }
  const waiting = experiments.filter((e) => e.status === 'proposed')
  const sub = controls
    ? 'One to three small changes for the next sprint, each with an owner. They come back at the start of the next retro.'
    : 'The team agrees on one to three small changes for the next sprint. If you’re asked to own one, your phone asks you to say yes.'
  return (
    <section>
      <Head n={n} kicker="Agree" title={<>What will we <em>try</em>?</>} sub={sub} />
      <div className="retro-two">
        <div>
          <h2 className="retro-col-title">Agreed so far<span>{agreedCount(experiments.length)}</span></h2>
          {experiments.length ? (
            <ol className="retro-exps mt-3">
              {experiments.map((e) => (
                <li key={e.id} className="retro-exp">
                  <p className="retro-exp-change">{e.change_to_try}</p>
                  <p className="retro-exp-meta">
                    <span data-waiting={(e.owner_name && !e.owner_accepted) || undefined}>{e.owner_name ? (e.owner_accepted ? `${e.owner_name} owns this` : `Waiting for ${e.owner_name} to say yes`) : 'No owner yet'}</span>
                    {e.success_signal ? <span><i>we’ll know by</i> {e.success_signal}</span> : null}
                    <span><i>back on</i> {shortDate(e.review_on)}</span>
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="retro-quiet mt-3">{controls ? (tryable.length ? 'Nothing yet. Start from an idea on the right, or write one below.' : 'Nothing yet. Write the first one below.') : 'The facilitator is writing up what the team agrees to try.'}</p>
          )}
          {controls ? (
            <div className="retro-editor">
              <ExperimentEditor stepwise sprintId={sprintId} participants={participants} themes={themes.map((t) => ({ id: t.id, title: t.title }))} seed={seed} existingCount={experiments.length} onSaved={() => { setSeed(null); onChange() }} />
            </div>
          ) : null}
        </div>
        <aside>
          <h2 className="retro-col-title">Ideas from the talk</h2>
          {ideas.length ? (
            <>
              <p className="retro-aside-line mt-2">{controls ? 'What the room said it could try. Use one as a starting point, or check it with the room first.' : 'What the room said it could try while talking.'}</p>
              <ul className="retro-ideas">
                {ideas.map((t) => {
                  const n = experiments.findIndex((e) => e.theme_id === t.id)
                  return (
                    <li key={t.id}>
                      <p className="retro-idea-theme">{t.title}</p>
                      {t.could_try ? <p className="retro-idea-line"><i>we could try</i>{t.could_try}</p> : null}
                      {t.takeaway ? <p className="retro-idea-line"><i>we’ll remember</i>{t.takeaway}</p> : null}
                      {t.could_try ? <IdeaCheck c={checkins.list.find((c) => c.theme_id === t.id && c.kind === 'action') ?? null} idea={t.could_try} controls={controls} onOpen={(renew) => asking.open(t.id, 'action', renew)} onShare={asking.share} /> : null}
                      {n >= 0 ? (
                        <p className="retro-idea-done">Experiment {n + 1}</p>
                      ) : controls && t.could_try ? (
                        <button
                          className="retro-idea-use"
                          aria-pressed={seed?.themeId === t.id}
                          // Already in the form: pressing again keeps what's been edited there.
                          onClick={() => (seed?.themeId === t.id && seed.text === t.could_try ? undefined : setSeed({ text: t.could_try, themeId: t.id }))}
                        >
                          {seed?.themeId === t.id ? 'In the form — edit it there' : 'Use this idea'} <ArrowRight className="size-3.5" aria-hidden />
                        </button>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </>
          ) : (
            <p className="retro-quiet mt-3">{controls ? 'No “we could try” was noted during the talk. Write an experiment on the left.' : 'Nothing was noted as “we could try” during the talk.'}</p>
          )}
        </aside>
      </div>
      {controls ? (
        <div className="retro-end">
          <Button size="lg" variant="primary" onClick={() => setEnding(true)}>End the retro</Button>
          <span>Every screen and phone shows it’s done; the sprint’s page keeps what the team agreed.</span>
        </div>
      ) : null}
      <Dialog open={ending} onOpenChange={(o) => !closing && setEnding(o)} title="End the retro?" description="Every screen and phone shows the retro is done. The sprint’s page keeps what the team will try, and what it said.">
        {!experiments.length ? <p className="text-sm text-ink-soft">Nothing has been agreed to try yet. You can still add experiments on the sprint’s page.</p> : null}
        {waiting.length ? <p className="text-sm text-ink-soft">{waiting.length === 1 ? 'One experiment is' : `${waiting.length} experiments are`} still waiting for an owner. They can still say yes afterwards.</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" disabled={closing} onClick={() => setEnding(false)}>Not yet</Button>
          <Button variant="primary" busy={closing} onClick={end}>End the retro</Button>
        </div>
      </Dialog>
    </section>
  )
}

/**
 * What the room said about an idea, if it was asked — shown as it came back, never as "endorsed".
 * An idea nobody checked carries no label at all.
 */
function IdeaCheck({ c, idea, controls, onOpen, onShare }: { c: CheckinView | null; idea: string; controls: boolean; onOpen: (renew: boolean) => void; onShare: (c: CheckinView) => void }) {
  const reworded = !!c && c.could_try !== idea
  if (c && !reworded && c.status === 'shared') return c.results?.responded ? <div className="retro-idea-check"><CheckinResult c={c} /></div> : <p className="retro-ask-hint">Checked · no answers came in</p>
  if (!controls) return c && !reworded ? <p className="retro-ask-hint">Being checked on phones</p> : null
  return <AskControl c={reworded ? null : c} idle={reworded ? 'Check this wording with the room' : 'Check it with the room'} onOpen={() => onOpen(reworded)} onShare={onShare} />
}
