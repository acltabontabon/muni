/**
 * Shared team invitations: the invite QR (docs/PASSKEYS.md §5).
 *
 * A join link is a normal HTTPS URL with an opaque 256-bit token in its fragment
 * (`/join#<token>`), so the token never reaches a server log or a Referer header; it travels to
 * the API only in request bodies, and only its hash is stored. The link admits nobody by itself:
 * a signed-in person uses it to *ask* to join, and someone who manages that scope approves each
 * request. A screenshot of the QR is therefore worth a request, not a membership.
 *
 * Joining grants only the explicit role on the link ('member' — the schema allows nothing else)
 * and, for a sprint link, participation in that unfinished sprint. It never grants content keys:
 * encrypted sprints reach new participants only through the existing, reviewed key-sharing flow
 * (docs/ENCRYPTION.md §3, "late participants").
 */
import { Hono, type Context } from 'hono'
import type { HonoEnv } from '../env'
import { config } from '../lib/config'
import { checkOrigin, loadSession, readCookie, requireAuth, requireMember, sessionCookie } from '../lib/auth'
import { randomToken, sha256Hex, uuid } from '../lib/crypto'
import { all, audit, batch, count, one, run } from '../lib/db'
import { AppError, bad, conflict, forbidden, notFound } from '../lib/errors'
import { clientClass, limit } from '../lib/ratelimit'
import { canInvite } from './workspaces'

export const join = new Hono<HonoEnv>()

const HOUR = 3_600_000
export const EXPIRY_CHOICES_H = [24, 168, 720] as const
export const REQUEST_CAP_CHOICES = [10, 30, 100] as const
/** A request nobody decided on stops being approvable after this long. */
export const REQUEST_TTL_MS = 14 * 24 * HOUR

interface LinkRow {
  id: string
  workspace_id: string
  sprint_id: string | null
  role: string
  created_by: string
  max_requests: number
  request_count: number
  expires_at: number
  revoked_at: number | null
  created_at: number
}
interface RequestRow {
  id: string
  link_id: string
  workspace_id: string
  sprint_id: string | null
  account_id: string
  status: 'pending' | 'approved' | 'declined' | 'withdrawn' | 'expired'
  created_at: number
  decided_at: number | null
  decided_by: string | null
}

const iso = (n: number | null) => (n === null ? null : new Date(n).toISOString())
const tokenOf = async (c: { req: { json: () => Promise<unknown> } }) => {
  const b = (await c.req.json().catch(() => ({}))) as { token?: unknown }
  const t = typeof b.token === 'string' ? b.token.trim() : ''
  return t.length >= 20 && t.length <= 128 ? t : ''
}
async function liveLink(db: D1Database, token: string): Promise<LinkRow | null> {
  if (!token) return null
  return one<LinkRow>(db, 'SELECT * FROM join_links WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?', await sha256Hex(token), Date.now())
}

/**
 * Who may create a link for a scope, see its requests and decide them: for a sprint, that
 * sprint's facilitator while it's unfinished (as for adding participants); for the workspace,
 * owners and active facilitators (as for email invitations). Re-evaluated on every decision.
 */
async function canManage(db: D1Database, workspaceId: string, sprintId: string | null, accountId: string, role: string): Promise<boolean> {
  if (!sprintId) return canInvite(db, workspaceId, accountId, role)
  const n = await count(
    db,
    `SELECT count(*) AS n FROM sprint_participants sp JOIN sprints s ON s.id = sp.sprint_id
      WHERE sp.sprint_id = ? AND s.workspace_id = ? AND sp.account_id = ? AND sp.is_facilitator = 1 AND s.status NOT IN ('completed','archived')`,
    sprintId, workspaceId, accountId,
  )
  return n > 0
}

async function isMemberOf(db: D1Database, workspaceId: string, sprintId: string | null, accountId: string): Promise<boolean> {
  const m = await count(db, 'SELECT count(*) AS n FROM memberships WHERE workspace_id = ? AND account_id = ? AND revoked_at IS NULL', workspaceId, accountId)
  if (!m) return false
  if (!sprintId) return true
  return (await count(db, 'SELECT count(*) AS n FROM sprint_participants WHERE sprint_id = ? AND account_id = ?', sprintId, accountId)) > 0
}

