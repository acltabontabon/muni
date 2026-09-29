/**
 * Check-ins: a quick, private response during the live retro, shared only when the facilitator
 * chooses. Optional at every step — nothing waits for them, and no answer is not an answer.
 *
 *  - A topic check-in asks how the topic showed up for you; an action check-in asks whether an
 *    idea to try would help. At most one of each per topic, so revisiting finds them again.
 *  - Until shared, an answer is visible only to its author. The facilitator learns a count of
 *    answers so far, never whose. Nobody else learns that anyone answered: the live hint for an
 *    answer goes only to the facilitator's sockets and the author's own other tabs.
 *  - Shared results are counts per choice and the lines people added, in an order drawn at
 *    sharing, with the choice each line came with. No account, time or order of answering.
 *  - An answer is tied to its check-in, not to whatever is on screen: a phone a step behind can't
 *    answer the wrong topic, and an answer that arrives after sharing is refused, with its text
 *    left on the author's screen.
 */
import { Hono } from 'hono'
import type { HonoEnv } from '../env'
import { config } from '../lib/config'
import { requireFacilitator, requireParticipant, requireSprint, type SprintCtx } from '../lib/auth'
import { uuid } from '../lib/crypto'
import { audit, batch, count, one, run } from '../lib/db'
import { AppError, bad, conflict, notFound } from '../lib/errors'
import { hint } from '../lib/live'
import { content, isEncrypted } from '../lib/sealed'
import { jsonBody } from '../lib/util'

export const checkins = new Hono<HonoEnv>()

/** What each kind asks, as stable ids; the words live in the app. */
export const CHOICES = { topic: ['felt', 'not_mine', 'context'], action: ['worth', 'concern', 'unsure'] } as const
type Kind = keyof typeof CHOICES
const NOTE_MAX = 280

interface Row {
  id: string
  theme_id: string
  kind: Kind
  subject: string | null
  status: 'open' | 'shared'
  opened_at: number
  shared_at: number | null
}
const COLS = 'id, theme_id, kind, subject, status, opened_at, shared_at'

/**
 * The sprint's check-ins as the caller may see them (or just `only`), from a handful of set-based
 * reads in one round trip, however many check-ins there are: the check-ins, the caller's own
 * answers, counts per choice and the lines of the shared ones, and — for the facilitator — how many
 * have answered the open ones.
 */
async function views(db: D1Database, ctx: SprintCtx, only?: string) {
  const which = `c.sprint_id = ?${only ? ' AND c.id = ?' : ''}`
  const args = only ? [ctx.sprint.id, only] : [ctx.sprint.id]
  const responses = `FROM checkin_responses r JOIN checkins c ON c.id = r.checkin_id WHERE ${which}`
  const [rows, mine, counts, notes, answers] = await db.batch([
    db.prepare(`SELECT c.id, c.theme_id, c.kind, c.subject, c.status, c.opened_at, c.shared_at FROM checkins c WHERE ${which} ORDER BY c.opened_at`).bind(...args),
    db.prepare(`SELECT r.checkin_id, r.choice, r.note ${responses} AND r.account_id = ?`).bind(...args, ctx.auth.account.id),
    db.prepare(`SELECT r.checkin_id, r.choice, count(*) AS n ${responses} AND c.status = 'shared' GROUP BY r.checkin_id, r.choice`).bind(...args),
    db.prepare(`SELECT r.checkin_id, r.choice, r.note ${responses} AND c.status = 'shared' AND r.note IS NOT NULL AND r.note <> '' ORDER BY r.checkin_id, r.reveal_order, r.rowid`).bind(...args),
    // Only the facilitator, only while open: how many have answered so far. Never who.
    db.prepare(`SELECT r.checkin_id, count(*) AS n ${responses} AND c.status = 'open' AND ? GROUP BY r.checkin_id`).bind(...args, ctx.isFacilitator ? 1 : 0),
  ])
  type Response = { checkin_id: string; choice: string; note: string | null; n?: number }
  const of = (res: D1Result) => {
    const m = new Map<string, Response[]>()
    for (const x of res.results as Response[]) {
      const list = m.get(x.checkin_id)
      if (list) list.push(x)
      else m.set(x.checkin_id, [x])
    }
    return m
  }
  const [mineOf, countsOf, notesOf, answersOf] = [of(mine), of(counts), of(notes), of(answers)]
  return (rows.results as Row[]).map((r) => {
    const own = mineOf.get(r.id)?.[0]
    let results: { responded: number; counts: Record<string, number>; notes: { choice: string; note: string }[] } | null = null
    if (r.status === 'shared') {
      const tally = countsOf.get(r.id) ?? []
      results = {
        responded: tally.reduce((sum, x) => sum + Number(x.n), 0),
        counts: Object.fromEntries(tally.map((x) => [x.choice, Number(x.n)])),
        notes: (notesOf.get(r.id) ?? []).map((x) => ({ choice: x.choice, note: x.note! })),
      }
    }
    return {
      id: r.id,
      sprint_id: ctx.sprint.id,
      theme_id: r.theme_id,
      kind: r.kind,
      // The idea's wording as it was asked about (an envelope in encrypted sprints).
      could_try: r.kind === 'action' ? r.subject : null,
      status: r.status,
      opened_at: new Date(r.opened_at).toISOString(),
      shared_at: r.shared_at ? new Date(r.shared_at).toISOString() : null,
      mine: own ? { choice: own.choice, note: own.note } : null,
      answers: ctx.isFacilitator && r.status === 'open' ? Number(answersOf.get(r.id)?.[0]?.n ?? 0) : null,
      results,
    }
  })
}

