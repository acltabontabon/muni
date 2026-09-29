import { Hono } from 'hono'
import type { HonoEnv } from '../env'
import { config } from '../lib/config'
import { requireAuth, requireMember, requireOwner } from '../lib/auth'
import { randomToken, sha256Hex, uuid } from '../lib/crypto'
import { all, assignments, audit, auditStmt, batch, bool, count, one, run } from '../lib/db'
import { AppError, bad, conflict, forbidden, notFound } from '../lib/errors'
import { templates } from '../lib/email'
import { mayGrant, mayRevoke } from '../lib/grants'
import { accountBucket, limit } from '../lib/ratelimit'
import { jsonBody, nonempty, normalizeEmail } from '../lib/util'
import { enqueueStatement, runSoon } from '../jobs'
import { forgetRoom, revokeLive } from '../lib/live'
import { deleteWorkspaces, facilitated, openSprints, retroRooms, revokeMembership, standing, type Standing } from '../lib/departure'
import { EMAIL_OF_A } from '../lib/accounts'

export const workspaces = new Hono<HonoEnv>()

export async function loadWorkspace(env: HonoEnv['Bindings'], id: string, role: string) {
  const w = await one<{ id: string; name: string; retention_days: number; outcome_retention_days: number; is_demo: number; created_at: number }>(env.DB, 'SELECT * FROM workspaces WHERE id = ?', id)
  if (!w) throw notFound()
  return { id: w.id, name: w.name, role, retention_days: w.retention_days, outcome_retention_days: w.outcome_retention_days, is_demo: bool(w.is_demo), created_at: new Date(w.created_at).toISOString() }
}

const DAY = 86_400_000
/** New workspaces one account may make a day: plenty for people, a brake on making many to invite from. */
export const WORKSPACES_DAILY = 10
/** Invitation emails one account may send a day, across all its workspaces. */
export const INVITE_EMAILS_DAILY = 20

workspaces.post('/api/workspaces', async (c) => {
  const cfg = config(c.env)
  const a = await requireAuth(c, cfg, c.env.DB)
  const body = await jsonBody<{ name?: string }>(c)
  const name = nonempty(body.name, 80, 'Workspace name')
  await limit(c.env.DB, accountBucket('workspace-new', a.account.id), WORKSPACES_DAILY, DAY, (s) => new AppError(429, 'rate_limited', `you’ve made ${WORKSPACES_DAILY} workspaces today, the most one person can — try again tomorrow`, { retry_after_seconds: s }))
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
  const isOwner = m.role === 'owner'
  // Independent reads travel to the database together. Pending invitations, with the addresses they
  // went to, and who a removal would strand a sprint for, are an owner's to see; nobody else is told.
  const [workspace, rows, pending, fac] = await Promise.all([
    loadWorkspace(c.env, m.workspaceId, m.role),
    all<{ id: string; display_name: string; email: string | null; role: string; created_at: number }>(c.env.DB, `SELECT a.id, a.display_name, ${EMAIL_OF_A} AS email, m.role, m.created_at FROM memberships m JOIN accounts a ON a.id = m.account_id WHERE m.workspace_id = ? AND m.revoked_at IS NULL ORDER BY m.created_at`, m.workspaceId),
    isOwner
      ? all<{ id: string; email: string; sprint_id: string | null; expires_at: number; created_at: number }>(c.env.DB, 'SELECT id, email, sprint_id, expires_at, created_at FROM invitations WHERE workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 100', m.workspaceId, Date.now())
      : Promise.resolve([]),
    isOwner ? facilitated(c.env.DB, { workspaceId: m.workspaceId }) : Promise.resolve([]),
  ])
  // Inviting to the workspace is an owner's; a sprint's facilitator invites from the sprint.
  const can_invite = isOwner
  return c.json({
    workspace,
    members: rows.map((r) => ({ account_id: r.id, display_name: r.display_name, email: isOwner ? r.email : null, role: r.role, joined_at: new Date(r.created_at).toISOString(), is_you: r.id === m.auth.account.id, facilitating: fac.filter((f) => f.account_id === r.id).map((f) => ({ id: f.id, name: f.name })) })),
    pending_invitations: pending.map((p) => ({ id: p.id, email: p.email, sprint_id: p.sprint_id, expires_at: new Date(p.expires_at).toISOString(), created_at: new Date(p.created_at).toISOString() })),
    can_invite,
  })
})

