import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { clsx } from 'clsx'
import * as Popover from '@radix-ui/react-popover'
import { ChevronLeft, ChevronRight, Menu, MonitorPlay, Pause, Play, Users, X } from 'lucide-react'
import { ApiError, patch, post, put } from '@/api/client'
import type { Experiment, SharedEntry, StageSnapshot, ThemeView } from '@/api/types'
import { OUTCOME_LABEL, PHASE_LABEL, categoryMeta } from '@/lib/categories'
import { applyTheme, readPrefs } from '@/lib/prefs'
import { useStage } from '@/lib/stage'
import { Badge, Button, Dialog, Input, Spinner, Textarea, fmtClock, useCountdown, useDocumentTitle, useToast } from '@/ui'
import { ReconnectingBar } from '@/ui/status'
import { CategoryMarks, Observation, ObservationList } from '@/ui/observations'
import { ExperimentEditor } from '@/ui/experiments'
import { Mark } from '@/brand/Mark'

/**
 * The shared stage. One idea per screen; the conversation, not the chrome, gets
 * the space. Two modes of the same sanitized snapshot:
 *  - facilitator (default for the facilitator): compact controls in the rail and a Facilitate menu
 *  - presenting (?mode=present, or H): no controls at all, for the shared screen
 * Participants always get the presenting layout plus a link to their companion.
 */
export function Stage() {
  const { sprintId = '' } = useParams()
  const nav = useNavigate()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const st = useStage(sprintId)
  const { sprint, stage, grouping, votes, experiments, previous, command } = st
  // The sealed-to-revealed moment plays once per sprint on this device (and its presentation window), not on every visit.
  const revealKey = `muni:revealed:${sprintId}`
  const [revealed, setRevealedState] = useState(() => {
    try {
      return localStorage.getItem(revealKey) === '1'
    } catch {
      return false
    }
  })
  const setRevealed = useCallback(() => {
    setRevealedState(true)
    try {
      localStorage.setItem(revealKey, '1')
    } catch {
      /* private mode: the reveal simply plays again next visit */
    }
  }, [revealKey])
  const [reader, setReader] = useState<string | null>(null) // theme id, 'ungrouped'
  useDocumentTitle(sprint ? `${sprint.name} · stage` : 'Stage')
  useEffect(() => {
    applyTheme(undefined, (params.get('theme') as 'light' | 'dark' | null) ?? 'dark')
    return () => applyTheme(readPrefs().theme)
  }, [params])

  const fac = !!stage?.is_facilitator
  const presenting = params.get('mode') === 'present' || !fac
  const controls = fac && !presenting
  const phases = useMemo(() => stage?.phases ?? [], [stage?.phases])
  const phaseIdx = stage ? phases.indexOf(stage.phase) : 0
  const setPresenting = useCallback(
    (on: boolean) => {
      const p = new URLSearchParams(params)
      if (on) p.set('mode', 'present')
      else p.delete('mode')
      setParams(p, { replace: true })
    },
    [params, setParams],
  )
  const go = useCallback(
    async (dir: 1 | -1) => {
      const next = phases[phaseIdx + dir]
      if (!next) return
      const r = await command({ type: 'set_phase', phase: next })
      if (!r.ok) toast(r.message ?? '', 'danger')
    },
    [phases, phaseIdx, command, toast],
  )

  useEffect(() => {
    if (!fac) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable) return
      if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === ' ') { e.preventDefault(); command(stage?.timer.running ? { type: 'timer_pause' } : { type: 'timer_resume' }) }
      else if (e.key.toLowerCase() === 'n') command({ type: 'speaking_next' })
      else if (e.key.toLowerCase() === 'o') command({ type: 'speaking_open_floor' })
      else if (e.key.toLowerCase() === 'h') setPresenting(!presenting)
      else if (e.key.toLowerCase() === 'r') setRevealed()
      else if (e.key === 'Escape') setReader(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fac, go, command, stage?.timer.running, presenting, setPresenting, setRevealed])

  if (st.revoked) return <Centered><p>Your access to this sprint ended.</p></Centered>
  if (st.error) return <Centered><p>{st.error}</p></Centered>
  if (!sprint) return <Centered><Spinner /></Centered>
  if (!stage)
    return (
      <Centered>
        <Mark size={40} className="text-ink" />
        <h1 className="font-display mt-4 text-2xl">{sprint.name}</h1>
        <p className="mt-2 text-ink-soft">{sprint.status === 'completed' ? 'This retro is done.' : 'The retro hasn’t started yet.'}</p>
        <div className="mt-6 flex gap-2">
          {sprint.status === 'completed' ? <Button onClick={() => nav(`/sprints/${sprintId}/outcomes`)}>See the outcomes</Button> : null}
          {fac && sprint.status === 'ready' ? <Button variant="primary" onClick={async () => { await post(`/api/sprints/${sprintId}/transition`, { to: 'live' }); st.reload() }}>Start the retro</Button> : null}
          <Button variant="ghost" onClick={() => nav(`/sprints/${sprintId}`)}>Back</Button>
        </div>
      </Centered>
    )
  const themes = grouping?.themes ?? []
  const ungrouped = grouping?.ungrouped ?? []
  const readerTheme = reader && reader !== 'ungrouped' ? themes.find((t) => t.id === reader) ?? null : null

  return (
    <div className="stage min-h-dvh text-ink">
      <TopRail stage={stage} sprint={sprint} controls={controls} presenting={presenting} onPrev={() => go(-1)} onNext={() => go(1)} command={command} themes={themes} onPresent={() => setPresenting(!presenting)} sprintId={sprintId} onChange={st.reload} />
      <main className={clsx('mx-auto px-5 pb-20 pt-6 sm:px-8', presenting ? 'max-w-7xl' : 'max-w-6xl')}>
        <ReconnectingBar status={st.live} />
        {stage.phase === 'arrive' ? <Arrive stage={stage} controls={controls} sprintId={sprintId} onChange={st.reload} /> : null}
        {stage.phase === 'remember' ? <Remember previous={previous} themes={themes} controls={controls} onChange={st.loadExperiments} /> : null}
        {stage.phase === 'discover' ? <Discover themes={themes} ungrouped={ungrouped} total={grouping?.total_entries ?? 0} revealed={revealed || !fac} onReveal={setRevealed} controls={controls} presenting={presenting} votes={votes} sprintId={sprintId} onVotesChanged={() => { st.loadVotes(); st.loadThemes() }} command={command} onRead={setReader} onRename={async (id, title) => { await patch(`/api/sprints/${sprintId}/themes/${id}`, { title }); st.loadThemes() }} /> : null}
        {stage.phase === 'discuss' ? <Discuss stage={stage} themes={themes} ungrouped={ungrouped} controls={controls} presenting={presenting} command={command} sprintId={sprintId} onSnapshot={(s) => st.setStage(s)} /> : null}
        {stage.phase === 'decide' ? <Decide stage={stage} themes={themes} experiments={experiments} controls={controls} sprintId={sprintId} participants={sprint.participants} onChange={st.loadExperiments} /> : null}
        {stage.phase === 'leave' ? <Leave stage={stage} experiments={experiments} themes={themes} controls={controls} onComplete={async () => { try { await post(`/api/sprints/${sprintId}/transition`, { to: 'completed' }); nav(`/sprints/${sprintId}/outcomes`) } catch (e) { toast(e instanceof ApiError ? e.message : 'Couldn’t complete', 'danger') } }} /> : null}
      </main>
      <div className="fixed bottom-3 right-3 z-30 flex items-center gap-2 text-xs">
        {fac ? (
          <>
            {!stage.you_control && !presenting ? <button className="rounded-full bg-card px-3 py-1.5 text-warn shadow-[var(--shadow-card)]" onClick={() => command({ type: 'take_control' })}>{stage.controller_name ? `${stage.controller_name} is controlling · take control` : 'Take control'}</button> : null}
            <button className="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-ink-soft shadow-[var(--shadow-card)] hover:text-ink" onClick={() => setPresenting(!presenting)} aria-pressed={presenting} title="H">
              <MonitorPlay className="size-3.5" /> {presenting ? 'Presenting · show controls' : 'Present on this screen'}
            </button>
          </>
        ) : (
          <Link to={`/sprints/${sprintId}/room`} className="rounded-full bg-card px-3 py-1.5 text-ink-soft shadow-[var(--shadow-card)] hover:text-ink">Your companion</Link>
        )}
      </div>
      <Dialog open={!!reader} onOpenChange={(o) => !o && setReader(null)} title={reader === 'ungrouped' ? 'Ungrouped observations' : readerTheme?.title ?? ''} description={reader === 'ungrouped' ? `${ungrouped.length} thoughts not placed in a theme. Nothing is dropped.` : readerTheme?.summary || undefined} wide>
        <ObservationList entries={reader === 'ungrouped' ? ungrouped : readerTheme?.entries ?? []} pageSize={6} />
        {readerTheme?.context.length ? (
          <div className="mt-4 rounded-xl border border-dashed border-line p-3">
            <div className="mb-1 text-xs text-ink-faint">Added during the retro · anonymous</div>
            {readerTheme.context.map((c) => <p key={c.id} className="py-1 text-sm">{c.body}</p>)}
          </div>
        ) : null}
      </Dialog>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="stage grid min-h-dvh place-items-center px-6 text-center text-ink"><div className="flex flex-col items-center">{children}</div></div>
}

