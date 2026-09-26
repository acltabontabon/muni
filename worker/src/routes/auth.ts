import { Hono } from 'hono'
import type { HonoEnv } from '../env'
import { config } from '../lib/config'
import { CODE_TTL_MS, RECENT_AUTH_MS, clearSessionCookies, clientLabel, createSession, loadSession, readCookie, requireAuth, revokeSession, securityEvent, sessionCookie, setSessionCookies, checkOrigin, type Auth } from '../lib/auth'
import { constantTimeEqual, randomCode, sha256Hex, uuid } from '../lib/crypto'
import { all, batch, one, run } from '../lib/db'
import { AppError, bad, quota } from '../lib/errors'
import { sendMail, templates } from '../lib/email'
import { clientClass, limit } from '../lib/ratelimit'
import { maskEmail, nonempty, normalizeEmail } from '../lib/util'

export const auth = new Hono<HonoEnv>()

/** `session` is the one asking (absent right after a sign-in, when the new session is fresh). */
export async function buildMe(env: HonoEnv['Bindings'], accountId: string, session?: Pick<Auth, 'authMethod' | 'authenticatedAt'>, extra: { created?: boolean } = {}) {
  const cfg = config(env)
  const acct = await one<{ email: string; display_name: string; name_set_at: number | null }>(env.DB, 'SELECT email, display_name, name_set_at FROM accounts WHERE id = ?', accountId)
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
    email: acct?.email ?? '',
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

const DAY_MS = 86_400_000
/** A new code can be sent once this long after the last one for the same address. */
export const RESEND_COOLDOWN_MS = 30_000
const codeHash = (code: string, challengeId: string) => sha256Hex(`${code}:${challengeId}`)

/** Request a one-time sign-in code by email. Never reveals whether an account exists. */
auth.post('/api/auth/request-code', async (c) => {
  const cfg = config(c.env)
  checkOrigin(c.req.raw, cfg)
  const body = (await c.req.json().catch(() => ({}))) as { email?: string }
  const email = normalizeEmail(body.email ?? '')
  if (!email) throw bad('enter a valid email address')
  // A short cooldown between codes for one address (the same for every address, account or not).
  const last = await one<{ created_at: number }>(c.env.DB, 'SELECT created_at FROM verification_challenges WHERE email = ? ORDER BY created_at DESC LIMIT 1', email)
  if (last && Date.now() - last.created_at < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((last.created_at + RESEND_COOLDOWN_MS - Date.now()) / 1000)
    throw new AppError(429, 'resend_cooldown', `a code was just sent — you can ask for another in ${wait} seconds`, { retry_after_seconds: wait })
  }
  // Buckets hold hashes, so the limiter table never stores an address or an IP in the clear.
  const who = await sha256Hex(email)
  const net = await sha256Hex(clientClass(c.req.raw))
  await limit(c.env.DB, `code:${who}`, 5, 15 * 60_000)
  await limit(c.env.DB, `code-ip:${net}`, 120, 10 * 60_000)
  await limit(c.env.DB, `code-ip-day:${net}`, cfg.signinCodesPerNetworkDaily, DAY_MS)
  await limit(c.env.DB, 'code-all', cfg.signinEmailsDailyLimit, DAY_MS, () =>
    quota('Muni has sent all the sign-in emails it can for today. Please try again tomorrow; devices that are already signed in keep working.'),
  )
  const code = randomCode()
  const id = uuid()
  await run(c.env.DB, 'INSERT INTO verification_challenges (id, email, code_hash, expires_at, created_at) VALUES (?,?,?,?,?)', id, email, await codeHash(code, id), Date.now() + CODE_TTL_MS, Date.now())
  // Sent inline so sign-in is immediate; provider errors are reported honestly.
  await sendMail(cfg, c.env.DB, templates.signInCode(email, code))
  // The same answer whether or not an account exists for this address.
  return c.json({ sent: true, expires_in_minutes: CODE_TTL_MS / 60_000, resend_after_seconds: RESEND_COOLDOWN_MS / 1000 })
})

/**
 * Exchange a code for a session. Consumes the code; bounded attempts; rotates any presented session.
 * Sign-in and sign-up are one step: a verified address without an account gets one, with no name
 * (never inferred from the address). `needs_name` in the answer tells the client to ask for one.
 */
auth.post('/api/auth/verify', async (c) => {
  const cfg = config(c.env)
  checkOrigin(c.req.raw, cfg)
  const body = (await c.req.json().catch(() => ({}))) as { email?: string; code?: string; reauth?: boolean; installed?: boolean }
  const email = normalizeEmail(body.email ?? '')
  if (!email) throw bad('enter a valid email address')
  await limit(c.env.DB, `verify:${await sha256Hex(email)}`, 10, 15 * 60_000)
  const old = await loadSession(c.env.DB, readCookie(c.req.raw, sessionCookie(cfg)))
  // Confirming it's you (step-up) must stay on the same account: checked before the code is spent.
  if (body.reauth === true && (!old || old.auth.account.email !== email)) throw new AppError(403, 'account_mismatch', 'use the email address of the account you’re signed in to')
  const code = (body.code ?? '').replace(/\D/g, '')
  if (code.length !== 6) throw new AppError(400, 'code_format', 'the code is six digits')
  const ch = await one<{ id: string; code_hash: string; attempts: number; max_attempts: number; consumed_at: number | null; expires_at: number }>(
    c.env.DB,
    'SELECT id, code_hash, attempts, max_attempts, consumed_at, expires_at FROM verification_challenges WHERE email = ? ORDER BY created_at DESC LIMIT 1',
    email,
  )
  if (!ch || ch.expires_at <= Date.now()) throw new AppError(400, 'code_expired', 'that code has expired — send a new one')
  if (ch.consumed_at) throw new AppError(400, 'code_used', 'that code was already used — send a new one')
  if (ch.attempts >= ch.max_attempts) throw new AppError(400, 'code_locked', 'too many wrong tries for this code — send a new one')
  if (!constantTimeEqual(ch.code_hash, await codeHash(code, ch.id))) {
    await run(c.env.DB, 'UPDATE verification_challenges SET attempts = attempts + 1 WHERE id = ?', ch.id)
    const left = ch.max_attempts - ch.attempts - 1
    if (left <= 0) throw new AppError(400, 'code_locked', 'that code doesn’t match, and it can’t be tried again — send a new one')
    throw new AppError(400, 'code_mismatch', 'that code doesn’t match', { attempts_left: left })
  }
  // Consume exactly once: the conditional update wins for a single concurrent verifier.
  const consumed = await run(c.env.DB, 'UPDATE verification_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL', Date.now(), ch.id)
  if (!consumed.meta.changes) throw new AppError(400, 'code_used', 'that code was already used — send a new one')
  // One account per address, even if two verifications race. `created` tells the client (only
  // after the code proved control of the mailbox) whether this is a new account, so someone who
  // meant to sign in to an existing one with a different address notices before joining a team.
  const inserted = await run(c.env.DB, "INSERT INTO accounts (id, email, display_name, created_at) VALUES (?,?,'',?) ON CONFLICT(email) DO NOTHING", uuid(), email, Date.now())
  const account = (await one<{ id: string }>(c.env.DB, 'SELECT id FROM accounts WHERE email = ?', email))!
  // Rotation: whatever session was presented ends; the new one has a fresh token.
  if (old) await revokeSession(c.env.DB, old.auth.sessionId)
  const session = await createSession(c.env.DB, account.id, cfg.sessionTtlDays, { method: 'email', clientLabel: clientLabel(c.req.raw, body.installed === true) })
  setSessionCookies(c, cfg, session)
  await securityEvent(c.env.DB, account.id, body.reauth === true ? 'reauth.email' : 'signin.email')
  return c.json(await buildMe(c.env, account.id, undefined, { created: !!inserted.meta.changes }))
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
  if (!inv) return c.json({ valid: false, email_hint: null, workspace_name: null, matches_session: false, signed_in: !!session })
  const matches = session?.auth.account.email === inv.email
  return c.json({ valid: true, email_hint: maskEmail(inv.email), workspace_name: matches ? inv.workspace_name : null, matches_session: matches, signed_in: !!session })
})

/** Accept with a session whose verified email matches. Single use under concurrency. */
auth.post('/api/invitations/accept', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  const inv = await liveInvite(c.env.DB, await bodyToken(c))
  if (!inv) return c.json({ error: 'this invitation is no longer valid', code: 'not_found' }, 404)
  if (inv.email !== a.account.email) {
    return c.json({ error: `this invitation was sent to ${maskEmail(inv.email)} — sign in with that address to accept it`, code: 'forbidden' }, 403)
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
