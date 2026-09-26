/**
 * Private capture and the sealed → revealed boundary.
 * `MyEntry` is what an author sees of their own entry. `SharedEntry` is the
 * only representation that ever leaves the author's account: no author, no
 * timestamp, no alias, by construction of the SELECT list.
 */
import { Hono } from 'hono'
import type { HonoEnv } from '../env'
import { config } from '../lib/config'
import { requireParticipant, requireSprint, type SprintCtx } from '../lib/auth'
import { uuid } from '../lib/crypto'
import { all, count, one, run } from '../lib/db'
import { bad, conflict, notFound } from '../lib/errors'
import { nonempty, optional } from '../lib/util'

export const entries = new Hono<HonoEnv>()
export const CATEGORIES = ['proud', 'keep', 'improve', 'stop', 'try']
export const PERIODS = ['early', 'middle', 'late']

export interface SharedEntry {
  id: string
  category: string | null
  body: string
  impact: string | null
  might_help: string | null
  period: string | null
  theme_id: string | null
}
export const SHARED_SELECT = 'SELECT e.id, e.category, e.body, e.impact, e.might_help, e.period, te.theme_id FROM entries e LEFT JOIN theme_entries te ON te.entry_id = e.id'
const MY_COLS = 'id, category, body, impact, might_help, period, created_at, updated_at'

interface MyRow {
  id: string
  category: string | null
  body: string
  impact: string | null
  might_help: string | null
  period: string | null
  created_at: number
  updated_at: number
}
const myEntry = (r: MyRow, editable: boolean) => ({ ...r, created_at: new Date(r.created_at).toISOString(), updated_at: new Date(r.updated_at).toISOString(), editable })

function validate(maxChars: number, b: Record<string, unknown>) {
  const cat = typeof b.category === 'string' ? b.category.trim() : ''
  if (cat && !CATEGORIES.includes(cat)) throw bad('unknown category')
  const per = typeof b.period === 'string' ? b.period.trim() : ''
  if (per && !PERIODS.includes(per)) throw bad('period must be early, middle or late')
  return { category: cat || null, body: nonempty(b.body, maxChars, 'The observation'), impact: optional(b.impact, maxChars, 'Impact'), might_help: optional(b.might_help, maxChars, 'What might help'), period: per || null }
}

export async function sharedEntries(db: D1Database, sprintId: string): Promise<SharedEntry[]> {
  return all<SharedEntry>(db, `${SHARED_SELECT} WHERE e.sprint_id = ? ORDER BY e.reveal_order, e.id LIMIT 2000`, sprintId)
}
export const sealed = (status: string) => status === 'draft' || status === 'collecting'

/** Save a thought. Only while collection is open; only visible to you until it closes. */
entries.post('/api/sprints/:sprintId/entries', async (c) => {
  const cfg = config(c.env)
  const ctx = await requireSprint(c, cfg, c.env.DB, c.req.param('sprintId'))
  requireParticipant(ctx)
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const v = validate(cfg.entryMaxChars, body)
  const key = typeof body.idempotency_key === 'string' && body.idempotency_key.trim() && body.idempotency_key.length <= 64 ? body.idempotency_key.trim() : null
  const db = c.env.DB
  const me = ctx.auth.account.id
  if (key) {
    const existing = await one<MyRow>(db, `SELECT ${MY_COLS} FROM entries WHERE sprint_id = ? AND author_account_id = ? AND idempotency_key = ?`, ctx.sprint.id, me, key)
    if (existing) return c.json(myEntry(existing, true))
  }
  if ((await count(db, 'SELECT count(*) AS n FROM entries WHERE sprint_id = ? AND author_account_id = ?', ctx.sprint.id, me)) >= 200) throw conflict('you’ve saved 200 entries for this sprint — that’s the limit')
  const id = uuid()
  const now = Date.now()
  // One statement decides: the row is inserted only if the sprint is still collecting. D1 serialises
  // writes, so a close that lands first refuses this, and one that lands later includes it.
  const res = await run(
    db,
    `INSERT INTO entries (id, sprint_id, author_account_id, category, body, impact, might_help, period, idempotency_key, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT status FROM sprints WHERE id = ?) = 'collecting'
     ON CONFLICT(sprint_id, author_account_id, idempotency_key) DO NOTHING`,
    id, ctx.sprint.id, me, v.category, v.body, v.impact, v.might_help, v.period, key, now, now, ctx.sprint.id,
  )
  if (!res.meta.changes) {
    if (key) {
      const existing = await one<MyRow>(db, `SELECT ${MY_COLS} FROM entries WHERE sprint_id = ? AND author_account_id = ? AND idempotency_key = ?`, ctx.sprint.id, me, key)
      if (existing) return c.json(myEntry(existing, true))
    }
    throw conflict('collection for this sprint has closed — this thought wasn’t saved')
  }
  const row = (await one<MyRow>(db, `SELECT ${MY_COLS} FROM entries WHERE id = ?`, id))!
  // Deliberately no hint: per-submission changes are not announced during collection.
  return c.json(myEntry(row, true))
})