// ---------- top rail ----------
function TopRail({ stage, sprint, controls, presenting, onPrev, onNext, command, themes, onPresent, sprintId, onChange }: { stage: StageSnapshot; sprint: { name: string }; controls: boolean; presenting: boolean; onPrev: () => void; onNext: () => void; command: ReturnType<typeof useStage>['command']; themes: ThemeView[]; onPresent: () => void; sprintId: string; onChange: () => void }) {
  const remaining = useCountdown(stage.timer.ends_at ?? null, stage.timer.remaining_secs, stage.server_time)
  const idx = stage.phases.indexOf(stage.phase)
  const over = stage.timer.total_secs > 0 && remaining === 0 && stage.timer.running
  const agendaPos = stage.current_theme_id ? stage.agenda.findIndex((a) => a.theme_id === stage.current_theme_id) : -1
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur">
      <div className={clsx('mx-auto flex items-center gap-4 px-5 py-2.5 sm:px-8', presenting ? 'max-w-7xl' : 'max-w-6xl')}>
        <div className="flex min-w-0 items-center gap-2 text-sm text-ink-soft">
          <Mark size={20} reflect={false} />
          <span className="hidden truncate sm:inline">{sprint.name}</span>
        </div>
        <ol className="flex flex-1 items-center justify-center gap-1 overflow-x-auto text-xs" aria-label="Stages">
          {stage.phases.map((p, i) => (
            <li key={p}>
              <span className={clsx('inline-flex items-center rounded-full px-2.5 py-1 whitespace-nowrap', i === idx ? 'bg-accent-soft font-medium text-accent-ink' : i < idx ? 'text-ink-soft' : 'text-ink-faint')} aria-current={i === idx ? 'step' : undefined}>
                {PHASE_LABEL[p]}
                {i === idx && stage.phase === 'discuss' && agendaPos >= 0 ? <span className="ml-1 text-ink-faint">· {agendaPos + 1} of {stage.agenda.length}</span> : null}
              </span>
            </li>
          ))}
        </ol>
        <div className={clsx('tabular-nums text-sm', over ? 'text-warn' : stage.timer.running ? 'text-ink' : 'text-ink-faint')} title="Guidance, not a cut-off">
          {stage.timer.total_secs ? fmtClock(remaining) : ''}
          {over ? <span className="ml-1 text-xs">over</span> : null}
        </div>
        {controls ? (
          <div className="flex items-center gap-1">
            <IconBtn label="Previous stage (←)" onClick={onPrev} disabled={idx === 0}><ChevronLeft className="size-4" /></IconBtn>
            <IconBtn label={stage.timer.running ? 'Pause timer (space)' : 'Resume timer (space)'} onClick={() => command(stage.timer.running ? { type: 'timer_pause' } : { type: 'timer_resume' })}>{stage.timer.running ? <Pause className="size-4" /> : <Play className="size-4" />}</IconBtn>
            <IconBtn label="Add two minutes" onClick={() => command({ type: 'timer_adjust', delta_secs: 120 })}>+2</IconBtn>
            <IconBtn label="Next stage (→)" onClick={onNext} disabled={idx === stage.phases.length - 1} primary><ChevronRight className="size-4" /></IconBtn>
            <FacilitateMenu stage={stage} command={command} themes={themes} sprintId={sprintId} onChange={onChange} onPresent={onPresent} />
          </div>
        ) : null}
      </div>
    </header>
  )
}

