import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { clsx } from 'clsx'
import { ChevronLeft, ChevronRight, Eye, EyeOff, Pause, Play, RotateCcw, Timer, Users } from 'lucide-react'
import { ApiError, patch, post, put } from '@/api/client'
import type { Experiment, StageSnapshot, ThemeView } from '@/api/types'
import { OUTCOME_LABEL, PHASE_HINT, PHASE_LABEL, categoryMeta } from '@/lib/categories'
import { applyTheme, readPrefs } from '@/lib/prefs'
import { useStage } from '@/lib/stage'
import { Badge, Button, Input, Spinner, Textarea, fmtClock, useCountdown, useDocumentTitle, useToast } from '@/ui'
import { EntryCard } from '@/ui/entries'
import { ExperimentEditor } from '@/ui/experiments'
import { Mark } from '@/brand/Mark'

/**
 * The shared stage. Dark, one idea per screen. The same sanitized snapshot
 * everyone gets; facilitator controls are drawn only for the facilitator and
 * can be hidden (H) when this screen is the one being projected.
 */
export function Stage() {
  const { sprintId = '' } = useParams()
  const nav = useNavigate()
  const toast = useToast()
  const st = useStage(sprintId)
  const { sprint, stage, grouping, votes, experiments, previous, command } = st
  const [hideControls, setHideControls] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [lookingAt, setLookingAt] = useState<string | null>(null)
  useDocumentTitle(sprint ? `${sprint.name} · stage` : 'Stage')
  useEffect(() => {
    applyTheme(undefined, 'dark')
    return () => applyTheme(readPrefs().theme)
  }, [])

  const fac = !!stage?.is_facilitator
  const phases = useMemo(() => stage?.phases ?? [], [stage?.phases])
  const phaseIdx = stage ? phases.indexOf(stage.phase) : 0
  const go = useCallback(
    async (dir: 1 | -1) => {
      if (!stage) return
      const next = phases[phaseIdx + dir]
      if (!next) return
      const r = await command({ type: 'set_phase', phase: next })
      if (!r.ok) toast(r.message ?? '', 'danger')
    },
    [stage, phases, phaseIdx, command, toast],
  )

  // Keyboard: → / ← stages, Space timer, N next speaker, O open floor, H hide controls, R reveal.
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
      else if (e.key.toLowerCase() === 'h') setHideControls((h) => !h)
      else if (e.key.toLowerCase() === 'r') setRevealed(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fac, go, command, stage?.timer.running])

  if (st.revoked) return <Centered><p>Your access to this sprint ended.</p></Centered>
  if (st.error) return <Centered><p>{st.error}</p></Centered>
  if (!sprint) return <Centered><Spinner /></Centered>
  if (!stage)
    return (
      <Centered>
        <Mark size={48} className="text-ink" />
        <h1 className="font-display mt-4 text-3xl">{sprint.name}</h1>
        <p className="mt-2 text-ink-soft">{sprint.status === 'completed' ? 'This retro is done.' : 'The retro hasn’t started yet.'}</p>
        <div className="mt-6 flex gap-2">
          {sprint.status === 'completed' ? <Button onClick={() => nav(`/sprints/${sprintId}/outcomes`)}>See the outcomes</Button> : null}
          {fac && sprint.status === 'ready' ? <Button variant="primary" onClick={async () => { await post(`/api/sprints/${sprintId}/transition`, { to: 'live' }); st.reload() }}>Start the retro</Button> : null}
          <Button variant="ghost" onClick={() => nav(`/sprints/${sprintId}`)}>Back</Button>
        </div>
      </Centered>
    )
  const showControls = fac && !hideControls
  const themes = grouping?.themes ?? []
  const currentTheme = themes.find((t) => t.id === (lookingAt ?? stage.current_theme_id)) ?? null

  return (
    <div className="stage-glow min-h-dvh text-ink">
      <TopRail stage={stage} sprintName={sprint.name} showControls={showControls} onPrev={() => go(-1)} onNext={() => go(1)} command={command} />
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-6 sm:px-10">
        {stage.quiet_reading ? <QuietBanner stage={stage} /> : null}
        {stage.phase === 'arrive' ? <Arrive stage={stage} fac={showControls} sprintId={sprintId} onChange={st.reload} /> : null}
        {stage.phase === 'remember' ? <Remember previous={previous} themes={themes} fac={showControls} sprintId={sprintId} onChange={st.loadExperiments} /> : null}
        {stage.phase === 'discover' ? <Discover themes={themes} ungrouped={grouping?.ungrouped.length ?? 0} total={grouping?.total_entries ?? 0} revealed={revealed} onReveal={() => setRevealed(true)} fac={showControls} votes={votes} sprintId={sprintId} onVotesChanged={() => { st.loadVotes(); st.loadThemes() }} command={command} stage={stage} /> : null}
        {stage.phase === 'discuss' ? <Discuss stage={stage} themes={themes} theme={currentTheme} lookingAt={lookingAt} setLookingAt={setLookingAt} fac={showControls} command={command} sprintId={sprintId} onNotesSaved={(s) => st.setStage(s)} /> : null}
        {stage.phase === 'decide' ? <Decide stage={stage} themes={themes} experiments={experiments} fac={showControls} sprintId={sprintId} sprintParticipants={sprint.participants} onChange={st.loadExperiments} /> : null}
        {stage.phase === 'leave' ? <Leave stage={stage} experiments={experiments} themes={themes} fac={showControls} sprintId={sprintId} onComplete={async () => { try { await post(`/api/sprints/${sprintId}/transition`, { to: 'completed' }); nav(`/sprints/${sprintId}/outcomes`) } catch (e) { toast(e instanceof ApiError ? e.message : 'Couldn’t complete', 'danger') } }} /> : null}
      </main>
      {fac ? (
        <div className="fixed bottom-3 right-3 z-30 flex items-center gap-2 text-xs text-ink-faint">
          {!stage.you_control ? <button className="rounded-full bg-card px-3 py-1 text-warn" onClick={() => command({ type: 'take_control' })}>{stage.controller_name ? `${stage.controller_name} is controlling — take control` : 'Take control'}</button> : null}
          <button className="rounded-full bg-card px-3 py-1 hover:text-ink" onClick={() => setHideControls((h) => !h)} aria-pressed={hideControls} title="H">
            {hideControls ? <span className="inline-flex items-center gap-1"><Eye className="size-3.5" /> Show controls</span> : <span className="inline-flex items-center gap-1"><EyeOff className="size-3.5" /> Presenting</span>}
          </button>
        </div>
      ) : (
        <div className="fixed bottom-3 right-3 z-30 text-xs text-ink-faint">
          <Link to={`/sprints/${sprintId}/room`} className="rounded-full bg-card px-3 py-1 hover:text-ink">Open the companion</Link>
        </div>
      )}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="stage-glow grid min-h-dvh place-items-center px-6 text-center text-ink"><div className="flex flex-col items-center">{children}</div></div>
}

