import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { clsx } from 'clsx'
import { ArrowLeft, Compass, Hand, Mic } from 'lucide-react'
import { ApiError, newKey, post } from '@/api/client'
import type { ThemeView } from '@/api/types'
import { OUTCOME_LABEL, PHASE_HINT, PHASE_LABEL } from '@/lib/categories'
import { useStage } from '@/lib/stage'
import { Badge, Button, Spinner, Textarea, fmtClock, useCountdown, useDocumentTitle, useToast } from '@/ui'
import { ReconnectingBar } from '@/ui/status'
import { EntryCard } from '@/ui/entries'
import { Mark } from '@/brand/Mark'

/**
 * The participant's private companion: follows the stage, or "looks around"
 * on request and returns. Holds the private things — your votes, your
 * readiness, your unreleased context — and never shows anyone else's.
 */
export function Companion() {
  const { sprintId = '' } = useParams()
  const nav = useNavigate()
  const toast = useToast()
  const st = useStage(sprintId)
  const { sprint, stage, grouping, votes, experiments, previous } = st
  const [browse, setBrowse] = useState<string | null>(null) // theme id being looked at, or 'all'
  const [context, setContext] = useState('')
  const [ctxKey, setCtxKey] = useState(newKey)
  useDocumentTitle(sprint ? `${sprint.name} · room` : 'Room')
  useEffect(() => { setBrowse(null) }, [stage?.current_theme_id, stage?.phase])

  if (st.revoked) return <Shell><p className="text-ink-soft">Your access to this sprint ended.</p></Shell>
  if (st.error) return <Shell><p className="text-ink-soft">{st.error}</p></Shell>
  if (!sprint) return <Shell><Spinner /></Shell>
  if (!stage)
    return (
      <Shell title={sprint.name}>
        <p className="text-ink-soft">{sprint.status === 'completed' ? 'This retro is done.' : 'The retro hasn’t started. This page wakes up when the facilitator starts it.'}</p>
        <div className="mt-4 flex gap-2">
          {sprint.status === 'completed' ? <Button onClick={() => nav(`/sprints/${sprintId}/outcomes`)}>See the outcomes</Button> : null}
          <Button variant="ghost" onClick={() => nav(`/sprints/${sprintId}`)}>Back to the sprint</Button>
        </div>
      </Shell>
    )
  const me = stage.attendance.find((a) => a.is_you)
  const themes = grouping?.themes ?? []
  const current = themes.find((t) => t.id === stage.current_theme_id) ?? null
  const currentUngrouped = stage.current_theme_id === 'ungrouped'
  const looking = browse === 'all' ? null : themes.find((t) => t.id === browse) ?? null
  const round = votes?.current ?? null
  const revealedPhase = ['discover', 'discuss', 'decide', 'leave'].includes(stage.phase)
  const mine = experiments.filter((e) => e.owner_account_id === me?.account_id && !e.owner_accepted && e.status === 'proposed')

  const sendContext = async (themeId: string) => {
    try {
      await post(`/api/sprints/${sprintId}/meeting/context`, { theme_id: themeId, body: context, idempotency_key: ctxKey })
      setContext('')
      setCtxKey(newKey())
      toast('Sent. The facilitator shares new context in batches.')
      st.reload()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Couldn’t send — your text is still here', 'danger')
    }
  }

  // Live actions need the room. While it can't be reached, they are disabled, never queued.
  const paused = st.live === 'reconnecting'
  return (
    <Shell title={sprint.name} sub={<span><span className="text-accent">{PHASE_LABEL[stage.phase]}</span> · {PHASE_HINT[stage.phase]}</span>}>
      <ReconnectingBar status={st.live} />
      {/* presence + readiness: the two private controls, always visible */}
      <div className="card mb-4 flex flex-wrap items-center gap-2 p-3">
        <button
          className={clsx('inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm disabled:pointer-events-none disabled:opacity-45', me?.present ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line')}
          disabled={paused}
          onClick={async () => { await post(`/api/sprints/${sprintId}/meeting/attendance`, { present: !me?.present }); st.reload() }}
          aria-pressed={!!me?.present}
        >
          {me?.present ? 'I’m here' : 'Mark me present'}
        </button>
        <button
          className={clsx('inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm disabled:pointer-events-none disabled:opacity-45', me?.ready ? 'border-line' : 'border-line bg-ink/6 text-ink-soft')}
          disabled={paused}
          onClick={async () => { await post(`/api/sprints/${sprintId}/meeting/attendance`, { ready: !(me?.ready ?? true) }); st.reload() }}
          aria-pressed={!(me?.ready ?? true)}
          title="Step out of the speaking rotation for now"
        >
          {me?.ready ? <><Mic className="size-4" /> Ready to speak</> : <><Hand className="size-4" /> Passing for now</>}
        </button>
        <TimerPill stage={stage} />
      </div>

      {stage.speaking?.current?.is_you ? (
        <div className="card anim-settle mb-4 border-accent/40 p-4">
          <div className="text-xs uppercase tracking-wider text-accent">Your invitation</div>
          <p className="font-display mt-1 text-2xl">{stage.speaking.prompt}</p>
          <p className="mt-1 text-sm text-ink-soft">Only if you want to. Nobody thinks you wrote anything in particular.</p>
          <Button className="mt-3" disabled={paused} onClick={async () => { await post(`/api/sprints/${sprintId}/meeting/pass`); st.reload() }}>Pass for now</Button>
        </div>
      ) : null}

      {mine.length ? (
        <div className="card mb-4 border-warn/40 p-4">
          <div className="text-xs uppercase tracking-wider text-warn">You’ve been nominated</div>
          {mine.map((e) => (
            <div key={e.id} className="mt-2">
              <p className="font-medium">{e.change_to_try}</p>
              <p className="text-sm text-ink-soft">Signal: {e.success_signal} · review {e.review_on}</p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="primary" disabled={paused} onClick={async () => { await post(`/api/sprints/${sprintId}/experiments/${e.id}/accept`, { accept: true }); st.loadExperiments() }}>I’ll own this</Button>
                <Button size="sm" variant="ghost" disabled={paused} onClick={async () => { await post(`/api/sprints/${sprintId}/experiments/${e.id}/accept`, { accept: false }); st.loadExperiments() }}>Not me</Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* follow vs. look around */}
      {revealedPhase && themes.length ? (
        <div className="mb-3 flex items-center justify-between text-sm">
          {browse ? (
            <button className="inline-flex items-center gap-1 text-accent" onClick={() => setBrowse(null)}><ArrowLeft className="size-4" /> Back to the live topic</button>
          ) : (
            <span className="text-ink-soft">Following the room</span>
          )}
          {!browse ? <button className="inline-flex items-center gap-1 text-ink-soft hover:text-ink" onClick={() => setBrowse('all')}><Compass className="size-4" /> Look around</button> : null}
        </div>
      ) : null}

      {browse === 'all' ? (
        <ul className="space-y-2">
          {themes.map((t) => (
            <li key={t.id}>
              <button className="card w-full p-3 text-left hover:border-ink/40" onClick={() => setBrowse(t.id)}>
                <div className="font-display text-lg">{t.title}</div>
                <div className="text-xs text-ink-soft">{t.entry_count} entries{t.parked ? ' · parked' : ''}</div>
              </button>
            </li>
          ))}
          {grouping?.ungrouped.length ? (
            <li className="card p-3">
              <div className="mb-2 font-display text-lg">Ungrouped</div>
              <div className="space-y-2">{grouping.ungrouped.map((e) => <EntryCard key={e.id} e={e} dense />)}</div>
            </li>
          ) : null}
        </ul>
      ) : looking ? (
        <ThemeReader t={looking} />
      ) : stage.phase === 'arrive' ? (
        <div className="space-y-3">
          {stage.opening_question ? <p className="font-display text-2xl">{stage.opening_question}</p> : null}
          <p className="text-ink-soft">Mark yourself present above so the facilitator knows you’re here.</p>
        </div>
      ) : stage.phase === 'remember' ? (
        <div className="space-y-2">
          <div className="font-display text-xl">Last time, we said…</div>
          {previous.length === 0 ? <p className="text-ink-soft">First retro here. Nothing to revisit yet.</p> : null}
          {previous.map((e) => (
            <div key={e.id} className="card p-3">
              <p>{e.change_to_try}</p>
              <div className="mt-1 text-sm"><Badge tone={e.status === 'helped' ? 'ok' : e.status === 'did_not_help' ? 'danger' : 'neutral'}>{OUTCOME_LABEL[e.status]}</Badge> <span className="text-ink-soft">{e.owner_name}</span></div>
            </div>
          ))}
        </div>
      ) : stage.phase === 'discover' ? (
        <div className="space-y-3">
          {round ? (
            <div className="rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent-ink">
              Voting is open. <strong>{round.my_remaining}</strong> of {round.budget} votes left — one per theme, private.
            </div>
          ) : (
            <p className="text-sm text-ink-soft">{themes.length ? 'Themes are on the stage. Voting opens when the facilitator says.' : 'No themes were prepared; the entries are readable under Look around.'}</p>
          )}
          {themes.filter((t) => !t.parked).map((t) => {
            const mineVote = round?.my_votes.includes(t.id)
            const total = votes?.previous.find((r) => r.status === 'closed')?.totals?.[t.id]
            return (
              <div key={t.id} className="card p-3">
                <div className="flex items-start justify-between gap-2">
                  <button className="text-left font-display text-lg" onClick={() => setBrowse(t.id)}>{t.title}</button>
                  {typeof total === 'number' && !round ? <span className="rounded-full bg-accent-soft px-2 py-0.5 text-sm text-accent-ink">{total}</span> : null}
                </div>
                <div className="text-xs text-ink-soft">{t.entry_count} entries · tap the title to read them</div>
                {round ? (
                  <button
                    className={clsx('mt-2 h-11 w-full rounded-full border text-sm disabled:pointer-events-none disabled:opacity-45', mineVote ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line')}
                    disabled={paused}
                    onClick={async () => { try { await post(`/api/sprints/${sprintId}/votes`, { theme_id: t.id, cast: !mineVote }); st.loadVotes() } catch (e) { toast(e instanceof ApiError ? e.message : 'Couldn’t vote', 'danger') } }}
                  >
                    {mineVote ? 'Voted · take back' : 'Vote for this'}
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : stage.phase === 'discuss' ? (
        currentUngrouped ? (
          <div className="space-y-2"><div className="font-display text-xl">Ungrouped observations</div>{(grouping?.ungrouped ?? []).map((e) => <EntryCard key={e.id} e={e} dense />)}</div>
        ) : current ? (
          <div className="space-y-4">
            {stage.quiet_reading ? <div className="rounded-xl bg-card px-4 py-3 text-center text-sm text-ink-soft">A quiet minute to read. No need to speak yet.</div> : null}
            <ThemeReader t={current} />
            <div className="card p-3">
              <div className="mb-1 text-sm font-medium">Add context, anonymously</div>
              <p className="mb-2 text-xs text-ink-soft">Another way to take part. Released by the facilitator in a batch; shown apart from the original entries.</p>
              <Textarea rows={3} value={context} onChange={(e) => setContext(e.target.value)} placeholder="Something the room should know…" maxLength={2000} />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-ink-faint">{stage.my_context.filter((c) => !c.released).length ? `${stage.my_context.filter((c) => !c.released).length} waiting for release` : ''}</span>
                <Button size="sm" variant="primary" disabled={!context.trim() || paused} onClick={() => sendContext(current.id)}>Send</Button>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-ink-soft">The facilitator is choosing the first conversation. Use “Look around” to read any theme meanwhile.</p>
        )
      ) : stage.phase === 'decide' ? (
        <div className="space-y-2">
          <div className="font-display text-xl">What will we try next?</div>
          {experiments.length === 0 ? <p className="text-ink-soft">Nothing proposed yet.</p> : null}
          {experiments.map((e) => (
            <div key={e.id} className="card p-3">
              <p>{e.change_to_try}</p>
              <div className="mt-1 text-xs text-ink-soft">{e.owner_name ? `${e.owner_name}${e.owner_accepted ? '' : ' (to accept)'}` : 'no owner yet'} · review {e.review_on}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="font-display text-xl">Taking with us</div>
          {experiments.filter((e) => e.status !== 'proposed').map((e) => (
            <div key={e.id} className="card p-3"><p>{e.change_to_try}</p><div className="text-xs text-ink-soft">{e.owner_name} · {e.review_on}</div></div>
          ))}
          <Link to={`/sprints/${sprintId}/outcomes`} className="block text-sm text-accent underline">Outcomes and exports</Link>
        </div>
      )}
    </Shell>
  )
}

function ThemeReader({ t }: { t: ThemeView }) {
  return (
    <div className="space-y-2">
      <div className="font-display text-2xl leading-tight">{t.title}</div>
      {t.summary ? <p className="text-sm text-ink-soft">{t.summary}</p> : null}
      {t.question ? <p className="text-sm italic">{t.question}</p> : null}
      <div className="text-xs text-ink-faint">{t.entry_count} entries — original observations</div>
      {t.entries.map((e) => <EntryCard key={e.id} e={e} dense />)}
      {t.context.length ? (
        <div className="rounded-xl border border-dashed border-line p-3">
          <div className="mb-1 text-xs text-ink-faint">Added during the retro</div>
          {t.context.map((c) => <p key={c.id} className="py-1 text-sm">{c.body}</p>)}
        </div>
      ) : null}
    </div>
  )
}

function TimerPill({ stage }: { stage: NonNullable<ReturnType<typeof useStage>['stage']> }) {
  const remaining = useCountdown(stage.timer.ends_at ?? null, stage.timer.remaining_secs, stage.server_time)
  if (!stage.timer.total_secs) return null
  return <span className={clsx('ml-auto tabular-nums text-sm', stage.timer.running ? 'text-ink' : 'text-ink-faint')}>{fmtClock(remaining)}</span>
}

function Shell({ children, title, sub }: { children: React.ReactNode; title?: string; sub?: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-paper">
      <header className="sticky top-0 z-20 border-b border-line/70 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3">
          <Link to="/" aria-label="Home" className="text-ink"><Mark size={24} /></Link>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{title ?? 'Muni'}</div>
            {sub ? <div className="truncate text-xs text-ink-soft">{sub}</div> : null}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 py-4 pb-16">{children}</main>
    </div>
  )
}