workspaces.patch('/api/workspaces/:workspaceId', async (c) => {
  const m = await requireMember(c, config(c.env), c.env.DB, c.req.param('workspaceId'))
  requireOwner(m)
  const body = await jsonBody<{ name?: string; retention_days?: number; outcome_retention_days?: number }>(c)
  const { sets, args, set } = assignments()
  if (body.name !== undefined) set('name = ?', nonempty(body.name, 80, 'Workspace name'))
  const content = body.retention_days === undefined ? null : Number(body.retention_days)
  if (content !== null) {
    if (!(content >= 7 && content <= 3650)) throw bad('retention must be between 7 and 3650 days')
    set('retention_days = ?', content)
  }
  const outcomes = body.outcome_retention_days === undefined ? null : Number(body.outcome_retention_days)
  if (outcomes !== null) {
    if (!(outcomes >= 30 && outcomes <= 3650)) throw bad('outcome retention must be between 30 and 3650 days')
    set('outcome_retention_days = ?', outcomes)
  }
  // All at once. A change to either window goes ahead only if outcomes (experiments, the published
  // recap) are then kept at least as long as the content they came from — checked in the same
  // statement against the stored window for the one not sent.
  const windows = content !== null || outcomes !== null
  if (sets.length) {
    const r = await run(c.env.DB, `UPDATE workspaces SET ${sets.join(', ')} WHERE id = ?${windows ? ' AND COALESCE(?, outcome_retention_days) >= COALESCE(?, retention_days)' : ''}`, ...args, m.workspaceId, ...(windows ? [outcomes, content] : []))
    if (!r.meta.changes) throw bad('outcomes are kept at least as long as the content they come from — make outcome retention at least as long as content retention')
  }
  await audit(c.env.DB, m.workspaceId, null, m.auth.account.id, 'workspace.settings_updated')
  return c.json(await loadWorkspace(c.env, m.workspaceId, m.role))
})

/**
 * Invite by email: a single-use link, sent to that address. Into the workspace, it's an owner's
 * call; into a sprint (which also makes them a member), that sprint's facilitator's, while it's
 * unfinished (lib/grants.ts). Whether an address belongs to a member is something only owners
 * learn — they see members' addresses anyway: an owner inviting a member just adds them, and for
 * anyone else an invitation is made and sent either way.
 */