function TopRail({ stage, sprintName, showControls, onPrev, onNext, command }: { stage: StageSnapshot; sprintName: string; showControls: boolean; onPrev: () => void; onNext: () => void; command: ReturnType<typeof useStage>['command'] }) {
  const remaining = useCountdown(stage.timer.ends_at ?? null, stage.timer.remaining_secs, stage.server_time)
  const idx = stage.phases.indexOf(stage.phase)
  const over = stage.timer.total_secs > 0 && remaining === 0 && stage.timer.running
  return (
    <header className="sticky top-0 z-20 border-b border-line/60 bg-paper/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3 sm:px-10">
        <div className="flex items-center gap-2 text-sm text-ink-soft"><Mark size={22} /> <span className="hidden sm:inline">{sprintName}</span></div>
        <ol className="flex flex-1 items-center gap-1" aria-label="Chapters">
          {stage.phases.map((p, i) => (
            <li key={p} className="flex flex-1 flex-col gap-1">
              <span className={clsx('h-1 rounded-full transition-colors duration-300', i < idx ? 'bg-sinag/60' : i === idx ? 'bg-sinag' : 'bg-line')} />
              <span className={clsx('text-[11px] uppercase tracking-wider', i === idx ? 'text-ink' : 'text-ink-faint')}>{PHASE_LABEL[p]}</span>
            </li>
          ))}
        </ol>
        <div className={clsx('flex items-center gap-2 font-display text-2xl tabular-nums', over ? 'text-warn' : stage.timer.running ? 'text-ink' : 'text-ink-faint')} aria-live="off" title="Timers are guidance, not a cut-off">
          <Timer className="size-5" /> {fmtClock(remaining)}
          {over ? <span className="text-xs font-sans">time’s a guide, not a wall</span> : null}
        </div>
        {showControls ? (
          <div className="flex items-center gap-1">
            <IconBtn label="Previous chapter (←)" onClick={onPrev} disabled={idx === 0}><ChevronLeft className="size-4" /></IconBtn>
            <IconBtn label={stage.timer.running ? 'Pause (space)' : 'Resume (space)'} onClick={() => command(stage.timer.running ? { type: 'timer_pause' } : { type: 'timer_resume' })}>{stage.timer.running ? <Pause className="size-4" /> : <Play className="size-4" />}</IconBtn>
            <IconBtn label="Add two minutes" onClick={() => command({ type: 'timer_adjust', delta_secs: 120 })}>+2</IconBtn>
            <IconBtn label="Reset chapter timer" onClick={() => command({ type: 'set_phase', phase: stage.phase })}><RotateCcw className="size-4" /></IconBtn>
            <IconBtn label="Next chapter (→)" onClick={onNext} disabled={idx === stage.phases.length - 1} primary><ChevronRight className="size-4" /></IconBtn>
          </div>
        ) : null}
      </div>
    </header>
  )
}

