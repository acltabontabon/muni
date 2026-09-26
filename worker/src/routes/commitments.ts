/** Experiments, owner acceptance, review outcomes, recap. Ownership is named; the observation behind it is not. */
import { Hono } from 'hono'
import { content, isEncrypted } from '../lib/sealed'
import type { HonoEnv } from '../env'
import { config } from '../lib/config'
import { requireFacilitator, requireMember, requireParticipant, requireSprint, type SprintCtx } from '../lib/auth'
import { uuid } from '../lib/crypto'
import { all, audit, count, one, run } from '../lib/db'
import { AppError, bad, conflict, forbidden, notFound, unprocessable } from '../lib/errors'
import { hint } from '../lib/live'
import { addDays } from '../lib/util'

export const commitments = new Hono<HonoEnv>()
export const OUTCOMES = ['proposed', 'accepted', 'helped', 'did_not_help', 'inconclusive', 'not_tried']

export const EXP_SELECT = `SELECT e.id, e.sprint_id, s.name AS sprint_name, e.theme_id, e.theme_title, e.change_to_try, e.success_signal, e.owner_account_id, a.display_name AS owner_name,
  (e.owner_accepted_at IS NOT NULL) AS owner_accepted, e.review_on, e.status, e.outcome_note, e.reviewed_at, e.created_at
  FROM experiments e JOIN sprints s ON s.id = e.sprint_id LEFT JOIN accounts a ON a.id = e.owner_account_id`

export interface ExperimentRow {
  id: string
  sprint_id: string
  sprint_name: string
  theme_id: string | null
  theme_title: string | null
  change_to_try: string
  success_signal: string
  owner_account_id: string | null
  owner_name: string | null
  owner_accepted: number
  review_on: string
  status: string
  outcome_note: string | null
  reviewed_at: number | null
  created_at: number
}
export const expView = (r: ExperimentRow) => ({ ...r, owner_accepted: Number(r.owner_accepted) === 1, reviewed_at: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : null, created_at: new Date(r.created_at).toISOString() })

function vague(change: string): string | null {
  const c = change.toLowerCase()
  const generic = ['communicate better', 'be more careful', 'try harder', 'improve communication', 'work better together', 'be better', 'do better', 'more transparency']
  if (generic.some((g) => c.includes(g)) || c.split(/\s+/).length < 4) return 'That reads as an intention rather than a change. What will someone do differently, and when? For example: “For the next sprint, reserve a 15-minute daily review window; see whether PRs spend less time waiting.”'
  return null
}

export const listFor = async (db: D1Database, sprintId: string) => (await all<ExperimentRow>(db, `${EXP_SELECT} WHERE e.sprint_id = ? ORDER BY e.created_at LIMIT 50`, sprintId)).map(expView)

commitments.get('/api/sprints/:sprintId/experiments', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireParticipant(ctx)
  return c.json(await listFor(c.env.DB, ctx.sprint.id))
})

commitments.get('/api/sprints/:sprintId/experiments/previous', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireParticipant(ctx)
  const rows = await all<ExperimentRow>(c.env.DB, `${EXP_SELECT} WHERE e.workspace_id = ? AND e.sprint_id <> ? AND e.status <> 'proposed' AND s.starts_on <= (SELECT starts_on FROM sprints WHERE id = ?) ORDER BY s.starts_on DESC, e.created_at DESC LIMIT 12`, ctx.sprint.workspace_id, ctx.sprint.id, ctx.sprint.id)
  return c.json(rows.map(expView))
})

