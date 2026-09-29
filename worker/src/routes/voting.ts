/**
 * Private prioritisation. D1 is a single writer, so one INSERT…SELECT that
 * checks the budget in its WHERE clause is atomic: two devices, or two
 * concurrent taps, can never spend more than the budget.
 */
import { Hono } from 'hono'
import { content, isEncrypted } from '../lib/sealed'
import type { HonoEnv } from '../env'
import { config } from '../lib/config'
import { requireFacilitator, requireParticipant, requireSprint, type SprintCtx } from '../lib/auth'
import { uuid } from '../lib/crypto'
import { all, audit, batch, count, one, run } from '../lib/db'
import { bad, conflict, forbidden, notFound } from '../lib/errors'
import { hint } from '../lib/live'
import { jsonBody } from '../lib/util'

export const voting = new Hono<HonoEnv>()

interface RoundRow {
  id: string
  status: string
  budget: number
  cancel_reason: string | null
  opened_at: number
  closed_at: number | null
  grouping_revision: number
}

/** What each round holds for the caller: their own votes, the totals of a closed one, and (the facilitator's, while open) how many have voted. */
function roundView(ctx: SprintCtx, r: RoundRow, mine: string[], totals: Record<string, number> | null, voters: number | null) {
  return {
    id: r.id,
    status: r.status,
    budget: r.budget,
    voters,
    cancel_reason: r.cancel_reason,
    opened_at: new Date(r.opened_at).toISOString(),
    closed_at: r.closed_at ? new Date(r.closed_at).toISOString() : null,
    my_votes: mine,
    my_remaining: r.budget - mine.length,
    totals: r.status === 'closed' ? (totals ?? {}) : null,
    eligible: ctx.isParticipant,
  }
}

/**
 * The sprint's latest rounds as the caller may see them, in one round trip however many there are:
 * the rounds, the caller's own votes in them, the totals of closed ones and — for the facilitator —
 * how many have voted in an open one (never who, or for what).
 */
export async function votingState(db: D1Database, ctx: SprintCtx) {
  const sid = ctx.sprint.id
  const ROUNDS = 'SELECT id, status FROM vote_rounds WHERE sprint_id = ? ORDER BY opened_at DESC LIMIT 20'
  const [roundRows, mineRows, totalRows, voterRows] = await db.batch([
    db.prepare('SELECT id, status, budget, cancel_reason, opened_at, closed_at, grouping_revision FROM vote_rounds WHERE sprint_id = ? ORDER BY opened_at DESC LIMIT 20').bind(sid),
    db.prepare(`SELECT round_id, theme_id FROM votes WHERE account_id = ? AND round_id IN (SELECT id FROM (${ROUNDS}))`).bind(ctx.auth.account.id, sid),
    db.prepare(`SELECT round_id, theme_id, count(*) AS n FROM votes WHERE round_id IN (SELECT id FROM (${ROUNDS}) WHERE status = 'closed') GROUP BY round_id, theme_id`).bind(sid),
    db.prepare(`SELECT round_id, count(DISTINCT account_id) AS n FROM votes WHERE ? AND round_id IN (SELECT id FROM vote_rounds WHERE sprint_id = ? AND status = 'open') GROUP BY round_id`).bind(ctx.isFacilitator ? 1 : 0, sid),
  ])
  const mine = new Map<string, string[]>()
  for (const v of mineRows.results as { round_id: string; theme_id: string }[]) {
    const list = mine.get(v.round_id)
    if (list) list.push(v.theme_id)
    else mine.set(v.round_id, [v.theme_id])
  }
  const totals = new Map<string, Record<string, number>>()
  for (const t of totalRows.results as { round_id: string; theme_id: string; n: number }[]) {
    const tally = totals.get(t.round_id) ?? {}
    tally[t.theme_id] = Number(t.n)
    totals.set(t.round_id, tally)
  }
  const voters = new Map((voterRows.results as { round_id: string; n: number }[]).map((v) => [v.round_id, Number(v.n)]))
  let current = null
  const previous = []
  for (const r of roundRows.results as RoundRow[]) {
    const v = roundView(ctx, r, mine.get(r.id) ?? [], totals.get(r.id) ?? null, r.status === 'open' && ctx.isFacilitator ? (voters.get(r.id) ?? 0) : null)
    if (v.status === 'open' && !current) current = v
    else previous.push(v)
  }
  return { current, previous }
}

/** Opens a round at this grouping revision. The partial unique index (one open round per sprint) makes a concurrent second open a no-op: false. */
export async function openRound(db: D1Database, sprintId: string, budget: number): Promise<boolean> {
  const res = await run(db, 'INSERT OR IGNORE INTO vote_rounds (id, sprint_id, budget, grouping_revision, opened_at) SELECT ?, id, ?, grouping_revision, ? FROM sprints WHERE id = ?', uuid(), budget, Date.now(), sprintId)
  return !!res.meta.changes
}

