/**
 * Sessions, cookies, CSRF and the authorization contexts every protected
 * handler uses. Identity = control of one of the account's passkeys; nothing else signs anyone in.
 * Signing in proves only that: membership and content keys are separate.
 */
import type { Context } from 'hono'
import { constantTimeEqual, randomToken, sha256Hex } from './crypto'
import { bool, one, run } from './db'
import { AppError, forbidden, notFound, unauthorized } from './errors'
import type { Config } from './config'

export const SESSION_COOKIE = 'muni_session'
export const CSRF_COOKIE = 'muni_csrf'
/**
 * Over HTTPS the cookies carry the `__Host-` prefix: the browser then only accepts them from this
 * exact host with Secure and Path=/, so a sibling origin (munimuni.app, any other *.munimuni.app)
 * can't plant a session or CSRF cookie here. Plain names remain for http://localhost development.
 */
export const sessionCookie = (cfg: Config) => (cfg.cookieSecure ? `__Host-${SESSION_COOKIE}` : SESSION_COOKIE)
export const csrfCookie = (cfg: Config) => (cfg.cookieSecure ? `__Host-${CSRF_COOKIE}` : CSRF_COOKIE)
export const CSRF_HEADER = 'x-csrf-token'
/** Security-sensitive changes (adding or removing a passkey, keys) need a sign-in this recent. */
export const RECENT_AUTH_MS = 10 * 60_000
export type AuthMethod = 'passkey'

export interface Account {
  id: string
  /** Where invitations and reminders go (account_emails), or null. Never a way in. */
  email: string | null
  display_name: string
}
export interface Auth {
  account: Account
  sessionId: string
  authMethod: AuthMethod
  /** When this session last proved control of the account (a code or a passkey). */
  authenticatedAt: number
  /** The passkey (webauthn_credentials.id) that started this session, for passkey sessions. */
  credentialRef: string | null
}
export type Role = 'owner' | 'member'
export interface Member {
  auth: Auth
  workspaceId: string
  role: Role
}
export interface SprintRow {
  id: string
  workspace_id: string
  name: string
  status: string
  grouping_revision: number
  vote_budget: number
  retro_duration_min: number
  opening_question: string | null
  /** 'e1': content is client-encrypted. NULL: set up without encryption. */
  encryption: string | null
}
export interface SprintCtx {
  auth: Auth
  sprint: SprintRow
  role: Role
  isParticipant: boolean
  isFacilitator: boolean
}

export function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie') ?? ''
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return rest.join('=')
  }
  return null
}

export function cookie(name: string, value: string, secure: boolean, maxAgeSecs: number, httpOnly: boolean): string {
  let c = `${name}=${value}; Path=/; SameSite=Lax; Max-Age=${maxAgeSecs}`
  if (httpOnly) c += '; HttpOnly'
  if (secure) c += '; Secure'
  return c
}

export interface NewSession {
  method: AuthMethod
  credentialRef?: string | null
  clientLabel?: string | null
}

/** Always a fresh token (never an adopted one), so a planted cookie can't become a session. */
export async function createSession(db: D1Database, accountId: string, ttlDays: number, s: NewSession): Promise<{ token: string; csrf: string; id: string }> {
  const token = randomToken(32)
  const csrf = randomToken(24)
  const now = Date.now()
  const id = crypto.randomUUID()
  await run(
    db,
    'INSERT INTO sessions (id, account_id, token_hash, csrf_token, created_at, last_seen_at, expires_at, auth_method, authenticated_at, credential_ref, client_label) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    id, accountId, await sha256Hex(token), csrf, now, now, now + ttlDays * 86_400_000, s.method, now, s.credentialRef ?? null, s.clientLabel ?? null,
  )
  return { token, csrf, id }
}

/**
 * A coarse, human label for the account holder's own session list ("Safari on iOS"). Never used
 * to decide anything, never shown to anyone else, and not a fingerprint: browser family and OS only.
 */
export function clientLabel(req: Request, installed = false): string {
  const ua = req.headers.get('user-agent') ?? ''
  const os = /iPhone|iPod/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /CrOS/.test(ua) ? 'ChromeOS' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : ''
  const browser = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\/|FxiOS/.test(ua) ? 'Firefox' : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : ''
  const app = installed ? 'Muni app' : browser || 'A browser'
  return os ? `${app} on ${os}` : app
}

/** The account holder's security history: ids and coarse labels only, never secrets or content. */
export async function securityEvent(db: D1Database, accountId: string, kind: string, meta: Record<string, string | number | boolean | null> = {}) {
  await run(db, 'INSERT INTO security_events (account_id, kind, meta, created_at) VALUES (?,?,?,?)', accountId, kind, JSON.stringify(meta), Date.now())
}