commitments.post('/api/sprints/:sprintId/experiments', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireFacilitator(ctx)
  if (!['live', 'completed', 'ready'].includes(ctx.sprint.status)) throw conflict('experiments are agreed during or after the retro')
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const encrypted = isEncrypted(ctx.sprint)
  // The "too vague" check reads the text, so for encrypted sprints it runs on the facilitator's device.
  const change = content(encrypted, body.change_to_try, 500, 'The change to try', true)!
  const v = encrypted ? null : vague(change)
  if (v) throw unprocessable(v)
  const signal = content(encrypted, body.success_signal, 300, 'The success signal', true)!
  const db = c.env.DB
  const n = await count(db, 'SELECT count(*) AS n FROM experiments WHERE sprint_id = ?', ctx.sprint.id)
  if (n >= 10) throw conflict('ten experiments is the hard limit')
  if (n >= 3 && body.override_limit !== true) throw conflict('three experiments is plenty for one sprint. Add another only if you’re sure the team can carry it — confirm to continue')
  let review = typeof body.review_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.review_on) ? body.review_on : null
  if (!review) {
    const s = await one<{ ends_on: string }>(db, 'SELECT ends_on FROM sprints WHERE id = ?', ctx.sprint.id)
    review = addDays(s!.ends_on, 14)
  }
  const owner = typeof body.owner_account_id === 'string' && body.owner_account_id ? body.owner_account_id : null
  if (owner && !(await count(db, 'SELECT count(*) AS n FROM sprint_participants WHERE sprint_id = ? AND account_id = ?', ctx.sprint.id, owner))) throw bad('the owner must be a participant in this sprint')
  const themeId = typeof body.theme_id === 'string' && body.theme_id ? body.theme_id : null
  const theme = themeId ? await one<{ title: string }>(db, 'SELECT title FROM themes WHERE id = ? AND sprint_id = ?', themeId, ctx.sprint.id) : null
  await run(db, 'INSERT INTO experiments (id, workspace_id, sprint_id, theme_id, theme_title, change_to_try, success_signal, owner_account_id, review_on, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', uuid(), ctx.sprint.workspace_id, ctx.sprint.id, theme ? themeId : null, theme?.title ?? null, change, signal, owner, review, Date.now(), Date.now())
  await audit(db, ctx.sprint.workspace_id, ctx.sprint.id, ctx.auth.account.id, 'experiment.proposed')
  await hint(c.env, ctx.sprint.id, 'commitments')
  return c.json(await listFor(db, ctx.sprint.id))
})

commitments.patch('/api/sprints/:sprintId/experiments/:experimentId', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireParticipant(ctx)
  const eid = c.req.param('experimentId')
  const db = c.env.DB
  const row = await one<{ owner_account_id: string | null }>(db, 'SELECT owner_account_id FROM experiments WHERE id = ? AND sprint_id = ?', eid, ctx.sprint.id)
  if (!row) throw notFound('experiment not found')
  const isOwner = row.owner_account_id === ctx.auth.account.id
  if (!(ctx.isFacilitator || isOwner)) throw forbidden('only the facilitator or the experiment’s owner can edit it')
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  if (body.change_to_try !== undefined) {
    const ch = content(isEncrypted(ctx.sprint), body.change_to_try, 500, 'The change to try', true)!
    const v = isEncrypted(ctx.sprint) ? null : vague(ch)
    if (v) throw unprocessable(v)
    await run(db, 'UPDATE experiments SET change_to_try=?, updated_at=? WHERE id=?', ch, Date.now(), eid)
  }
  if (body.success_signal !== undefined) await run(db, 'UPDATE experiments SET success_signal=?, updated_at=? WHERE id=?', content(isEncrypted(ctx.sprint), body.success_signal, 300, 'The success signal', true), Date.now(), eid)
  if (body.owner_account_id !== undefined) {
    if (!ctx.isFacilitator) throw forbidden('only the facilitator can nominate an owner')
    if (body.owner_account_id && !(await count(db, 'SELECT count(*) AS n FROM sprint_participants WHERE sprint_id = ? AND account_id = ?', ctx.sprint.id, String(body.owner_account_id)))) throw bad('the owner must be a participant in this sprint')
    await run(db, "UPDATE experiments SET owner_account_id=?, owner_accepted_at=NULL, status=CASE WHEN status IN ('proposed','accepted') THEN 'proposed' ELSE status END, updated_at=? WHERE id=?", body.owner_account_id ? String(body.owner_account_id) : null, Date.now(), eid)
  }
  if (typeof body.review_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.review_on)) await run(db, 'UPDATE experiments SET review_on=?, updated_at=? WHERE id=?', body.review_on, Date.now(), eid)
  if (body.status !== undefined) {
    const st = String(body.status)
    if (!OUTCOMES.includes(st)) throw bad('unknown status')
    if (st === 'accepted') throw bad('acceptance comes from the owner via /accept')
    const reviewed = ['helped', 'did_not_help', 'inconclusive', 'not_tried'].includes(st)
    await run(db, 'UPDATE experiments SET status=?, reviewed_at=CASE WHEN ? THEN ? ELSE reviewed_at END, updated_at=? WHERE id=?', st, reviewed ? 1 : 0, Date.now(), Date.now(), eid)
  }
  if (body.outcome_note !== undefined) await run(db, 'UPDATE experiments SET outcome_note=?, updated_at=? WHERE id=?', content(isEncrypted(ctx.sprint), body.outcome_note, 500, 'Outcome note', false), Date.now(), eid)
  await audit(db, ctx.sprint.workspace_id, ctx.sprint.id, ctx.auth.account.id, 'experiment.updated', { experiment_id: eid })
  await hint(c.env, ctx.sprint.id, 'commitments')
  return c.json(await listFor(db, ctx.sprint.id))
})

