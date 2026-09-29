import { Hono } from 'hono'
import type { HonoEnv } from '../env'
import { config } from '../lib/config'
import { RECENT_AUTH_MS, clearSessionCookies, loadSession, readCookie, requireAuth, requireRecentAuth, revokeSession, securityEvent, sessionCookie, checkOrigin, type Auth } from '../lib/auth'
import { sha256Hex } from '../lib/crypto'
import { all, batch, one, run } from '../lib/db'
import { AppError, bad } from '../lib/errors'
import { clientClass, limit } from '../lib/ratelimit'
import { jsonBody, maskEmail, nonempty } from '../lib/util'
import { accountByEmail, emailOf, setAccountEmail } from '../lib/accounts'
import { INTRO, introName, isAvatarId } from '../lib/avatars'
import { deleteAccount, free, openSprints, retroRooms, standing } from '../lib/departure'
import { mayGrant } from '../lib/grants'
import { forgetRoom, revokeLive } from '../lib/live'

export const auth = new Hono<HonoEnv>()

/** `session` is the one asking (absent right after a sign-in, when the new session is fresh). */
export async function buildMe(env: HonoEnv['Bindings'], accountId: string, session?: Pick<Auth, 'authMethod' | 'authenticatedAt'>, extra: { created?: boolean } = {}) {
  const cfg = config(env)
  const acct = await one<{ display_name: string; name_set_at: number | null; avatar_id: string | null; avatar_theme: number; avatar_intro: number }>(
    env.DB,
    'SELECT display_name, name_set_at, avatar_id, avatar_theme, avatar_intro FROM accounts WHERE id = ?',
    accountId,
  )
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
    /** Where invitations and reminders go, if anywhere. Never a way to sign in. */
    email,
    display_name: acct?.display_name ?? '',
    /** No name chosen yet (a new account, or one whose name was once inferred): ask before anything else. */
    needs_name: !acct?.name_set_at || !acct.display_name.trim(),
    workspaces: rows.map((r) => ({ id: r.id, name: r.name, role: r.role, is_demo: r.is_demo === 1 })),
    session_expires_at: new Date(Number(exp?.e ?? Date.now())).toISOString(),
    email_transport: cfg.email,
    passkeys: Number(passkeys?.n ?? 0),
    auth_method: session?.authMethod ?? null,
    /** Until when security-sensitive changes are allowed without signing in again. */
    recent_auth_until: new Date(authedAt + RECENT_AUTH_MS).toISOString(),
    pending_join_requests: pending.map((p) => ({ id: p.id, workspace_name: p.workspace_name, created_at: new Date(p.created_at).toISOString() })),
    /** Yours alone: no other response carries it. An id this build doesn't know reads as none. */
    avatar: { id: isAvatarId(acct?.avatar_id) ? acct.avatar_id : null, theme: (acct?.avatar_theme ?? 1) === 1, intro: introName(acct?.avatar_intro) },
    ...(extra.created !== undefined ? { created: extra.created } : {}),
  }
}

auth.get('/api/auth/me', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  return c.json(await buildMe(c.env, a.account.id, a))
})

/**
 * Your own profile: any of your name, your character, whether your pages wear its world, and
 * dismissing the character introduction. Each field is optional; at least one is needed. A
 * character is a preference, not a security change: nothing is recorded in security activity.
 */
auth.patch('/api/auth/me', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  const body = await jsonBody<{ display_name?: unknown; avatar_id?: unknown; avatar_theme?: unknown; avatar_intro?: unknown }>(c)
  const sets: string[] = []
  const args: unknown[] = []
  if (body.display_name !== undefined) {
    sets.push('display_name = ?', 'name_set_at = COALESCE(name_set_at, ?)')
    args.push(nonempty(typeof body.display_name === 'string' ? body.display_name : undefined, 80, 'Name'), Date.now())
  }
  if (body.avatar_id !== undefined) {
    if (body.avatar_id !== null && !isAvatarId(body.avatar_id)) throw bad('choose one of Muni’s characters')
    // Choosing (or clearing) a character answers the introduction.
    sets.push('avatar_id = ?', 'avatar_intro = ?')
    args.push(body.avatar_id, INTRO.done)
  }
  if (body.avatar_theme !== undefined) {
    if (typeof body.avatar_theme !== 'boolean') throw bad('avatar_theme must be true or false')
    sets.push('avatar_theme = ?')
    args.push(body.avatar_theme ? 1 : 0)
  }
  if (body.avatar_intro !== undefined) {
    if (body.avatar_intro !== 'done') throw bad('avatar_intro can only be set to done')
    if (!sets.includes('avatar_intro = ?')) {
      sets.push('avatar_intro = ?')
      args.push(INTRO.done)
    }
  }
  if (!sets.length) throw bad('nothing to change')
  await run(c.env.DB, `UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`, ...args, a.account.id)
  return c.json(await buildMe(c.env, a.account.id, a))
})

/**
 * What deleting your account would do: per workspace, whether it goes with you (no one else is in
 * it) or what you'd need to hand on first (ownership, or sprints you facilitate).
 */
auth.get('/api/auth/me/deletion', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  const workspaces = await standing(c.env.DB, a.account.id)
  return c.json({ can_delete: workspaces.every(free), workspaces })
})

