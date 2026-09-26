import { Hono } from 'hono'
import type { HonoEnv } from '../env'
import { config } from '../lib/config'
import { requireMember, requireOwner } from '../lib/auth'
import { randomToken, sha256Hex, uuid } from '../lib/crypto'
import { all, audit, batch, bool, count, one, run } from '../lib/db'
import { bad, conflict, forbidden, notFound } from '../lib/errors'
import { templates } from '../lib/email'
import { limit } from '../lib/ratelimit'
import { nonempty, normalizeEmail } from '../lib/util'
import { enqueue, runSoon } from '../jobs'
import { revokeLive } from '../lib/live'

export const workspaces = new Hono<HonoEnv>()

export async function loadWorkspace(env: HonoEnv['Bindings'], id: string, role: string) {
  const w = await one<{ id: string; name: string; retention_days: number; outcome_retention_days: number; ai_enabled_default: number; is_demo: number; created_at: number }>(env.DB, 'SELECT * FROM workspaces WHERE id = ?', id)
  if (!w) throw notFound()
  return { id: w.id, name: w.name, role, retention_days: w.retention_days, outcome_retention_days: w.outcome_retention_days, ai_enabled_default: bool(w.ai_enabled_default), ai_provider: config(env).ai, is_demo: bool(w.is_demo), created_at: new Date(w.created_at).toISOString() }
}

async function canInvite(db: D1Database, workspaceId: string, accountId: string, role: string) {
  if (role === 'owner') return true
  const n = await count(db, `SELECT count(*) AS n FROM sprint_participants sp JOIN sprints s ON s.id = sp.sprint_id WHERE s.workspace_id = ? AND sp.account_id = ? AND sp.is_facilitator = 1 AND s.status NOT IN ('completed','archived')`, workspaceId, accountId)
  return n > 0
}

workspaces.post('/api/workspaces', async (c) => {
  const cfg = config(c.env)
  const { requireAuth } = await import('../lib/auth')
  const a = await requireAuth(c, cfg, c.env.DB)
  const body = (await c.req.json().catch(() => ({}))) as { name?: string }
  const name = nonempty(body.name, 80, 'Workspace name')
  const id = uuid()
  await batch(c.env.DB, [
    ['INSERT INTO workspaces (id, name, created_at) VALUES (?,?,?)', id, name, Date.now()],
    ['INSERT INTO memberships (workspace_id, account_id, role, created_at) VALUES (?,?,?,?)', id, a.account.id, 'owner', Date.now()],
    ['INSERT INTO audit_events (workspace_id, actor_id, action, meta, created_at) VALUES (?,?,?,?,?)', id, a.account.id, 'workspace.created', '{}', Date.now()],
  ])
  return c.json(await loadWorkspace(c.env, id, 'owner'))
})

workspaces.get('/api/workspaces/:workspaceId', async (c) => {
  const m = await requireMember(c, config(c.env), c.env.DB, c.req.param('workspaceId'))
  const workspace = await loadWorkspace(c.env, m.workspaceId, m.role)
  const isOwner = m.role === 'owner'
  const rows = await all<{ id: string; display_name: string; email: string; role: string; created_at: number }>(c.env.DB, 'SELECT a.id, a.display_name, a.email, m.role, m.created_at FROM memberships m JOIN accounts a ON a.id = m.account_id WHERE m.workspace_id = ? AND m.revoked_at IS NULL ORDER BY m.created_at', m.workspaceId)
  const can_invite = await canInvite(c.env.DB, m.workspaceId, m.auth.account.id, m.role)
  const pending = can_invite
    ? await all<{ id: string; email: string; sprint_id: string | null; expires_at: number; created_at: number }>(c.env.DB, 'SELECT id, email, sprint_id, expires_at, created_at FROM invitations WHERE workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 100', m.workspaceId, Date.now())
    : []
  return c.json({
    workspace,
    members: rows.map((r) => ({ account_id: r.id, display_name: r.display_name, email: isOwner ? r.email : null, role: r.role, joined_at: new Date(r.created_at).toISOString(), is_you: r.id === m.auth.account.id })),
    pending_invitations: pending.map((p) => ({ id: p.id, email: p.email, sprint_id: p.sprint_id, expires_at: new Date(p.expires_at).toISOString(), created_at: new Date(p.created_at).toISOString() })),
    can_invite,
  })
})