function IconBtn({ children, label, onClick, disabled, primary }: { children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <button className={clsx('grid h-8 min-w-8 place-items-center rounded-full px-2 text-sm transition-colors disabled:opacity-40', primary ? 'bg-accent text-paper' : 'border border-line bg-card hover:bg-card-2')} aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )
}

function MenuItem({ children, onClick, hint }: { children: React.ReactNode; onClick: () => void; hint?: string }) {
  return (
    <button role="menuitem" className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-card-2" onClick={onClick}>
      <span>{children}</span>
      {hint ? <span className="text-xs text-ink-faint">{hint}</span> : null}
    </button>
  )
}

/** A menu action that closes the enclosing popover once it runs. */
function Item({ children, onClick, hint }: { children: React.ReactNode; onClick: () => void; hint?: string }) {
  return (
    <Popover.Close asChild>
      <MenuItem onClick={onClick} hint={hint}>{children}</MenuItem>
    </Popover.Close>
  )
}

/** Every secondary control, discoverable by label, in one named menu. */
function FacilitateMenu({ stage, command, themes, sprintId, onChange, onPresent }: { stage: StageSnapshot; command: ReturnType<typeof useStage>['command']; themes: ThemeView[]; sprintId: string; onChange: () => void; onPresent: () => void }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const speaking = stage.speaking
  const present = stage.attendance.filter((a) => a.present).length
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className="ml-1 inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-card px-3 text-sm hover:bg-card-2" aria-label="Facilitate menu"><Menu className="size-4" /> Facilitate</button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-40 w-80 rounded-xl border border-line bg-card p-1.5 shadow-[var(--shadow-float)] anim-rise" role="menu">
          <div className="px-3 pb-1 pt-2 text-[11px] uppercase tracking-wider text-ink-faint">Room · {present} present</div>
          <div className="max-h-40 overflow-y-auto px-1">
            {stage.attendance.map((a) => (
              <label key={a.account_id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-card-2">
                <input type="checkbox" className="accent-[var(--accent)]" checked={a.present} onChange={async () => { await post(`/api/sprints/${sprintId}/meeting/attendance/${a.account_id}`, { present: !a.present }); onChange() }} />
                <span className="flex-1 truncate">{a.display_name}</span>
                {a.is_facilitator ? <span className="text-[10px] text-ink-faint">facilitator</span> : a.ready === false ? <span className="text-[10px] text-ink-faint">passing</span> : null}
              </label>
            ))}
          </div>
          <div className="mt-1 border-t border-line pt-1">
            <div className="px-3 pb-1 pt-1 text-[11px] uppercase tracking-wider text-ink-faint">Voices</div>
            {!speaking || speaking.status !== 'active' ? <Item onClick={() => command({ type: 'speaking_start' })}>Invite voices one at a time</Item> : null}
            {speaking?.status === 'active' ? <Item onClick={() => command({ type: 'speaking_next' })} hint="N">Next voice</Item> : null}
            {speaking?.status === 'active' ? <Item onClick={() => command({ type: 'speaking_open_floor' })} hint="O">Open the floor</Item> : null}
            {speaking ? <Item onClick={() => command({ type: 'speaking_end' })}>End the round</Item> : null}
          </div>
          <div className="mt-1 border-t border-line pt-1">
            <div className="px-3 pb-1 pt-1 text-[11px] uppercase tracking-wider text-ink-faint">Conversation</div>
            <Item onClick={() => command({ type: 'quiet_reading', secs: 60 })}>A quiet minute to read</Item>
            {stage.has_unreleased_context ? <Item onClick={() => command({ type: 'release_context' })}>Release new written context</Item> : <div className="px-3 py-1.5 text-xs text-ink-faint">No written context waiting</div>}
            {stage.current_theme_id && stage.current_theme_id !== 'ungrouped' ? (
              <>
                <Item onClick={() => command({ type: 'mark_discussed', theme_id: stage.current_theme_id!, discussed: !stage.discussed_theme_ids.includes(stage.current_theme_id!) })}>{stage.discussed_theme_ids.includes(stage.current_theme_id) ? 'Unmark as discussed' : 'Mark as discussed'}</Item>
                <Item onClick={async () => { try { await patch(`/api/sprints/${sprintId}/themes/${stage.current_theme_id}`, { parked: true }); toast('Parked'); command({ type: 'set_topic', theme_id: null }) } catch (e) { toast(e instanceof ApiError ? e.message : 'Couldn’t park', 'danger') } }}>Park this topic</Item>
              </>
            ) : null}
            {stage.current_theme_id ? <Item onClick={() => command({ type: 'set_topic', theme_id: null })}>Back to the agenda</Item> : null}
            {themes.length ? <Item onClick={() => command({ type: 'set_agenda', items: themes.filter((t) => !t.parked).sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0)).slice(0, 3).map((t) => ({ theme_id: t.id })) })}>Set the agenda from votes (top 3)</Item> : null}
          </div>
          <div className="mt-1 border-t border-line pt-1">
            <Item onClick={onPresent} hint="H">Present on this screen</Item>
            <Item onClick={() => command({ type: 'timer_clear' })}>Clear the timer</Item>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function Heading({ kicker, title, sub }: { kicker?: string; title: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mb-6 anim-rise">
      {kicker ? <div className="text-xs uppercase tracking-wider text-accent">{kicker}</div> : null}
      <h1 className="font-display mt-1 text-2xl leading-tight sm:text-3xl">{title}</h1>
      {sub ? <div className="mt-1 text-sm text-ink-soft">{sub}</div> : null}
    </div>
  )
}