commitments.post('/api/sprints/:sprintId/experiments/:experimentId/accept', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireParticipant(ctx)
  const body = (await c.req.json().catch(() => ({}))) as { accept?: boolean }
  const eid = c.req.param('experimentId')
  const res = body.accept
    ? await run(c.env.DB, "UPDATE experiments SET owner_accepted_at=?, status='accepted', updated_at=? WHERE id=? AND sprint_id=? AND owner_account_id=? AND status='proposed'", Date.now(), Date.now(), eid, ctx.sprint.id, ctx.auth.account.id)
    : await run(c.env.DB, "UPDATE experiments SET owner_account_id=NULL, owner_accepted_at=NULL, status='proposed', updated_at=? WHERE id=? AND sprint_id=? AND owner_account_id=?", Date.now(), eid, ctx.sprint.id, ctx.auth.account.id)
  if (!res.meta.changes) throw conflict('this experiment isn’t waiting on you')
  await hint(c.env, ctx.sprint.id, 'commitments')
  return c.json(await listFor(c.env.DB, ctx.sprint.id))
})

commitments.delete('/api/sprints/:sprintId/experiments/:experimentId', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireFacilitator(ctx)
  await run(c.env.DB, "DELETE FROM experiments WHERE id=? AND sprint_id=? AND status IN ('proposed','accepted') AND reviewed_at IS NULL", c.req.param('experimentId'), ctx.sprint.id)
  await hint(c.env, ctx.sprint.id, 'commitments')
  return c.json({ ok: true })
})

commitments.get('/api/workspaces/:workspaceId/experiments', async (c) => {
  const m = await requireMember(c, config(c.env), c.env.DB, c.req.param('workspaceId'))
  const rows = await all<ExperimentRow>(c.env.DB, `${EXP_SELECT} WHERE e.workspace_id = ? ORDER BY s.starts_on DESC, e.created_at DESC LIMIT 200`, m.workspaceId)
  return c.json(rows.map(expView))
})

// ---------- recap ----------
export async function generateRecap(db: D1Database, ctx: SprintCtx): Promise<string> {
  const s = (await one<{ name: string; goal: string | null }>(db, 'SELECT name, goal FROM sprints WHERE id = ?', ctx.sprint.id))!
  let out = `# ${s.name} — retro recap\n\n`
  if (s.goal) out += `Sprint goal: ${s.goal}\n\n`
  const themes = await all<{ id: string; title: string; summary: string; parked: number; needs_attention: number; takeaway: string | null; what_happened: string | null; impact: string | null; could_try: string | null; discussed: number | null }>(
    db,
    'SELECT t.id, t.title, t.summary, t.parked, t.needs_attention, d.takeaway, d.what_happened, d.impact, d.could_try, d.discussed FROM themes t LEFT JOIN discussion_notes d ON d.theme_id = t.id WHERE t.sprint_id = ? ORDER BY t.position LIMIT 100',
    ctx.sprint.id,
  )
  const entries = await count(db, 'SELECT count(*) AS n FROM entries WHERE sprint_id = ?', ctx.sprint.id)
  out += `${entries} observations were captured during the sprint and grouped into ${themes.length} themes.\n\n## Topics discussed\n\n`
  const discussed = themes.filter((t) => Number(t.discussed) === 1)
  if (!discussed.length) out += '_No theme was marked as discussed._\n\n'
  for (const t of discussed) {
    out += `### ${t.title}\n\n${t.summary ? `${t.summary}\n\n` : ''}`
    if (t.takeaway) out += `**Takeaway:** ${t.takeaway}\n\n`
    if (t.what_happened) out += `**What happened:** ${t.what_happened}\n\n`
    if (t.impact) out += `**Impact:** ${t.impact}\n\n`
    if (t.could_try) out += `**What we could try:** ${t.could_try}\n\n`
  }
  out += '## Decisions and open questions\n\n_Add decisions and open questions here._\n\n## Experiments\n\n'
  const exps = await listFor(db, ctx.sprint.id)
  if (!exps.length) out += '_No experiments were agreed._\n\n'
  for (const e of exps) {
    const owner = e.owner_name ? (e.owner_accepted ? `owner: ${e.owner_name}` : `proposed owner: ${e.owner_name} (not yet accepted)`) : 'no owner yet'
    out += `- **${e.change_to_try}** — success signal: ${e.success_signal}. Review on ${e.review_on}. (${owner})\n`
  }
  out += '\n## Parked\n\n'
  const parked = themes.filter((t) => Number(t.parked) === 1 || Number(t.discussed) !== 1)
  if (!parked.length) out += '_Nothing was parked._\n'
  for (const t of parked) out += `- ${t.title}${Number(t.needs_attention) === 1 ? ' (needs attention despite low votes)' : ''}\n`
  return out
}