entries.get('/api/sprints/:sprintId/entries/mine', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireParticipant(ctx)
  const rows = await all<MyRow>(c.env.DB, `SELECT ${MY_COLS} FROM entries WHERE sprint_id = ? AND author_account_id = ? ORDER BY created_at DESC LIMIT 200`, ctx.sprint.id, ctx.auth.account.id)
  return c.json(rows.map((r) => myEntry(r, ctx.sprint.status === 'collecting')))
})

entries.patch('/api/sprints/:sprintId/entries/:entryId', async (c) => {
  const cfg = config(c.env)
  const ctx = await requireSprint(c, cfg, c.env.DB, c.req.param('sprintId'))
  requireParticipant(ctx)
  const v = validate(cfg.entryMaxChars, (await c.req.json().catch(() => ({}))) as Record<string, unknown>)
  // Ownership and phase are enforced in the WHERE clause: a non-owner gets 404, a closed sprint 409.
  const res = await run(
    c.env.DB,
    `UPDATE entries SET category=?, body=?, impact=?, might_help=?, period=?, updated_at=? WHERE id=? AND sprint_id=? AND author_account_id=? AND (SELECT status FROM sprints WHERE id = ?) = 'collecting'`,
    v.category, v.body, v.impact, v.might_help, v.period, Date.now(), c.req.param('entryId'), ctx.sprint.id, ctx.auth.account.id, ctx.sprint.id,
  )
  if (!res.meta.changes) {
    if (ctx.sprint.status !== 'collecting') throw conflict('collection has closed; originals are read-only now. Add clarification as a new note during the meeting.')
    throw notFound('entry not found')
  }
  const row = (await one<MyRow>(c.env.DB, `SELECT ${MY_COLS} FROM entries WHERE id = ?`, c.req.param('entryId')))!
  return c.json(myEntry(row, true))
})

entries.delete('/api/sprints/:sprintId/entries/:entryId', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireParticipant(ctx)
  const res = await run(c.env.DB, `DELETE FROM entries WHERE id=? AND sprint_id=? AND author_account_id=? AND (SELECT status FROM sprints WHERE id = ?) = 'collecting'`, c.req.param('entryId'), ctx.sprint.id, ctx.auth.account.id, ctx.sprint.id)
  if (!res.meta.changes) {
    if (ctx.sprint.status !== 'collecting') throw conflict('collection has closed; originals are read-only now')
    throw notFound('entry not found')
  }
  return c.json({ ok: true })
})

/** Everyone's entries, revealed as a batch after collection closes. Anonymous; randomised order. This applies to the facilitator too. */
entries.get('/api/sprints/:sprintId/entries', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireParticipant(ctx)
  if (sealed(ctx.sprint.status)) throw conflict('entries stay sealed until collection closes')
  return c.json(await sharedEntries(c.env.DB, ctx.sprint.id))
})

export function requireRevealed(ctx: SprintCtx) {
  if (sealed(ctx.sprint.status)) throw conflict('entries stay sealed until collection closes')
}
