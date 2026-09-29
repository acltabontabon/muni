import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { post } from '@/api/client'
import type { CheckinView, Experiment, ThemeView, VotingState } from '@/api/types'
import { PHASE_HINT, PHASE_LABEL } from '@/lib/categories'
import { readRetroDraft } from '@/lib/retro-drafts'
import { useStage } from '@/lib/stage'
import { shortDate } from '@/lib/schedule'
import { votePurse } from '@/lib/votes'
import { Button, Spinner, fmtClock, useCountdown, useDocumentTitle, useToast } from '@/ui'
import { ReconnectingBar } from '@/ui/status'
import { BehindLine, CouldntLoad, PastExperiment, RetroMap, Thought, TopicHorizon, worthKeeping } from '@/ui/retro'
import { AddToDiscussion, CheckinAsk, CheckinResult, LeftoverLine, kindWord } from '@/ui/checkin'
import { ApiError } from '@/api/client'
import { Mark } from '@/brand/Mark'
import { talkTime } from '@/lib/talk-time'

/**
 * Each person's own retro, on a phone or in a browser while the call goes on. It follows the shared
 * screen and holds the private things: your votes, your answers to a check-in, what you add without
 * your name, and saying yes to an experiment. There's usually one obvious thing to do, and never a
 * screen to wait on: look away, come back, and it's where the room is.
 */
export function Companion() {
  const { sprintId = '' } = useParams()
  // Another sprint's retro is another retro: nothing on screen carries over.
  return <CompanionRoom key={sprintId} sprintId={sprintId} />
}