export function setSessionCookies(c: Context, cfg: Config, s: { token: string; csrf: string }) {
  const secs = cfg.sessionTtlDays * 86_400
  c.header('set-cookie', cookie(sessionCookie(cfg), s.token, cfg.cookieSecure, secs, true), { append: true })
  c.header('set-cookie', cookie(csrfCookie(cfg), s.csrf, cfg.cookieSecure, secs, false), { append: true })
}
export function clearSessionCookies(c: Context, cfg: Config) {
  c.header('set-cookie', cookie(sessionCookie(cfg), '', cfg.cookieSecure, 0, true), { append: true })
  c.header('set-cookie', cookie(csrfCookie(cfg), '', cfg.cookieSecure, 0, false), { append: true })
}

interface SessionRow {
  id: string
  csrf_token: string
  expires_at: number
  last_seen_at: number
  auth_method: AuthMethod
  authenticated_at: number | null
  created_at: number
  credential_ref: string | null
  aid: string
  email: string | null
  display_name: string
}

/** What a request needs read alongside its session, in the same query: columns, joins, their values. */
interface Alongside {
  cols: string
  joins: string
  args: unknown[]
}

/** The live session a token names — and, with `alongside`, what the caller needs with it — in one query. */
async function sessionRow<T = object>(db: D1Database, rawToken: string | null, alongside: Alongside = { cols: '', joins: '', args: [] }): Promise<(SessionRow & T) | null> {
  if (!rawToken || rawToken.length > 128) return null
  const row = await one<SessionRow & T>(
    db,
    `SELECT s.id, s.csrf_token, s.expires_at, s.last_seen_at, s.auth_method, s.authenticated_at, s.created_at, s.credential_ref, a.id AS aid, ae.email, a.display_name${alongside.cols}
     FROM sessions s JOIN accounts a ON a.id = s.account_id LEFT JOIN account_emails ae ON ae.account_id = a.id${alongside.joins}
     WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.auth_method = 'passkey'`,
    ...alongside.args,
    await sha256Hex(rawToken),
  )
  if (!row || row.expires_at < Date.now()) return null
  if (Date.now() - row.last_seen_at > 5 * 60_000) await run(db, 'UPDATE sessions SET last_seen_at = ? WHERE id = ?', Date.now(), row.id)
  return row
}

const sessionOf = (row: SessionRow): { auth: Auth; csrf: string } => ({
  auth: { account: { id: row.aid, email: row.email, display_name: row.display_name }, sessionId: row.id, authMethod: row.auth_method, authenticatedAt: row.authenticated_at ?? row.created_at, credentialRef: row.credential_ref ?? null },
  csrf: row.csrf_token,
})

export async function loadSession(db: D1Database, rawToken: string | null): Promise<{ auth: Auth; csrf: string } | null> {
  const row = await sessionRow(db, rawToken)
  return row ? sessionOf(row) : null
}

export async function revokeSession(db: D1Database, sessionId: string) {
  await run(db, 'UPDATE sessions SET revoked_at = ? WHERE id = ?', Date.now(), sessionId)
}

/** Rejects cross-site posts and disallowed origins. */
export function checkOrigin(req: Request, cfg: Config) {
  const site = req.headers.get('sec-fetch-site')
  if (site === 'cross-site') throw forbidden('cross-site request refused')
  const origin = req.headers.get('origin')
  if (origin && origin !== 'null' && !originAllowed(origin, cfg)) throw forbidden('request origin not allowed')
}
/**
 * WebSocket upgrades are GET requests that browsers send cross-origin with cookies and without
 * CORS, so the socket route requires an Origin header naming this app.
 */