function IconBtn({ children, label, onClick, disabled, primary }: { children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <button className={clsx('grid h-9 min-w-9 place-items-center rounded-full px-2 text-sm transition-colors disabled:opacity-40', primary ? 'bg-sinag text-paper' : 'bg-card border border-line hover:bg-ink/6')} aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )
}

function ChapterTitle({ phase, children }: { phase: string; children?: React.ReactNode }) {
  return (
    <div className="mb-8 anim-rise" key={phase}>
      <div className="text-sm uppercase tracking-wider text-sinag">{PHASE_LABEL[phase]}</div>
      <h1 className="font-display mt-1 text-4xl leading-tight sm:text-5xl">{children ?? PHASE_HINT[phase]}</h1>
    </div>
  )
}

function QuietBanner({ stage }: { stage: StageSnapshot }) {
  const remaining = useCountdown(stage.timer.ends_at ?? null, stage.timer.remaining_secs, stage.server_time)
  return (
    <div className="mb-6 rounded-2xl border border-line bg-card/70 px-5 py-4 text-center anim-fade">
      <div className="font-display text-2xl">A quiet minute to read.</div>
      <div className="text-sm text-ink-soft">No need to speak yet. {fmtClock(remaining)} left.</div>
    </div>
  )
}

// ---------- Arrive ----------
function Arrive({ stage, fac, sprintId, onChange }: { stage: StageSnapshot; fac: boolean; sprintId: string; onChange: () => void }) {
  const present = stage.attendance.filter((a) => a.present)
  return (
    <div>
      <ChapterTitle phase="arrive">Welcome back.</ChapterTitle>
      {stage.opening_question ? (
        <div className="mb-10 max-w-3xl anim-rise">
          <div className="text-sm text-ink-soft">While people arrive — optional</div>
          <p className="font-display text-3xl leading-snug">{stage.opening_question}</p>
        </div>
      ) : null}
      <div className="flex items-center gap-2 text-sm text-ink-soft"><Users className="size-4" /> {present.length} of {stage.attendance.length} here{fac ? ' — click a name to mark them present' : ''}</div>
      <ul className="mt-3 flex flex-wrap gap-2">
        {stage.attendance.map((a) => (
          <li key={a.account_id}>
            <button
              className={clsx('rounded-full border px-4 py-2 text-lg transition-colors', a.present ? 'border-sinag bg-sinag-soft text-ink' : 'border-line text-ink-faint', fac ? 'hover:border-ink/40' : 'cursor-default')}
              onClick={fac ? async () => { await post(`/api/sprints/${sprintId}/meeting/attendance/${a.account_id}`, { present: !a.present }); onChange() } : undefined}
              aria-pressed={a.present}
              disabled={!fac}
            >
              {a.display_name}{a.is_facilitator ? <span className="ml-2 text-xs text-ink-faint">facilitator</span> : null}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm text-ink-faint">People can also mark themselves present from the companion on their phone.</p>
    </div>
  )
}

// ---------- Remember ----------
function Remember({ previous, themes, fac, sprintId, onChange }: { previous: Experiment[]; themes: ThemeView[]; fac: boolean; sprintId: string; onChange: () => void }) {
  const wins = useMemo(() => themes.flatMap((t) => t.entries).filter((e) => e.category === 'proud' || e.category === 'keep').slice(0, 6), [themes])
  return (
    <div className="grid gap-10 lg:grid-cols-[1.3fr_1fr]">
      <div>
        <ChapterTitle phase="remember">Last time, we said…</ChapterTitle>
        {previous.length === 0 ? (
          <p className="text-xl text-ink-soft">This is the first retro here. Nothing to revisit — next time, the experiments you agree on come back to this screen first.</p>
        ) : (
          <ul className="space-y-4">
            {previous.map((e) => (
              <li key={e.id} className="card anim-rise p-5">
                <p className="text-xl leading-snug">{e.change_to_try}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-ink-soft">
                  <Badge tone={e.status === 'helped' ? 'ok' : e.status === 'did_not_help' ? 'danger' : 'neutral'}>{OUTCOME_LABEL[e.status]}</Badge>
                  {e.owner_name ? <span>{e.owner_name}</span> : null}
                  <span>signal: {e.success_signal}</span>
                </div>
                {e.outcome_note ? <p className="mt-2 text-ink-soft">{e.outcome_note}</p> : null}
                {fac ? <OutcomeQuick e={e} onChange={onChange} sprintId={sprintId} /> : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-sm text-ink-faint">“Not tried yet” and “Inconclusive” are honest answers. Learning something counts.</p>
      </div>
      <div>
        <div className="mb-4 font-display text-2xl">Wins worth keeping</div>
        {wins.length === 0 ? <p className="text-ink-soft">No “proud of” or “keep” entries this sprint — that’s worth a sentence too.</p> : null}
        <ul className="space-y-2">
          {wins.map((e) => (
            <li key={e.id}><EntryCard e={e} dense /></li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function OutcomeQuick({ e, sprintId, onChange }: { e: Experiment; sprintId: string; onChange: () => void }) {
  const [note, setNote] = useState(e.outcome_note ?? '')
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm">
      <span className="text-ink-faint">What happened?</span>
      {(['helped', 'did_not_help', 'inconclusive', 'not_tried'] as const).map((s) => (
        <button key={s} className={clsx('rounded-full border px-3 py-1', e.status === s ? 'border-sinag bg-sinag-soft' : 'border-line hover:border-ink/40')} onClick={async () => { await patch(`/api/sprints/${e.sprint_id}/experiments/${e.id}`, { status: s, outcome_note: note }); onChange() }}>
          {OUTCOME_LABEL[s]}
        </button>
      ))}
      <input className="min-w-40 flex-1 rounded-lg border border-line bg-paper px-2 py-1" placeholder="short context" value={note} onChange={(ev) => setNote(ev.target.value)} onBlur={async () => { if (note !== (e.outcome_note ?? '')) { await patch(`/api/sprints/${e.sprint_id}/experiments/${e.id}`, { outcome_note: note }); onChange() } }} aria-label="Outcome note" />
      <span className="sr-only">{sprintId}</span>
    </div>
  )
}

// ---------- Discover: the reveal ----------
function Discover({ themes, ungrouped, total, revealed, onReveal, fac, votes, sprintId, onVotesChanged, command, stage }: { themes: ThemeView[]; ungrouped: number; total: number; revealed: boolean; onReveal: () => void; fac: boolean; votes: ReturnType<typeof useStage>['votes']; sprintId: string; onVotesChanged: () => void; command: ReturnType<typeof useStage>['command']; stage: StageSnapshot }) {
  const toast = useToast()
  const round = votes?.current ?? null
  const closed = votes?.previous.find((r) => r.status === 'closed') ?? null
  const marks = useMemo(() => {
    // One mark per entry, positioned by a seeded hash of the entry id: stable across renders,
    // unrelated to submission order or author. Nothing is inferable from position.
    const all = themes.flatMap((t) => t.entries)
    return all.map((e) => {
      let h = 0
      for (const ch of e.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
      return { id: e.id, x: 5 + ((h % 1000) / 1000) * 90, y: 8 + (((h >> 10) % 1000) / 1000) * 84, color: categoryMeta(e.category).color, delay: (h >> 20) % 400 }
    })
  }, [themes])
  const few = total <= 1
  const auto = few || themes.length === 0
  const show = revealed || auto
  return (
    <div>
      <ChapterTitle phase="discover">{total === 0 ? 'Nothing was captured this sprint.' : total === 1 ? 'One thought was captured.' : `${total} thoughts, ${themes.length} ${themes.length === 1 ? 'theme' : 'themes'}.`}</ChapterTitle>
      {total === 0 ? <p className="text-xl text-ink-soft">That’s a real outcome, not a failure. Talk about why, and whether the next sprint needs a different way in.</p> : null}
      {!show ? (
        <div className="relative h-[46vh] min-h-72 overflow-hidden rounded-3xl border border-line bg-card/40">
          {marks.map((m) => (
            <span key={m.id} aria-hidden className="absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full anim-pulse shadow-[0_0_18px_2px_var(--glow)]" style={{ left: `${m.x}%`, top: `${m.y}%`, background: m.color, animationDelay: `${m.delay}ms`, ["--glow" as string]: m.color }} />
          ))}
          <div className="absolute inset-0 grid place-items-center">
            {fac ? (
              <Button size="lg" variant="primary" onClick={onReveal} className="shadow-[var(--shadow-float)]">Open the sprint <span className="ml-1 text-xs opacity-70">R</span></Button>
            ) : (
              <p className="rounded-full bg-paper/80 px-4 py-2 text-ink-soft">Each mark is one thought. The facilitator opens them.</p>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {themes.map((t, i) => {
              const votesFor = closed?.totals?.[t.id] ?? t.votes ?? null
              const mine = round?.my_votes.includes(t.id)
              return (
                <article key={t.id} className={clsx('card anim-settle relative p-5', t.parked && 'opacity-70')} style={{ animationDelay: `${Math.min(i, 8) * 70}ms` }}>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-display text-2xl leading-tight">{t.title}</h3>
                    {typeof votesFor === 'number' && !round ? <span className="rounded-full bg-sinag-soft px-2.5 py-0.5 font-display text-lg text-sinag-ink" title="votes">{votesFor}</span> : null}
                  </div>
                  {t.summary ? <p className="mt-2 text-ink-soft">{t.summary}</p> : null}
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink-soft">
                    <span>{t.entry_count} {t.entry_count === 1 ? 'entry' : 'entries'} <span className="text-ink-faint">(entries, not people)</span></span>
                    <span className="inline-flex gap-1">{Object.entries(t.category_mix).map(([c, n]) => <span key={c} className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: categoryMeta(c).color }} />{n}</span>)}</span>
                    {t.needs_attention ? <Badge tone="warn">needs attention</Badge> : null}
                    {t.parked ? <Badge>parked</Badge> : null}
                  </div>
                  {t.question ? <p className="mt-3 border-t border-line pt-3 text-sm italic">{t.question}</p> : null}
                  {round && stage.attendance.some((a) => a.is_you) ? (
                    <button
                      className={clsx('mt-3 w-full rounded-full border py-2 text-sm', mine ? 'border-sinag bg-sinag-soft text-sinag-ink' : 'border-line hover:border-ink/40')}
                      onClick={async () => { try { await post(`/api/sprints/${sprintId}/votes`, { theme_id: t.id, cast: !mine }); onVotesChanged() } catch (e) { toast(e instanceof ApiError ? e.message : 'Couldn’t vote', 'danger') } }}
                    >
                      {mine ? 'Voted — take back' : 'Vote for this'}
                    </button>
                  ) : null}
                </article>
              )
            })}
          </div>
          {ungrouped > 0 ? <p className="mt-4 text-sm text-ink-soft">{ungrouped} {ungrouped === 1 ? 'entry stays' : 'entries stay'} ungrouped and readable in the companion — nothing is dropped.</p> : null}
          <div className="mt-8 flex flex-wrap items-center gap-3">
            {round ? (
              <>
                <span className="text-ink-soft">Voting is open. Choices are private; totals appear when it closes.</span>
                <span className="text-sm">You have <strong>{round.my_remaining}</strong> of {round.budget} left.</span>
                {fac ? <Button variant="primary" onClick={async () => { await post(`/api/sprints/${sprintId}/votes/rounds/close`, { action: 'close' }); onVotesChanged() }}>Close voting and reveal totals</Button> : null}
              </>
            ) : fac ? (
              <>
                <Button variant="primary" onClick={async () => { try { await post(`/api/sprints/${sprintId}/votes/rounds`, {}); onVotesChanged() } catch (e) { toast(e instanceof ApiError ? e.message : 'Couldn’t open voting', 'danger') } }} disabled={themes.length === 0}>
                  {closed ? 'Vote again' : 'Open voting'}
                </Button>
                {closed ? <Button onClick={() => command({ type: 'set_agenda', items: [...themes].filter((t) => !t.parked).sort((a, b) => (closed.totals?.[b.id] ?? 0) - (closed.totals?.[a.id] ?? 0)).slice(0, 3).map((t) => ({ theme_id: t.id })) })}>Set the top three as the agenda</Button> : null}
                <span className="text-sm text-ink-faint">Low-vote themes stay in the parking lot; flag one “needs attention” in Prepare to bring it anyway.</span>
              </>
            ) : closed ? (
              <span className="text-ink-soft">Totals are in. The facilitator picks the conversations.</span>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}

// ---------- Discuss ----------
function Discuss({ stage, themes, theme, lookingAt, setLookingAt, fac, command, sprintId, onNotesSaved }: { stage: StageSnapshot; themes: ThemeView[]; theme: ThemeView | null; lookingAt: string | null; setLookingAt: (id: string | null) => void; fac: boolean; command: ReturnType<typeof useStage>['command']; sprintId: string; onNotesSaved: (s: StageSnapshot) => void }) {
  const toast = useToast()
  const agenda = stage.agenda.map((a) => themes.find((t) => t.id === a.theme_id)).filter(Boolean) as ThemeView[]
  const list = agenda.length ? agenda : themes.filter((t) => !t.parked)
  const speaking = stage.speaking
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.7fr)_minmax(260px,0.8fr)]">
      <div>
        {!theme ? (
          <>
            <ChapterTitle phase="discuss">Which conversation first?</ChapterTitle>
            <ul className="space-y-2">
              {list.map((t, i) => (
                <li key={t.id}>
                  <button className="card flex w-full items-center justify-between gap-3 p-4 text-left hover:border-ink/40 disabled:cursor-default" disabled={!fac} onClick={() => command({ type: 'set_topic', theme_id: t.id })}>
                    <span><span className="mr-3 font-display text-xl text-ink-faint">{i + 1}</span><span className="font-display text-xl">{t.title}</span>{stage.discussed_theme_ids.includes(t.id) ? <Badge className="ml-2" tone="ok">discussed</Badge> : null}</span>
                    {typeof t.votes === 'number' ? <span className="text-sm text-ink-soft">{t.votes} votes</span> : null}
                  </button>
                </li>
              ))}
            </ul>
            {list.length === 0 ? <p className="text-xl text-ink-soft">No themes on the agenda. You can still open any theme, or talk about the ungrouped entries directly.</p> : null}
          </>
        ) : (
          <div key={theme.id} className="anim-rise">
            {lookingAt && lookingAt !== stage.current_theme_id ? (
              <div className="mb-4 flex items-center gap-3 rounded-full bg-card px-4 py-2 text-sm">
                <span className="text-ink-soft">Looking around — the room is on <strong className="text-ink">{themes.find((t) => t.id === stage.current_theme_id)?.title ?? 'the agenda'}</strong></span>
                <button className="text-sinag underline" onClick={() => setLookingAt(null)}>Back to the live topic</button>
              </div>
            ) : null}
            <div className="text-sm uppercase tracking-wider text-sinag">Discuss</div>
            <h1 className="font-display mt-1 text-4xl leading-tight sm:text-5xl">{theme.title}</h1>
            {theme.summary ? <p className="mt-3 max-w-3xl text-lg text-ink-soft">{theme.summary}</p> : null}
            {theme.question ? <p className="mt-4 font-display text-2xl italic text-ink">{theme.question}</p> : null}
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              {theme.entries.map((e) => <EntryCard key={e.id} e={e} dense />)}
            </div>
            {theme.context.length ? (
              <div className="mt-4 rounded-2xl border border-dashed border-line p-4">
                <div className="mb-2 text-xs uppercase tracking-wider text-ink-faint">Added during the retro · anonymous</div>
                <ul className="space-y-2">{theme.context.map((c) => <li key={c.id} className="anim-rise text-[15px]">{c.body}</li>)}</ul>
              </div>
            ) : null}
            {fac ? <Notes stage={stage} sprintId={sprintId} themeId={theme.id} onSaved={onNotesSaved} /> : (
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {[['What happened?', stage.notes.what_happened], ['What impact did it have?', stage.notes.impact], ['What could we try?', stage.notes.could_try]].map(([q, v]) => (
                  <div key={q} className="rounded-xl bg-card/60 p-3"><div className="text-xs text-ink-faint">{q}</div><div className="mt-1 whitespace-pre-wrap text-sm">{v || <span className="text-ink-faint">—</span>}</div></div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <aside className="space-y-4">
        <SpeakerCard speaking={speaking} fac={fac} command={command} present={stage.attendance.filter((a) => a.present).length} />
        {fac ? (
          <div className="card space-y-2 p-4 text-sm">
            <div className="text-xs uppercase tracking-wider text-ink-faint">Facilitate</div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => command({ type: 'quiet_reading', secs: 60 })} disabled={!theme}>Quiet minute to read</Button>
              <Button size="sm" onClick={() => command({ type: 'release_context' })} variant={stage.has_unreleased_context ? 'primary' : 'secondary'}>{stage.has_unreleased_context ? 'Release new context' : 'No new context'}</Button>
              {theme ? <Button size="sm" onClick={() => command({ type: 'mark_discussed', theme_id: theme.id, discussed: !stage.discussed_theme_ids.includes(theme.id) })}>{stage.discussed_theme_ids.includes(theme.id) ? 'Unmark discussed' : 'Mark discussed'}</Button> : null}
              {theme ? <Button size="sm" variant="ghost" onClick={async () => { try { await patch(`/api/sprints/${sprintId}/themes/${theme.id}`, { parked: true }); toast('Parked'); command({ type: 'set_topic', theme_id: null }) } catch (e) { toast(e instanceof ApiError ? e.message : 'Couldn’t park', 'danger') } }}>Park this</Button> : null}
              {theme ? <Button size="sm" variant="ghost" onClick={() => command({ type: 'set_topic', theme_id: null })}>Back to agenda</Button> : null}
            </div>
          </div>
        ) : null}
        {list.length > 1 ? (
          <nav className="card p-3 text-sm" aria-label="Agenda">
            <div className="mb-1 text-xs uppercase tracking-wider text-ink-faint">Agenda</div>
            <ol className="space-y-0.5">
              {list.map((t, i) => (
                <li key={t.id}>
                  <button className={clsx('flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-ink/6', t.id === stage.current_theme_id && 'bg-sinag-soft text-sinag-ink')} onClick={() => (fac ? command({ type: 'set_topic', theme_id: t.id }) : setLookingAt(t.id))}>
                    <span className="w-4 text-ink-faint">{i + 1}</span><span className="truncate">{t.title}</span>{stage.discussed_theme_ids.includes(t.id) ? <span className="ml-auto text-xs text-ok">✓</span> : null}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
      </aside>
    </div>
  )
}

function Notes({ stage, sprintId, themeId, onSaved }: { stage: StageSnapshot; sprintId: string; themeId: string; onSaved: (s: StageSnapshot) => void }) {
  const [n, setN] = useState(stage.notes)
  useEffect(() => setN(stage.notes), [stage.notes, themeId])
  const save = async (k: 'what_happened' | 'impact' | 'could_try' | 'notes') => {
    if (n[k] === stage.notes[k]) return
    const s = await put<StageSnapshot>(`/api/sprints/${sprintId}/meeting/notes/${themeId}`, { [k]: n[k] })
    onSaved(s)
  }
  return (
    <div className="mt-6 grid gap-3 sm:grid-cols-3">
      {([['what_happened', 'What happened?'], ['impact', 'What impact did it have?'], ['could_try', 'What could we try?']] as const).map(([k, q]) => (
        <label key={k} className="block rounded-xl bg-card/60 p-3">
          <span className="text-xs text-ink-faint">{q}</span>
          <Textarea rows={3} className="mt-1 bg-transparent text-sm" value={n[k]} onChange={(e) => setN({ ...n, [k]: e.target.value })} onBlur={() => save(k)} />
        </label>
      ))}
    </div>
  )
}

function SpeakerCard({ speaking, fac, command, present }: { speaking: StageSnapshot['speaking']; fac: boolean; command: ReturnType<typeof useStage>['command']; present: number }) {
  return (
    <div className="card p-5">
      <div className="text-xs uppercase tracking-wider text-ink-faint">Make room for another voice</div>
      {speaking?.current ? (
        <div key={speaking.current.account_id} className="anim-settle mt-2">
          <div className="font-display text-3xl">{speaking.current.display_name}</div>
          <p className="mt-1 text-ink-soft">{speaking.prompt}</p>
          <p className="mt-2 text-xs text-ink-faint">An invitation, not a turn. Passing is fine.</p>
        </div>
      ) : speaking?.status === 'exhausted' ? (
        <p className="mt-2 text-ink-soft">Everyone who was ready has had an invitation. The floor is open.</p>
      ) : speaking ? (
        <p className="mt-2 text-ink-soft">The floor is open.</p>
      ) : (
        <p className="mt-2 text-ink-soft">{present === 0 ? 'Nobody is marked present yet.' : 'Open the floor, or invite voices one at a time.'}</p>
      )}
      {fac ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {!speaking || speaking.status !== 'active' ? <Button size="sm" variant="primary" onClick={() => command({ type: 'speaking_start' })}>Invite someone</Button> : null}
          {speaking?.status === 'active' ? <Button size="sm" variant="primary" onClick={() => command({ type: 'speaking_next' })} title="N">Next voice</Button> : null}
          {speaking?.status === 'active' ? <Button size="sm" onClick={() => command({ type: 'speaking_open_floor' })} title="O">Open the floor</Button> : null}
          {speaking ? <Button size="sm" variant="ghost" onClick={() => command({ type: 'speaking_end' })}>End round</Button> : null}
        </div>
      ) : null}
      {speaking?.status === 'active' && speaking.remaining > 0 ? <div className="mt-2 text-xs text-ink-faint">{speaking.remaining} more to invite</div> : null}
    </div>
  )
}

// ---------- Decide ----------
function Decide({ stage, themes, experiments, fac, sprintId, sprintParticipants, onChange }: { stage: StageSnapshot; themes: ThemeView[]; experiments: Experiment[]; fac: boolean; sprintId: string; sprintParticipants: { account_id: string; display_name: string; is_facilitator: boolean; is_you: boolean }[]; onChange: () => void }) {
  const discussed = themes.filter((t) => stage.discussed_theme_ids.includes(t.id))
  const [seed, setSeed] = useState<{ text: string; theme: string } | null>(null)
  return (
    <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
      <div>
        <ChapterTitle phase="decide">What will we try next?</ChapterTitle>
        {experiments.length === 0 ? <p className="mb-4 text-ink-soft">One to three concrete changes. Each needs a person who says yes, a signal, and a date to revisit.</p> : null}
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
        {fac ? (
          <div className="mt-4">
            <ExperimentEditor key={seed?.text ?? 'blank'} sprintId={sprintId} participants={sprintParticipants} themes={themes.map((t) => ({ id: t.id, title: t.title }))} defaultText={seed?.text} defaultThemeId={seed?.theme} existingCount={experiments.length} onSaved={() => { setSeed(null); onChange() }} />
          </div>
        ) : (
          <p className="mt-4 text-sm text-ink-faint">If you’re nominated as an owner, the companion asks you to accept — or not.</p>
        )}
      </div>
      <aside>
        <div className="mb-3 font-display text-2xl">What we discussed</div>
        {discussed.length === 0 ? <p className="text-ink-soft">Nothing was marked discussed. That’s fine — draft from any theme.</p> : null}
        <ul className="space-y-2">
          {(discussed.length ? discussed : themes.slice(0, 5)).map((t) => (
            <li key={t.id} className="card p-3">
              <div className="font-medium">{t.title}</div>
              {t.draft_experiment ? <p className="mt-1 text-sm text-ink-soft">Draft: {t.draft_experiment}</p> : null}
              {fac ? <button className="mt-1 text-sm text-sinag underline" onClick={() => setSeed({ text: t.draft_experiment ?? '', theme: t.id })}>Start an experiment from this</button> : null}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  )
}

// ---------- Leave ----------
function Leave({ stage, experiments, themes, fac, onComplete, sprintId }: { stage: StageSnapshot; experiments: Experiment[]; themes: ThemeView[]; fac: boolean; onComplete: () => void; sprintId: string }) {
  const accepted = experiments.filter((e) => e.status !== 'proposed')
  const pending = experiments.filter((e) => e.status === 'proposed')
  const parked = themes.filter((t) => t.parked || (!stage.discussed_theme_ids.includes(t.id) && stage.agenda.some((a) => a.theme_id === t.id)))
  const [open, setOpen] = useState('')
  return (
    <div>
      <ChapterTitle phase="leave">Here’s what we’re taking with us.</ChapterTitle>
      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 font-display text-2xl">Commitments</h2>
          {accepted.length === 0 ? <p className="text-ink-soft">No accepted commitments. That can be the honest outcome of a good conversation.</p> : null}
          <ol className="space-y-3">
            {accepted.map((e, i) => (
              <li key={e.id} className="card anim-rise p-4" style={{ animationDelay: `${i * 80}ms` }}>
                <p className="text-lg">{e.change_to_try}</p>
                <div className="mt-1 text-sm text-ink-soft">{e.owner_name} · we’ll know by: {e.success_signal} · revisit {e.review_on}</div>
              </li>
            ))}
          </ol>
          {pending.length ? (
            <div className="mt-4 text-sm text-warn">{pending.length} proposed {pending.length === 1 ? 'experiment is' : 'experiments are'} still waiting for an owner to accept. They stay editable in Outcomes.</div>
          ) : null}
        </section>
        <section>
          <h2 className="mb-3 font-display text-2xl">Open questions & parked</h2>
          {fac ? (
            <div className="card p-3">
              <Input placeholder="Add an open question for the recap" value={open} onChange={(e) => setOpen(e.target.value)} onKeyDown={async (e) => { if (e.key === 'Enter' && open.trim() && stage.current_theme_id) { await put(`/api/sprints/${sprintId}/meeting/notes/${stage.current_theme_id}`, { notes: `${stage.notes.notes}\n- ${open.trim()}`.trim() }); setOpen('') } }} disabled={!stage.current_theme_id} />
              <p className="mt-1 text-xs text-ink-faint">{stage.current_theme_id ? 'Enter to add to the current theme’s notes; edit everything in Outcomes.' : 'Open a theme in Discuss to attach notes; or write them in Outcomes.'}</p>
            </div>
          ) : null}
          <ul className="mt-3 space-y-2">
            {parked.map((t) => (
              <li key={t.id} className="rounded-xl border border-dashed border-line px-4 py-3">
                <span className="font-medium">{t.title}</span> <span className="text-sm text-ink-faint">{t.parked ? 'parked' : 'not reached'}{t.needs_attention ? ' · needs attention' : ''}</span>
              </li>
            ))}
            {parked.length === 0 ? <li className="text-ink-soft">Nothing parked.</li> : null}
          </ul>
        </section>
      </div>
      {fac ? (
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Button size="lg" variant="primary" onClick={onComplete}>Complete the retro</Button>
          <span className="text-sm text-ink-faint">Outcomes stay editable afterwards. The recap is never published without you.</span>
        </div>
      ) : (
        <p className="mt-10 text-ink-soft">Thanks for being here.</p>
      )}
    </div>
  )
}