async function linkView(db: D1Database, l: LinkRow) {
  const who = await one<{ display_name: string }>(db, 'SELECT display_name FROM accounts WHERE id = ?', l.created_by)
  const sp = l.sprint_id ? await one<{ name: string }>(db, 'SELECT name FROM sprints WHERE id = ?', l.sprint_id) : null
  return {
    id: l.id,
    sprint_id: l.sprint_id,
    sprint_name: sp?.name ?? null,
    role: l.role,
    created_by_name: who?.display_name ?? '',
    created_at: iso(l.created_at)!,
    expires_at: iso(l.expires_at)!,
    max_requests: l.max_requests,
    request_count: l.request_count,
  }
}

// ------------------------------------------------------------------ managers: links

join.post('/api/workspaces/:workspaceId/join-links', async (c) => {
  const cfg = config(c.env)
  const m = await requireMember(c, cfg, c.env.DB, c.req.param('workspaceId'))
  const body = (await c.req.json().catch(() => ({}))) as { sprint_id?: unknown; expires_in_hours?: unknown; max_requests?: unknown; replace?: unknown }
  const sprintId = typeof body.sprint_id === 'string' && body.sprint_id ? body.sprint_id : null
  const hours = Number(body.expires_in_hours ?? 168)
  const cap = Number(body.max_requests ?? 30)
  if (!(EXPIRY_CHOICES_H as readonly number[]).includes(hours)) throw bad('choose an expiry of 24 hours, 7 days or 30 days')
  if (!(REQUEST_CAP_CHOICES as readonly number[]).includes(cap)) throw bad('choose a request limit of 10, 30 or 100')
  if (sprintId) {
    const sp = await one<{ status: string }>(c.env.DB, 'SELECT status FROM sprints WHERE id = ? AND workspace_id = ?', sprintId, m.workspaceId)
    if (!sp) throw notFound('sprint not found')
    if (['completed', 'archived'].includes(sp.status)) throw conflict('this sprint is finished')
  }
  if (!(await canManage(c.env.DB, m.workspaceId, sprintId, m.auth.account.id, m.role)))
    throw forbidden(sprintId ? 'only this sprint’s facilitator can invite people to it' : 'only owners and facilitators can invite')
  await limit(c.env.DB, `join-link:${m.workspaceId}`, 30, 24 * HOUR)
  const now = Date.now()
  const active = await one<LinkRow>(c.env.DB, 'SELECT * FROM join_links WHERE workspace_id = ? AND sprint_id IS ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1', m.workspaceId, sprintId, now)
  // Only a fingerprint of each link is kept, so an existing one can't be shown again: replacing it
  // is explicit, and turns the old one off (its pending requests stay for someone to decide).
  if (active && body.replace !== true) throw new AppError(409, 'link_exists', 'an invite link is already active here — replace it to show a new QR', { link: await linkView(c.env.DB, active) })
  const token = randomToken(32)
  const id = uuid()
  const stmts: [string, ...unknown[]][] = []
  if (active) stmts.push(['UPDATE join_links SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', now, active.id])
  stmts.push([
    'INSERT INTO join_links (id, workspace_id, sprint_id, token_hash, role, created_by, max_requests, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    id, m.workspaceId, sprintId, await sha256Hex(token), 'member', m.auth.account.id, cap, now + hours * HOUR, now,
  ])
  await batch(c.env.DB, stmts)
  await audit(c.env.DB, m.workspaceId, sprintId, m.auth.account.id, 'join_link.created', { link_id: id, replaced: active?.id ?? null })
  const link = (await one<LinkRow>(c.env.DB, 'SELECT * FROM join_links WHERE id = ?', id))!
  // The only time the token leaves the server. It goes in the fragment: never sent in requests.
  return c.json({ link: await linkView(c.env.DB, link), url: `${cfg.publicOrigin}/join#${token}` })
})

join.get('/api/workspaces/:workspaceId/join-links', async (c) => {
  const m = await requireMember(c, config(c.env), c.env.DB, c.req.param('workspaceId'))
  const rows = await all<LinkRow>(c.env.DB, 'SELECT * FROM join_links WHERE workspace_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 50', m.workspaceId, Date.now())
  const out = []
  for (const l of rows) if (await canManage(c.env.DB, m.workspaceId, l.sprint_id, m.auth.account.id, m.role)) out.push(await linkView(c.env.DB, l))
  return c.json(out)
})