/**
 * Deletes your account, after a recent sign-in. Workspaces only you are in go with it; in the
 * others, what nobody has seen yet is deleted and what the team has seen stays, tied to no one
 * (lib/departure.ts). Every session ends. The passkey ids come back so this device can tell its
 * password manager they're no longer any use.
 */
auth.delete('/api/auth/me', async (c) => {
  const cfg = config(c.env)
  const a = await requireAuth(c, cfg, c.env.DB)
  requireRecentAuth(a)
  const body = await jsonBody<{ confirm?: unknown }>(c)
  if (body.confirm !== true) throw bad('confirm that you want to delete your account')
  const me = a.account.id
  const workspaces = await standing(c.env.DB, me)
  if (!workspaces.every(free)) throw new AppError(409, 'not_free', 'hand on what others depend on first', { workspaces: workspaces.filter((w) => !free(w)) })
  const sole = workspaces.filter((w) => w.sole).map((w) => w.workspace_id)
  const [email, creds, open, rooms, goneRooms] = await Promise.all([
    emailOf(c.env.DB, me),
    all<{ credential_id: string }>(c.env.DB, 'SELECT credential_id FROM webauthn_credentials WHERE account_id = ?', me),
    openSprints(c.env.DB, me),
    retroRooms(c.env.DB, { accountId: me }),
    retroRooms(c.env.DB, { workspaceIds: sole }),
  ])
  const done = await batch(c.env.DB, deleteAccount(me, email, sole))
  // Someone joined a workspace only they owned, or handed them a sprint, since they were checked:
  // nothing was deleted, and they're told what now needs handing on.
  if (!done[done.length - 1].meta.changes) {
    const now = await standing(c.env.DB, me)
    throw new AppError(409, 'not_free', 'something changed just now — hand on what others depend on first', { workspaces: now.filter((w) => !free(w)) })
  }
  // Their connections close and no room keeps anything naming them; the rooms of sprints that went
  // with a workspace keep nothing at all.
  await Promise.all([
    ...[...new Set([...open, ...rooms])].filter((id) => !goneRooms.includes(id)).map((id) => revokeLive(c.env, id, me)),
    ...goneRooms.map((id) => forgetRoom(c.env, id)),
  ])
  clearSessionCookies(c, cfg)
  return c.json({ ok: true, rp_id: cfg.webauthn.rpId, credential_ids: creds.map((r) => r.credential_id) })
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
  invited_by: string
  inviter_role: string | null
}
/** A live invitation — which includes that whoever sent it may still invite into its scope (lib/grants.ts). */
async function liveInvite(db: D1Database, token: string): Promise<InviteRow | null> {
  if (!token || token.length > 128) return null
  const inv = await one<InviteRow>(
    db,
    `SELECT i.id, i.workspace_id, i.email, i.sprint_id, w.name AS workspace_name, i.invited_by, m.role AS inviter_role
       FROM invitations i JOIN workspaces w ON w.id = i.workspace_id
       LEFT JOIN memberships m ON m.workspace_id = i.workspace_id AND m.account_id = i.invited_by AND m.revoked_at IS NULL
      WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ?`,
    await sha256Hex(token),
    Date.now(),
  )
  return inv && (await mayGrant(db, inv.workspace_id, inv.sprint_id, inv.invited_by, inv.inviter_role)) ? inv : null
}

/**
 * Invitation tokens travel in request bodies, never in URLs: the emailed link carries the token in
 * the fragment (`/invite#<token>`), which browsers don't send, and these endpoints read it from JSON.
 * URLs end up in platform request logs; bodies don't.
 */
const bodyToken = async (c: { req: { text: () => Promise<string> } }) => {
  const b = await jsonBody<{ token?: unknown }>(c)
  return typeof b.token === 'string' ? b.token.trim() : ''
}

/**
 * Preview: safe without a session. The link is the invitation: its token went only to the invited
 * address, so whoever holds it may see the workspace's name (and a masked address).
 */
auth.post('/api/invitations/preview', async (c) => {
  const cfg = config(c.env)
  checkOrigin(c.req.raw, cfg)
  await limit(c.env.DB, `invite-preview:${await sha256Hex(clientClass(c.req.raw))}`, 60, 10 * 60_000)
  const session = await loadSession(c.env.DB, readCookie(c.req.raw, sessionCookie(cfg)))
  const inv = await liveInvite(c.env.DB, await bodyToken(c))
  if (!inv) return c.json({ valid: false, email_hint: null, workspace_name: null, signed_in: !!session })
  return c.json({ valid: true, email_hint: maskEmail(inv.email), workspace_name: inv.workspace_name, signed_in: !!session })
})

/**
 * Accept, signed in with a passkey. The token is single use (under concurrency too) and expires:
 * it admits whoever redeems it first, like a personal invite link. An account with no address for
 * invitations and reminders takes the invited one, unless another account already has it; that
 * address is only ever a destination for mail, never a way in.
 */
auth.post('/api/invitations/accept', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  const inv = await liveInvite(c.env.DB, await bodyToken(c))
  if (!inv) return c.json({ error: 'this invitation is no longer valid', code: 'not_found' }, 404)
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
  if (!a.account.email && !(await accountByEmail(c.env.DB, inv.email)) && (await setAccountEmail(c.env.DB, a.account.id, inv.email)))
    await securityEvent(c.env.DB, a.account.id, 'email.added', { via: 'invitation' })
  return c.json({ workspace_id: inv.workspace_id, sprint_id: inv.sprint_id })
})
