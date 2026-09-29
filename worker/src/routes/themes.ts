/**
 * Grouping, by the facilitator's hand. Structural changes bump the
 * sprint's grouping revision and must explicitly reset an open vote round.
 */
import { Hono } from 'hono'
import type { HonoEnv } from '../env'
import { config } from '../lib/config'
import { requireFacilitator, requireParticipant, requireSprint, type SprintCtx } from '../lib/auth'
import { uuid } from '../lib/crypto'
import { audit, batch, bool, count, one, run } from '../lib/db'
import { bad, conflict, notFound } from '../lib/errors'
import { hint } from '../lib/live'
import { content, isEncrypted } from '../lib/sealed'
import { idList, jsonBody } from '../lib/util'
import { MAX_THEMES } from '../lib/limits'
import { requireRevealed, SHARED_SELECT, type SharedEntry } from './entries'

export const themes = new Hono<HonoEnv>()

interface ThemeRow {
  id: string
  title: string
  summary: string
  question: string
  draft_experiment: string | null
  position: number
  parked: number
  needs_attention: number
  order_reason: string | null
}

export async function grouping(env: HonoEnv['Bindings'], ctx: SprintCtx) {
  requireRevealed(ctx)
  const db = env.DB
  const sid = ctx.sprint.id
  const LATEST_CLOSED = "SELECT id FROM vote_rounds WHERE sprint_id = ? AND status = 'closed' ORDER BY closed_at DESC LIMIT 1"
  // Everything the view needs, read in one round trip. Every theme and everything shared (the caps
  // are where they're written): a thought in a theme that wasn't read would be in neither the themes
  // nor the ungrouped pool.
  const [themeRows, entryRows, contextRows, noteRows, voteRows, stateRows] = await db.batch([
    db.prepare('SELECT id, title, summary, question, draft_experiment, position, parked, needs_attention, order_reason FROM themes WHERE sprint_id = ? ORDER BY position, created_at').bind(sid),
    db.prepare(`${SHARED_SELECT} WHERE e.sprint_id = ? ORDER BY e.reveal_order, e.id`).bind(sid),
    db.prepare('SELECT id, theme_id, body, kind FROM context_additions WHERE sprint_id = ? AND released_batch IS NOT NULL AND theme_id IS NOT NULL ORDER BY released_batch, reveal_order, id').bind(sid),
    db.prepare('SELECT theme_id, takeaway, could_try, discussed FROM discussion_notes WHERE sprint_id = ?').bind(sid),
    db.prepare(`SELECT theme_id, count(*) AS n FROM votes WHERE round_id = (${LATEST_CLOSED}) GROUP BY theme_id`).bind(sid),
    // The revision as it is now (a change in this same request may have moved it on), and the vote's state.
    db.prepare(`SELECT grouping_revision, EXISTS (SELECT 1 FROM vote_rounds WHERE sprint_id = s.id AND status = 'open') AS voting_open, EXISTS (${LATEST_CLOSED}) AS voted FROM sprints s WHERE s.id = ?`).bind(sid, sid),
  ])
  const rows = themeRows.results as ThemeRow[]
  const allEntries = entryRows.results as SharedEntry[]
  const state = stateRows.results[0] as { grouping_revision: number; voting_open: number; voted: number }
  const byTheme = <T extends { theme_id: string | null }>(items: T[]) => {
    const m = new Map<string, T[]>()
    for (const x of items) if (x.theme_id) m.set(x.theme_id, [...(m.get(x.theme_id) ?? []), x])
    return m
  }
  const entriesOf = byTheme(allEntries)
  const contextOf = byTheme(contextRows.results as { id: string; theme_id: string; body: string; kind: string | null }[])
  const notesOf = new Map((noteRows.results as { theme_id: string; takeaway: string; could_try: string; discussed: number }[]).map((x) => [x.theme_id, x]))
  const votes = bool(state.voted) ? Object.fromEntries((voteRows.results as { theme_id: string; n: number }[]).map((v) => [v.theme_id, Number(v.n)])) : null
  const themesOut = rows.map((t) => {
    const ents = entriesOf.get(t.id) ?? []
    const mix: Record<string, number> = {}
    for (const e of ents) mix[e.category ?? 'unsorted'] = (mix[e.category ?? 'unsorted'] ?? 0) + 1
    const tk = notesOf.get(t.id)
    return {
      id: t.id,
      title: t.title,
      summary: t.summary,
      question: t.question,
      draft_experiment: t.draft_experiment,
      position: t.position,
      parked: bool(t.parked),
      needs_attention: bool(t.needs_attention),
      order_reason: t.order_reason,
      entry_count: ents.length,
      category_mix: mix,
      entries: ents,
      context: (contextOf.get(t.id) ?? []).map((x) => ({ id: x.id, body: x.body, kind: x.kind })),
      votes: votes ? (votes[t.id] ?? 0) : null,
      takeaway: tk?.takeaway ?? '',
      could_try: tk?.could_try ?? '',
      discussed: !!tk && bool(tk.discussed),
    }
  })
  // The status can't change within a request that edits themes, so it's the one the request read.
  return {
    sprint_status: ctx.sprint.status,
    grouping_revision: state.grouping_revision,
    themes: themesOut,
    ungrouped: allEntries.filter((e) => !e.theme_id),
    total_entries: allEntries.length,
    can_edit: ctx.isFacilitator && ['preparing', 'ready', 'live'].includes(ctx.sprint.status),
    voting_open: bool(state.voting_open),
  }
}