/** Turn a link off: nobody new can ask with it. Requests already made stay until decided. */
join.delete('/api/workspaces/:workspaceId/join-links/:linkId', async (c) => {
  const m = await requireMember(c, config(c.env), c.env.DB, c.req.param('workspaceId'))
  const l = await one<LinkRow>(c.env.DB, 'SELECT * FROM join_links WHERE id = ? AND workspace_id = ?', c.req.param('linkId'), m.workspaceId)
  if (!l) throw notFound('invite link not found')
  if (!(await canManage(c.env.DB, m.workspaceId, l.sprint_id, m.auth.account.id, m.role))) throw forbidden('you can’t manage this invite link')
  const r = await run(c.env.DB, 'UPDATE join_links SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', Date.now(), l.id)
  if (r.meta.changes) await audit(c.env.DB, m.workspaceId, l.sprint_id, m.auth.account.id, 'join_link.revoked', { link_id: l.id })
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ people who scanned

/**
 * What the join page may show. Without a session: only whether the link works. With one: the
 * workspace's name (so the person knows what they're asking for) and their own standing. Never
 * members, sprints' contents, or who made the link.
 */
join.post('/api/join/preview', async (c) => {
  const cfg = config(c.env)
  checkOrigin(c.req.raw, cfg)
  await limit(c.env.DB, `join-preview:${await sha256Hex(clientClass(c.req.raw))}`, 60, 10 * 60_000)
  const session = await loadSession(c.env.DB, readCookie(c.req.raw, sessionCookie(cfg)))
  const link = await liveLink(c.env.DB, await tokenOf(c))
  if (!link) return c.json({ valid: false, signed_in: !!session })
  const base = { valid: true, signed_in: !!session, includes_sprint: !!link.sprint_id }
  if (!session) return c.json(base)
  const aid = session.auth.account.id
  const ws = await one<{ name: string }>(c.env.DB, 'SELECT name FROM workspaces WHERE id = ?', link.workspace_id)
  if (await isMemberOf(c.env.DB, link.workspace_id, link.sprint_id, aid)) return c.json({ ...base, workspace_name: ws?.name ?? '', state: 'member', workspace_id: link.workspace_id, sprint_id: link.sprint_id })
  const mine = await one<{ id: string }>(c.env.DB, "SELECT id FROM join_requests WHERE workspace_id = ? AND account_id = ? AND status = 'pending' AND created_at > ?", link.workspace_id, aid, Date.now() - REQUEST_TTL_MS)
  if (mine) return c.json({ ...base, workspace_name: ws?.name ?? '', state: 'pending', request_id: mine.id })
  return c.json({ ...base, workspace_name: ws?.name ?? '', state: link.request_count >= link.max_requests ? 'full' : 'none' })
})

/** Ask to join. Idempotent: one open request per person per workspace, however many tabs or scans. */
join.post('/api/join/request', async (c) => {
  const cfg = config(c.env)
  const a = await requireAuth(c, cfg, c.env.DB)
  await limit(c.env.DB, `join-req:${a.account.id}`, 20, HOUR)
  const link = await liveLink(c.env.DB, await tokenOf(c))
  if (!link) throw new AppError(410, 'link_invalid', 'this invite code has expired or been turned off — ask for a new one')
  // Managers see this name next to the verified email address, so it's chosen first.
  const named = await one<{ ok: number }>(c.env.DB, "SELECT (name_set_at IS NOT NULL AND trim(display_name) <> '') AS ok FROM accounts WHERE id = ?", a.account.id)
  if (!named?.ok) throw new AppError(409, 'name_required', 'choose the name your teammates will see first')
  if (await isMemberOf(c.env.DB, link.workspace_id, link.sprint_id, a.account.id)) return c.json({ state: 'member', workspace_id: link.workspace_id, sprint_id: link.sprint_id })
  const now = Date.now()
  const existing = await one<{ id: string }>(c.env.DB, "SELECT id FROM join_requests WHERE workspace_id = ? AND account_id = ? AND status = 'pending' AND created_at > ?", link.workspace_id, a.account.id, now - REQUEST_TTL_MS)
  if (existing) return c.json({ state: 'pending', request_id: existing.id })
  // A stale open request (never decided) no longer blocks a new one.
  await run(c.env.DB, "UPDATE join_requests SET status = 'expired' WHERE workspace_id = ? AND account_id = ? AND status = 'pending' AND created_at <= ?", link.workspace_id, a.account.id, now - REQUEST_TTL_MS)
  const id = uuid()
  // One transaction: the request exists only if the link was live and under its cap, and the count
  // moves only if the request was created. The partial unique index absorbs a concurrent duplicate.
  await batch(c.env.DB, [
    [
      `INSERT INTO join_requests (id, link_id, workspace_id, sprint_id, account_id, status, created_at)
       SELECT ?, id, workspace_id, sprint_id, ?, 'pending', ? FROM join_links
        WHERE id = ? AND revoked_at IS NULL AND expires_at > ? AND request_count < max_requests
       ON CONFLICT DO NOTHING`,
      id, a.account.id, now, link.id, now,
    ],
    ['UPDATE join_links SET request_count = request_count + 1 WHERE id = ? AND EXISTS (SELECT 1 FROM join_requests WHERE id = ?)', link.id, id],
  ])
  const made = await one<{ id: string }>(c.env.DB, 'SELECT id FROM join_requests WHERE id = ?', id)
  if (made) {
    await audit(c.env.DB, link.workspace_id, link.sprint_id, a.account.id, 'join_request.created', { request_id: id, link_id: link.id })
    return c.json({ state: 'pending', request_id: id })
  }
  const raced = await one<{ id: string }>(c.env.DB, "SELECT id FROM join_requests WHERE workspace_id = ? AND account_id = ? AND status = 'pending'", link.workspace_id, a.account.id)
  if (raced) return c.json({ state: 'pending', request_id: raced.id })
  throw new AppError(409, 'link_full', 'this invite code has reached its limit — ask for a new one')
})

/** The requester's own view of their request (bounded status checks from the waiting page). */
join.get('/api/join-requests/:requestId', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  const r = await one<RequestRow & { workspace_name: string }>(
    c.env.DB,
    'SELECT r.*, w.name AS workspace_name FROM join_requests r JOIN workspaces w ON w.id = r.workspace_id WHERE r.id = ? AND r.account_id = ?',
    c.req.param('requestId'), a.account.id,
  )
  if (!r) throw notFound('request not found')
  const status = r.status === 'pending' && r.created_at <= Date.now() - REQUEST_TTL_MS ? 'expired' : r.status
  // Where to go now, only while access actually exists (membership may have been removed since).
  const member = status === 'approved' && (await isMemberOf(c.env.DB, r.workspace_id, null, a.account.id))
  const inSprint = member && !!r.sprint_id && (await isMemberOf(c.env.DB, r.workspace_id, r.sprint_id, a.account.id))
  return c.json({
    id: r.id,
    status,
    workspace_name: r.workspace_name,
    created_at: iso(r.created_at),
    decided_at: iso(r.decided_at),
    workspace_id: member ? r.workspace_id : null,
    sprint_id: inSprint ? r.sprint_id : null,
  })
})

join.post('/api/join-requests/:requestId/withdraw', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  const r = await run(c.env.DB, "UPDATE join_requests SET status = 'withdrawn', decided_at = ? WHERE id = ? AND account_id = ? AND status = 'pending'", Date.now(), c.req.param('requestId'), a.account.id)
  if (!r.meta.changes) {
    const cur = await one<{ status: string }>(c.env.DB, 'SELECT status FROM join_requests WHERE id = ? AND account_id = ?', c.req.param('requestId'), a.account.id)
    if (!cur) throw notFound('request not found')
    return c.json({ status: cur.status })
  }
  return c.json({ status: 'withdrawn' })
})

