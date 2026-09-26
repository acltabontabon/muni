import { Hono } from 'hono'
import type { HonoEnv } from '../env'
import { config } from '../lib/config'
import { CODE_TTL_MS, clearSessionCookies, createSession, loadSession, readCookie, requireAuth, revokeSession, SESSION_COOKIE, setSessionCookies, checkOrigin } from '../lib/auth'
import { constantTimeEqual, randomCode, sha256Hex, uuid } from '../lib/crypto'
import { all, batch, one, run } from '../lib/db'
import { bad, quota } from '../lib/errors'
import { sendMail, templates } from '../lib/email'
import { clientClass, limit } from '../lib/ratelimit'
import { nonempty, normalizeEmail } from '../lib/util'

export const auth = new Hono<HonoEnv>()

export async function buildMe(env: HonoEnv['Bindings'], accountId: string) {
  const cfg = config(env)
  const acct = await one<{ email: string; display_name: string }>(env.DB, 'SELECT email, display_name FROM accounts WHERE id = ?', accountId)
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
    workspaces: rows.map((r) => ({ id: r.id, name: r.name, role: r.role, is_demo: r.is_demo === 1 })),
    session_expires_at: new Date(Number(exp?.e ?? Date.now())).toISOString(),
    email_transport: cfg.email,
    ai_provider: cfg.ai,
  }
}

const DAY_MS = 86_400_000
const codeHash = (code: string, challengeId: string) => sha256Hex(`${code}:${challengeId}`)

/** Request a one-time sign-in code by email. Never reveals whether an account exists. */
auth.post('/api/auth/request-code', async (c) => {
  const cfg = config(c.env)
  checkOrigin(c.req.raw, cfg)
  const body = (await c.req.json().catch(() => ({}))) as { email?: string }
  const email = normalizeEmail(body.email ?? '')
  if (!email) throw bad('enter a valid email address')
  await limit(c.env.DB, `code:${email}`, 5, 15 * 60_000)
  await limit(c.env.DB, `code-ip:${clientClass(c.req.raw)}`, 120, 10 * 60_000)
  await limit(c.env.DB, `code-ip-day:${clientClass(c.req.raw)}`, cfg.signinCodesPerNetworkDaily, DAY_MS)
  await limit(c.env.DB, 'code-all', cfg.signinEmailsDailyLimit, DAY_MS, () =>
    quota('Muni has sent all the sign-in emails it can for today. Please try again tomorrow; devices that are already signed in keep working.'),
  )
  const code = randomCode()
  const id = uuid()
  await run(c.env.DB, 'INSERT INTO verification_challenges (id, email, code_hash, expires_at, created_at) VALUES (?,?,?,?,?)', id, email, await codeHash(code, id), Date.now() + CODE_TTL_MS, Date.now())
  // Sent inline so sign-in is immediate; provider errors are reported honestly.
  await sendMail(cfg, c.env.DB, templates.signInCode(email, code))
  return c.json({ sent: true, expires_in_minutes: CODE_TTL_MS / 60_000 })
})