/** Closes (or cancels) the open round; a close orders the themes by its totals — flagged first, parked last. False when none was open. */
export async function closeRound(db: D1Database, sprintId: string, status: 'closed' | 'cancelled', reason: string | null = null): Promise<boolean> {
  const res = await run(db, "UPDATE vote_rounds SET status = ?, cancel_reason = ?, closed_at = ? WHERE sprint_id = ? AND status = 'open'", status, reason, Date.now(), sprintId)
  if (!res.meta.changes) return false
  if (status === 'closed') {
    const rows = await all<{ id: string }>(
      db,
      `SELECT t.id FROM themes t LEFT JOIN votes v ON v.theme_id = t.id AND v.round_id = (SELECT id FROM vote_rounds WHERE sprint_id = ? AND status='closed' ORDER BY closed_at DESC LIMIT 1)
       WHERE t.sprint_id = ? GROUP BY t.id ORDER BY t.parked, t.needs_attention DESC, count(v.theme_id) DESC, t.position`,
      sprintId,
      sprintId,
    )
    await batch(db, rows.map((r, i): [string, ...unknown[]] => ['UPDATE themes SET position = ?, order_reason = NULL WHERE id = ?', i, r.id]))
  }
  return true
}

voting.get('/api/sprints/:sprintId/votes', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireParticipant(ctx)
  return c.json(await votingState(c.env.DB, ctx))
})

voting.post('/api/sprints/:sprintId/votes/rounds', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireFacilitator(ctx)
  if (!['ready', 'live'].includes(ctx.sprint.status)) throw conflict('voting opens once the themes are ready')
  const body = await jsonBody<{ budget?: number }>(c)
  const budget = Number(body.budget ?? ctx.sprint.vote_budget)
  if (!(budget >= 1 && budget <= 10)) throw bad('votes per person must be between 1 and 10')
  if (!(await count(c.env.DB, 'SELECT count(*) AS n FROM themes WHERE sprint_id = ? AND parked = 0', ctx.sprint.id))) throw conflict('there are no themes to vote on yet')
  if (!(await openRound(c.env.DB, ctx.sprint.id, budget))) throw conflict('a voting round is already open')
  await audit(c.env.DB, ctx.sprint.workspace_id, ctx.sprint.id, ctx.auth.account.id, 'votes.round_opened', { budget })
  await hint(c.env, ctx.sprint.id, 'votes')
  return c.json(await votingState(c.env.DB, ctx))
})

/** Cast or withdraw a vote. At most one per theme; budget enforced in one statement. */
voting.post('/api/sprints/:sprintId/votes', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  if (!ctx.isParticipant) throw forbidden('only sprint participants can vote')
  const body = await jsonBody<{ theme_id?: string; cast?: boolean }>(c)
  const themeId = String(body.theme_id ?? '')
  const db = c.env.DB
  const round = await one<{ id: string; budget: number; grouping_revision: number }>(db, "SELECT id, budget, grouping_revision FROM vote_rounds WHERE sprint_id = ? AND status = 'open'", ctx.sprint.id)
  if (!round) throw conflict('voting isn’t open right now')
  const rev = await one<{ grouping_revision: number }>(db, 'SELECT grouping_revision FROM sprints WHERE id = ?', ctx.sprint.id)
  if (Number(rev?.grouping_revision) !== Number(round.grouping_revision)) throw conflict('the themes changed since this round opened — the facilitator needs to reopen voting')
  if (!(await count(db, 'SELECT count(*) AS n FROM themes WHERE id = ? AND sprint_id = ? AND parked = 0', themeId, ctx.sprint.id))) throw notFound('theme not found')
  const me = ctx.auth.account.id
  if (body.cast) {
    const res = await run(
      db,
      `INSERT OR IGNORE INTO votes (round_id, theme_id, account_id, created_at)
       SELECT ?, ?, ?, ? WHERE (SELECT count(*) FROM votes WHERE round_id = ? AND account_id = ?) < ?
         AND (SELECT status FROM vote_rounds WHERE id = ?) = 'open'`,
      round.id, themeId, me, Date.now(), round.id, me, round.budget, round.id,
    )
    if (!res.meta.changes) {
      const already = await count(db, 'SELECT count(*) AS n FROM votes WHERE round_id = ? AND account_id = ? AND theme_id = ?', round.id, me, themeId)
      if (!already) throw conflict('you’ve used all your votes — take one back to change your mind')
    }
  } else {
    await run(db, 'DELETE FROM votes WHERE round_id = ? AND theme_id = ? AND account_id = ?', round.id, themeId, me)
  }
  // Nobody learns what anyone voted for. The voter's own other tabs (the stage, their phone) follow
  // every change, to show the votes they have left. Beyond that only the facilitator's count of
  // voters moves: when this person goes from no votes to some, or back to none, it reads it again.
  const mine = await count(db, 'SELECT count(*) AS n FROM votes WHERE round_id = ? AND account_id = ?', round.id, me)
  const counted = (body.cast && mine === 1) || (!body.cast && mine === 0)
  await hint(c.env, ctx.sprint.id, 'votes', { facilitators: counted, accounts: [me] })
  return c.json(await votingState(db, ctx))
})

voting.post('/api/sprints/:sprintId/votes/rounds/close', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireFacilitator(ctx)
  const body = await jsonBody<{ action?: string; reason?: string }>(c)
  const status = body.action === 'close' ? 'closed' : body.action === 'cancel' ? 'cancelled' : null
  if (!status) throw bad('action must be close or cancel')
  const db = c.env.DB
  const reason = body.reason ? (isEncrypted(ctx.sprint) ? content(true, body.reason, 200, 'The reason', false) : String(body.reason).slice(0, 200)) : null
  if (!(await closeRound(db, ctx.sprint.id, status, reason ?? null))) throw conflict('no voting round is open')
  await audit(db, ctx.sprint.workspace_id, ctx.sprint.id, ctx.auth.account.id, 'votes.round_closed', { status })
  await hint(c.env, ctx.sprint.id, ['votes', 'themes'])
  return c.json(await votingState(db, ctx))
})