export const checkinList = (db: D1Database, ctx: SprintCtx) => views(db, ctx)
const view = async (db: D1Database, ctx: SprintCtx, r: Pick<Row, 'id'>) => (await views(db, ctx, r.id))[0]

async function find(db: D1Database, ctx: SprintCtx, id: string): Promise<Row> {
  const r = await one<Row>(db, `SELECT ${COLS} FROM checkins WHERE id = ? AND sprint_id = ?`, id, ctx.sprint.id)
  if (!r) throw notFound('check-in not found')
  return r
}

const live = (ctx: SprintCtx, what: string) => {
  if (ctx.sprint.status !== 'live') throw conflict(`${what} while the retro is live`)
}

checkins.get('/api/sprints/:sprintId/checkins', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireParticipant(ctx)
  return c.json(await checkinList(c.env.DB, ctx))
})

/** Open a check-in on a topic, or on its idea to try. Opening again finds the same one (and its answers). */
checkins.post('/api/sprints/:sprintId/checkins', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireFacilitator(ctx)
  live(ctx, 'check-ins open')
  const body = await jsonBody<{ theme_id?: string; kind?: string; renew?: boolean }>(c)
  const db = c.env.DB
  const kind = body.kind === 'action' ? 'action' : body.kind === 'topic' ? 'topic' : null
  if (!kind) throw bad('kind must be topic or action')
  const themeId = String(body.theme_id ?? '')
  if (!(await count(db, 'SELECT count(*) AS n FROM themes WHERE id = ? AND sprint_id = ?', themeId, ctx.sprint.id))) throw notFound('theme not found')
  let subject: string | null = null
  if (kind === 'action') {
    subject = (await one<{ could_try: string }>(db, 'SELECT could_try FROM discussion_notes WHERE theme_id = ?', themeId))?.could_try || null
    if (!subject) throw conflict('write the idea to try first, then check it')
  }
  const existing = await one<Row>(db, `SELECT ${COLS} FROM checkins WHERE theme_id = ? AND kind = ?`, themeId, kind)
  if (existing && body.renew === true && kind === 'action') {
    // The idea was reworded: ask about the new wording. Earlier answers were about other words, so they go.
    await batch(db, [
      ['DELETE FROM checkin_responses WHERE checkin_id = ?', existing.id],
      ["UPDATE checkins SET subject = ?, status = 'open', opened_at = ?, shared_at = NULL WHERE id = ?", subject, Date.now(), existing.id],
    ])
    await audit(db, ctx.sprint.workspace_id, ctx.sprint.id, ctx.auth.account.id, 'checkin.opened', { kind, renewed: true })
  } else if (!existing) {
    await run(db, 'INSERT OR IGNORE INTO checkins (id, sprint_id, theme_id, kind, subject, opened_by, opened_at) VALUES (?,?,?,?,?,?,?)', uuid(), ctx.sprint.id, themeId, kind, subject, ctx.auth.account.id, Date.now())
    await audit(db, ctx.sprint.workspace_id, ctx.sprint.id, ctx.auth.account.id, 'checkin.opened', { kind })
  }
  await hint(c.env, ctx.sprint.id, 'checkins')
  return c.json(await view(db, ctx, (await one<Row>(db, 'SELECT id FROM checkins WHERE theme_id = ? AND kind = ?', themeId, kind))!))
})