// ------------------------------------------------------------------ managers: requests

/**
 * Open requests the caller may decide, with the context needed to recognise someone: the name
 * they chose *and* their verified email address (every account's address was confirmed with a
 * code), how new the account is, and whether they were in this workspace before. The requester is
 * told the approver sees their email address.
 */
join.get('/api/workspaces/:workspaceId/join-requests', async (c) => {
  const m = await requireMember(c, config(c.env), c.env.DB, c.req.param('workspaceId'))
  const rows = await all<RequestRow & { display_name: string; email: string; account_created_at: number; sprint_name: string | null; link_revoked: number | null; previously: number; invited: number }>(
    c.env.DB,
    `SELECT r.*, a.display_name, a.email, a.created_at AS account_created_at, s.name AS sprint_name, l.revoked_at AS link_revoked,
            (SELECT count(*) FROM memberships ms WHERE ms.workspace_id = r.workspace_id AND ms.account_id = r.account_id AND ms.revoked_at IS NOT NULL) AS previously,
            (SELECT count(*) FROM invitations i WHERE i.workspace_id = r.workspace_id AND i.email = a.email AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ?) AS invited
       FROM join_requests r JOIN accounts a ON a.id = r.account_id JOIN join_links l ON l.id = r.link_id LEFT JOIN sprints s ON s.id = r.sprint_id
      WHERE r.workspace_id = ? AND r.status = 'pending' AND r.created_at > ? ORDER BY r.created_at LIMIT 100`,
    Date.now(), m.workspaceId, Date.now() - REQUEST_TTL_MS,
  )
  const out = []
  for (const r of rows) {
    if (!(await canManage(c.env.DB, m.workspaceId, r.sprint_id, m.auth.account.id, m.role))) continue
    out.push({
      id: r.id,
      display_name: r.display_name,
      email: r.email,
      account_created_at: iso(r.account_created_at),
      requested_at: iso(r.created_at),
      sprint_id: r.sprint_id,
      sprint_name: r.sprint_name,
      previously_member: r.previously > 0,
      matches_email_invitation: r.invited > 0,
      link_turned_off: r.link_revoked !== null,
    })
  }
  return c.json(out)
})

