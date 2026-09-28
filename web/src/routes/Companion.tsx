import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ApiError, newKey, post } from '@/api/client'
import type { ThemeView } from '@/api/types'
import { PHASE_HINT, PHASE_LABEL } from '@/lib/categories'
import { useStage } from '@/lib/stage'
import { Button, Spinner, Textarea, fmtClock, useCountdown, useDocumentTitle, useToast } from '@/ui'
import { ReconnectingBar } from '@/ui/status'
import { PastExperiment, Thought, worthKeeping } from '@/ui/retro'
import { Mark } from '@/brand/Mark'

/**
 * Each person's own retro, on their phone. It follows the shared screen step by step and holds the
 * private things: your votes, whether you're ready to be invited to speak, and what you add
 * without your name. Opening it is being there.
 */
export function Companion() {
  const { sprintId = '' } = useParams()
  const nav = useNavigate()
  const toast = useToast()
  const st = useStage(sprintId)
  const { sprint, stage, grouping, votes, experiments, previous } = st
  const [context, setContext] = useState('')
  const [ctxKey, setCtxKey] = useState(newKey)
  useDocumentTitle(sprint ? `${sprint.name} · retro` : 'Retro')
  const me = stage?.attendance.find((a) => a.is_you)
  const paused = st.live === 'reconnecting'
  useEffect(() => {
    if (me && !me.present && !stage?.ended_at && !paused) post(`/api/sprints/${sprintId}/meeting/attendance`, { present: true }).then(() => st.reload()).catch(() => {})
  }, [me?.account_id, stage?.session_id]) // eslint-disable-line react-hooks/exhaustive-deps
  const themes = useMemo(() => (grouping?.themes ?? []).filter((t) => !t.parked), [grouping?.themes])
  const ungrouped = useMemo(() => grouping?.ungrouped ?? [], [grouping?.ungrouped])

  if (st.revoked) return <Shell><p className="text-ink-soft">Your access to this sprint ended.</p></Shell>
  if (st.error) return <Shell><p className="text-ink-soft">{st.error}</p></Shell>
  if (!sprint) return <Shell><Spinner /></Shell>
  const done = ['completed', 'archived'].includes(sprint.status) || (!!stage?.ended_at && !stage.cancelled)
  if (!stage || done)
    return (
      <Shell title={sprint.name}>
        <h1 className="retro-title retro-title--phone">{done ? <>The retro is <em>done</em>.</> : 'Not started yet.'}</h1>
        <p className="mt-2 text-ink-soft">{done ? 'What the team will try, and what it said, is on the sprint’s page.' : 'This page wakes up when the facilitator starts the retro.'}</p>
        <div className="mt-5"><Button variant={done ? 'primary' : 'ghost'} onClick={() => nav(`/sprints/${sprintId}`)}>{done ? 'See the outcomes' : 'Back to the sprint'}</Button></div>
      </Shell>
    )

  const step = stage.phases.indexOf(stage.phase) + 1
  const round = votes?.current ?? null
  const closed = votes?.previous.find((r) => r.status === 'closed') ?? null
  const current = themes.find((t) => t.id === stage.current_theme_id) ?? null
  const mine = experiments.filter((e) => e.owner_account_id === me?.account_id && !e.owner_accepted && e.status === 'proposed')
  const waiting = stage.my_context.filter((c) => !c.released && c.theme_id === current?.id).length

  const sendContext = async (themeId: string) => {
    try {
      await post(`/api/sprints/${sprintId}/meeting/context`, { theme_id: themeId, body: context, idempotency_key: ctxKey })
      setContext('')
      setCtxKey(newKey())
      toast('Sent. It reaches the room without your name, when the facilitator shows it.')
      st.reload()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Couldn’t send — your words are still here', 'danger')
    }
  }
  const vote = async (t: ThemeView, cast: boolean) => {
    try {
      await post(`/api/sprints/${sprintId}/votes`, { theme_id: t.id, cast })
      st.loadVotes()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Couldn’t vote', 'danger')
    }
  }

  return (
    <Shell title={sprint.name} sub={<><span className="text-accent-ink">{step} · {PHASE_LABEL[stage.phase]}</span> — {PHASE_HINT[stage.phase]}</>}>
      <ReconnectingBar status={st.live} />

      {stage.speaking?.current?.is_you ? (
        <div className="retro-invite anim-settle">
          <p className="retro-note-label">You’re invited</p>
          <p className="retro-invite-line">{stage.speaking.prompt}</p>
          <p className="retro-invite-hint">Only if you want to. Nobody thinks you wrote anything in particular.</p>
          <Button size="sm" disabled={paused} onClick={async () => { await post(`/api/sprints/${sprintId}/meeting/pass`); st.reload() }}>Pass for now</Button>
        </div>
      ) : null}

      {mine.map((e) => (
        <div key={e.id} className="retro-invite">
          <p className="retro-note-label">Will you own this?</p>
          <p className="retro-invite-line">{e.change_to_try}</p>
          <p className="retro-invite-hint">{e.success_signal ? `We’ll know by: ${e.success_signal}. ` : ''}Review {e.review_on}.</p>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={paused} onClick={async () => { await post(`/api/sprints/${sprintId}/experiments/${e.id}/accept`, { accept: true }); st.loadExperiments() }}>I’ll own this</Button>
            <Button size="sm" variant="ghost" disabled={paused} onClick={async () => { await post(`/api/sprints/${sprintId}/experiments/${e.id}/accept`, { accept: false }); st.loadExperiments() }}>Not me</Button>
          </div>
        </div>
      ))}

      {stage.phase === 'look_back' ? (
        <section>
          <h1 className="retro-title retro-title--phone">{previous.length ? <>Last time, we said we’d <em>try</em>…</> : <>Your first retro <em>here</em>.</>}</h1>
          {previous.length ? <ol className="retro-exps">{previous.map((e) => <PastExperiment key={e.id} e={e} />)}</ol> : <p className="retro-quiet">What you agree to try today comes back here next time.</p>}
          {worthKeeping([...themes.flatMap((t) => t.entries), ...ungrouped]).length ? (
            <>
              <h2 className="retro-col-title mt-8">Worth keeping</h2>
              <ul className="retro-thoughts">{worthKeeping([...themes.flatMap((t) => t.entries), ...ungrouped]).map((e) => <Thought key={e.id} e={e} compact />)}</ul>
            </>
          ) : null}
        </section>
      ) : stage.phase === 'choose' ? (
        <section>
          <h1 className="retro-title retro-title--phone">What matters <em>most</em>?</h1>
          <p className="retro-sub">{round ? <><strong>{round.my_remaining}</strong> of {round.budget} votes left. One per topic, and nobody sees yours.</> : closed ? 'The votes are in. The talk takes the topics in this order.' : 'Voting opens in a moment.'}</p>
          <ol className="retro-topics retro-topics--phone">
            {themes.map((t, i) => {
              const cast = round?.my_votes.includes(t.id)
              const n = !round ? closed?.totals?.[t.id] : undefined
              return (
                <li key={t.id} className="retro-topic">
                  <span className="retro-topic-n">{i + 1}</span>
                  <div className="retro-topic-body">
                    <h3 className="retro-topic-title">{t.title}</h3>
                    {t.question ? <p className="retro-topic-q">{t.question}</p> : null}
                    <details className="retro-peek">
                      <summary>{t.entry_count} {t.entry_count === 1 ? 'thought' : 'thoughts'}</summary>
                      <ul className="retro-thoughts">{t.entries.map((e) => <Thought key={e.id} e={e} compact />)}</ul>
                    </details>
                    {round ? <button className="retro-vote retro-vote--wide" aria-pressed={!!cast} disabled={paused} onClick={() => vote(t, !cast)}>{cast ? 'Your vote · take it back' : 'Vote for this'}</button> : null}
                  </div>
                  {typeof n === 'number' ? <span className="retro-tally-n">{n}</span> : null}
                </li>
              )
            })}
          </ol>
        </section>
      ) : stage.phase === 'talk' ? (
        current || stage.current_theme_id === 'ungrouped' ? (
          <section key={stage.current_theme_id}>
            <TopicClock stage={stage} />
            <h1 className="retro-title retro-title--phone">{current ? current.title : 'Not in a theme'}</h1>
            {current?.question ? <p className="retro-talk-q retro-talk-q--phone">{current.question}</p> : null}
            {current && (stage.notes.takeaway || stage.notes.could_try) ? (
              <div className="retro-phone-notes">
                {stage.notes.takeaway ? <p><i>we’ll remember</i>{stage.notes.takeaway}</p> : null}
                {stage.notes.could_try ? <p><i>we could try</i>{stage.notes.could_try}</p> : null}
              </div>
            ) : null}
            <ul className="retro-thoughts">{(current ? current.entries : ungrouped).map((e) => <Thought key={e.id} e={e} compact />)}</ul>
            {current?.context.length ? (
              <>
                <h2 className="retro-col-title mt-6">Added during the retro</h2>
                <ul className="retro-added-list">{current.context.map((c) => <li key={c.id}>{c.body}</li>)}</ul>
              </>
            ) : null}
            {current ? (
              <div className="retro-add">
                <p className="retro-note-label">Add something, without your name</p>
                <Textarea rows={3} value={context} onChange={(e) => setContext(e.target.value)} placeholder="Something the room should know…" maxLength={2000} aria-label="Add something, without your name" />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-xs text-ink-faint">{waiting ? `${waiting} waiting to be shown` : 'Shown with others’, never with your name.'}</span>
                  <Button size="sm" variant="primary" disabled={!context.trim() || paused} onClick={() => sendContext(current.id)}>Send</Button>
                </div>
              </div>
            ) : null}
          </section>
        ) : (
          <p className="retro-quiet">The facilitator is choosing where to start.</p>
        )
      ) : (
        <section>
          <h1 className="retro-title retro-title--phone">What will we <em>try</em>?</h1>
          {experiments.length ? (
            <ol className="retro-exps">
              {experiments.map((e) => (
                <li key={e.id} className="retro-exp">
                  <p className="retro-exp-change">{e.change_to_try}</p>
                  <p className="retro-exp-meta"><span>{e.owner_name ? `${e.owner_name}${e.owner_accepted ? '' : ' (to say yes)'}` : 'No owner yet'}</span><span>review {e.review_on}</span></p>
                </li>
              ))}
            </ol>
          ) : <p className="retro-quiet">Nothing agreed yet.</p>}
        </section>
      )}

      <footer className="retro-phone-foot">
        <label className="retro-ready">
          <input type="checkbox" checked={me?.ready ?? true} disabled={paused} onChange={async () => { await post(`/api/sprints/${sprintId}/meeting/attendance`, { ready: !(me?.ready ?? true) }); st.reload() }} />
          <span>{me?.ready === false ? 'Passing for now: you won’t be invited to speak' : 'You may be invited to speak'}</span>
        </label>
        <Link to={`/sprints/${sprintId}`} className="retro-link">The sprint’s page</Link>
      </footer>
    </Shell>
  )
}

function TopicClock({ stage }: { stage: NonNullable<ReturnType<typeof useStage>['stage']> }) {
  const remaining = useCountdown(stage.timer.ends_at ?? null, stage.timer.remaining_secs, stage.server_time)
  if (!stage.timer.total_secs) return null
  return <p className="retro-kicker retro-kicker--phone">{fmtClock(remaining)} {stage.timer.running ? 'left for this topic' : 'paused'}</p>
}

function Shell({ children, title, sub }: { children: React.ReactNode; title?: string; sub?: React.ReactNode }) {
  return (
    <div className="retro retro-phone min-h-dvh bg-paper">
      <header className="sticky top-0 z-20 border-b border-line/70 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3">
          <Link to="/" aria-label="Home" className="text-ink"><Mark size={24} /></Link>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{title ?? 'Muni'}</div>
            {sub ? <div className="truncate text-xs text-ink-soft">{sub}</div> : null}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 pb-16 pt-5">{children}</main>
    </div>
  )
}
