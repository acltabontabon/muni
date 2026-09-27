import { Hono } from 'hono'
import type { HonoEnv } from '../env'
import { config } from '../lib/config'
import { RECENT_AUTH_MS, clearSessionCookies, clientLabel, createSession, loadSession, readCookie, requireAuth, revokeSession, securityEvent, sessionCookie, setSessionCookies, checkOrigin, type Auth } from '../lib/auth'
import { sha256Hex } from '../lib/crypto'
import { all, batch, one, run } from '../lib/db'
import { AppError, bad } from '../lib/errors'
import { clientClass, limit } from '../lib/ratelimit'
import { maskEmail, nonempty, normalizeEmail } from '../lib/util'
import { accountByEmail, emailOf, setAccountEmail } from '../lib/accounts'
import { issueCode, spendCode } from '../lib/codes'

export { RESEND_COOLDOWN_MS } from '../lib/codes'

export const auth = new Hono<HonoEnv>()

/** `session` is the one asking (absent right after a sign-in, when the new session is fresh). */
export async function buildMe(env: HonoEnv['Bindings'], accountId: string, session?: Pick<Auth, 'authMethod' | 'authenticatedAt'>, extra: { created?: boolean } = {}) {
  const cfg = config(env)
  const acct = await one<{ display_name: string; name_set_at: number | null }>(env.DB, 'SELECT display_name, name_set_at FROM accounts WHERE id = ?', accountId)
  const email = await emailOf(env.DB, accountId)
  const rows = await all<{ id: string; name: string; role: string; is_demo: number }>(
    env.DB,
    'SELECT w.id, w.name, m.role, w.is_demo FROM memberships m JOIN workspaces w ON w.id = m.workspace_id WHERE m.account_id = ? AND m.revoked_at IS NULL ORDER BY w.created_at',
    accountId,
  )
  const exp = await one<{ e: number }>(env.DB, 'SELECT COALESCE(MAX(expires_at), ?) AS e FROM sessions WHERE account_id = ? AND revoked_at IS NULL', Date.now(), accountId)
  const passkeys = await one<{ n: number }>(env.DB, 'SELECT count(*) AS n FROM webauthn_credentials WHERE account_id = ?', accountId)
  const pending = await all<{ id: string; workspace_name: string; created_at: number }>(
    env.DB,
    "SELECT r.id, w.name AS workspace_name, r.created_at FROM join_requests r JOIN workspaces w ON w.id = r.workspace_id WHERE r.account_id = ? AND r.status = 'pending' ORDER BY r.created_at DESC LIMIT 10",
    accountId,
  )
  const authedAt = session?.authenticatedAt ?? Date.now()
  return {
    account_id: accountId,
    /** Optional and verified: recovery, email invitations, reminders. Never needed to sign in. */
    email,
    display_name: acct?.display_name ?? '',
    /** No name chosen yet (a new account, or one whose name was once inferred): ask before anything else. */
    needs_name: !acct?.name_set_at || !acct.display_name.trim(),
    workspaces: rows.map((r) => ({ id: r.id, name: r.name, role: r.role, is_demo: r.is_demo === 1 })),
    session_expires_at: new Date(Number(exp?.e ?? Date.now())).toISOString(),
    email_transport: cfg.email,
    ai_provider: cfg.ai,
    passkeys: Number(passkeys?.n ?? 0),
    auth_method: session?.authMethod ?? null,
    /** Until when security-sensitive changes are allowed without signing in again. */
    recent_auth_until: new Date(authedAt + RECENT_AUTH_MS).toISOString(),
    pending_join_requests: pending.map((p) => ({ id: p.id, workspace_name: p.workspace_name, created_at: new Date(p.created_at).toISOString() })),
    ...(extra.created !== undefined ? { created: extra.created } : {}),
  }
}

/**
 * Request a one-time code for signing in to an existing account by email ("Used Muni before?").
 * Never reveals whether an account exists: the answer and the email are the same either way.
 */
auth.post('/api/auth/request-code', async (c) => {
  const cfg = config(c.env)
  checkOrigin(c.req.raw, cfg)
  const body = (await c.req.json().catch(() => ({}))) as { email?: string }
  const email = normalizeEmail(body.email ?? '')
  if (!email) throw bad('enter a valid email address')
  return c.json(await issueCode(c, cfg, email, 'signin'))
})