/** Exchange a code for a session. Consumes the code; bounded attempts; rotates any presented session. */
auth.post('/api/auth/verify', async (c) => {
  const cfg = config(c.env)
  checkOrigin(c.req.raw, cfg)
  const body = (await c.req.json().catch(() => ({}))) as { email?: string; code?: string; display_name?: string }
  const email = normalizeEmail(body.email ?? '')
  if (!email) throw bad('enter a valid email address')
  await limit(c.env.DB, `verify:${email}`, 10, 15 * 60_000)
  const code = (body.code ?? '').trim().replace(/\s/g, '')
  if (!/^\d{6}$/.test(code)) throw bad('the code is six digits')
  const ch = await one<{ id: string; code_hash: string; attempts: number; max_attempts: number }>(
    c.env.DB,
    'SELECT id, code_hash, attempts, max_attempts FROM verification_challenges WHERE email = ? AND consumed_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1',
    email,
    Date.now(),
  )
  if (!ch) throw bad('that code has expired — request a new one')
  if (ch.attempts >= ch.max_attempts) throw bad('too many wrong codes — request a new one')
  if (!constantTimeEqual(ch.code_hash, await codeHash(code, ch.id))) {
    await run(c.env.DB, 'UPDATE verification_challenges SET attempts = attempts + 1 WHERE id = ?', ch.id)
    throw bad('that code doesn’t match')
  }
  // Consume exactly once: the conditional update wins for a single concurrent verifier.
  const consumed = await run(c.env.DB, 'UPDATE verification_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL', Date.now(), ch.id)
  if (!consumed.meta.changes) throw bad('that code was already used — request a new one')
  let account = await one<{ id: string }>(c.env.DB, 'SELECT id FROM accounts WHERE email = ?', email)
  if (!account) {
    const name = (body.display_name ?? '').trim().slice(0, 80) || email.split('@')[0]
    const id = uuid()
    await run(c.env.DB, 'INSERT INTO accounts (id, email, display_name, created_at) VALUES (?,?,?,?) ON CONFLICT(email) DO NOTHING', id, email, name, Date.now())
    account = (await one<{ id: string }>(c.env.DB, 'SELECT id FROM accounts WHERE email = ?', email))!
  }
  const old = await loadSession(c.env.DB, readCookie(c.req.raw, SESSION_COOKIE))
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
  await run(c.env.DB, 'UPDATE accounts SET display_name = ? WHERE id = ?', name, a.account.id)
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

/** Preview: safe without a session; reveals only a masked address. The workspace name appears only to the intended recipient. */
auth.get('/api/invitations/:token', async (c) => {
  const session = await loadSession(c.env.DB, readCookie(c.req.raw, SESSION_COOKIE))
  const inv = await liveInvite(c.env.DB, c.req.param('token'))
  if (!inv) return c.json({ valid: false, email_hint: null, workspace_name: null, matches_session: false, signed_in: !!session })
  const matches = session?.auth.account.email === inv.email
  const { maskEmail } = await import('../lib/util')
  return c.json({ valid: true, email_hint: maskEmail(inv.email), workspace_name: matches ? inv.workspace_name : null, matches_session: matches, signed_in: !!session })
})

/** Accept with a session whose verified email matches. Single use under concurrency. */
auth.post('/api/invitations/:token/accept', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  const inv = await liveInvite(c.env.DB, c.req.param('token'))
  if (!inv) return c.json({ error: 'this invitation is no longer valid', code: 'not_found' }, 404)
  if (inv.email !== a.account.email) {
    const { maskEmail } = await import('../lib/util')
    return c.json({ error: `this invitation was sent to ${maskEmail(inv.email)} — sign in with that address to accept it`, code: 'forbidden' }, 403)
  }
  const claimed = await run(c.env.DB, 'UPDATE invitations SET accepted_at = ?, accepted_by = ? WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?', Date.now(), a.account.id, inv.id, Date.now())
  if (!claimed.meta.changes) return c.json({ error: 'this invitation was already used', code: 'conflict' }, 409)
  const stmts: [string, ...unknown[]][] = [
    ['INSERT INTO memberships (workspace_id, account_id, role, created_at) VALUES (?,?,?,?) ON CONFLICT(workspace_id, account_id) DO UPDATE SET revoked_at = NULL', inv.workspace_id, a.account.id, 'member', Date.now()],
    ['INSERT INTO audit_events (workspace_id, actor_id, action, meta, created_at) VALUES (?,?,?,?,?)', inv.workspace_id, a.account.id, 'invitation.accepted', JSON.stringify({ invitation_id: inv.id }), Date.now()],
  ]
  if (inv.sprint_id) stmts.push(['INSERT OR IGNORE INTO sprint_participants (sprint_id, account_id, is_facilitator, created_at) SELECT id, ?, 0, ? FROM sprints WHERE id = ? AND status NOT IN (\'completed\',\'archived\')', a.account.id, Date.now(), inv.sprint_id])
  await batch(c.env.DB, stmts)
  return c.json({ workspace_id: inv.workspace_id, sprint_id: inv.sprint_id })
})