// ---------- Arrive ----------
function Arrive({ stage, controls, sprintId, onChange }: { stage: StageSnapshot; controls: boolean; sprintId: string; onChange: () => void }) {
  const present = stage.attendance.filter((a) => a.present)
  return (
    <div>
      <Heading kicker="Arrive" title="Welcome back." sub={`${present.length} of ${stage.attendance.length} here${controls ? ' · click a name to mark them present' : ''}`} />
      {stage.opening_question ? (
        <p className="mb-8 max-w-3xl text-xl leading-snug text-ink sm:text-2xl">{stage.opening_question}</p>
      ) : null}
      <ul className="flex flex-wrap gap-2">
        {stage.attendance.map((a) => (
          <li key={a.account_id}>
            <button className={clsx('rounded-full border px-4 py-2 text-base transition-colors', a.present ? 'border-accent bg-accent-soft text-ink' : 'border-line text-ink-faint', controls ? 'hover:border-line-strong' : 'cursor-default')} onClick={controls ? async () => { await post(`/api/sprints/${sprintId}/meeting/attendance/${a.account_id}`, { present: !a.present }); onChange() } : undefined} aria-pressed={a.present} disabled={!controls}>
              {a.display_name}{a.is_facilitator ? <span className="ml-2 text-xs text-ink-faint">facilitator</span> : null}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-6 flex items-center gap-1.5 text-xs text-ink-faint"><Users className="size-3.5" /> People can also mark themselves present from their phone.</p>
    </div>
  )
}

// ---------- Remember ----------
function Remember({ previous, themes, controls, onChange }: { previous: Experiment[]; themes: ThemeView[]; controls: boolean; onChange: () => void }) {
  const wins = useMemo(() => themes.flatMap((t) => t.entries).filter((e) => e.category === 'proud' || e.category === 'keep').slice(0, 4), [themes])
  return (
    <div className="grid gap-10 lg:grid-cols-[1.3fr_1fr]">
      <div>
        <Heading kicker="Remember" title="Last time, we said…" />
        {previous.length === 0 ? <p className="text-lg text-ink-soft">This is the first retro here. Next time, the experiments you agree on come back to this screen first.</p> : null}
        <ul className="space-y-3">
          {previous.map((e) => (
            <li key={e.id} className="card anim-rise p-4">
              <p className="text-lg leading-snug">{e.change_to_try}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-ink-soft">
                <Badge tone={e.status === 'helped' ? 'ok' : e.status === 'did_not_help' ? 'danger' : 'neutral'}>{OUTCOME_LABEL[e.status]}</Badge>
                {e.owner_name ? <span>{e.owner_name}</span> : null}
                <span className="text-ink-faint">signal: {e.success_signal}</span>
              </div>
              {e.outcome_note ? <p className="mt-2 text-sm text-ink-soft">{e.outcome_note}</p> : null}
              {controls ? <OutcomeQuick e={e} onChange={onChange} /> : null}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-ink-faint">“Not tried yet” and “Inconclusive” are honest answers.</p>
      </div>
      <div>
        <div className="mb-3 text-xs uppercase tracking-wider text-accent">Wins worth keeping</div>
        {wins.length === 0 ? <p className="text-ink-soft">No “proud of” or “keep” entries this sprint.</p> : null}
        <div className="grid gap-3">{wins.map((e) => <Observation key={e.id} e={e} size="sm" />)}</div>
      </div>
    </div>
  )
}

function OutcomeQuick({ e, onChange }: { e: Experiment; onChange: () => void }) {
  const [note, setNote] = useState(e.outcome_note ?? '')
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm">
      {(['helped', 'did_not_help', 'inconclusive', 'not_tried'] as const).map((s) => (
        <button key={s} className={clsx('rounded-full border px-3 py-1 text-xs', e.status === s ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line hover:border-line-strong')} onClick={async () => { await patch(`/api/sprints/${e.sprint_id}/experiments/${e.id}`, { status: s, outcome_note: note }); onChange() }}>
          {OUTCOME_LABEL[s]}
        </button>
      ))}
      <input className="min-w-40 flex-1 rounded-lg border border-line bg-paper px-2 py-1 text-xs" placeholder="short context" value={note} onChange={(ev) => setNote(ev.target.value)} onBlur={async () => { if (note !== (e.outcome_note ?? '')) { await patch(`/api/sprints/${e.sprint_id}/experiments/${e.id}`, { outcome_note: note }); onChange() } }} aria-label="Outcome note" />
    </div>
  )
}

// ---------- Discover ----------
function Discover({ themes, ungrouped, total, revealed, onReveal, controls, presenting, votes, sprintId, onVotesChanged, command, onRead, onRename }: { themes: ThemeView[]; ungrouped: SharedEntry[]; total: number; revealed: boolean; onReveal: () => void; controls: boolean; presenting: boolean; votes: ReturnType<typeof useStage>['votes']; sprintId: string; onVotesChanged: () => void; command: ReturnType<typeof useStage>['command']; onRead: (id: string) => void; onRename: (id: string, title: string) => Promise<void> }) {
  const toast = useToast()
  const round = votes?.current ?? null
  const closed = votes?.previous.find((r) => r.status === 'closed') ?? null
  const show = revealed || total <= 1 || themes.length === 0
  const notes = useMemo(() => {
    // One sealed note per thought (up to 48), placed by a hash of its id: stable, and unrelated to author or order.
    const all = themes.flatMap((t) => t.entries).concat(ungrouped)
    const sample = all.slice(0, 48)
    return sample.map((e) => {
      let h = 7
      for (const ch of e.id) h = (h * 33 + ch.charCodeAt(0)) >>> 0
      return { id: e.id, x: (h % 1000) / 10, rot: ((h >> 10) % 21) - 10, delay: (h >> 16) % 300 }
    })
  }, [themes, ungrouped])
  const counts = `${total} ${total === 1 ? 'thought' : 'thoughts'} · ${themes.length} ${themes.length === 1 ? 'theme' : 'themes'}`
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 anim-rise">
        <div>
          <div className="text-xs uppercase tracking-wider text-accent">Discover</div>
          <h1 className="font-display mt-1 text-2xl sm:text-3xl">This sprint</h1>
          <div className="mt-1 text-sm text-ink-soft" title="Counts thoughts, not people">
            {counts}
            {ungrouped.length ? <> · <button className="underline decoration-line-strong underline-offset-4 hover:text-ink" onClick={() => onRead('ungrouped')}>{ungrouped.length} ungrouped</button></> : null}
          </div>
        </div>
        {show ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {round ? (
              <>
                <span className="text-ink-soft">Voting is open · choices are private</span>
                {controls ? <Button size="sm" variant="primary" onClick={async () => { await post(`/api/sprints/${sprintId}/votes/rounds/close`, { action: 'close' }); onVotesChanged() }}>Close voting</Button> : null}
              </>
            ) : controls ? (
              <>
                <Button size="sm" variant="primary" disabled={themes.length === 0} onClick={async () => { try { await post(`/api/sprints/${sprintId}/votes/rounds`, {}); onVotesChanged() } catch (e) { toast(e instanceof ApiError ? e.message : 'Couldn’t open voting', 'danger') } }}>{closed ? 'Vote again' : 'Open voting'}</Button>
                {closed ? <Button size="sm" onClick={() => command({ type: 'set_agenda', items: [...themes].filter((t) => !t.parked).sort((a, b) => (closed.totals?.[b.id] ?? 0) - (closed.totals?.[a.id] ?? 0)).slice(0, 3).map((t) => ({ theme_id: t.id })) })}>Top three → agenda</Button> : null}
              </>
            ) : closed ? (
              <span className="text-ink-soft">Votes are in.</span>
            ) : null}
          </div>
        ) : null}
      </div>

      {total === 0 ? <p className="max-w-2xl text-lg text-ink-soft">Nothing was captured this sprint. That’s a real outcome: talk about why, and whether the next sprint needs a different way in.</p> : null}

      {!show ? (
        <div className="relative">
          <div className="relative h-40 overflow-hidden rounded-xl border border-line bg-card-2/60" aria-hidden>
            {notes.map((n, i) => (
              <span key={n.id} className="absolute h-10 w-14 rounded-md border border-line bg-card shadow-[var(--shadow-card)] anim-pulse" style={{ left: `calc(${n.x}% - 28px)`, top: `${16 + ((i * 37) % 88)}px`, transform: `rotate(${n.rot}deg)`, animationDelay: `${n.delay}ms` }} />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <p className="text-sm text-ink-soft">{total > 48 ? `A sample of the ${total} sealed thoughts.` : `${total} sealed thoughts, still folded.`}</p>
            {controls ? <Button variant="primary" onClick={onReveal}>Open the sprint <span className="ml-1 text-xs opacity-70">R</span></Button> : <span className="text-sm text-ink-faint">The facilitator opens them.</span>}
          </div>
        </div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {themes.map((t, i) => {
            const votesFor = round ? null : (closed?.totals?.[t.id] ?? t.votes)
            const mine = round?.my_votes.includes(t.id)
            const excerpt = t.entries[0]?.body ?? ''
            return (
              <ThemeTile key={t.id} t={t} index={i} presenting={presenting} editable={controls} votesFor={typeof votesFor === 'number' ? votesFor : null} excerpt={excerpt} onRead={() => onRead(t.id)} onRename={(title) => onRename(t.id, title)} vote={round && !presenting ? { mine: !!mine, onToggle: async () => { try { await post(`/api/sprints/${sprintId}/votes`, { theme_id: t.id, cast: !mine }); onVotesChanged() } catch (e) { toast(e instanceof ApiError ? e.message : 'Couldn’t vote', 'danger') } } } : null} />
            )
          })}
          {ungrouped.length ? (
            <button className="card anim-gather flex min-h-36 flex-col items-start justify-between border-dashed p-4 text-left hover:border-line-strong" style={{ animationDelay: `${Math.min(themes.length, 8) * 45}ms` }} onClick={() => onRead('ungrouped')}>
              <span className="text-xs uppercase tracking-wider text-ink-faint">Ungrouped</span>
              <span className="font-display text-xl">{ungrouped.length} {ungrouped.length === 1 ? 'thought' : 'thoughts'}</span>
              <span className="text-xs text-accent-ink underline decoration-accent/30 underline-offset-4">Read all {ungrouped.length}</span>
            </button>
          ) : null}
        </div>
      )}
      {show && round ? <p className="mt-4 text-sm text-ink-soft">You have <strong className="text-ink">{round.my_remaining}</strong> of {round.budget} votes left. Totals appear when voting closes.</p> : null}
    </div>
  )
}

function ThemeTile({ t, index, presenting, editable, votesFor, excerpt, onRead, onRename, vote }: { t: ThemeView; index: number; presenting: boolean; editable: boolean; votesFor: number | null; excerpt: string; onRead: () => void; onRename: (title: string) => Promise<void>; vote: { mine: boolean; onToggle: () => void } | null }) {
  const [title, setTitle] = useState(t.title)
  useEffect(() => setTitle(t.title), [t.title])
  const dx = ((index * 53) % 41) - 20
  const dy = ((index * 29) % 31) - 15
  return (
    <article className={clsx('paper-stack anim-gather flex min-h-36 flex-col p-4', t.parked && 'opacity-70')} style={{ ['--dx' as string]: `${dx}px`, ['--dy' as string]: `${dy}px`, ['--rot' as string]: `${((index * 7) % 5) - 2}deg`, animationDelay: `${Math.min(index, 8) * 45}ms` }}>
      <div className="flex items-start justify-between gap-2">
        {editable ? (
          // Wraps like the read-only title: the hidden copy sizes the grid cell, the textarea fills it.
          <div className="grid w-full font-display text-lg leading-tight">
            <span aria-hidden className="invisible col-start-1 row-start-1 whitespace-pre-wrap break-words">{title || ' '}</span>
            <textarea rows={1} className="col-start-1 row-start-1 resize-none overflow-hidden bg-transparent outline-none focus:shadow-[inset_0_-1px_0_var(--accent)]" value={title} onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }} onBlur={() => title.trim() && title !== t.title && onRename(title.trim())} aria-label="Theme title" maxLength={80} />
          </div>
        ) : (
          <h3 className={clsx('font-display leading-tight', presenting ? 'text-xl' : 'text-lg')}>{t.title}</h3>
        )}
        {votesFor !== null ? <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-sm font-medium text-accent-ink" title="votes">{votesFor}</span> : null}
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-ink-soft">
        <span title="Counts thoughts, not people">{t.entry_count} {t.entry_count === 1 ? 'thought' : 'thoughts'}</span>
        <CategoryMarks mix={t.category_mix} />
        {t.needs_attention ? <Badge tone="warn">needs attention</Badge> : null}
        {t.parked ? <Badge>parked</Badge> : null}
      </div>
      {excerpt ? <p className="mt-3 line-clamp-2 text-sm text-ink-soft">“{excerpt}”</p> : null}
      <div className="mt-auto flex items-center justify-between gap-2 pt-3">
        <button className="text-xs text-accent-ink underline decoration-accent/30 underline-offset-4 hover:decoration-accent" onClick={onRead}>Read all {t.entry_count}</button>
        {vote ? (
          <button className={clsx('rounded-full border px-3 py-1 text-xs', vote.mine ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line hover:border-line-strong')} onClick={vote.onToggle} aria-pressed={vote.mine}>
            {vote.mine ? 'Voted' : 'Vote'}
          </button>
        ) : null}
      </div>
    </article>
  )
}

// ---------- Discuss ----------
function Discuss({ stage, themes, ungrouped, controls, presenting, command, sprintId, onSnapshot }: { stage: StageSnapshot; themes: ThemeView[]; ungrouped: SharedEntry[]; controls: boolean; presenting: boolean; command: ReturnType<typeof useStage>['command']; sprintId: string; onSnapshot: (s: StageSnapshot) => void }) {
  const agenda = stage.agenda.map((a) => themes.find((t) => t.id === a.theme_id)).filter(Boolean) as ThemeView[]
  const list = agenda.length ? agenda : themes.filter((t) => !t.parked)
  const isUngrouped = stage.current_theme_id === 'ungrouped'
  const theme = isUngrouped ? null : themes.find((t) => t.id === stage.current_theme_id) ?? null
  const entries = isUngrouped ? ungrouped : theme?.entries ?? []
  const pos = theme ? list.findIndex((t) => t.id === theme.id) : -1
  const [takeaway, setTakeaway] = useState(false)
  const quiet = useCountdown(stage.timer.ends_at ?? null, stage.timer.remaining_secs, stage.server_time)

  if (!theme && !isUngrouped)
    return (
      <div>
        <Heading kicker="Discuss" title="Which conversation first?" sub={list.length ? 'Suggested by votes; the facilitator decides.' : undefined} />
        <ol className="grid gap-2 sm:grid-cols-2">
          {list.map((t, i) => (
            <li key={t.id}>
              <button className="card flex w-full items-center gap-3 p-4 text-left hover:border-line-strong disabled:cursor-default" disabled={!controls} onClick={() => command({ type: 'set_topic', theme_id: t.id })}>
                <span className="font-display text-lg text-ink-faint">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-lg">{t.title}</span>
                  <span className="text-xs text-ink-soft">{t.entry_count} thoughts{typeof t.votes === 'number' ? ` · ${t.votes} votes` : ''}</span>
                </span>
                {stage.discussed_theme_ids.includes(t.id) ? <Badge tone="ok">done</Badge> : null}
              </button>
            </li>
          ))}
          {ungrouped.length ? (
            <li>
              <button className="card flex w-full items-center gap-3 border-dashed p-4 text-left hover:border-line-strong disabled:cursor-default" disabled={!controls} onClick={() => command({ type: 'set_topic', theme_id: 'ungrouped' })}>
                <span className="font-display text-lg text-ink-faint">·</span>
                <span className="min-w-0 flex-1"><span className="block font-display text-lg">Ungrouped observations</span><span className="text-xs text-ink-soft">{ungrouped.length} thoughts</span></span>
              </button>
            </li>
          ) : null}
        </ol>
        {!list.length && !ungrouped.length ? <p className="text-lg text-ink-soft">No themes on the agenda.</p> : null}
      </div>
    )

  return (
    <div key={stage.current_theme_id} className="anim-rise">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-accent">Discuss{pos >= 0 ? ` · ${pos + 1} of ${list.length}` : ''}</div>
          <h1 className={clsx('font-display mt-1 leading-tight', presenting ? 'text-3xl sm:text-4xl' : 'text-2xl sm:text-3xl')}>{isUngrouped ? 'Ungrouped observations' : theme!.title}</h1>
          {theme?.question ? <p className="mt-2 max-w-3xl text-base text-ink-soft sm:text-lg">{theme.question}</p> : null}
        </div>
        <SpeakingInvite stage={stage} controls={controls} command={command} />
      </div>
      {stage.quiet_reading ? <div className="mb-4 rounded-xl border border-line bg-card px-4 py-2 text-sm text-ink-soft">A quiet minute to read · {fmtClock(quiet)} left · no need to speak yet</div> : null}
      {stage.notes.takeaway && !isUngrouped ? (
        <div className="mb-4 rounded-xl border border-accent/30 bg-accent-soft/60 px-4 py-3 text-[15px]">
          <span className="mr-2 text-xs uppercase tracking-wider text-accent-ink">Takeaway</span>
          {stage.notes.takeaway}
        </div>
      ) : null}
      <ObservationList entries={entries} pageSize={presenting ? 6 : 8} size={presenting ? 'lg' : 'md'} />
      {theme?.context.length ? (
        <div className="mt-4 rounded-xl border border-dashed border-line p-4">
          <div className="mb-2 text-xs uppercase tracking-wider text-ink-faint">Added during the retro · anonymous</div>
          <ul className="grid gap-2 sm:grid-cols-2">{theme.context.map((c) => <li key={c.id} className="anim-rise text-[15px]">{c.body}</li>)}</ul>
        </div>
      ) : null}
      {controls && theme ? (
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" onClick={() => setTakeaway(true)}>{stage.notes.takeaway ? 'Edit the takeaway' : 'Capture a takeaway'}</Button>
          {pos >= 0 && pos < list.length - 1 ? <Button size="sm" onClick={() => command({ type: 'set_topic', theme_id: list[pos + 1].id })}>Next topic: {list[pos + 1].title}</Button> : null}
          <span className="text-xs text-ink-faint">Everything else is under Facilitate.</span>
        </div>
      ) : null}
      {theme ? <TakeawayDialog open={takeaway} onClose={() => setTakeaway(false)} sprintId={sprintId} theme={theme} notes={stage.notes} onSaved={(s) => { onSnapshot(s); setTakeaway(false) }} /> : null}
    </div>
  )
}

/** A compact invitation, not a stage prop. Selection never implies authorship. */
function SpeakingInvite({ stage, controls, command }: { stage: StageSnapshot; controls: boolean; command: ReturnType<typeof useStage>['command'] }) {
  const sp = stage.speaking
  if (!sp && !controls) return null
  return (
    <div className="flex shrink-0 flex-col items-end gap-1 text-right">
      {sp?.current ? (
        <div key={sp.current.account_id} className="anim-settle rounded-full border border-accent/40 bg-accent-soft/60 px-4 py-2 text-[15px]">
          <span className="font-medium">{sp.current.display_name.split(' ')[0]}</span>, {sp.prompt.charAt(0).toLowerCase() + sp.prompt.slice(1)}
        </div>
      ) : sp?.status === 'exhausted' ? (
        <div className="text-sm text-ink-soft">Everyone who was ready has had an invitation.</div>
      ) : sp ? (
        <div className="text-sm text-ink-soft">The floor is open.</div>
      ) : null}
      {controls ? (
        <div className="flex gap-1.5">
          {!sp || sp.status !== 'active' ? <Button size="sm" onClick={() => command({ type: 'speaking_start' })}>Invite a voice</Button> : null}
          {sp?.status === 'active' ? <Button size="sm" onClick={() => command({ type: 'speaking_next' })} title="N">Next voice</Button> : null}
          {sp?.status === 'active' ? <Button size="sm" variant="ghost" onClick={() => command({ type: 'speaking_open_floor' })} title="O">Open the floor</Button> : null}
        </div>
      ) : null}
      <span className="text-[11px] text-ink-faint">An invitation, not a turn. Passing is fine.</span>
    </div>
  )
}

function TakeawayDialog({ open, onClose, sprintId, theme, notes, onSaved }: { open: boolean; onClose: () => void; sprintId: string; theme: ThemeView; notes: StageSnapshot['notes']; onSaved: (s: StageSnapshot) => void }) {
  const [takeaway, setTakeaway] = useState(notes.takeaway)
  const [tryText, setTryText] = useState(notes.could_try)
  const [more, setMore] = useState(false)
  const [what, setWhat] = useState(notes.what_happened)
  const [impact, setImpact] = useState(notes.impact)
  useEffect(() => { setTakeaway(notes.takeaway); setTryText(notes.could_try); setWhat(notes.what_happened); setImpact(notes.impact) }, [notes, theme.id])
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Capture a takeaway" description={`One line the room agrees on for “${theme.title}”. It appears on the stage and in the recap.`}>
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const s = await put<StageSnapshot>(`/api/sprints/${sprintId}/meeting/notes/${theme.id}`, { takeaway, could_try: tryText, what_happened: what, impact }); onSaved(s) }}>
        <Textarea rows={2} value={takeaway} onChange={(e) => setTakeaway(e.target.value)} placeholder="What did we learn here?" autoFocus maxLength={400} aria-label="Takeaway" />
        <Input value={tryText} onChange={(e) => setTryText(e.target.value)} placeholder="What could we try? (optional — seeds the experiment)" maxLength={300} aria-label="What could we try" />
        <button type="button" className="text-xs text-ink-soft underline underline-offset-4" onClick={() => setMore((m) => !m)}>{more ? 'Fewer fields' : 'Add what happened and its impact'}</button>
        {more ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <Textarea rows={2} value={what} onChange={(e) => setWhat(e.target.value)} placeholder="What happened?" aria-label="What happened" />
            <Textarea rows={2} value={impact} onChange={(e) => setImpact(e.target.value)} placeholder="What impact did it have?" aria-label="Impact" />
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">Save takeaway</Button>
        </div>
      </form>
    </Dialog>
  )
}

// ---------- Decide ----------
function Decide({ stage, themes, experiments, controls, sprintId, participants, onChange }: { stage: StageSnapshot; themes: ThemeView[]; experiments: Experiment[]; controls: boolean; sprintId: string; participants: { account_id: string; display_name: string; is_facilitator: boolean; is_you: boolean }[]; onChange: () => void }) {
  const discussed = themes.filter((t) => stage.discussed_theme_ids.includes(t.id) || t.takeaway)
  const [seed, setSeed] = useState<{ text: string; theme: string } | null>(null)
  return (
    <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
      <div>
        <Heading kicker="Decide" title="What will we try next?" sub="One to three concrete changes, each with an owner who says yes, a signal, and a date." />
        <ul className="space-y-3">
          {experiments.map((e) => (
            <li key={e.id} className="card anim-rise p-4">
              <p className="text-lg leading-snug">{e.change_to_try}</p>
              <div className="mt-1 text-sm text-ink-soft">signal: {e.success_signal} · review {e.review_on}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <Badge tone={e.status === 'accepted' ? 'ok' : 'warn'}>{e.owner_name ? (e.owner_accepted ? `${e.owner_name} owns this` : `waiting for ${e.owner_name} to accept`) : 'no owner yet'}</Badge>
                {e.theme_title ? <span className="text-ink-faint">from {e.theme_title}</span> : null}
              </div>
            </li>
          ))}
        </ul>
        {controls ? <div className="mt-4"><ExperimentEditor key={seed?.text ?? 'blank'} sprintId={sprintId} participants={participants} themes={themes.map((t) => ({ id: t.id, title: t.title }))} defaultText={seed?.text} defaultThemeId={seed?.theme} existingCount={experiments.length} onSaved={() => { setSeed(null); onChange() }} /></div> : <p className="mt-4 text-sm text-ink-faint">If you’re nominated as an owner, your companion asks you to accept — or not.</p>}
      </div>
      <aside>
        <div className="mb-3 text-xs uppercase tracking-wider text-accent">What we discussed</div>
        {discussed.length === 0 ? <p className="text-sm text-ink-soft">Nothing was marked discussed yet. Draft from any theme.</p> : null}
        <ul className="space-y-2">
          {(discussed.length ? discussed : themes.slice(0, 5)).map((t) => (
            <li key={t.id} className="card p-3">
              <div className="font-medium">{t.title}</div>
              {t.takeaway ? <p className="mt-1 text-sm text-ink-soft">{t.takeaway}</p> : null}
              {t.draft_experiment ? <p className="mt-1 text-sm text-ink-faint">Draft: {t.draft_experiment}</p> : null}
              {controls ? <button className="mt-1 text-sm text-accent-ink underline underline-offset-4" onClick={() => setSeed({ text: t.draft_experiment ?? '', theme: t.id })}>Start an experiment from this</button> : null}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  )
}

// ---------- Leave ----------
function Leave({ stage, experiments, themes, controls, onComplete }: { stage: StageSnapshot; experiments: Experiment[]; themes: ThemeView[]; controls: boolean; onComplete: () => void }) {
  const accepted = experiments.filter((e) => e.status !== 'proposed')
  const pending = experiments.filter((e) => e.status === 'proposed')
  const parked = themes.filter((t) => t.parked || (!stage.discussed_theme_ids.includes(t.id) && stage.agenda.some((a) => a.theme_id === t.id)))
  return (
    <div>
      <Heading kicker="Leave" title="Here’s what we’re taking with us." />
      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-xs uppercase tracking-wider text-ink-faint">Commitments</h2>
          {accepted.length === 0 ? <p className="text-ink-soft">No accepted commitments. That can be the honest outcome of a good conversation.</p> : null}
          <ol className="space-y-3">
            {accepted.map((e, i) => (
              <li key={e.id} className="card anim-rise p-4" style={{ animationDelay: `${i * 70}ms` }}>
                <p className="text-lg">{e.change_to_try}</p>
                <div className="mt-1 text-sm text-ink-soft">{e.owner_name} · we’ll know by: {e.success_signal} · revisit {e.review_on}</div>
              </li>
            ))}
          </ol>
          {pending.length ? <p className="mt-3 text-sm text-warn">{pending.length} proposed {pending.length === 1 ? 'experiment is' : 'experiments are'} still waiting for an owner to accept. Editable in Outcomes.</p> : null}
        </section>
        <section>
          <h2 className="mb-3 text-xs uppercase tracking-wider text-ink-faint">Takeaways & parked</h2>
          <ul className="space-y-2">
            {themes.filter((t) => t.takeaway).map((t) => (
              <li key={t.id} className="rounded-xl border border-line px-4 py-3"><span className="text-xs text-ink-faint">{t.title} — </span>{t.takeaway}</li>
            ))}
            {parked.map((t) => (
              <li key={t.id} className="rounded-xl border border-dashed border-line px-4 py-3 text-sm"><span className="font-medium">{t.title}</span> <span className="text-ink-faint">{t.parked ? 'parked' : 'not reached'}{t.needs_attention ? ' · needs attention' : ''}</span></li>
            ))}
            {!parked.length && !themes.some((t) => t.takeaway) ? <li className="text-ink-soft">Nothing parked.</li> : null}
          </ul>
        </section>
      </div>
      {controls ? (
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Button size="lg" variant="primary" onClick={onComplete}>Complete the retro</Button>
          <span className="text-sm text-ink-faint">Outcomes stay editable afterwards. The recap is never published without you.</span>
        </div>
      ) : <p className="mt-10 text-ink-soft">Thanks for being here.</p>}
      <X className="hidden" />
    </div>
  )
}

export { categoryMeta }