/**
 * Exchange a code for a session on the account that has this address. Consumes the code; bounded
 * attempts; rotates any presented session. It never creates an account: new accounts are made
 * with a passkey. Only after the code proved control of the mailbox does the answer say that no
 * account has this address.
 */
auth.post('/api/auth/verify', async (c) => {
  const cfg = config(c.env)
  checkOrigin(c.req.raw, cfg)
  const body = (await c.req.json().catch(() => ({}))) as { email?: string; code?: string; reauth?: boolean; installed?: boolean }
  const email = normalizeEmail(body.email ?? '')
  if (!email) throw bad('enter a valid email address')
  const old = await loadSession(c.env.DB, readCookie(c.req.raw, sessionCookie(cfg)))
  // Confirming it's you (step-up) must stay on the same account: checked before the code is spent.
  if (body.reauth === true && (!old || old.auth.account.email !== email)) throw new AppError(403, 'account_mismatch', 'use the email address of the account you’re signed in to')
  await spendCode(c.env.DB, email, body.code, 'signin')
  const accountId = await accountByEmail(c.env.DB, email)
  if (!accountId) throw new AppError(404, 'no_account', 'no Muni account has this address — create one with a passkey instead')
  // Rotation: whatever session was presented ends; the new one has a fresh token.
  if (old) await revokeSession(c.env.DB, old.auth.sessionId)
  const session = await createSession(c.env.DB, accountId, cfg.sessionTtlDays, { method: 'email', clientLabel: clientLabel(c.req.raw, body.installed === true) })
  setSessionCookies(c, cfg, session)
  await securityEvent(c.env.DB, accountId, body.reauth === true ? 'reauth.email' : 'signin.email')
  return c.json(await buildMe(c.env, accountId, undefined, { created: false }))
})

auth.get('/api/auth/me', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  return c.json(await buildMe(c.env, a.account.id, a))
})

auth.patch('/api/auth/me', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  const body = (await c.req.json().catch(() => ({}))) as { display_name?: string }
  const name = nonempty(body.display_name, 80, 'Name')
  await run(c.env.DB, 'UPDATE accounts SET display_name = ?, name_set_at = COALESCE(name_set_at, ?) WHERE id = ?', name, Date.now(), a.account.id)
  return c.json(await buildMe(c.env, a.account.id, a))
})

/**
 * Ends this session. Idempotent: with no live session (already revoked or expired) it still clears
 * the cookies and answers ok, so a device can always finish signing out — including one that
 * signed out locally while offline and retries later. A live session still needs CSRF.
 */
auth.post('/api/auth/logout', async (c) => {
  const cfg = config(c.env)
  checkOrigin(c.req.raw, cfg)
  const live = await loadSession(c.env.DB, readCookie(c.req.raw, sessionCookie(cfg)))
  if (live) {
    const a = await requireAuth(c, cfg, c.env.DB)
    await revokeSession(c.env.DB, a.sessionId)
  }
  clearSessionCookies(c, cfg)
  return c.json({ ok: true, ended: !!live })
})

/**
 * Ends every other session. Sessions and sign-in methods are separate: this doesn't remove any
 * passkey, and a removed passkey doesn't end sessions unless asked to (DELETE /api/auth/passkeys/:id).
 */
auth.post('/api/auth/logout-others', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  const r = await run(c.env.DB, 'UPDATE sessions SET revoked_at = ? WHERE account_id = ? AND id <> ? AND revoked_at IS NULL', Date.now(), a.account.id, a.sessionId)
  await securityEvent(c.env.DB, a.account.id, 'sessions.revoked_others', { count: r.meta.changes ?? 0 })
  return c.json({ ok: true })
})