workspaces.patch('/api/workspaces/:workspaceId', async (c) => {
  const m = await requireMember(c, config(c.env), c.env.DB, c.req.param('workspaceId'))
  requireOwner(m)
  const body = (await c.req.json().catch(() => ({}))) as { name?: string; retention_days?: number; outcome_retention_days?: number; ai_enabled_default?: boolean }
  if (body.name !== undefined) await run(c.env.DB, 'UPDATE workspaces SET name = ? WHERE id = ?', nonempty(body.name, 80, 'Workspace name'), m.workspaceId)
  if (body.retention_days !== undefined) {
    const d = Number(body.retention_days)
    if (!(d >= 7 && d <= 3650)) throw bad('retention must be between 7 and 3650 days')
    await run(c.env.DB, 'UPDATE workspaces SET retention_days = ? WHERE id = ?', d, m.workspaceId)
  }
  if (body.outcome_retention_days !== undefined) {
    const d = Number(body.outcome_retention_days)
    if (!(d >= 30 && d <= 3650)) throw bad('outcome retention must be between 30 and 3650 days')
    await run(c.env.DB, 'UPDATE workspaces SET outcome_retention_days = ? WHERE id = ?', d, m.workspaceId)
  }
  if (body.ai_enabled_default !== undefined) await run(c.env.DB, 'UPDATE workspaces SET ai_enabled_default = ? WHERE id = ?', body.ai_enabled_default ? 1 : 0, m.workspaceId)
  await audit(c.env.DB, m.workspaceId, null, m.auth.account.id, 'workspace.settings_updated')
  return c.json(await loadWorkspace(c.env, m.workspaceId, m.role))
})

/** Invite by email. Sends a link; joining requires verifying that exact address. */
workspaces.post('/api/workspaces/:workspaceId/invitations', async (c) => {
  const cfg = config(c.env)
  const m = await requireMember(c, cfg, c.env.DB, c.req.param('workspaceId'))
  if (!(await canInvite(c.env.DB, m.workspaceId, m.auth.account.id, m.role))) throw forbidden('only owners and facilitators can invite')
  const body = (await c.req.json().catch(() => ({}))) as { email?: string; sprint_id?: string }
  const email = normalizeEmail(body.email ?? '')
  if (!email) throw bad('enter a valid email address')
  await limit(c.env.DB, `invite:${m.workspaceId}`, 60, 3_600_000)
  if (body.sprint_id) {
    // Adding someone to a sprint is the facilitator's call for that sprint (as with POST /participants),
    // and only while it's unfinished. Facilitating one sprint, or owning the workspace, doesn't open
    // other sprints — otherwise anyone could invite themselves into a sprint they aren't part of.
    const sp = await one<{ status: string }>(c.env.DB, 'SELECT status FROM sprints WHERE id = ? AND workspace_id = ?', body.sprint_id, m.workspaceId)
    if (!sp) throw notFound('sprint not found')
    const fac = await count(c.env.DB, 'SELECT count(*) AS n FROM sprint_participants WHERE sprint_id = ? AND account_id = ? AND is_facilitator = 1', body.sprint_id, m.auth.account.id)
    if (!fac) throw forbidden('only this sprint’s facilitator can add people to it')
    if (['completed', 'archived'].includes(sp.status)) throw conflict('this sprint is finished')
  }
  const existing = await one<{ id: string }>(c.env.DB, 'SELECT a.id FROM accounts a JOIN memberships mm ON mm.account_id = a.id WHERE a.email = ? AND mm.workspace_id = ? AND mm.revoked_at IS NULL', email, m.workspaceId)
  if (existing) {
    if (body.sprint_id) await run(c.env.DB, 'INSERT OR IGNORE INTO sprint_participants (sprint_id, account_id, is_facilitator, created_at) VALUES (?,?,0,?)', body.sprint_id, existing.id, Date.now())
    return c.json({ invitation_id: '00000000-0000-0000-0000-000000000000', email, already_member: true })
  }
  const token = randomToken(32)
  const id = uuid()
  await run(c.env.DB, 'INSERT INTO invitations (id, workspace_id, email, token_hash, invited_by, sprint_id, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?)', id, m.workspaceId, email, await sha256Hex(token), m.auth.account.id, body.sprint_id ?? null, Date.now() + 14 * 86_400_000, Date.now())
  const ws = await one<{ name: string }>(c.env.DB, 'SELECT name FROM workspaces WHERE id = ?', m.workspaceId)
  const mail = templates.invitation(email, ws?.name ?? 'your team', m.auth.account.display_name, `${cfg.publicOrigin}/invite#${token}`)
  await enqueue(c.env.DB, 'email', { to: mail.to, subject: mail.subject, body: mail.body }, Date.now(), `invite:${id}`)
  runSoon(c, c.env)
  await audit(c.env.DB, m.workspaceId, body.sprint_id ?? null, m.auth.account.id, 'invitation.sent', { invitation_id: id })
  return c.json({ invitation_id: id, email, already_member: false })
})