function requireEdit(ctx: SprintCtx) {
  requireFacilitator(ctx)
  if (!['preparing', 'ready', 'live'].includes(ctx.sprint.status)) throw conflict('themes can be edited once collection has closed and until the retro is completed')
}

/** A structural change invalidates an open vote round; refuses unless the facilitator gave a reason. Returns statements to include in the batch. */
export async function structuralChange(db: D1Database, ctx: SprintCtx, reason: unknown): Promise<[string, ...unknown[]][]> {
  const open = await one<{ id: string }>(db, "SELECT id FROM vote_rounds WHERE sprint_id = ? AND status = 'open'", ctx.sprint.id)
  const stmts: [string, ...unknown[]][] = []
  if (open) {
    const r = typeof reason === 'string' ? reason.trim() : ''
    if (!r) throw conflict('a voting round is open. Changing themes now cancels it — give a short reason for participants to continue')
    // The reason is written by the facilitator and shown to participants: content, so sealed in encrypted sprints.
    const stored = isEncrypted(ctx.sprint) ? content(true, r, 200, 'The reason', true)! : r.slice(0, 200)
    // Only while it's still open: a round closed in the meantime keeps its result.
    stmts.push(["UPDATE vote_rounds SET status='cancelled', cancel_reason=?, closed_at=? WHERE id=? AND status='open'", stored, Date.now(), open.id])
  }
  stmts.push(['UPDATE sprints SET grouping_revision = grouping_revision + 1, updated_at = ? WHERE id = ?', Date.now(), ctx.sprint.id])
  stmts.push(['INSERT INTO audit_events (workspace_id, sprint_id, actor_id, action, meta, created_at) VALUES (?,?,?,?,?,?)', ctx.sprint.workspace_id, ctx.sprint.id, ctx.auth.account.id, 'grouping.changed', '{}', Date.now()])
  return stmts
}

/** A new theme, made or split off, fits under the cap. */
async function roomForTheme(db: D1Database, sprintId: string) {
  if ((await count(db, 'SELECT count(*) AS n FROM themes WHERE sprint_id = ?', sprintId)) >= MAX_THEMES) throw conflict(`${MAX_THEMES} themes is the limit — merge some first`)
}

const assign = (sprintId: string, themeId: string, entryIds: string[]): [string, ...unknown[]][] =>
  entryIds.map((eid) => ['INSERT INTO theme_entries (entry_id, theme_id) SELECT id, ? FROM entries WHERE id = ? AND sprint_id = ? ON CONFLICT(entry_id) DO UPDATE SET theme_id = excluded.theme_id', themeId, eid, sprintId])

themes.get('/api/sprints/:sprintId/themes', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireParticipant(ctx)
  return c.json(await grouping(c.env, ctx))
})