/** Your answer: a choice, and optionally a line. Change it freely until it's shared. */
checkins.put('/api/sprints/:sprintId/checkins/:checkinId/response', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireParticipant(ctx)
  live(ctx, 'answers are taken')
  const db = c.env.DB
  const r = await find(db, ctx, c.req.param('checkinId'))
  if (r.status !== 'open') throw new AppError(409, 'checkin_shared', 'These answers were just shared, so yours wasn’t added. Anything you wrote is still here.')
  const body = await jsonBody<{ choice?: string; note?: string }>(c)
  const me = ctx.auth.account.id
  const prior = await one<{ choice: string; note: string | null }>(db, 'SELECT choice, note FROM checkin_responses WHERE checkin_id = ? AND account_id = ?', r.id, me)
  const choice = body.choice === undefined ? prior?.choice : String(body.choice)
  if (!choice || !(CHOICES[r.kind] as readonly string[]).includes(choice)) throw bad('pick one of the answers')
  const note = body.note === undefined ? (prior?.note ?? null) : content(isEncrypted(ctx.sprint), body.note, NOTE_MAX, 'Your line', false)
  // The status check travels with the write, so an answer can't land after sharing.
  const res = await run(
    db,
    `INSERT INTO checkin_responses (checkin_id, account_id, choice, note, updated_at) SELECT ?, ?, ?, ?, ? WHERE (SELECT status FROM checkins WHERE id = ?) = 'open'
     ON CONFLICT(checkin_id, account_id) DO UPDATE SET choice = excluded.choice, note = excluded.note, updated_at = excluded.updated_at`,
    r.id, me, choice, note, Date.now(), r.id,
  )
  if (!res.meta.changes) throw new AppError(409, 'checkin_shared', 'These answers were just shared, so yours wasn’t added. Anything you wrote is still here.')
  // Only the facilitator (a count) and your own other tabs hear about it.
  await hint(c.env, ctx.sprint.id, 'checkins', { facilitators: true, accounts: [me] })
  return c.json(await view(db, ctx, r))
})

checkins.delete('/api/sprints/:sprintId/checkins/:checkinId/response', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireParticipant(ctx)
  live(ctx, 'answers are taken')
  const db = c.env.DB
  const r = await find(db, ctx, c.req.param('checkinId'))
  if (r.status !== 'open') throw new AppError(409, 'checkin_shared', 'These answers were already shared.')
  await run(db, 'DELETE FROM checkin_responses WHERE checkin_id = ? AND account_id = ?', r.id, ctx.auth.account.id)
  await hint(c.env, ctx.sprint.id, 'checkins', { facilitators: true, accounts: [ctx.auth.account.id] })
  return c.json(await view(db, ctx, r))
})

/** Share the answers there are. Closes the check-in; with none, it simply closes. */
checkins.post('/api/sprints/:sprintId/checkins/:checkinId/share', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireFacilitator(ctx)
  live(ctx, 'answers are shared')
  const db = c.env.DB
  const r = await find(db, ctx, c.req.param('checkinId'))
  if (r.status === 'open') {
    await batch(db, [
      ["UPDATE checkins SET status = 'shared', shared_at = ? WHERE id = ? AND status = 'open'", Date.now(), r.id],
      ['UPDATE checkin_responses SET reveal_order = abs(random()) % 2147483647 WHERE checkin_id = ?', r.id],
    ])
    await audit(db, ctx.sprint.workspace_id, ctx.sprint.id, ctx.auth.account.id, 'checkin.shared', { kind: r.kind })
    await hint(c.env, ctx.sprint.id, 'checkins')
  }
  return c.json(await view(db, ctx, r))
})
