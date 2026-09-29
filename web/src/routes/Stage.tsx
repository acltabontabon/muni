import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import * as Popover from '@radix-ui/react-popover'
import { ArrowRight, MonitorPlay, Pause, Play } from 'lucide-react'
import { ApiError, patch, post, put } from '@/api/client'
import type { CheckinView, Experiment, SharedEntry, StageSnapshot, ThemeView, VotingState } from '@/api/types'
import { PHASE_LABEL, categoryMeta } from '@/lib/categories'
import { applyAppearance } from '@/lib/prefs'
import { useStage } from '@/lib/stage'
import { talkTime } from '@/lib/talk-time'
import { shortDate } from '@/lib/schedule'
import { Button, Dialog, Spinner, fmtClock, useCountdown, useDocumentTitle, useToast } from '@/ui'
import { ReconnectingBar } from '@/ui/status'
import { ExperimentEditor } from '@/ui/experiments'
import { BehindLine, CouldntLoad, NoteField, PastExperiment, RetroMap, Thought, TopicHorizon, worthKeeping } from '@/ui/retro'
import { ASK, CheckinResult, kindWord } from '@/ui/checkin'
import { Mark } from '@/brand/Mark'
import { Face } from '@/ui/faces'

type Command = ReturnType<typeof useStage>['command']

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
  useDocumentTitle(sprint ? `${sprint.name} · retro` : 'Retro')
  useEffect(() => {
    applyAppearance({ force: (params.get('theme') as 'light' | 'dark' | null) ?? 'dark' })
    return () => applyAppearance({ force: null })
  }, [params])

  const fac = !!stage?.is_facilitator
  const presenting = params.get('mode') === 'present' || !fac
  const controls = fac && !presenting
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

  useEffect(() => {
    if (!fac) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable) return
      if (e.key === 'ArrowRight') forward()
      else if (e.key === 'ArrowLeft') toStep(phases[phaseIdx - 1])
      else if (e.key.toLowerCase() === 'h') setPresenting(!presenting)
      else if (e.key === 'Escape') setReader(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fac, forward, toStep, phases, phaseIdx, presenting, setPresenting])

  if (st.revoked) return <Centered><p>Your access to this sprint ended.</p></Centered>
  if (st.error) return <Centered><CouldntLoad message={st.error} onRetry={st.reload} /></Centered>
  if (!sprint || !st.ready) return <Centered><Spinner /></Centered>
  const done = ['completed', 'archived'].includes(sprint.status) || (!!stage?.ended_at && !stage.cancelled)
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
    <div className="stage retro min-h-dvh text-ink" data-presenting={presenting || undefined}>
      <Rail stage={stage} name={sprint.name} controls={controls} onStep={toStep} onForward={forward} topics={topics} topicAt={topicAt} themes={themes} sprintId={sprintId} onPresent={st.putStage} command={command} />
      <Arrivals stage={stage} />
      <main className="retro-main">
        <ReconnectingBar status={st.live} />
        {st.stale && st.live !== 'reconnecting' ? <BehindLine onRetry={st.reload} /> : null}
        {stage.phase === 'look_back' ? <LookBack stage={stage} previous={previous} wins={worthKeeping([...themes.flatMap((t) => t.entries), ...ungrouped])} controls={controls} onVerdict={async (e, status) => { try { st.putPrevious(await patch<Experiment[]>(`/api/sprints/${e.sprint_id}/experiments/${e.id}`, { status })) } catch (err) { toast(err instanceof ApiError ? err.message : 'Couldn’t save', 'danger') } }} /> : null}
        {stage.phase === 'choose' ? <Choose stage={stage} themes={themes} ungrouped={ungrouped} votes={votes} controls={controls} sprintId={sprintId} budget={sprint.vote_budget} onRead={setReader} onVotes={st.putVotes} /> : null}
        {stage.phase === 'talk' ? <Talk stage={stage} themes={themes} ungrouped={ungrouped} topics={topics} controls={controls} command={run} onNote={saveNote} sprintId={sprintId} checkins={{ list: st.checkins, put: st.putCheckin }} /> : null}
        {stage.phase === 'agree' ? <Agree themes={themes} experiments={experiments} controls={controls} sprintId={sprintId} participants={sprint.participants} onChange={() => void st.refresh('experiments')} checkins={{ list: st.checkins, put: st.putCheckin }} onEnd={async () => { try { await post(`/api/sprints/${sprintId}/transition`, { to: 'completed' }); nav(`/sprints/${sprintId}`) } catch (e) { toast(e instanceof ApiError ? e.message : 'Couldn’t end the retro', 'danger') } }} /> : null}
      </main>
      <div className="retro-corner">
        {fac ? (
          <>
            {!stage.you_control && !presenting ? <button className="retro-chip retro-chip--warn" onClick={() => run({ type: 'take_control' })}>{stage.controller_name ? `${stage.controller_name} is leading · take over` : 'Take over'}</button> : null}
            <button className="retro-chip" onClick={() => setPresenting(!presenting)} aria-pressed={presenting} title="H">
              <MonitorPlay className="size-3.5" /> {presenting ? 'Presenting · show controls' : 'Present on this screen'}
            </button>
          </>
        ) : (
          <Link to={`/sprints/${sprintId}/room`} className="retro-chip">Answer and add from here</Link>
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

// ---------- the rail: where the retro is, and the one next step ----------
function Rail({ stage, name, controls, onStep, onForward, topics, topicAt, themes, sprintId, onPresent, command }: { stage: StageSnapshot; name: string; controls: boolean; onStep: (p: string) => void; onForward: () => void; topics: string[]; topicAt: number; themes: ThemeView[]; sprintId: string; onPresent: (s: StageSnapshot) => void; command: Command }) {
  const idx = stage.phases.indexOf(stage.phase)
  const nextStep = stage.phases[idx + 1]
  const nextTopic = stage.phase === 'talk' && topicAt >= 0 && topicAt < topics.length - 1 ? topics[topicAt + 1] : null
  const nextLabel = nextTopic ? `Next topic` : nextStep ? PHASE_LABEL[nextStep] : null
  const present = stage.attendance.filter((a) => a.present)
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
          {controls ? <People stage={stage} sprintId={sprintId} onPresent={onPresent} command={command} /> : <span className="retro-room retro-room--still" aria-label={`${present.length} here`}><span className="retro-room-faces" aria-hidden>{stage.attendance.filter((a) => a.connected || a.present).slice(0, 5).map((a) => <Face key={a.account_id} a={a} state={a.connected ? 'on' : a.present ? 'here' : 'away'} />)}</span><span className="retro-room-n">{present.length}<span> here</span></span></span>}
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

/** A small, steady number from a string: the same person always gets the same line. */
const hashOf = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)

const ARRIVED = [
  (n: string) => `${n} pulled up a chair.`,
  (n: string) => `${n} is here, fashionably on time.`,
  (n: string) => `${n} slipped in quietly. Very on brand.`,
  (n: string) => `${n} arrived. The room is 4% wiser.`,
  (n: string) => `${n} joined — snacks unconfirmed.`,
  (n: string) => `${n} is in. No pressure to speak first.`,
  (n: string) => `${n} found the room. Nobody had to send the link twice.`,
  (n: string) => `${n} made it. The retro can now begin to begin.`,
  (n: string) => `${n} is here, and has thoughts. Probably.`,
]
const LEFT = [
  (n: string) => `${n} stepped out. The chair stays warm.`,
  (n: string) => `${n} dropped off — the door’s still open.`,
  (n: string) => `${n} wandered off. Their thoughts stayed.`,
]
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name

/**
 * Arrivals and departures on the stage, as the room fills: a line each, for a few seconds. Only
 * changes after the first look count — opening the stage doesn't announce everyone already there —
 * and moving between pages isn't leaving: a departure is said only if they're still gone after a
 * few seconds, and coming back within them says nothing at all.
 */
const LEAVE_GRACE_MS = 8000
function useArrivals(attendance: Attendee[], session: string) {
  const seen = useRef<Map<string, boolean> | null>(null)
  const leaving = useRef(new Map<string, number>())
  const [lines, setLines] = useState<{ key: string; text: string; face: Attendee; kind: 'in' | 'out' }[]>([])
  const say = useCallback((line: { key: string; text: string; face: Attendee; kind: 'in' | 'out' }) => {
    setLines((l) => [...l, line].slice(-3))
    // Each line leaves on its own clock, even if someone else arrives meanwhile.
    window.setTimeout(() => setLines((l) => l.filter((x) => x !== line)), 5200)
  }, [])
  useEffect(() => {
    const now = new Map(attendance.map((a) => [a.account_id, a.connected]))
    const before = seen.current
    seen.current = now
    if (!before) return
    for (const a of attendance) {
      if (a.is_you) continue
      const was = before.get(a.account_id) ?? false
      const pending = leaving.current.get(a.account_id)
      if (a.connected && !was) {
        if (pending !== undefined) {
          // Back within the grace: they only changed pages.
          window.clearTimeout(pending)
          leaving.current.delete(a.account_id)
        } else say({ key: `${a.account_id}:in:${Date.now()}`, text: ARRIVED[hashOf(a.account_id + session) % ARRIVED.length](firstName(a.display_name)), face: a, kind: 'in' })
      } else if (!a.connected && was && pending === undefined) {
        leaving.current.set(
          a.account_id,
          window.setTimeout(() => {
            leaving.current.delete(a.account_id)
            say({ key: `${a.account_id}:out:${Date.now()}`, text: LEFT[hashOf(a.account_id + session) % LEFT.length](firstName(a.display_name)), face: a, kind: 'out' })
          }, LEAVE_GRACE_MS),
        )
      }
    }
  }, [attendance, session, say])
  useEffect(() => {
    const timers = leaving.current
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [])
  return lines
}

/** The lines as people come and go, under the rail. */
function Arrivals({ stage }: { stage: StageSnapshot }) {
  const lines = useArrivals(stage.attendance, stage.session_id)
  return (
    <div className="retro-arrivals" aria-live="polite">
      {lines.map((l) => (
        <p key={l.key} className="retro-arrival" data-kind={l.kind}>
          <Face a={l.face} state={l.kind === 'in' ? 'on' : 'away'} size="lg" /> <span>{l.text}</span>
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
        <button className="retro-room" aria-label={`Who’s here: ${connected} of ${people.length} connected`}>
          <span className="retro-room-faces" aria-hidden>
            {people.slice(0, 5).map((a) => <Face key={a.account_id} a={a} state={a.connected ? 'on' : a.present ? 'here' : 'away'} />)}
          </span>
          <span className="retro-room-n">{connected}<span>/{people.length}</span></span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="retro-pop anim-rise">
          <p className="retro-pop-title">Who’s here <span>{connected} of {people.length} connected</span></p>
          <p className="retro-pop-hint">Lit while someone has the retro open, on the stage or their phone. Tick someone who’s in the room without a device.</p>
          <ul className="retro-pop-list">
            {people.map((a) => (
              <li key={a.account_id}>
                <label>
                  <input type="checkbox" checked={a.present} disabled={saving === a.account_id} aria-label={`${a.display_name} is here`} onChange={() => void mark(a)} />
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
function LookBack({ stage, previous, wins, controls, onVerdict }: { stage: StageSnapshot; previous: Experiment[]; wins: SharedEntry[]; controls: boolean; onVerdict: (e: Experiment, status: string) => void }) {
  return (
    <section>
      <Head n={1} kicker="Look back" title={previous.length ? <>Last time, we said we’d <em>try</em>…</> : <>Your first retro <em>here</em>.</>} sub={previous.length ? 'Did it help? “Inconclusive” and “not tried yet” are honest answers.' : 'What you agree to try today comes back to this screen next time, to see if it helped.'} />
      <RetroMap phases={stage.phases} plan={stage.plan} now={stage.phase} />
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

function Choose({ stage, themes, ungrouped, votes, controls, sprintId, budget, onRead, onVotes }: { stage: StageSnapshot; themes: ThemeView[]; ungrouped: SharedEntry[]; votes: ReturnType<typeof useStage>['votes']; controls: boolean; sprintId: string; budget: number; onRead: (id: string) => void; onVotes: (v: VotingState) => void }) {
  const toast = useToast()
  const round = votes?.current ?? null
  const closed = votes?.previous.find((r) => r.status === 'closed') ?? null
  const totals = !round ? closed?.totals ?? null : null
  const max = totals ? Math.max(1, ...Object.values(totals)) : 1
  const list = totals ? [...themes].sort((a, b) => (totals[b.id] ?? 0) - (totals[a.id] ?? 0)) : themes
  const { reach, minutes, per } = talkTime(stage.plan, themes.length)
  const each = Math.min(round?.budget ?? budget, themes.length)
  const people = stage.attendance.length
  const single = themes.length <= 1
  // The answer is the voting as it now stands (your votes, what's left): shown as it is.
  const vote = async (id: string, cast: boolean) => {
    try {
      onVotes(await post<VotingState>(`/api/sprints/${sprintId}/votes`, { theme_id: id, cast }))
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Couldn’t vote', 'danger')
    }
  }
  const sub = single
    ? 'There’s only one topic, so there’s nothing to choose between. Move on and talk about it.'
    : totals
      ? <>The votes are in. The talk starts at the top and goes down the list — there’s time for about <strong>{nWord(reach)}</strong>.</>
      : <>The talk has about {minutes} minutes: time for about <strong>{nWord(reach)} of these {themes.length} topics</strong>, around {per} minutes each. Vote for the ones you most want to talk about — the most-voted go first.</>
  return (
    <section>
      <Head n={2} kicker="Choose" title={<>What matters <em>most</em>?</>} sub={sub} />
      <div className="retro-two">
        <div>
          <ol className="retro-topics">
            {list.map((t, i) => {
              const mine = round?.my_votes.includes(t.id)
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
                  ) : round && controls && !single ? (
                    <button className="retro-vote" aria-pressed={!!mine} disabled={!mine && round.my_remaining <= 0} onClick={() => vote(t.id, !mine)}>{mine ? 'Your vote ✓' : 'Vote'}</button>
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
              <p className="rm-big">{round.voters ?? 0}<span> of {people} {people === 1 ? 'person' : 'people'}</span></p>
              <span className="rm-dots" aria-hidden>{Array.from({ length: people }, (_, i) => <i key={i} data-on={i < (round.voters ?? 0) || undefined} />)}</span>
              <p className="rm-text">Move on when most have voted. <strong>Next: Talk</strong> counts the votes and opens the top topic.</p>
              <p className="rm-text rm-quiet">Your own: {round.my_remaining} of {round.budget} left{round.my_remaining < round.budget ? '' : ' — vote here or on your phone'}.</p>
            </div>
          ) : null}
          {!single && !totals ? (
            <div className="rm-block">
              <p className="retro-note-label">How voting works</p>
              <ol className="rm-steps">
                <li><strong>{each === 1 ? 'One vote each.' : `${nWord(each)[0].toUpperCase()}${nWord(each).slice(1)} votes each, one per topic.`}</strong> {each === 1 ? 'The one topic that matters most to you.' : `Like picking your top ${nWord(each)}: enough to say what matters, too few to vote for everything.`}</li>
                <li><strong>Private.</strong> Nobody sees whose votes are whose, not even the facilitator. The counts appear when the room moves on.</li>
                <li><strong>Then the talk</strong> takes the topics from the top. Anything not reached stays on the sprint’s page.</li>
              </ol>
              {controls ? <p className="rm-text rm-quiet">The number of votes is set in the sprint’s setup (1–10).</p> : <p className="rm-text">Vote on your phone, or on this screen if it’s yours.</p>}
            </div>
          ) : null}
          {totals ? (
            <div className="rm-block">
              <p className="retro-note-label">What happens next</p>
              <p className="rm-text">The talk opens <strong>{list[0]?.title}</strong> first, with about {per} minutes on the clock — guidance, not a cut-off.</p>
              {controls ? <p className="rm-text rm-quiet"><button className="retro-link" onClick={async () => { try { onVotes(await post<VotingState>(`/api/sprints/${sprintId}/votes/rounds`, {})) } catch (e) { toast(e instanceof ApiError ? e.message : 'Couldn’t open voting', 'danger') } }}>Vote again</button> — clears these votes and opens a new round.</p> : null}
            </div>
          ) : null}
        </aside>
      </div>
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

function Talk({ stage, themes, ungrouped, topics, controls, command, onNote, sprintId, checkins }: { stage: StageSnapshot; themes: ThemeView[]; ungrouped: SharedEntry[]; topics: string[]; controls: boolean; command: (c: Parameters<Command>[0]) => void; onNote: (themeId: string, field: 'takeaway' | 'could_try', value: string) => Promise<void>; sprintId: string; checkins: Checkins }) {
  const current = stage.current_theme_id
  const theme = current && current !== 'ungrouped' ? themes.find((t) => t.id === current) ?? null : null
  const pos = current ? topics.indexOf(current) : -1
  const title = (id: string) => (id === 'ungrouped' ? 'Not in a theme' : themes.find((t) => t.id === id)?.title ?? '')
  const asking = useAsking(sprintId, checkins)
  if (!current || pos < 0)
    return (
      <section>
        <Head n={3} kicker="Talk" title={<>Where do we <em>start</em>?</>} />
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
  const topicCheck = theme ? checkins.list.find((c) => c.theme_id === theme.id && c.kind === 'topic') ?? null : null
  const actionCheck = theme ? checkins.list.find((c) => c.theme_id === theme.id && c.kind === 'action') ?? null : null
  // An idea reworded after it was checked: its answers were about other words, so they aren't shown as its answers.
  const reworded = !!actionCheck && !!stage.notes.could_try && actionCheck.could_try !== stage.notes.could_try
  return (
    <section key={current} className="retro-talk anim-rise">
      <TopicHorizon topics={topics} current={current} discussed={stage.discussed_theme_ids} titleOf={title} onPick={controls ? (id) => command({ type: 'set_topic', theme_id: id }) : undefined} />
      <div className="retro-talk-main">
        <p className="retro-kicker retro-kicker--now"><span>03</span>Now talking about · topic {pos + 1} of {topics.length}{typeof theme?.votes === 'number' && theme.votes > 0 ? ` · ${theme.votes} ${theme.votes === 1 ? 'vote' : 'votes'}` : ''}</p>
        <h1 className="retro-talk-title">{theme ? theme.title : 'Not in a theme'}</h1>
        {theme?.question ? <p className="retro-talk-q">{theme.question}</p> : !theme ? <p className="retro-talk-q">The thoughts nobody grouped, exactly as written.</p> : null}
        {topicCheck ? <Moment c={topicCheck} /> : null}
        {actionCheck && !reworded ? <Moment c={actionCheck} /> : null}
        <ul className="retro-thoughts retro-thoughts--talk">{entries.map((e) => <Thought key={e.id} e={e} />)}</ul>
        {theme?.context.length ? (
          <div className="retro-added">
            <h2 className="retro-col-title">Added during the retro <span>without names</span></h2>
            <ul className="retro-thoughts">
              {theme.context.map((c) => (
                <li key={c.id} className="retro-thought retro-thought--added anim-rise">
                  <span className="retro-cat">{kindWord(c.kind)}</span>
                  <div className="retro-words"><p className="retro-text">{c.body}</p></div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <aside className="retro-margin">
        <Clock stage={stage} controls={controls} command={command} />
        {controls && theme ? (
          <div className="rm-block">
            <p className="retro-note-label">Ask the room</p>
            <p className="rm-text rm-quiet">A private question on every phone: did this show up in your work? Useful when only a few are talking.</p>
            <div className="retro-asks">
              <AskControl c={topicCheck} idle="Ask how it showed up" onOpen={() => asking.open(theme.id, 'topic')} onShare={asking.share} />
            </div>
          </div>
        ) : null}
        {theme ? (
          <div className="rm-block">
            <Note label="We’ll remember" value={stage.notes.takeaway} controls={controls} placeholder="What the room takes from this, in a line" onSave={(v) => onNote(theme.id, 'takeaway', v)} />
            <div className="retro-note-group">
              <Note label="We could try" value={stage.notes.could_try} controls={controls} placeholder="An idea to try — it waits for Agree" onSave={(v) => onNote(theme.id, 'could_try', v)} />
              {controls && stage.notes.could_try ? <AskControl c={reworded ? null : actionCheck} idle={reworded ? 'Check this wording with the room' : 'Check it with the room'} onOpen={() => asking.open(theme.id, 'action', reworded)} onShare={asking.share} quiet /> : null}
            </div>
            {!controls && !stage.notes.takeaway && !stage.notes.could_try ? <p className="rm-text rm-quiet">What the room will remember, and ideas to try, appear here.</p> : null}
          </div>
        ) : null}
        {controls && stage.has_unreleased_context ? (
          <button className="retro-waiting" onClick={() => command({ type: 'release_context' })}>
            <span>Someone added to the discussion from their phone, without a name.</span> Share it with the room
          </button>
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

/** The facilitator's side of a check-in: ask; then share when it helps, or just keep talking. */
function AskControl({ c, idle, onOpen, onShare, quiet }: { c: CheckinView | null; idle: string; onOpen: () => void; onShare: (c: CheckinView) => void; quiet?: boolean }) {
  if (!c) return <button className={quiet ? 'retro-link retro-ask-quiet' : 'retro-ask'} onClick={onOpen}>{idle}</button>
  if (c.status === 'open')
    return (
      <div className="retro-asking">
        <p className="retro-asking-n">{c.answers ? `${c.answers} ${c.answers === 1 ? 'answer' : 'answers'} so far` : 'Asked · no answers yet'}</p>
        <button className="retro-ask retro-ask--share" onClick={() => onShare(c)}>Share answers</button>
        <p className="retro-ask-hint">Shows the counts and lines, without names, and closes it. Or keep talking: it stays open.</p>
      </div>
    )
  return <p className="retro-ask-hint">{c.results?.responded ? `Shared · ${c.results.responded} ${c.results.responded === 1 ? 'answer' : 'answers'}` : 'Shared · no answers came in'}</p>
}

/** A topic's timebox: guidance, never a cut-off. */
function Clock({ stage, controls, command }: { stage: StageSnapshot; controls: boolean; command: (c: Parameters<Command>[0]) => void }) {
  const remaining = useCountdown(stage.timer.ends_at ?? null, stage.timer.remaining_secs, stage.server_time)
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

// ---------- 4 · Agree ----------
/** How far the room has got: at most three is the aim, so the count is said against it. */
const agreedCount = (n: number) => (n === 0 ? 'none yet' : n <= 3 ? `${n} of up to 3` : `${n} — more than most teams can carry`)

function Agree({ themes, experiments, controls, sprintId, participants, onChange, onEnd, checkins }: { themes: ThemeView[]; experiments: Experiment[]; controls: boolean; sprintId: string; participants: { account_id: string; display_name: string; is_facilitator: boolean; is_you: boolean }[]; onChange: () => void; onEnd: () => Promise<void>; checkins: Checkins }) {
  const ideas = themes.filter((t) => t.could_try || t.takeaway)
  const tryable = ideas.filter((t) => t.could_try)
  const asking = useAsking(sprintId, checkins)
  const [seed, setSeed] = useState<{ text: string; theme: string } | null>(null)
  const [ending, setEnding] = useState(false)
  const waiting = experiments.filter((e) => e.status === 'proposed')
  const sub = controls
    ? 'Agree on one to three small changes for the next sprint. Each gets an owner, who says yes on their phone. They come back at the start of the next retro.'
    : 'The team agrees on one to three small changes for the next sprint. If you’re asked to own one, your phone asks you to say yes.'
  return (
    <section>
      <Head n={4} kicker="Agree" title={<>What will we <em>try</em>?</>} sub={sub} />
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
              <ExperimentEditor key={seed ? `${seed.theme}:${seed.text}` : 'blank'} sprintId={sprintId} participants={participants} themes={themes.map((t) => ({ id: t.id, title: t.title }))} defaultText={seed?.text} defaultThemeId={seed?.theme} existingCount={experiments.length} onSaved={() => { setSeed(null); onChange() }} />
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
                          aria-pressed={seed?.theme === t.id}
                          onClick={() => setSeed({ text: t.could_try, theme: t.id })}
                        >
                          {seed?.theme === t.id ? 'In the form — edit it there' : 'Use this idea'} <ArrowRight className="size-3.5" aria-hidden />
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
          <span>When you’re done. Everyone moves to the sprint’s outcomes, where experiments can still be added and edited.</span>
        </div>
      ) : null}
      <Dialog open={ending} onOpenChange={setEnding} title="End the retro?" description="Everyone’s screen moves to the sprint’s outcomes: what the team will try, and what it said.">
        {!experiments.length ? <p className="text-sm text-ink-soft">Nothing has been agreed to try yet. You can still add experiments on the outcomes page.</p> : null}
        {waiting.length ? <p className="text-sm text-ink-soft">{waiting.length === 1 ? 'One experiment is' : `${waiting.length} experiments are`} still waiting for an owner. They can still say yes afterwards.</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setEnding(false)}>Not yet</Button>
          <Button variant="primary" onClick={async () => { await onEnd(); setEnding(false) }}>End the retro</Button>
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
  return <AskControl c={reworded ? null : c} idle={reworded ? 'Check this wording with the room' : 'Check it with the room'} onOpen={() => onOpen(reworded)} onShare={onShare} quiet />
}