themes.post('/api/sprints/:sprintId/themes', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireEdit(ctx)
  const body = await jsonBody<Record<string, unknown>>(c)
  const title = content(isEncrypted(ctx.sprint), body.title, 80, 'Theme title', true)!
  const entryIds = idList(body.entry_ids, 'entry_ids')
  await roomForTheme(c.env.DB, ctx.sprint.id)
  const id = uuid()
  const stmts = await structuralChange(c.env.DB, ctx, body.reset_voting_reason)
  stmts.push(['INSERT INTO themes (id, sprint_id, title, summary, question, draft_experiment, position, created_at) VALUES (?,?,?,?,?,?,(SELECT COALESCE(MAX(position),0)+1 FROM themes WHERE sprint_id=?),?)', id, ctx.sprint.id, title, content(isEncrypted(ctx.sprint), body.summary, 500, 'Summary', false) ?? '', content(isEncrypted(ctx.sprint), body.question, 240, 'Question', false) ?? '', content(isEncrypted(ctx.sprint), body.draft_experiment, 300, 'Draft experiment', false), ctx.sprint.id, Date.now()])
  stmts.push(...assign(ctx.sprint.id, id, entryIds))
  await batch(c.env.DB, stmts)
  await hint(c.env, ctx.sprint.id, 'themes')
  return c.json(await grouping(c.env, ctx))
})

themes.patch('/api/sprints/:sprintId/themes/:themeId', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireEdit(ctx)
  const tid = c.req.param('themeId')
  if (!(await count(c.env.DB, 'SELECT count(*) AS n FROM themes WHERE id = ? AND sprint_id = ?', tid, ctx.sprint.id))) throw notFound('theme not found')
  const body = await jsonBody<Record<string, unknown>>(c)
  // Moving thoughts is structural; without `entry_ids` (or with null) they stay where they are.
  const moving = body.entry_ids === undefined || body.entry_ids === null ? null : idList(body.entry_ids, 'entry_ids')
  const stmts: [string, ...unknown[]][] = []
  if (body.title !== undefined) stmts.push(['UPDATE themes SET title = ? WHERE id = ?', content(isEncrypted(ctx.sprint), body.title, 80, 'Theme title', true)!, tid])
  if (body.summary !== undefined) stmts.push(['UPDATE themes SET summary = ? WHERE id = ?', content(isEncrypted(ctx.sprint), body.summary, 500, 'Summary', false) ?? '', tid])
  if (body.question !== undefined) stmts.push(['UPDATE themes SET question = ? WHERE id = ?', content(isEncrypted(ctx.sprint), body.question, 240, 'Question', false) ?? '', tid])
  if (body.draft_experiment !== undefined) stmts.push(['UPDATE themes SET draft_experiment = ? WHERE id = ?', content(isEncrypted(ctx.sprint), body.draft_experiment, 300, 'Draft experiment', false), tid])
  if (body.parked !== undefined) stmts.push(['UPDATE themes SET parked = ? WHERE id = ?', body.parked ? 1 : 0, tid])
  if (body.needs_attention !== undefined) stmts.push(['UPDATE themes SET needs_attention = ? WHERE id = ?', body.needs_attention ? 1 : 0, tid])
  if (body.order_reason !== undefined) stmts.push(['UPDATE themes SET order_reason = ? WHERE id = ?', content(isEncrypted(ctx.sprint), body.order_reason, 200, 'Reason', false), tid])
  if (moving) {
    stmts.push(...(await structuralChange(c.env.DB, ctx, body.reset_voting_reason)))
    stmts.push(...assign(ctx.sprint.id, tid, moving))
  }
  await batch(c.env.DB, stmts)
  await hint(c.env, ctx.sprint.id, 'themes')
  return c.json(await grouping(c.env, ctx))
})

themes.post('/api/sprints/:sprintId/themes/ungroup', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireEdit(ctx)
  const body = await jsonBody<{ entry_ids?: unknown; reset_voting_reason?: string }>(c)
  const entryIds = idList(body.entry_ids, 'entry_ids')
  const stmts = await structuralChange(c.env.DB, ctx, body.reset_voting_reason)
  for (const eid of entryIds) stmts.push(['DELETE FROM theme_entries WHERE entry_id = ? AND entry_id IN (SELECT id FROM entries WHERE sprint_id = ?)', eid, ctx.sprint.id])
  await batch(c.env.DB, stmts)
  await hint(c.env, ctx.sprint.id, 'themes')
  return c.json(await grouping(c.env, ctx))
})