type DecideCtx = Context<HonoEnv, '/api/workspaces/:workspaceId/join-requests/:requestId/approve' | '/api/workspaces/:workspaceId/join-requests/:requestId/decline'>
async function decide(c: DecideCtx, verdict: 'approved' | 'declined') {
  const m = await requireMember(c, config(c.env), c.env.DB, c.req.param('workspaceId'))
  const req = await one<RequestRow>(c.env.DB, 'SELECT * FROM join_requests WHERE id = ? AND workspace_id = ?', c.req.param('requestId'), m.workspaceId)
  if (!req) throw notFound('request not found')
  if (!(await canManage(c.env.DB, m.workspaceId, req.sprint_id, m.auth.account.id, m.role))) throw forbidden('you can’t decide requests for this invite')
  if (req.account_id === m.auth.account.id) throw forbidden('someone else has to decide your own request')
  const now = Date.now()
  // Only this batch's own decision (matched by decider and instant) adds anyone, in one transaction:
  // of two managers or tabs acting at once, one decides and the other sees the result.
  const mine = 'EXISTS (SELECT 1 FROM join_requests WHERE id = ? AND status = ? AND decided_by = ? AND decided_at = ?)'
  const tag = [req.id, verdict, m.auth.account.id, now]
  const stmts: [string, ...unknown[]][] = [
    ["UPDATE join_requests SET status = ?, decided_at = ?, decided_by = ? WHERE id = ? AND status = 'pending' AND created_at > ?", verdict, now, m.auth.account.id, req.id, now - REQUEST_TTL_MS],
  ]
  if (verdict === 'approved') {
    stmts.push(
      // The role is the link's ('member'): never an owner, and a returning member doesn't get an old role back.
      [
        `INSERT INTO memberships (workspace_id, account_id, role, created_at) SELECT ?, ?, 'member', ? WHERE ${mine}
         ON CONFLICT(workspace_id, account_id) DO UPDATE SET role = CASE WHEN memberships.revoked_at IS NULL THEN memberships.role ELSE 'member' END, revoked_at = NULL`,
        req.workspace_id, req.account_id, now, ...tag,
      ],
      [`INSERT OR IGNORE INTO sprint_participants (sprint_id, account_id, is_facilitator, created_at) SELECT id, ?, 0, ? FROM sprints WHERE id = ? AND status NOT IN ('completed','archived') AND ${mine}`, req.account_id, now, req.sprint_id, ...tag],
    )
  }
  stmts.push([`INSERT INTO audit_events (workspace_id, sprint_id, actor_id, action, meta, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE ${mine}`, req.workspace_id, req.sprint_id, m.auth.account.id, `join_request.${verdict}`, JSON.stringify({ request_id: req.id, account_id: req.account_id }), now, ...tag])
  const res = await batch(c.env.DB, stmts)
  if (res[0].meta.changes) return c.json({ status: verdict })
  const cur = (await one<RequestRow>(c.env.DB, 'SELECT * FROM join_requests WHERE id = ?', req.id))!
  if (cur.status === verdict) return c.json({ status: verdict }) // already done (another tab, or a double click)
  const status = cur.status === 'pending' ? 'expired' : cur.status
  throw new AppError(409, 'request_closed', status === 'withdrawn' ? 'they withdrew this request' : status === 'expired' ? 'this request expired' : `this request was already ${status}`, { status })
}

join.post('/api/workspaces/:workspaceId/join-requests/:requestId/approve', (c) => decide(c, 'approved'))
join.post('/api/workspaces/:workspaceId/join-requests/:requestId/decline', (c) => decide(c, 'declined'))