export function checkSocketOrigin(req: Request, cfg: Config) {
  const origin = req.headers.get('origin')
  if (!origin || !originAllowed(origin, cfg)) throw forbidden('request origin not allowed')
}
function originAllowed(origin: string, cfg: Config): boolean {
  if (origin === cfg.publicOrigin) return true
  if (cfg.env !== 'production') return /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
  return false
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * The account a tab believes it is acting for. A tab left open while another tab signed in as
 * someone else still holds the first account's keys and content: it names that account on every
 * request, and anything sent under a different session is refused rather than mixed across accounts.
 * Reading who is signed in and signing out don't ask (they are how a tab finds out, or leaves).
 */
export const ACCOUNT_HEADER = 'x-muni-account'
const accountExempt = (method: string, path: string) => path === '/api/auth/logout' || (path === '/api/auth/me' && method === 'GET')

/** A valid session; for unsafe methods also a matching CSRF token and an allowed origin. */
export async function requireAuth(c: Context, cfg: Config, db: D1Database): Promise<Auth> {
  return checked(c, cfg, await sessionRow(db, readCookie(c.req.raw, sessionCookie(cfg))))
}

/** What every signed-in request must pass, given its session (read with whatever came alongside). */
function checked(c: Context, cfg: Config, row: SessionRow | null): Auth {
  if (!row) throw unauthorized()
  const s = sessionOf(row)
  const expected = c.req.header(ACCOUNT_HEADER)
  if (expected && expected !== s.auth.account.id && !accountExempt(c.req.method.toUpperCase(), new URL(c.req.url).pathname))
    throw new AppError(409, 'account_changed', 'you’re signed in as someone else in another tab — reload to continue')
  if (!SAFE.has(c.req.method.toUpperCase())) {
    checkOrigin(c.req.raw, cfg)
    const header = c.req.header(CSRF_HEADER) ?? ''
    if (!constantTimeEqual(header, s.csrf)) throw forbidden('missing or stale CSRF token — reload and try again')
  }
  return s.auth
}

/**
 * Adding or removing passkeys and changing keys need a recent sign-in on this session, so a
 * borrowed unlocked laptop or a stolen cookie can't quietly add an attacker's passkey.
 */
export function requireRecentAuth(a: Auth) {
  if (Date.now() - a.authenticatedAt > RECENT_AUTH_MS)
    throw new AppError(403, 'reauth_required', 'confirm it’s you first with your passkey', { recent_auth_minutes: RECENT_AUTH_MS / 60_000 })
}

/** The session and the caller's membership of the workspace: one query. */
export async function requireMember(c: Context, cfg: Config, db: D1Database, workspaceId: string): Promise<Member> {
  const row = await sessionRow<{ member_role: Role | null }>(db, readCookie(c.req.raw, sessionCookie(cfg)), {
    cols: ', m.role AS member_role',
    joins: ' LEFT JOIN memberships m ON m.workspace_id = ? AND m.account_id = a.id AND m.revoked_at IS NULL',
    args: [workspaceId],
  })
  const auth = checked(c, cfg, row)
  if (!row!.member_role) throw forbidden('you’re not a member of this workspace')
  return { auth, workspaceId, role: row!.member_role }
}

export function requireOwner(m: Member) {
  if (m.role !== 'owner') throw forbidden('only a workspace owner can do that')
}

const SPRINT_FIELDS = ['id', 'workspace_id', 'name', 'status', 'grouping_revision', 'vote_budget', 'retro_duration_min', 'opening_question', 'encryption'] as const
/** A sprint (`spr`), the caller's membership of its workspace (`m`) and part in it (`pt`), as columns. */
const SPRINT_CTX_COLS = `${SPRINT_FIELDS.map((f) => `spr.${f} AS spr_${f}`).join(', ')}, m.role AS member_role, pt.account_id AS part_id, pt.is_facilitator AS part_fac`
const SPRINT_CTX_JOINS = (account: string) =>
  `LEFT JOIN memberships m ON m.workspace_id = spr.workspace_id AND m.account_id = ${account} AND m.revoked_at IS NULL
   LEFT JOIN sprint_participants pt ON pt.sprint_id = spr.id AND pt.account_id = ${account}`
type SprintCtxRow = { [K in (typeof SPRINT_FIELDS)[number] as `spr_${K}`]: SprintRow[K] | null } & { member_role: Role | null; part_id: string | null; part_fac: number | null }

function sprintCtxOf(auth: Auth, row: SprintCtxRow | null): SprintCtx {
  // Non-members get 404, not 403: don't confirm the sprint exists.
  if (!row?.spr_id || !row.member_role) throw notFound('sprint not found')
  const sprint = Object.fromEntries(SPRINT_FIELDS.map((f) => [f, row[`spr_${f}`]])) as unknown as SprintRow
  const isParticipant = !!row.part_id
  const isFacilitator = isParticipant && bool(row.part_fac)
  if (!isParticipant && row.member_role !== 'owner') throw forbidden('you’re not a participant in this sprint')
  return { auth, sprint, role: row.member_role, isParticipant, isFacilitator }
}

/** The sprint as `auth` may see it: the sprint, the membership and the participation in one query. */
export async function loadSprintCtx(db: D1Database, auth: Auth, sprintId: string): Promise<SprintCtx> {
  return sprintCtxOf(auth, await one<SprintCtxRow>(db, `SELECT ${SPRINT_CTX_COLS} FROM sprints spr ${SPRINT_CTX_JOINS('?')} WHERE spr.id = ?`, auth.account.id, auth.account.id, sprintId))
}

/** The session, the sprint, the membership and the participation: all in one query. */
export async function requireSprint(c: Context, cfg: Config, db: D1Database, sprintId: string): Promise<SprintCtx> {
  const row = await sessionRow<SprintCtxRow>(db, readCookie(c.req.raw, sessionCookie(cfg)), { cols: `, ${SPRINT_CTX_COLS}`, joins: ` LEFT JOIN sprints spr ON spr.id = ? ${SPRINT_CTX_JOINS('a.id')}`, args: [sprintId] })
  return sprintCtxOf(checked(c, cfg, row), row)
}
export function requireFacilitator(ctx: SprintCtx) {
  if (!ctx.isFacilitator) throw forbidden('only the facilitator can do that')
}
export function requireParticipant(ctx: SprintCtx) {
  if (!ctx.isParticipant && !ctx.isFacilitator) throw forbidden('you’re not a participant in this sprint')
}