async function recapView(db: D1Database, ctx: SprintCtx) {
  const r = await one<{ body: string; draft_source: string; approved_at: number | null; published_at: number | null; updated_at: number }>(db, 'SELECT body, draft_source, approved_at, published_at, updated_at FROM recaps WHERE sprint_id = ?', ctx.sprint.id)
  if (!r) return { body: '', draft_source: 'manual', approved_at: null, published_at: null, updated_at: null, exists: false }
  if (!r.published_at && !ctx.isFacilitator) return { body: '', draft_source: r.draft_source, approved_at: null, published_at: null, updated_at: null, exists: false }
  return { body: r.body, draft_source: r.draft_source, approved_at: r.approved_at ? new Date(r.approved_at).toISOString() : null, published_at: r.published_at ? new Date(r.published_at).toISOString() : null, updated_at: new Date(r.updated_at).toISOString(), exists: true }
}

commitments.get('/api/sprints/:sprintId/recap', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireParticipant(ctx)
  return c.json(await recapView(c.env.DB, ctx))
})

commitments.put('/api/sprints/:sprintId/recap', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireFacilitator(ctx)
  if (!['live', 'completed', 'archived'].includes(ctx.sprint.status)) throw conflict('the recap is written during or after the retro')
  const body = (await c.req.json().catch(() => ({}))) as { body?: string; publish?: boolean }
  // A recap draft is generated from the meeting record, which the server can only read for
  // legacy sprints. Encrypted sprints draft it on the facilitator's device.
  if (isEncrypted(ctx.sprint) && typeof body.body !== 'string') throw new AppError(409, 'encrypted_recap', 'this sprint is encrypted, so its recap is drafted on your device')
  const text = isEncrypted(ctx.sprint) ? content(true, body.body, 20_000, 'The recap', false) ?? '' : typeof body.body === 'string' ? body.body.trim().slice(0, 20_000) : await generateRecap(c.env.DB, ctx)
  const source = typeof body.body === 'string' ? 'manual' : 'generated'
  await run(c.env.DB, 'INSERT INTO recaps (sprint_id, body, draft_source, updated_at) VALUES (?,?,?,?) ON CONFLICT(sprint_id) DO UPDATE SET body=excluded.body, draft_source=excluded.draft_source, updated_at=excluded.updated_at', ctx.sprint.id, text, source, Date.now())
  if (body.publish === true) {
    await run(c.env.DB, 'UPDATE recaps SET approved_at=?, published_at=? WHERE sprint_id=?', Date.now(), Date.now(), ctx.sprint.id)
    await audit(c.env.DB, ctx.sprint.workspace_id, ctx.sprint.id, ctx.auth.account.id, 'recap.published')
  }
  await hint(c.env, ctx.sprint.id, 'commitments')
  return c.json(await recapView(c.env.DB, ctx))
})