function CompanionRoom({ sprintId }: { sprintId: string }) {
  const nav = useNavigate()
  const toast = useToast()
  // Opening the retro is being there: useStage says so to the room once it can be reached.
  const st = useStage(sprintId)
  const { sprint, stage, grouping, votes, experiments, previous, checkins } = st
  const [seed, setSeed] = useState<string | null>(null)
  const seedUsed = useCallback(() => setSeed(null), [])
  // An owner's answer is sent once, however quickly it's tapped.
  const [answering, setAnswering] = useState<string | null>(null)
  useDocumentTitle(sprint ? `${sprint.name} · retro` : 'Retro')
  const me = stage?.attendance.find((a) => a.is_you)
  const accountId = me?.account_id ?? null
  const paused = st.live === 'reconnecting'
  const themes = useMemo(() => (grouping?.themes ?? []).filter((t) => !t.parked), [grouping?.themes])
  const ungrouped = useMemo(() => grouping?.ungrouped ?? [], [grouping?.ungrouped])

  if (st.revoked) return <Shell><p className="text-ink-soft">Your access to this sprint ended.</p></Shell>
  if (st.error) return <Shell><CouldntLoad message={st.error} onRetry={st.reload} /></Shell>
  if (!sprint || !st.ready) return <Shell><Spinner /></Shell>
  const done = ['completed', 'archived'].includes(sprint.status) || (!!stage?.ended_at && !stage.cancelled)
  const running = !!stage && !stage.ended_at && !stage.cancelled && sprint.status === 'live'
  // Paused from the sprint's page: nothing here can be sent until it starts again.
  if (stage && !done && !running)
    return (
      <Shell title={sprint.name}>
        <h1 className="retro-title retro-title--phone">The retro is <em>paused</em>.</h1>
        <p className="mt-2 text-ink-soft">{stage.is_facilitator ? 'Start it again from the sprint’s page when the team is ready. What the room noted and agreed so far is kept.' : 'It carries on here when the facilitator starts it again. What the room noted so far is kept, and so is anything you were writing.'}</p>
        <div className="mt-5"><Button variant={stage.is_facilitator ? 'primary' : 'ghost'} onClick={() => nav(`/sprints/${sprintId}`)}>Back to the sprint</Button></div>
      </Shell>
    )
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
  // The talk's order, as the stage has it: the agenda (the vote's order), then anything not in a theme.
  const listed = stage.agenda.map((a) => a.theme_id).filter((id) => themes.some((t) => t.id === id))
  const talkOrder = [...(listed.length ? listed : themes.map((t) => t.id)), ...(ungrouped.length ? ['ungrouped'] : [])]
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
  // What these answer with (the sprint's experiments, your votes) is shown as it is, not read again.
  const answer = async (e: Experiment, accept: boolean) => {
    if (answering) return
    setAnswering(e.id)
    try {
      st.putExperiments(await post<Experiment[]>(`/api/sprints/${sprintId}/experiments/${e.id}/accept`, { accept }))
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Couldn’t save', 'danger')
    } finally {
      setAnswering(null)
    }
  }
  const vote = async (t: ThemeView, cast: boolean) => {
    try {
      st.putVotes(await post<VotingState>(`/api/sprints/${sprintId}/votes`, { theme_id: t.id, cast }))
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Couldn’t vote', 'danger')
    }
  }

  return (
    <Shell title={sprint.name} sub={<><span className="text-accent-ink">{step} · {PHASE_LABEL[stage.phase]}</span> — {PHASE_HINT[stage.phase]}</>}>
      <ReconnectingBar status={st.live} />
      {st.stale && !paused ? <BehindLine onRetry={st.reload} /> : null}

      {mine.map((e) => (
        <div key={e.id} className="retro-invite">
          <p className="retro-note-label">Will you own this?</p>
          <p className="retro-invite-line">{e.change_to_try}</p>
          <p className="retro-invite-hint">{e.success_signal ? `We’ll know it helped if: ${e.success_signal.replace(/[.\s]+$/, '')}. ` : ''}The team looks at it again on {shortDate(e.review_on)}. Saying yes means you keep it moving — not that you do it all yourself.</p>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={paused || !!answering} busy={answering === e.id} onClick={() => answer(e, true)}>I’ll own this</Button>
            <Button size="sm" variant="ghost" disabled={paused || !!answering} onClick={() => answer(e, false)}>Not me</Button>
          </div>
        </div>
      ))}

      {checkins.filter((c) => c.status === 'shared').map((c) => (
        <LeftoverLine key={c.id} checkinId={c.id} accountId={accountId} saved={c.mine?.note} onMove={addHere ? setSeed : undefined} />
      ))}

      {stage.phase === 'look_back' ? (
        <section>
          <h1 className="retro-title retro-title--phone">{previous.length ? <>Last time, we said we’d <em>try</em>…</> : <>Your first retro <em>here</em>.</>}</h1>
          <RetroMap phases={stage.phases} plan={stage.plan} now={stage.phase} />
          {previous.length ? <ol className="retro-exps">{previous.map((e) => <PastExperiment key={e.id} e={e} />)}</ol> : <p className="retro-quiet">What you agree to try today comes back here next time.</p>}
          {worthKeeping([...themes.flatMap((t) => t.entries), ...ungrouped]).length ? (
            <>
              <h2 className="retro-col-title mt-8">Worth keeping</h2>
              <ul className="retro-thoughts">{worthKeeping([...themes.flatMap((t) => t.entries), ...ungrouped]).map((e) => <Thought key={e.id} e={e} compact />)}</ul>
            </>
          ) : null}
        </section>
      ) : stage.phase === 'choose' ? (
        <Choosing themes={themes} round={round} closed={closed} paused={paused} plan={stage.plan} onVote={vote} />
      ) : stage.phase === 'talk' ? (
        current || topicId === 'ungrouped' ? (
          <section key={topicId}>
            <TopicHorizon topics={talkOrder} current={topicId} discussed={stage.discussed_theme_ids} titleOf={titleOf} compact />
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
            {addHere ? <AddToDiscussion sprintId={sprintId} accountId={accountId} topic={current.id} titleOf={titleOf} mine={stage.my_context} paused={paused} onSent={st.putStage} seed={seed} onSeedUsed={seedUsed} /> : null}
            {current && (stage.notes.takeaway || stage.notes.could_try) ? (
              <>
                <h2 className="retro-col-title mt-6">The room’s notes</h2>
                <div className="retro-phone-notes">
                  {stage.notes.takeaway ? <p><i>we’ll remember</i>{stage.notes.takeaway}</p> : null}
                  {stage.notes.could_try ? <p><i>we could try</i>{stage.notes.could_try}</p> : null}
                </div>
              </>
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
                      <div className="retro-words">
                        <p className="retro-text">{c.body}</p>
                        {stage.my_context.some((m) => m.id === c.id) ? <span className="retro-yours">yours · only you see this</span> : null}
                      </div>
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
          <p className="retro-sub">The team is agreeing on one to three changes for the next sprint. If you’re asked to own one, it appears here for you to say yes.</p>
          {asks.map((c) => <CheckinAsk key={c.id} c={c} sprintId={sprintId} accountId={accountId} paused={paused} onSaved={onSaved} heading={`From “${titleOf(c.theme_id)}”`} />)}
          {experiments.length ? (
            <ol className="retro-exps">
              {experiments.map((e) => (
                <li key={e.id} className="retro-exp">
                  <p className="retro-exp-change">{e.change_to_try}</p>
                  <p className="retro-exp-meta"><span>{e.owner_name ? (e.owner_accepted ? `${e.owner_name} owns this` : `Waiting for ${e.owner_name} to say yes`) : 'No owner yet'}</span><span><i>back on</i> {shortDate(e.review_on)}</span></p>
                </li>
              ))}
            </ol>
          ) : !asks.length ? <p className="retro-quiet">Nothing agreed yet — the facilitator writes them up as the team decides.</p> : null}
        </section>
      )}

      <footer className="retro-phone-foot">
        <span>Your answers and additions never carry your name.</span>
        <Link to={`/sprints/${sprintId}`} className="retro-link">The sprint’s page</Link>
      </footer>
    </Shell>
  )
}

function Choosing({ themes, round, closed, paused, plan, onVote }: { themes: ThemeView[]; round: { budget: number; my_remaining: number; my_votes: string[] } | null; closed: { totals: Record<string, number> | null } | null; paused: boolean; plan: Record<string, number>; onVote: (t: ThemeView, cast: boolean) => void }) {
  const { reach, per } = talkTime(plan, themes.length)
  const single = themes.length <= 1
  const totals = !round ? closed?.totals ?? null : null
  const list = totals ? [...themes].sort((a, b) => (totals[b.id] ?? 0) - (totals[a.id] ?? 0)) : themes
  // What you can cast: the budget, but one vote per topic at most (as the server counts it).
  const purse = round ? votePurse(round, themes.map((t) => t.id)) : null
  const spent = !!purse && purse.left <= 0
  return (
    <section>
      <h1 className="retro-title retro-title--phone">What matters <em>most</em>?</h1>
      <p className="retro-sub">
        {single
          ? 'Only one topic this time — nothing to choose. The talk starts with it.'
          : totals
            ? <>The votes are in. The talk starts at the top — time for about {reach}.</>
            : reach >= themes.length
              ? <>There’s time for all {themes.length} topics, around {per} minutes each. Vote for the ones that matter most to you; the most-voted go first.</>
              : <>There’s time to talk about roughly <strong>{reach}</strong> of these {themes.length}, around {per} minutes each. Vote for the ones you most want to talk about; the most-voted go first.</>}
      </p>
      {purse && !single ? (
        <div className="vote-purse" data-spent={spent || undefined}>
          <span className="vote-purse-coins" aria-hidden>{Array.from({ length: purse.size }, (_, i) => <i key={i} data-used={i >= purse.left || undefined} />)}</span>
          <span><strong>{purse.left}</strong> of {purse.size} {purse.size === 1 ? 'vote' : 'votes'} left · one per topic · nobody sees yours</span>
        </div>
      ) : null}
      <ol className="retro-topics retro-topics--phone">
        {list.map((t, i) => {
          const cast = round?.my_votes.includes(t.id)
          const n = totals?.[t.id]
          return (
            <li key={t.id} className="retro-topic" data-voted={cast || undefined} data-beyond={(totals && i >= reach) || undefined}>
              <span className="retro-topic-n">{i + 1}</span>
              <div className="retro-topic-body">
                <h3 className="retro-topic-title">{t.title}</h3>
                {t.question ? <p className="retro-topic-q">{t.question}</p> : null}
                <details className="retro-peek">
                  <summary>{t.entry_count} {t.entry_count === 1 ? 'thought' : 'thoughts'}</summary>
                  <ul className="retro-thoughts">{t.entries.map((e) => <Thought key={e.id} e={e} compact />)}</ul>
                </details>
                {round && !single ? (
                  <button className="retro-vote retro-vote--wide" aria-pressed={!!cast} disabled={paused || (!cast && spent)} onClick={() => onVote(t, !cast)}>
                    {cast ? 'Voted ✓ · tap to take it back' : spent ? 'No votes left — take one back to move it' : 'Vote for this'}
                  </button>
                ) : null}
              </div>
              {typeof n === 'number' ? <span className="retro-tally-n">{n}</span> : null}
            </li>
          )
        })}
      </ol>
      {round && !single ? <p className="retro-aside-line">You can move your votes until the facilitator moves on. Then they’re counted, and the talk begins.</p> : null}
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
