import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import * as Popover from '@radix-ui/react-popover'
import { ArrowRight, MonitorPlay, Pause, Play, Users } from 'lucide-react'
import { ApiError, patch, post, put } from '@/api/client'
import type { CheckinView, Experiment, SharedEntry, StageSnapshot, ThemeView } from '@/api/types'
import { PHASE_LABEL, categoryMeta } from '@/lib/categories'
import { applyAppearance } from '@/lib/prefs'
import { useStage } from '@/lib/stage'
import { Button, Dialog, Spinner, fmtClock, useCountdown, useDocumentTitle, useToast } from '@/ui'
import { ReconnectingBar } from '@/ui/status'
import { ExperimentEditor } from '@/ui/experiments'
import { NoteField, PastExperiment, Thought, worthKeeping } from '@/ui/retro'
import { ASK, CheckinResult, kindWord } from '@/ui/checkin'
import { Mark } from '@/brand/Mark'

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

  // Being on the stage is being at the retro.
  const me = stage?.attendance.find((a) => a.is_you)
  useEffect(() => {
    if (me && !me.present && !stage?.ended_at) post(`/api/sprints/${sprintId}/meeting/attendance`, { present: true }).catch(() => {})
  }, [me?.account_id, stage?.session_id]) // eslint-disable-line react-hooks/exhaustive-deps

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
  if (st.error) return <Centered><p>{st.error}</p></Centered>
  if (!sprint) return <Centered><Spinner /></Centered>
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
  const saveNote = async (themeId: string, field: 'takeaway' | 'could_try', value: string) => {
    try {
      st.setStage(await put<StageSnapshot>(`/api/sprints/${sprintId}/meeting/notes/${themeId}`, { [field]: value }))
      st.loadThemes()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Couldn’t save', 'danger')
      throw e
    }
  }

  return (
    <div className="stage retro min-h-dvh text-ink" data-presenting={presenting || undefined}>
      <Rail stage={stage} name={sprint.name} controls={controls} onStep={toStep} onForward={forward} topics={topics} topicAt={topicAt} themes={themes} sprintId={sprintId} onChange={st.reload} command={command} />
      <main className="retro-main">
        <ReconnectingBar status={st.live} />
        {stage.phase === 'look_back' ? <LookBack previous={previous} wins={worthKeeping([...themes.flatMap((t) => t.entries), ...ungrouped])} controls={controls} onVerdict={async (e, status) => { try { await patch(`/api/sprints/${e.sprint_id}/experiments/${e.id}`, { status }); st.loadExperiments() } catch (err) { toast(err instanceof ApiError ? err.message : 'Couldn’t save', 'danger') } }} /> : null}
        {stage.phase === 'choose' ? <Choose themes={themes} ungrouped={ungrouped} votes={votes} controls={controls} sprintId={sprintId} budget={sprint.vote_budget} onRead={setReader} onVotes={() => { st.loadVotes(); st.loadThemes() }} /> : null}
        {stage.phase === 'talk' ? <Talk stage={stage} themes={themes} ungrouped={ungrouped} topics={topics} controls={controls} command={run} onNote={saveNote} sprintId={sprintId} checkins={{ list: st.checkins, put: st.putCheckin }} /> : null}
        {stage.phase === 'agree' ? <Agree themes={themes} experiments={experiments} controls={controls} sprintId={sprintId} participants={sprint.participants} onChange={st.loadExperiments} checkins={{ list: st.checkins, put: st.putCheckin }} onEnd={async () => { try { await post(`/api/sprints/${sprintId}/transition`, { to: 'completed' }); nav(`/sprints/${sprintId}`) } catch (e) { toast(e instanceof ApiError ? e.message : 'Couldn’t end the retro', 'danger') } }} /> : null}
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
function Rail({ stage, name, controls, onStep, onForward, topics, topicAt, themes, sprintId, onChange, command }: { stage: StageSnapshot; name: string; controls: boolean; onStep: (p: string) => void; onForward: () => void; topics: string[]; topicAt: number; themes: ThemeView[]; sprintId: string; onChange: () => void; command: Command }) {
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
          {controls ? <People stage={stage} sprintId={sprintId} onChange={onChange} command={command} /> : <span className="retro-here"><Users className="size-3.5" /> {present.length} here</span>}
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

/** Who's here. People mark themselves by opening the retro; the facilitator can correct it. */
function People({ stage, sprintId, onChange, command }: { stage: StageSnapshot; sprintId: string; onChange: () => void; command: Command }) {
  const present = stage.attendance.filter((a) => a.present).length
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="retro-here retro-here--button" aria-label="Who’s here"><Users className="size-3.5" /> {present} here</button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="retro-pop anim-rise">
          <p className="retro-pop-title">Who’s here</p>
          <p className="retro-pop-hint">Opening the retro on a phone or laptop marks someone here.</p>
          <ul className="retro-pop-list">
            {stage.attendance.map((a) => (
              <li key={a.account_id}>
                <label>
                  <input type="checkbox" checked={a.present} onChange={async () => { await post(`/api/sprints/${sprintId}/meeting/attendance/${a.account_id}`, { present: !a.present }); onChange() }} />
                  <span>{a.display_name}</span>
                  {a.is_facilitator ? <em>facilitating</em> : null}
                </label>
              </li>
            ))}
          </ul>
          {!stage.you_control ? <button className="retro-pop-action" onClick={() => command({ type: 'take_control' })}>Take over leading</button> : null}
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
function LookBack({ previous, wins, controls, onVerdict }: { previous: Experiment[]; wins: SharedEntry[]; controls: boolean; onVerdict: (e: Experiment, status: string) => void }) {
  return (
    <section>
      <Head n={1} kicker="Look back" title={previous.length ? <>Last time, we said we’d <em>try</em>…</> : <>Your first retro <em>here</em>.</>} sub={previous.length ? 'Did it help? “Inconclusive” and “not tried yet” are honest answers.' : 'What you agree to try today comes back to this screen next time, to see if it helped.'} />
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
function Choose({ themes, ungrouped, votes, controls, sprintId, budget, onRead, onVotes }: { themes: ThemeView[]; ungrouped: SharedEntry[]; votes: ReturnType<typeof useStage>['votes']; controls: boolean; sprintId: string; budget: number; onRead: (id: string) => void; onVotes: () => void }) {
  const toast = useToast()
  const round = votes?.current ?? null
  const closed = votes?.previous.find((r) => r.status === 'closed') ?? null
  const totals = !round ? closed?.totals ?? null : null
  const max = totals ? Math.max(1, ...Object.values(totals)) : 1
  const list = totals ? [...themes].sort((a, b) => (totals[b.id] ?? 0) - (totals[a.id] ?? 0)) : themes
  const vote = async (id: string, cast: boolean) => {
    try {
      await post(`/api/sprints/${sprintId}/votes`, { theme_id: id, cast })
      onVotes()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Couldn’t vote', 'danger')
    }
  }
  return (
    <section>
      <Head
        n={2}
        kicker="Choose"
        title={<>What matters <em>most</em>?</>}
        sub={round ? <>Vote on your phone: {round.budget} {round.budget === 1 ? 'vote' : 'votes'} each, private. The count shows when we move on.</> : totals ? 'The votes are in. The talk takes the topics in this order.' : `Everyone gets ${budget} votes, on their phone.`}
      />
      <ol className="retro-topics">
        {list.map((t, i) => {
          const mine = round?.my_votes.includes(t.id)
          const n = totals?.[t.id] ?? 0
          return (
            <li key={t.id} className="retro-topic">
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
              ) : round && controls ? (
                <button className="retro-vote" aria-pressed={!!mine} onClick={() => vote(t.id, !mine)}>{mine ? 'Your vote' : 'Vote'}</button>
              ) : null}
            </li>
          )
        })}
      </ol>
      {ungrouped.length ? <p className="retro-aside-line">Not in a theme: <button className="retro-link" onClick={() => onRead('ungrouped')}>{ungrouped.length} {ungrouped.length === 1 ? 'thought' : 'thoughts'}</button>, talked about after the themes.</p> : null}
      {round && controls ? <p className="retro-aside-line">Your own votes: {round.my_remaining} of {round.budget} left.</p> : null}
      {totals && controls ? (
        <p className="retro-aside-line"><button className="retro-link" onClick={async () => { try { await post(`/api/sprints/${sprintId}/votes/rounds`, {}); onVotes() } catch (e) { toast(e instanceof ApiError ? e.message : 'Couldn’t open voting', 'danger') } }}>Vote again</button> — clears these votes and opens a new round.</p>
      ) : null}
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
  const openNow = [topicCheck, reworded ? null : actionCheck].filter((c) => c?.status === 'open') as CheckinView[]
  const onPhones = openNow.length === 2 ? 'this topic, and both questions' : openNow[0]?.kind === 'topic' ? 'this topic, and how it showed up' : openNow[0] ? 'this topic, and the idea to check' : 'this topic, and a way to add to it'
  return (
    <section key={current} className="retro-talk anim-rise">
      <div className="retro-talk-main">
        <p className="retro-kicker"><span>03</span>Topic {pos + 1} of {topics.length}{typeof theme?.votes === 'number' && theme.votes > 0 ? ` · ${theme.votes} ${theme.votes === 1 ? 'vote' : 'votes'}` : ''}</p>
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
        {controls ? <p className="retro-seen"><span>On phones</span> {onPhones}</p> : null}
        <Clock stage={stage} controls={controls} command={command} />
        {controls && theme ? (
          <div className="retro-asks">
            <AskControl c={topicCheck} idle="Ask how it showed up" onOpen={() => asking.open(theme.id, 'topic')} onShare={asking.share} />
          </div>
        ) : null}
        {theme ? (
          <>
            <Note label="We’ll remember" value={stage.notes.takeaway} controls={controls} placeholder="What the room takes from this, in a line" onSave={(v) => onNote(theme.id, 'takeaway', v)} />
            <div className="retro-note-group">
              <Note label="We could try" value={stage.notes.could_try} controls={controls} placeholder="An idea to try — it waits for Agree" onSave={(v) => onNote(theme.id, 'could_try', v)} />
              {controls && stage.notes.could_try ? <AskControl c={reworded ? null : actionCheck} idle={reworded ? 'Check this wording with the room' : 'Check it with the room'} onOpen={() => asking.open(theme.id, 'action', reworded)} onShare={asking.share} quiet /> : null}
            </div>
          </>
        ) : null}
        {controls && stage.has_unreleased_context ? (
          <button className="retro-waiting" onClick={() => command({ type: 'release_context' })}>
            <span>Something was added, without a name.</span> Share it with the room
          </button>
        ) : null}
      </aside>
      <nav className="retro-topicbar" aria-label="Topics">
        <ol>
          {topics.map((id, i) => (
            <li key={id} data-now={id === current || undefined} data-done={(id !== current && stage.discussed_theme_ids.includes(id)) || undefined}>
              {controls && id !== current ? <button onClick={() => command({ type: 'set_topic', theme_id: id })}><span>{i + 1}</span>{title(id)}</button> : <span><span>{i + 1}</span>{title(id)}</span>}
            </li>
          ))}
        </ol>
      </nav>
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
function Agree({ themes, experiments, controls, sprintId, participants, onChange, onEnd, checkins }: { themes: ThemeView[]; experiments: Experiment[]; controls: boolean; sprintId: string; participants: { account_id: string; display_name: string; is_facilitator: boolean; is_you: boolean }[]; onChange: () => void; onEnd: () => Promise<void>; checkins: Checkins }) {
  const ideas = themes.filter((t) => t.could_try || t.takeaway)
  const asking = useAsking(sprintId, checkins)
  const [seed, setSeed] = useState<{ text: string; theme: string } | null>(null)
  const [ending, setEnding] = useState(false)
  const waiting = experiments.filter((e) => e.status === 'proposed')
  return (
    <section>
      <Head n={4} kicker="Agree" title={<>What will we <em>try</em>?</>} sub="One to three changes, each with someone who says yes. They open the next retro." />
      <div className="retro-two">
        <div>
          {experiments.length ? (
            <ol className="retro-exps">
              {experiments.map((e) => (
                <li key={e.id} className="retro-exp">
                  <p className="retro-exp-change">{e.change_to_try}</p>
                  <p className="retro-exp-meta">
                    <span data-waiting={!e.owner_accepted || undefined}>{e.owner_name ? (e.owner_accepted ? `${e.owner_name} owns this` : `Waiting for ${e.owner_name} to say yes`) : 'No owner yet'}</span>
                    {e.success_signal ? <span><i>we’ll know by</i> {e.success_signal}</span> : null}
                  </p>
                </li>
              ))}
            </ol>
          ) : !controls ? <p className="retro-quiet">Nothing agreed yet.</p> : null}
          {controls ? (
            <div className="retro-editor">
              <ExperimentEditor key={seed ? `${seed.theme}:${seed.text}` : 'blank'} sprintId={sprintId} participants={participants} themes={themes.map((t) => ({ id: t.id, title: t.title }))} defaultText={seed?.text} defaultThemeId={seed?.theme} existingCount={experiments.length} onSaved={() => { setSeed(null); onChange() }} />
            </div>
          ) : <p className="retro-aside-line">If you’re asked to own one, your phone asks you.</p>}
        </div>
        <aside>
          <h2 className="retro-col-title">From the talk</h2>
          {ideas.length ? (
            <ul className="retro-ideas">
              {ideas.map((t) => (
                <li key={t.id}>
                  <p className="retro-idea-theme">{t.title}</p>
                  {t.takeaway ? <p className="retro-idea-line"><i>we’ll remember</i>{t.takeaway}</p> : null}
                  {t.could_try ? <p className="retro-idea-line"><i>we could try</i>{t.could_try}</p> : null}
                  {t.could_try ? <IdeaCheck c={checkins.list.find((c) => c.theme_id === t.id && c.kind === 'action') ?? null} idea={t.could_try} controls={controls} onOpen={(renew) => asking.open(t.id, 'action', renew)} onShare={asking.share} /> : null}
                  {experiments.some((e) => e.theme_id === t.id) ? (
                    <p className="retro-idea-done">Experiment {experiments.findIndex((e) => e.theme_id === t.id) + 1}</p>
                  ) : controls && t.could_try ? (
                    <button className="retro-link" onClick={() => setSeed({ text: t.could_try, theme: t.id })}>Make it an experiment</button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : <p className="retro-quiet">Ideas noted while talking (“we could try”) wait here.</p>}
        </aside>
      </div>
      {controls ? (
        <div className="retro-end">
          <Button size="lg" variant="primary" onClick={() => setEnding(true)}>End the retro</Button>
          <span>Everyone goes to the sprint’s outcomes. They stay editable.</span>
        </div>
      ) : null}
      <Dialog open={ending} onOpenChange={setEnding} title="End the retro?" description="Everyone’s screen moves to the sprint’s outcomes: what the team will try, and what it said.">
        {waiting.length ? <p className="text-sm text-ink-soft">{waiting.length === 1 ? 'One experiment is' : `${waiting.length} experiments are`} still waiting for an owner to say yes. They can still answer afterwards.</p> : null}
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
