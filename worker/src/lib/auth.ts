/**
 * Sessions, cookies, CSRF and the authorization contexts every protected
 * handler uses. Identity = control of a mailbox, stated to users as such.
 */
import type { Context } from 'hono'
import { constantTimeEqual, randomToken, sha256Hex } from './crypto'
import { bool, one, run } from './db'
import { forbidden, notFound, unauthorized } from './errors'
import type { Config } from './config'

export const SESSION_COOKIE = 'muni_session'
export const CSRF_COOKIE = 'muni_csrf'
export const CSRF_HEADER = 'x-csrf-token'
export const CODE_TTL_MS = 10 * 60_000

export interface Account {
  id: string
  email: string
  display_name: string
}
export interface Auth {
  account: Account
  sessionId: string
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
  ai_processing: number
  include_facilitator_in_rotation: number
  retro_duration_min: number
  opening_question: string | null
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

export async function createSession(db: D1Database, accountId: string, ttlDays: number): Promise<{ token: string; csrf: string }> {
  const token = randomToken(32)
  const csrf = randomToken(24)
  const now = Date.now()
  await run(db, 'INSERT INTO sessions (id, account_id, token_hash, csrf_token, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?,?,?)', crypto.randomUUID(), accountId, await sha256Hex(token), csrf, now, now, now + ttlDays * 86_400_000)
  return { token, csrf }
}

export function setSessionCookies(c: Context, cfg: Config, s: { token: string; csrf: string }) {
  const secs = cfg.sessionTtlDays * 86_400
  c.header('set-cookie', cookie(SESSION_COOKIE, s.token, cfg.cookieSecure, secs, true), { append: true })
  c.header('set-cookie', cookie(CSRF_COOKIE, s.csrf, cfg.cookieSecure, secs, false), { append: true })
}
export function clearSessionCookies(c: Context, cfg: Config) {
  c.header('set-cookie', cookie(SESSION_COOKIE, '', cfg.cookieSecure, 0, true), { append: true })
  c.header('set-cookie', cookie(CSRF_COOKIE, '', cfg.cookieSecure, 0, false), { append: true })
}

interface SessionRow {
  id: string
  csrf_token: string
  expires_at: number
  last_seen_at: number
  aid: string
  email: string
  display_name: string
}

export async function loadSession(db: D1Database, rawToken: string | null): Promise<{ auth: Auth; csrf: string } | null> {
  if (!rawToken || rawToken.length > 128) return null
  const row = await one<SessionRow>(
    db,
    `SELECT s.id, s.csrf_token, s.expires_at, s.last_seen_at, a.id AS aid, a.email, a.display_name
     FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.revoked_at IS NULL`,
    await sha256Hex(rawToken),
  )
  if (!row || row.expires_at < Date.now()) return null
  if (Date.now() - row.last_seen_at > 5 * 60_000) await run(db, 'UPDATE sessions SET last_seen_at = ? WHERE id = ?', Date.now(), row.id)
  return { auth: { account: { id: row.aid, email: row.email, display_name: row.display_name }, sessionId: row.id }, csrf: row.csrf_token }
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
function originAllowed(origin: string, cfg: Config): boolean {
  if (origin === cfg.publicOrigin) return true
  if (cfg.env !== 'production') return /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
  return false
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])

/** A valid session; for unsafe methods also a matching CSRF token and an allowed origin. */
export async function requireAuth(c: Context, cfg: Config, db: D1Database): Promise<Auth> {
  const s = await loadSession(db, readCookie(c.req.raw, SESSION_COOKIE))
  if (!s) throw unauthorized()
  if (!SAFE.has(c.req.method.toUpperCase())) {
    checkOrigin(c.req.raw, cfg)
    const header = c.req.header(CSRF_HEADER) ?? ''
    if (!constantTimeEqual(header, s.csrf)) throw forbidden('missing or stale CSRF token — reload and try again')
  }
  return s.auth
}

export async function membershipRole(db: D1Database, workspaceId: string, accountId: string): Promise<Role | null> {
  const r = await one<{ role: Role }>(db, 'SELECT role FROM memberships WHERE workspace_id = ? AND account_id = ? AND revoked_at IS NULL', workspaceId, accountId)
  return r?.role ?? null
}

export async function requireMember(c: Context, cfg: Config, db: D1Database, workspaceId: string): Promise<Member> {
  const auth = await requireAuth(c, cfg, db)
  const role = await membershipRole(db, workspaceId, auth.account.id)
  if (!role) throw forbidden('you’re not a member of this workspace')
  return { auth, workspaceId, role }
}

export function requireOwner(m: Member) {
  if (m.role !== 'owner') throw forbidden('only a workspace owner can do that')
}

export const SPRINT_COLS = 'id, workspace_id, name, status, grouping_revision, vote_budget, ai_processing, include_facilitator_in_rotation, retro_duration_min, opening_question'

export async function loadSprintCtx(db: D1Database, auth: Auth, sprintId: string): Promise<SprintCtx> {
  const sprint = await one<SprintRow>(db, `SELECT ${SPRINT_COLS} FROM sprints WHERE id = ?`, sprintId)
  // Non-members get 404, not 403: don't confirm the sprint exists.
  if (!sprint) throw notFound('sprint not found')
  const role = await membershipRole(db, sprint.workspace_id, auth.account.id)
  if (!role) throw notFound('sprint not found')
  const part = await one<{ is_facilitator: number }>(db, 'SELECT is_facilitator FROM sprint_participants WHERE sprint_id = ? AND account_id = ?', sprintId, auth.account.id)
  const isParticipant = !!part
  const isFacilitator = !!part && bool(part.is_facilitator)
  if (!isParticipant && role !== 'owner') throw forbidden('you’re not a participant in this sprint')
  return { auth, sprint, role, isParticipant, isFacilitator }
}

export async function requireSprint(c: Context, cfg: Config, db: D1Database, sprintId: string): Promise<SprintCtx> {
  const auth = await requireAuth(c, cfg, db)
  return loadSprintCtx(db, auth, sprintId)
}
export function requireFacilitator(ctx: SprintCtx) {
  if (!ctx.isFacilitator) throw forbidden('only the facilitator can do that')
}
export function requireParticipant(ctx: SprintCtx) {
  if (!ctx.isParticipant && !ctx.isFacilitator) throw forbidden('you’re not a participant in this sprint')
}