workspaces.delete('/api/workspaces/:workspaceId/invitations/:invitationId', async (c) => {
  const m = await requireMember(c, config(c.env), c.env.DB, c.req.param('workspaceId'))
  if (!(await canInvite(c.env.DB, m.workspaceId, m.auth.account.id, m.role))) throw forbidden('only owners and facilitators can manage invitations')
  await run(c.env.DB, 'UPDATE invitations SET revoked_at = ? WHERE id = ? AND workspace_id = ? AND accepted_at IS NULL', Date.now(), c.req.param('invitationId'), m.workspaceId)
  return c.json({ ok: true })
})

/** Remove a member: every later request to this workspace fails and their live connections close. */
workspaces.delete('/api/workspaces/:workspaceId/members/:accountId', async (c) => {
  const m = await requireMember(c, config(c.env), c.env.DB, c.req.param('workspaceId'))
  requireOwner(m)
  const target = c.req.param('accountId')
  if (target === m.auth.account.id) {
    const owners = await count(c.env.DB, "SELECT count(*) AS n FROM memberships WHERE workspace_id = ? AND role = 'owner' AND revoked_at IS NULL", m.workspaceId)
    if (owners <= 1) throw conflict('a workspace needs at least one owner')
  }
  const liveSprints = await all<{ id: string }>(c.env.DB, `SELECT s.id FROM sprints s JOIN sprint_participants sp ON sp.sprint_id = s.id WHERE s.workspace_id = ? AND sp.account_id = ? AND s.status NOT IN ('completed','archived')`, m.workspaceId, target)
  await batch(c.env.DB, [
    ['UPDATE memberships SET revoked_at = ? WHERE workspace_id = ? AND account_id = ? AND revoked_at IS NULL', Date.now(), m.workspaceId, target],
    // Drop them from unfinished sprints; their sealed entries stay in the sprint's pool.
    [`DELETE FROM sprint_participants WHERE account_id = ? AND sprint_id IN (SELECT id FROM sprints WHERE workspace_id = ? AND status NOT IN ('completed','archived'))`, target, m.workspaceId],
    ['INSERT INTO audit_events (workspace_id, actor_id, action, meta, created_at) VALUES (?,?,?,?,?)', m.workspaceId, m.auth.account.id, 'membership.revoked', JSON.stringify({ account_id: target }), Date.now()],
  ])
  // Persisted first; live sockets are closed afterwards (and every join/command re-checks membership).
  await Promise.all(liveSprints.map((s) => revokeLive(c.env, s.id, target)))
  return c.json({ ok: true })
})

workspaces.patch('/api/workspaces/:workspaceId/members/:accountId', async (c) => {
  const m = await requireMember(c, config(c.env), c.env.DB, c.req.param('workspaceId'))
  requireOwner(m)
  const body = (await c.req.json().catch(() => ({}))) as { role?: string }
  if (body.role !== 'owner' && body.role !== 'member') throw bad('role must be owner or member')
  if (body.role === 'member') {
    const owners = await all<{ account_id: string }>(c.env.DB, "SELECT account_id FROM memberships WHERE workspace_id = ? AND role = 'owner' AND revoked_at IS NULL", m.workspaceId)
    if (owners.length <= 1 && owners[0]?.account_id === c.req.param('accountId')) throw conflict('a workspace needs at least one owner')
  }
  await run(c.env.DB, 'UPDATE memberships SET role = ? WHERE workspace_id = ? AND account_id = ? AND revoked_at IS NULL', body.role, m.workspaceId, c.req.param('accountId'))
  return c.json({ ok: true })
})

workspaces.get('/api/workspaces/:workspaceId/audit', async (c) => {
  const m = await requireMember(c, config(c.env), c.env.DB, c.req.param('workspaceId'))
  requireOwner(m)
  const rows = await all<{ id: number; sprint_id: string | null; actor_name: string | null; action: string; meta: string; created_at: number }>(c.env.DB, 'SELECT e.id, e.sprint_id, a.display_name AS actor_name, e.action, e.meta, e.created_at FROM audit_events e LEFT JOIN accounts a ON a.id = e.actor_id WHERE e.workspace_id = ? ORDER BY e.id DESC LIMIT 200', m.workspaceId)
  return c.json(rows.map((r) => ({ id: r.id, sprint_id: r.sprint_id, actor_name: r.actor_name, action: r.action, meta: JSON.parse(r.meta || '{}'), created_at: new Date(r.created_at).toISOString() })))
})