workspaces.post('/api/workspaces/:workspaceId/invitations', async (c) => {
  const cfg = config(c.env)
  const db = c.env.DB
  const m = await requireMember(c, cfg, db, c.req.param('workspaceId'))
  const me = m.auth.account.id
  const body = await jsonBody<{ email?: unknown; sprint_id?: unknown }>(c)
  const email = normalizeEmail(body.email)
  if (!email) throw bad('enter a valid email address')
  if (body.sprint_id !== undefined && body.sprint_id !== null && typeof body.sprint_id !== 'string') throw bad('sprint_id must be an id')
  const sprintId = body.sprint_id || null
  if (sprintId) {
    // Facilitating one sprint, or owning the workspace, doesn't open other sprints — otherwise anyone
    // could invite themselves into a sprint they aren't part of.
    const sp = await one<{ status: string }>(db, 'SELECT status FROM sprints WHERE id = ? AND workspace_id = ?', sprintId, m.workspaceId)
    if (!sp) throw notFound('sprint not found')
    if (['completed', 'archived'].includes(sp.status)) throw conflict('this sprint is finished')
    if (!(await mayGrant(db, m.workspaceId, sprintId, me, m.role))) throw forbidden('only this sprint’s facilitator can add people to it')
  } else if (!(await mayGrant(db, m.workspaceId, null, me, m.role))) throw forbidden('only an owner can invite people to the workspace')
  if (m.role === 'owner') {
    const existing = await one<{ id: string }>(db, 'SELECT ae.account_id AS id FROM account_emails ae JOIN memberships mm ON mm.account_id = ae.account_id WHERE ae.email = ? AND mm.workspace_id = ? AND mm.revoked_at IS NULL', email, m.workspaceId)
    if (existing) {
      if (sprintId) await run(db, 'INSERT OR IGNORE INTO sprint_participants (sprint_id, account_id, is_facilitator, created_at) VALUES (?,?,0,?)', sprintId, existing.id, Date.now())
      return c.json({ invitation_id: '00000000-0000-0000-0000-000000000000', email, already_member: true })
    }
  }
  // Every invitation is an email with the inviter's name and the workspace's in it: limited per
  // workspace, and per person across all their workspaces.
  await limit(db, `invite:${m.workspaceId}`, 60, 3_600_000)
  await limit(db, accountBucket('invite-mail', me), INVITE_EMAILS_DAILY, DAY, (s) => new AppError(429, 'rate_limited', `you’ve sent ${INVITE_EMAILS_DAILY} invitations today, the most one person can — send more tomorrow, or share an invite link instead`, { retry_after_seconds: s }))
  const token = randomToken(32)
  const id = uuid()
  const now = Date.now()
  const ws = await one<{ name: string }>(db, 'SELECT name FROM workspaces WHERE id = ?', m.workspaceId)
  const link = `${cfg.publicOrigin}/invite#${token}`
  const mail = templates.invitation(email, ws?.name ?? 'your team', m.auth.account.display_name, link)
  await batch(db, [
    ["INSERT INTO invitations (id, workspace_id, email, token_hash, invited_by, sprint_id, expires_at, created_at, role) VALUES (?,?,?,?,?,?,?,?,'member')", id, m.workspaceId, email, await sha256Hex(token), me, sprintId, now + 14 * DAY, now],
    enqueueStatement('email', { to: mail.to, subject: mail.subject, body: mail.body }, now, `invite:${id}`),
    auditStmt(m.workspaceId, sprintId, me, 'invitation.sent', { invitation_id: id }),
  ])
  runSoon(c, c.env)
  // The inviter may copy the link too; like the email, it admits whoever uses it first.
  return c.json({ invitation_id: id, email, already_member: false, link })
})

/** Withdraw an invitation: an owner, or whoever may invite into its scope. */
workspaces.delete('/api/workspaces/:workspaceId/invitations/:invitationId', async (c) => {
  const m = await requireMember(c, config(c.env), c.env.DB, c.req.param('workspaceId'))
  const inv = await one<{ sprint_id: string | null }>(c.env.DB, 'SELECT sprint_id FROM invitations WHERE id = ? AND workspace_id = ?', c.req.param('invitationId'), m.workspaceId)
  if (inv && !(await mayRevoke(c.env.DB, m.workspaceId, inv.sprint_id, m.auth.account.id, m.role))) throw forbidden('only an owner, or the sprint’s facilitator, can withdraw this invitation')
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
  // Nobody is removed from under a sprint the team depends on: its facilitator hands it on first.
  const refuse = async () => {
    const facilitating = (await facilitated(c.env.DB, { accountId: target, workspaceId: m.workspaceId })).map((f) => ({ id: f.id, name: f.name }))
    if (facilitating.length)
      throw new AppError(409, 'facilitating', `they facilitate ${facilitating.map((f) => f.name).join(', ')} — ask them to choose another facilitator first`, { sprints: facilitating })
  }
  await refuse()
  const liveSprints = await openSprints(c.env.DB, target, m.workspaceId)
  const [done] = await batch(c.env.DB, revokeMembership(m.workspaceId, target, m.auth.account.id, 'membership.revoked'))
  if (!done.meta.changes) {
    // The removal checks again as it happens: a handover to them, or the other owner leaving, since.
    await refuse()
    if (await count(c.env.DB, 'SELECT count(*) AS n FROM memberships WHERE workspace_id = ? AND account_id = ? AND revoked_at IS NULL', m.workspaceId, target)) throw conflict('a workspace needs at least one owner')
  }
  // Persisted first; live sockets are closed afterwards (and every join/command re-checks membership).
  await Promise.all(liveSprints.map((s) => revokeLive(c.env, s, target)))
  return c.json({ ok: true })
})

/**
 * Leave a workspace. The last owner hands ownership on first, and a facilitator hands on any
 * unfinished sprint others are in. Someone alone in a workspace can leave only by deleting it,
 * and says so (`delete_workspace: true`).
 */