themes.delete('/api/sprints/:sprintId/themes/:themeId', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireEdit(ctx)
  const body = await jsonBody<{ reset_voting_reason?: string }>(c)
  const stmts = await structuralChange(c.env.DB, ctx, body.reset_voting_reason)
  stmts.push(['DELETE FROM themes WHERE id = ? AND sprint_id = ?', c.req.param('themeId'), ctx.sprint.id])
  await batch(c.env.DB, stmts)
  await hint(c.env, ctx.sprint.id, 'themes')
  return c.json(await grouping(c.env, ctx))
})

themes.post('/api/sprints/:sprintId/themes/:themeId/merge', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireEdit(ctx)
  const tid = c.req.param('themeId')
  const body = await jsonBody<{ into_theme_id?: string; reset_voting_reason?: string }>(c)
  const into = String(body.into_theme_id ?? '')
  if (into === tid) throw bad('pick a different theme to merge into')
  if ((await count(c.env.DB, 'SELECT count(*) AS n FROM themes WHERE sprint_id = ? AND id IN (?, ?)', ctx.sprint.id, tid, into)) !== 2) throw notFound('theme not found')
  const stmts = await structuralChange(c.env.DB, ctx, body.reset_voting_reason)
  stmts.push(['UPDATE theme_entries SET theme_id = ? WHERE theme_id = ?', into, tid], ['UPDATE context_additions SET theme_id = ? WHERE theme_id = ?', into, tid], ['DELETE FROM themes WHERE id = ?', tid])
  await batch(c.env.DB, stmts)
  await hint(c.env, ctx.sprint.id, 'themes')
  return c.json(await grouping(c.env, ctx))
})

themes.post('/api/sprints/:sprintId/themes/:themeId/split', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireEdit(ctx)
  const tid = c.req.param('themeId')
  const body = await jsonBody<{ title?: string; entry_ids?: unknown; reset_voting_reason?: string }>(c)
  const title = content(isEncrypted(ctx.sprint), body.title, 80, 'Theme title', true)!
  const entryIds = idList(body.entry_ids, 'entry_ids')
  const src = await one<{ position: number }>(c.env.DB, 'SELECT position FROM themes WHERE id = ? AND sprint_id = ?', tid, ctx.sprint.id)
  if (!src) throw notFound('theme not found')
  await roomForTheme(c.env.DB, ctx.sprint.id)
  const nid = uuid()
  const stmts = await structuralChange(c.env.DB, ctx, body.reset_voting_reason)
  stmts.push(['INSERT INTO themes (id, sprint_id, title, position, created_at) VALUES (?,?,?,?,?)', nid, ctx.sprint.id, title, src.position + 1, Date.now()])
  for (const eid of entryIds) stmts.push(['UPDATE theme_entries SET theme_id = ? WHERE entry_id = ? AND theme_id = ?', nid, eid, tid])
  await batch(c.env.DB, stmts)
  await hint(c.env, ctx.sprint.id, 'themes')
  return c.json(await grouping(c.env, ctx))
})

/** Reorder themes. Not structural: does not reset voting. */
themes.post('/api/sprints/:sprintId/themes/reorder', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireEdit(ctx)
  const body = await jsonBody<{ theme_ids?: unknown; reason?: string }>(c)
  const reason = content(isEncrypted(ctx.sprint), body.reason, 200, 'Reason', false)
  const stmts: [string, ...unknown[]][] = idList(body.theme_ids, 'theme_ids').slice(0, 100).map((id, i) => ['UPDATE themes SET position = ?, order_reason = COALESCE(?, order_reason) WHERE id = ? AND sprint_id = ?', i, reason, id, ctx.sprint.id])
  await batch(c.env.DB, stmts)
  await audit(c.env.DB, ctx.sprint.workspace_id, ctx.sprint.id, ctx.auth.account.id, 'themes.reordered')
  await hint(c.env, ctx.sprint.id, 'themes')
  return c.json(await grouping(c.env, ctx))
})

export type { SharedEntry }
export { run }
