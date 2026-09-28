import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { post } from '@/api/client'
import type { CheckinView, ThemeView } from '@/api/types'
import { PHASE_HINT, PHASE_LABEL } from '@/lib/categories'
import { readRetroDraft } from '@/lib/retro-drafts'
import { useStage } from '@/lib/stage'
import { Button, Spinner, fmtClock, useCountdown, useDocumentTitle, useToast } from '@/ui'
import { ReconnectingBar } from '@/ui/status'
import { PastExperiment, Thought, worthKeeping } from '@/ui/retro'
import { AddToDiscussion, CheckinAsk, CheckinResult, LeftoverLine, kindWord } from '@/ui/checkin'
import { ApiError } from '@/api/client'
import { Mark } from '@/brand/Mark'

/**
 * Each person's own retro, on a phone or in a browser while the call goes on. It follows the shared
 * screen and holds the private things: your votes, your answers to a check-in, what you add without
 * your name, and saying yes to an experiment. There's usually one obvious thing to do, and never a
 * screen to wait on: look away, come back, and it's where the room is.
 */
export function Companion() {
  const { sprintId = '' } = useParams()
  const nav = useNavigate()
  const toast = useToast()
  const st = useStage(sprintId)
  const { sprint, stage, grouping, votes, experiments, previous, checkins } = st
  const [seed, setSeed] = useState<{ text: string; n: number } | null>(null)
  useDocumentTitle(sprint ? `${sprint.name} · retro` : 'Retro')
  const me = stage?.attendance.find((a) => a.is_you)
  const accountId = me?.account_id ?? null
  const paused = st.live === 'reconnecting'
  // Opening the retro is being there.
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
  const topicId = stage.current_theme_id
  const current = themes.find((t) => t.id === topicId) ?? null
  const titleOf = (id: string) => (id === 'ungrouped' ? 'Not in a theme' : themes.find((t) => t.id === id)?.title ?? 'an earlier topic')
  const mine = experiments.filter((e) => e.owner_account_id === accountId && !e.owner_accepted && e.status === 'proposed')
  const byKind = (a: CheckinView, b: CheckinView) => Number(a.kind === 'action') - Number(b.kind === 'action')
  // What to answer now: the topic's open check-ins (in Agree, any idea being checked), and any other
  // still-open one you'd started writing a line for — the room moving on doesn't take it from you.
  const asks = checkins
    .filter((c) => c.status === 'open' && ((stage.phase === 'talk' && c.theme_id === topicId) || (stage.phase === 'agree' && c.kind === 'action') || !!readRetroDraft(`note:${c.id}`, accountId).trim()))
    .sort(byKind)
  const shared = stage.phase === 'talk' ? checkins.filter((c) => c.status === 'shared' && c.theme_id === topicId && c.results?.responded).sort(byKind) : []
  const onSaved = (c: CheckinView) => st.putCheckin(c)
  const addHere = stage.phase === 'talk' && !!current

  return (
    <Shell title={sprint.name} sub={<><span className="text-accent-ink">{step} · {PHASE_LABEL[stage.phase]}</span> — {PHASE_HINT[stage.phase]}</>}>
      <ReconnectingBar status={st.live} />

      {mine.map((e) => (
        <div key={e.id} className="retro-invite">
          <p className="retro-note-label">Will you own this?</p>
          <p className="retro-invite-line">{e.change_to_try}</p>
          <p className="retro-invite-hint">{e.success_signal ? `We’ll know by: ${e.success_signal}. ` : ''}Review {e.review_on}.</p>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={paused} onClick={async () => { try { await post(`/api/sprints/${sprintId}/experiments/${e.id}/accept`, { accept: true }); st.loadExperiments() } catch (err) { toast(err instanceof ApiError ? err.message : 'Couldn’t save', 'danger') } }}>I’ll own this</Button>
            <Button size="sm" variant="ghost" disabled={paused} onClick={async () => { try { await post(`/api/sprints/${sprintId}/experiments/${e.id}/accept`, { accept: false }); st.loadExperiments() } catch (err) { toast(err instanceof ApiError ? err.message : 'Couldn’t save', 'danger') } }}>Not me</Button>
          </div>
        </div>
      ))}

      {checkins.filter((c) => c.status === 'shared').map((c) => (
        <LeftoverLine key={c.id} checkinId={c.id} accountId={accountId} onMove={(text) => setSeed({ text, n: Date.now() })} />
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
        <Choosing themes={themes} round={round} closed={closed} paused={paused} onVote={async (t, cast) => { try { await post(`/api/sprints/${sprintId}/votes`, { theme_id: t.id, cast }); st.loadVotes() } catch (e) { toast(e instanceof ApiError ? e.message : 'Couldn’t vote', 'danger') } }} />
      ) : stage.phase === 'talk' ? (
        current || topicId === 'ungrouped' ? (
          <section key={topicId}>
            <TopicClock stage={stage} />
            <h1 className="retro-title retro-title--phone">{current ? current.title : 'Not in a theme'}</h1>
            {current?.question ? <p className="retro-talk-q retro-talk-q--phone">{current.question}</p> : null}
            {asks.map((c) => <CheckinAsk key={c.id} c={c} sprintId={sprintId} accountId={accountId} paused={paused} onSaved={onSaved} heading={c.theme_id !== topicId ? `Still open, for “${titleOf(c.theme_id)}”` : undefined} />)}
            {shared.map((c) => (
              <div key={c.id} className="ci-moment ci-moment--phone">
                <p className="retro-note-label">{c.kind === 'topic' ? 'How it showed up' : 'Would trying it help?'}</p>
                {c.kind === 'action' && c.could_try ? <p className="ci-subject">“{c.could_try}”</p> : null}
                <CheckinResult c={c} you />
              </div>
            ))}
            {addHere ? <AddToDiscussion sprintId={sprintId} accountId={accountId} topic={current.id} titleOf={titleOf} mine={stage.my_context} paused={paused} onSent={() => st.reload()} seed={seed} /> : null}
            {current && (stage.notes.takeaway || stage.notes.could_try) ? (
              <div className="retro-phone-notes">
                {stage.notes.takeaway ? <p><i>we’ll remember</i>{stage.notes.takeaway}</p> : null}
                {stage.notes.could_try ? <p><i>we could try</i>{stage.notes.could_try}</p> : null}
              </div>
            ) : null}
            <h2 className="retro-col-title mt-7">The thoughts <span>{(current ? current.entries : ungrouped).length}</span></h2>
            <ul className="retro-thoughts">{(current ? current.entries : ungrouped).map((e) => <Thought key={e.id} e={e} compact />)}</ul>
            {current?.context.length ? (
              <>
                <h2 className="retro-col-title mt-6">Added during the retro <span>without names</span></h2>
                <ul className="retro-thoughts">
                  {current.context.map((c) => (
                    <li key={c.id} className="retro-thought retro-thought--added" data-compact>
                      <span className="retro-cat">{kindWord(c.kind)}</span>
                      <div className="retro-words"><p className="retro-text">{c.body}</p></div>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        ) : (
          <p className="retro-quiet">The facilitator is choosing where to start.</p>
        )
      ) : (
        <section>
          <h1 className="retro-title retro-title--phone">What will we <em>try</em>?</h1>
          {asks.map((c) => <CheckinAsk key={c.id} c={c} sprintId={sprintId} accountId={accountId} paused={paused} onSaved={onSaved} heading={`From “${titleOf(c.theme_id)}”`} />)}
          {experiments.length ? (
            <ol className="retro-exps">
              {experiments.map((e) => (
                <li key={e.id} className="retro-exp">
                  <p className="retro-exp-change">{e.change_to_try}</p>
                  <p className="retro-exp-meta"><span>{e.owner_name ? `${e.owner_name}${e.owner_accepted ? '' : ' (to say yes)'}` : 'No owner yet'}</span><span>review {e.review_on}</span></p>
                </li>
              ))}
            </ol>
          ) : !asks.length ? <p className="retro-quiet">Nothing agreed yet.</p> : null}
        </section>
      )}

      <footer className="retro-phone-foot">
        <span>Your answers and additions never carry your name.</span>
        <Link to={`/sprints/${sprintId}`} className="retro-link">The sprint’s page</Link>
      </footer>
    </Shell>
  )
}

function Choosing({ themes, round, closed, paused, onVote }: { themes: ThemeView[]; round: { budget: number; my_remaining: number; my_votes: string[] } | null; closed: { totals: Record<string, number> | null } | null; paused: boolean; onVote: (t: ThemeView, cast: boolean) => void }) {
  return (
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
                {round ? <button className="retro-vote retro-vote--wide" aria-pressed={!!cast} disabled={paused} onClick={() => onVote(t, !cast)}>{cast ? 'Your vote · take it back' : 'Vote for this'}</button> : null}
              </div>
              {typeof n === 'number' ? <span className="retro-tally-n">{n}</span> : null}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function TopicClock({ stage }: { stage: NonNullable<ReturnType<typeof useStage>['stage']> }) {
  const remaining = useCountdown(stage.timer.ends_at ?? null, stage.timer.remaining_secs, stage.server_time)
  const pos = stage.current_theme_id ? stage.agenda.findIndex((a) => a.theme_id === stage.current_theme_id) : -1
  return (
    <p className="retro-kicker retro-kicker--phone">
      {pos >= 0 ? <span>Topic {pos + 1}</span> : null}
      {stage.timer.total_secs ? `${fmtClock(remaining)} ${stage.timer.running ? 'left' : 'paused'}` : null}
    </p>
  )
}

function Shell({ children, title, sub }: { children: React.ReactNode; title?: string; sub?: React.ReactNode }) {
  return (
    <div className="retro retro-phone min-h-dvh bg-paper">
      <header className="sticky top-0 z-20 border-b border-line/70 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
          <Link to="/" aria-label="Home" className="text-ink"><Mark size={24} /></Link>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{title ?? 'Muni'}</div>
            {sub ? <div className="truncate text-xs text-ink-soft">{sub}</div> : null}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 pb-16 pt-5">{children}</main>
    </div>
  )
}