workspaces.post('/api/workspaces/:workspaceId/leave', async (c) => {
  const m = await requireMember(c, config(c.env), c.env.DB, c.req.param('workspaceId'))
  const me = m.auth.account.id
  const body = await jsonBody<{ delete_workspace?: boolean }>(c)
  const refuse = (s: Standing) => {
    if (s.facilitating.length)
      throw new AppError(409, 'facilitating', `hand ${s.facilitating.map((f) => f.name).join(', ')} to another facilitator first`, { sprints: s.facilitating })
    if (s.last_owner) throw new AppError(409, 'last_owner', 'make someone else an owner first')
  }
  const [s] = await standing(c.env.DB, me, m.workspaceId)
  if (!s) throw notFound()
  refuse(s)
  const liveSprints = await openSprints(c.env.DB, me, m.workspaceId)
  if (s.sole) {
    if (body.delete_workspace !== true) throw new AppError(409, 'sole_member', 'you’re the only one here, so leaving deletes the workspace')
    const rooms = await retroRooms(c.env.DB, { workspaceIds: [m.workspaceId] })
    const res = await batch(c.env.DB, deleteWorkspaces([m.workspaceId], me))
    if (!res[res.length - 1].meta.changes) throw new AppError(409, 'not_alone', 'someone just joined — leave again to see what that means')
    await Promise.all(rooms.map((id) => forgetRoom(c.env, id)))
  } else {
    const [done] = await batch(c.env.DB, revokeMembership(m.workspaceId, me, me, 'membership.left'))
    if (!done.meta.changes) {
      // It checks again as it happens: a handover to them, or the other owner leaving, since.
      const [now] = await standing(c.env.DB, me, m.workspaceId)
      if (now) refuse(now)
      throw new AppError(409, 'last_owner', 'make someone else an owner first')
    }
  }
  await Promise.all(liveSprints.map((id) => revokeLive(c.env, id, me)))
  return c.json({ ok: true, deleted: s.sole })
})

workspaces.patch('/api/workspaces/:workspaceId/members/:accountId', async (c) => {
  const m = await requireMember(c, config(c.env), c.env.DB, c.req.param('workspaceId'))
  requireOwner(m)
  const body = await jsonBody<{ role?: string }>(c)
  if (body.role !== 'owner' && body.role !== 'member') throw bad('role must be owner or member')
  const target = c.req.param('accountId')
  // One statement decides: an owner becomes a member only while another owner stays, so two owners
  // demoting each other at the same moment can't leave the workspace with none.
  const r = await run(
    c.env.DB,
    `UPDATE memberships SET role = ? WHERE workspace_id = ? AND account_id = ? AND revoked_at IS NULL
       AND (? = 'owner' OR role <> 'owner' OR EXISTS (SELECT 1 FROM memberships o WHERE o.workspace_id = memberships.workspace_id AND o.account_id <> memberships.account_id AND o.role = 'owner' AND o.revoked_at IS NULL))`,
    body.role, m.workspaceId, target, body.role,
  )
  if (!r.meta.changes && body.role === 'member' && (await count(c.env.DB, "SELECT count(*) AS n FROM memberships WHERE workspace_id = ? AND account_id = ? AND role = 'owner' AND revoked_at IS NULL", m.workspaceId, target)))
    throw conflict('a workspace needs at least one owner')
  return c.json({ ok: true })
})

workspaces.get('/api/workspaces/:workspaceId/audit', async (c) => {
  const m = await requireMember(c, config(c.env), c.env.DB, c.req.param('workspaceId'))
  requireOwner(m)
  const rows = await all<{ id: number; sprint_id: string | null; actor_id: string | null; actor_name: string | null; action: string; meta: string; created_at: number }>(c.env.DB, 'SELECT e.id, e.sprint_id, e.actor_id, a.display_name AS actor_name, e.action, e.meta, e.created_at FROM audit_events e LEFT JOIN accounts a ON a.id = e.actor_id WHERE e.workspace_id = ? ORDER BY e.id DESC LIMIT 200', m.workspaceId)
  // An actor whose account no longer exists is a person who deleted it, never Muni itself.
  return c.json(rows.map((r) => ({ id: r.id, sprint_id: r.sprint_id, actor_name: r.actor_name, actor_gone: r.actor_id !== null && r.actor_name === null, action: r.action, meta: JSON.parse(r.meta || '{}'), created_at: new Date(r.created_at).toISOString() })))
})
