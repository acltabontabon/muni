import { Hono } from 'hono'
import type { HonoEnv } from '../env'
import { config } from '../lib/config'
import { CODE_TTL_MS, clearSessionCookies, createSession, loadSession, readCookie, requireAuth, revokeSession, sessionCookie, setSessionCookies, checkOrigin } from '../lib/auth'
import { constantTimeEqual, randomCode, sha256Hex, uuid } from '../lib/crypto'
import { all, batch, one, run } from '../lib/db'
import { AppError, bad, quota } from '../lib/errors'
import { sendMail, templates } from '../lib/email'
import { clientClass, limit } from '../lib/ratelimit'
import { maskEmail, nonempty, normalizeEmail } from '../lib/util'

export const auth = new Hono<HonoEnv>()

export async function buildMe(env: HonoEnv['Bindings'], accountId: string) {
  const cfg = config(env)
  const acct = await one<{ email: string; display_name: string; name_set_at: number | null }>(env.DB, 'SELECT email, display_name, name_set_at FROM accounts WHERE id = ?', accountId)
  const rows = await all<{ id: string; name: string; role: string; is_demo: number }>(
    env.DB,
    'SELECT w.id, w.name, m.role, w.is_demo FROM memberships m JOIN workspaces w ON w.id = m.workspace_id WHERE m.account_id = ? AND m.revoked_at IS NULL ORDER BY w.created_at',
    accountId,
  )
  const exp = await one<{ e: number }>(env.DB, 'SELECT COALESCE(MAX(expires_at), ?) AS e FROM sessions WHERE account_id = ? AND revoked_at IS NULL', Date.now(), accountId)
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
  const body = (await c.req.json().catch(() => ({}))) as { email?: string; code?: string }
  const email = normalizeEmail(body.email ?? '')
  if (!email) throw bad('enter a valid email address')
  await limit(c.env.DB, `verify:${await sha256Hex(email)}`, 10, 15 * 60_000)
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
  // One account per address, even if two verifications race.
  await run(c.env.DB, "INSERT INTO accounts (id, email, display_name, created_at) VALUES (?,?,'',?) ON CONFLICT(email) DO NOTHING", uuid(), email, Date.now())
  const account = (await one<{ id: string }>(c.env.DB, 'SELECT id FROM accounts WHERE email = ?', email))!
  const old = await loadSession(c.env.DB, readCookie(c.req.raw, sessionCookie(cfg)))
  if (old) await revokeSession(c.env.DB, old.auth.sessionId)
  const session = await createSession(c.env.DB, account.id, cfg.sessionTtlDays)
  setSessionCookies(c, cfg, session)
  return c.json(await buildMe(c.env, account.id))
})

auth.get('/api/auth/me', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  return c.json(await buildMe(c.env, a.account.id))
})

auth.patch('/api/auth/me', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  const body = (await c.req.json().catch(() => ({}))) as { display_name?: string }
  const name = nonempty(body.display_name, 80, 'Name')
  await run(c.env.DB, 'UPDATE accounts SET display_name = ?, name_set_at = COALESCE(name_set_at, ?) WHERE id = ?', name, Date.now(), a.account.id)
  return c.json(await buildMe(c.env, a.account.id))
})

auth.post('/api/auth/logout', async (c) => {
  const cfg = config(c.env)
  const a = await requireAuth(c, cfg, c.env.DB)
  await revokeSession(c.env.DB, a.sessionId)
  clearSessionCookies(c, cfg)
  return c.json({ ok: true })
})

auth.post('/api/auth/logout-others', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  await run(c.env.DB, 'UPDATE sessions SET revoked_at = ? WHERE account_id = ? AND id <> ? AND revoked_at IS NULL', Date.now(), a.account.id, a.sessionId)
  return c.json({ ok: true })
})

auth.get('/api/auth/sessions', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  const rows = await all<{ id: string; created_at: number; last_seen_at: number }>(c.env.DB, 'SELECT id, created_at, last_seen_at FROM sessions WHERE account_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC', a.account.id, Date.now())
  return c.json(rows.map((r) => ({ id: r.id, current: r.id === a.sessionId, created_at: new Date(r.created_at).toISOString(), last_seen_at: new Date(r.last_seen_at).toISOString() })))
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