auth.get('/api/auth/sessions', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  const rows = await all<{ id: string; created_at: number; last_seen_at: number; auth_method: string; client_label: string | null; expires_at: number; passkey_name: string | null }>(
    c.env.DB,
    `SELECT s.id, s.created_at, s.last_seen_at, s.auth_method, s.client_label, s.expires_at, k.name AS passkey_name
       FROM sessions s LEFT JOIN webauthn_credentials k ON k.id = s.credential_ref
      WHERE s.account_id = ? AND s.revoked_at IS NULL AND s.expires_at > ? ORDER BY s.last_seen_at DESC`,
    a.account.id,
    Date.now(),
  )
  return c.json(
    rows.map((r) => ({
      id: r.id,
      current: r.id === a.sessionId,
      created_at: new Date(r.created_at).toISOString(),
      last_seen_at: new Date(r.last_seen_at).toISOString(),
      expires_at: new Date(r.expires_at).toISOString(),
      method: r.auth_method,
      label: r.client_label,
      passkey_name: r.passkey_name,
    })),
  )
})

/** Sign out one other session. Your current one ends with POST /api/auth/logout. */
auth.delete('/api/auth/sessions/:sessionId', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  const id = c.req.param('sessionId')
  if (id === a.sessionId) throw bad('to end this session, sign out')
  const r = await run(c.env.DB, 'UPDATE sessions SET revoked_at = ? WHERE id = ? AND account_id = ? AND revoked_at IS NULL', Date.now(), id, a.account.id)
  if (r.meta.changes) await securityEvent(c.env.DB, a.account.id, 'session.revoked')
  return c.json({ ok: true })
})

auth.get('/api/auth/security-events', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  const rows = await all<{ id: number; kind: string; meta: string; created_at: number }>(c.env.DB, 'SELECT id, kind, meta, created_at FROM security_events WHERE account_id = ? ORDER BY id DESC LIMIT 20', a.account.id)
  return c.json(rows.map((r) => ({ id: r.id, kind: r.kind, meta: JSON.parse(r.meta || '{}'), created_at: new Date(r.created_at).toISOString() })))
})

// ---------- invitations ----------
interface InviteRow {
  id: string
  workspace_id: string
  email: string
  sprint_id: string | null
  workspace_name: string
}
async function liveInvite(db: D1Database, token: string): Promise<InviteRow | null> {
  if (!token || token.length > 128) return null
  return one<InviteRow>(
    db,
    `SELECT i.id, i.workspace_id, i.email, i.sprint_id, w.name AS workspace_name FROM invitations i JOIN workspaces w ON w.id = i.workspace_id
     WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ?`,
    await sha256Hex(token),
    Date.now(),
  )
}

/**
 * Invitation tokens travel in request bodies, never in URLs: the emailed link carries the token in
 * the fragment (`/invite#<token>`), which browsers don't send, and these endpoints read it from JSON.
 * URLs end up in platform request logs; bodies don't.
 */
const bodyToken = async (c: { req: { json: () => Promise<unknown> } }) => {
  const b = (await c.req.json().catch(() => ({}))) as { token?: unknown }
  return typeof b.token === 'string' ? b.token.trim() : ''
}

/** Preview: safe without a session; reveals only a masked address. The workspace name appears only to the intended recipient. */
auth.post('/api/invitations/preview', async (c) => {
  const cfg = config(c.env)
  checkOrigin(c.req.raw, cfg)
  await limit(c.env.DB, `invite-preview:${await sha256Hex(clientClass(c.req.raw))}`, 60, 10 * 60_000)
  const session = await loadSession(c.env.DB, readCookie(c.req.raw, sessionCookie(cfg)))
  const inv = await liveInvite(c.env.DB, await bodyToken(c))
  if (!inv) return c.json({ valid: false, email_hint: null, workspace_name: null, matches_session: false, signed_in: !!session, can_confirm: false })
  const mine = session?.auth.account.email ?? null
  const matches = mine === inv.email
  // A signed-in account without an address can confirm the invited one by code (and keep it).
  return c.json({ valid: true, email_hint: maskEmail(inv.email), workspace_name: matches ? inv.workspace_name : null, matches_session: matches, signed_in: !!session, can_confirm: !!session && !matches && mine === null })
})

/**
 * Send a code to the invited address so a signed-in account without an address can prove it
 * controls that mailbox. The link alone proves nothing (links get forwarded).
 */
auth.post('/api/invitations/confirm', async (c) => {
  const cfg = config(c.env)
  const a = await requireAuth(c, cfg, c.env.DB)
  const inv = await liveInvite(c.env.DB, await bodyToken(c))
  if (!inv) return c.json({ error: 'this invitation is no longer valid', code: 'not_found' }, 404)
  if (a.account.email === inv.email) return c.json({ sent: false, matches: true })
  if (a.account.email) throw new AppError(403, 'forbidden', `this invitation was sent to ${maskEmail(inv.email)} — sign in to the account with that address to accept it`)
  return c.json(await issueCode(c, cfg, inv.email, 'invite', a.account.id))
})

/**
 * Accept with a session whose verified address matches — or, for an account with no address, a
 * code sent to the invited address (which is then kept as the account's verified address). If
 * that address already belongs to another account, the person is sent there instead of ending up
 * with two identities. Single use under concurrency.
 */
auth.post('/api/invitations/accept', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  const body = (await c.req.json().catch(() => ({}))) as { token?: unknown; code?: unknown }
  const inv = await liveInvite(c.env.DB, typeof body.token === 'string' ? body.token.trim() : '')
  if (!inv) return c.json({ error: 'this invitation is no longer valid', code: 'not_found' }, 404)
  if (inv.email !== a.account.email) {
    if (a.account.email || body.code === undefined)
      return c.json({ error: `this invitation was sent to ${maskEmail(inv.email)} — ${a.account.email ? 'sign in with the account that has that address' : 'confirm that address with a code'} to accept it`, code: a.account.email ? 'forbidden' : 'confirm_email' }, 403)
    await spendCode(c.env.DB, inv.email, body.code, 'invite', a.account.id)
    const owner = await accountByEmail(c.env.DB, inv.email)
    if (owner && owner !== a.account.id)
      return c.json({ error: 'that address belongs to another Muni account — sign in to it with “Used Muni before?”, then open this invitation again', code: 'email_other_account' }, 409)
    if (!(await setAccountEmail(c.env.DB, a.account.id, inv.email))) return c.json({ error: 'that address belongs to another Muni account', code: 'email_other_account' }, 409)
    await securityEvent(c.env.DB, a.account.id, 'email.added', { via: 'invitation' })
  }
  // Teammates see the name of whoever joins, so it's chosen before joining (never inferred).
  const named = await one<{ ok: number }>(c.env.DB, "SELECT (name_set_at IS NOT NULL AND trim(display_name) <> '') AS ok FROM accounts WHERE id = ?", a.account.id)
  if (!named?.ok) return c.json({ error: 'choose the name your teammates will see first', code: 'name_required' }, 409)
  const claimed = await run(c.env.DB, 'UPDATE invitations SET accepted_at = ?, accepted_by = ? WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?', Date.now(), a.account.id, inv.id, Date.now())
  if (!claimed.meta.changes) return c.json({ error: 'this invitation was already used', code: 'conflict' }, 409)
  const stmts: [string, ...unknown[]][] = [
    // A returning (previously removed) member comes back as a member: an old role is never restored by an invitation.
    [
      `INSERT INTO memberships (workspace_id, account_id, role, created_at) VALUES (?,?,?,?)
       ON CONFLICT(workspace_id, account_id) DO UPDATE SET role = CASE WHEN memberships.revoked_at IS NULL THEN memberships.role ELSE 'member' END, revoked_at = NULL`,
      inv.workspace_id, a.account.id, 'member', Date.now(),
    ],
    ['INSERT INTO audit_events (workspace_id, actor_id, action, meta, created_at) VALUES (?,?,?,?,?)', inv.workspace_id, a.account.id, 'invitation.accepted', JSON.stringify({ invitation_id: inv.id }), Date.now()],
  ]
  if (inv.sprint_id) stmts.push(['INSERT OR IGNORE INTO sprint_participants (sprint_id, account_id, is_facilitator, created_at) SELECT id, ?, 0, ? FROM sprints WHERE id = ? AND status NOT IN (\'completed\',\'archived\')', a.account.id, Date.now(), inv.sprint_id])
  await batch(c.env.DB, stmts)
  return c.json({ workspace_id: inv.workspace_id, sprint_id: inv.sprint_id })
})
