/**
 * One small fetch wrapper. Cookies carry the session; the CSRF token is
 * read from its (non-HttpOnly) cookie and sent as a header on every
 * mutating request. Errors surface as ApiError with the server's message.
 */
import { CLIENT_REVISION } from '@/lib/local/outbox'
import { SIGN_IN_PATHS, clearPendingSignOut } from '@/lib/signout'

export class ApiError extends Error {
  status: number
  code: string
  /** Extra fields the server put on the error body (e.g. `retry_after_seconds`, `attempts_left`). */
  details: Record<string, unknown>
  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

/**
 * `__Host-muni_csrf` over HTTPS (production); `muni_csrf` on http://localhost. Over HTTPS the plain
 * name is never ours any more: browsers that signed in before the prefix was introduced still hold
 * a readable `muni_csrf` from the old session, listed first (older cookies come first), and sending
 * it made every change — signing out included — fail with a stale-token 403. Over plain HTTP
 * (development) the plain cookie is the server's, and a prefixed one can only be a leftover.
 */
export function csrfToken(cookies: string = document.cookie, https: boolean = location.protocol === 'https:'): string {
  const found: Record<string, string> = {}
  for (const part of cookies.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const name = part.slice(0, i).trim()
    if ((name === '__Host-muni_csrf' || name === 'muni_csrf') && !(name in found)) found[name] = part.slice(i + 1).trim()
  }
  return safeDecode((https ? found['__Host-muni_csrf'] : (found.muni_csrf ?? found['__Host-muni_csrf'])) ?? '')
}
const safeDecode = (v: string) => {
  try {
    return decodeURIComponent(v)
  } catch {
    return v
  }
}

type Listener = () => void
const unauthorizedListeners = new Set<Listener>()
export function onUnauthorized(fn: Listener) {
  unauthorizedListeners.add(fn)
  return () => unauthorizedListeners.delete(fn)
}
const accountChangedListeners = new Set<Listener>()
/** Another tab signed in as someone else (409 account_changed): this tab must find out who it is now. */
export function onAccountChanged(fn: Listener) {
  accountChangedListeners.add(fn)
  return () => accountChangedListeners.delete(fn)
}
/**
 * The account this tab is acting for, sent as `x-muni-account`. If the browser's session now
 * belongs to someone else (signed in as them in another tab), the server refuses rather than mixing
 * one account's keys or content with another's.
 */
let expectedAccount: string | null = null
export function setExpectedAccount(id: string | null) {
  expectedAccount = id
}
export const expectedAccountId = () => expectedAccount
const upgradeListeners = new Set<Listener>()
/** The server no longer accepts this build (426): offer a reload rather than retrying. */
export function onUpgradeRequired(fn: Listener) {
  upgradeListeners.add(fn)
  return () => upgradeListeners.delete(fn)
}

/**
 * Encrypted sprints: content is sealed on the way out and opened on the way in (lib/e2ee). A
 * request that can't be sealed is never sent. `plain` skips both (for the key endpoints).
 */
type ContentHooks = { seal: (method: string, path: string, body: unknown) => Promise<unknown>; open: (data: unknown, path: string) => Promise<unknown> }
let hooks: ContentHooks | null = null
export function setContentHooks(h: ContentHooks | null) {
  hooks = h
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown; raw?: boolean; plain?: boolean } = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const method = (init.method ?? 'GET').toUpperCase()
  if (hooks && !init.plain && init.json !== undefined) {
    try {
      init = { ...init, json: await hooks.seal(method, path, init.json) }
    } catch (e) {
      throw new ApiError(412, 'no_key', `${e instanceof Error ? e.message : 'This device can’t encrypt for this sprint.'} Nothing was sent.`)
    }
  }
  if (init.json !== undefined) headers.set('content-type', 'application/json')
  if (method !== 'GET' && method !== 'HEAD') headers.set('x-csrf-token', csrfToken())
  headers.set('x-muni-client', String(CLIENT_REVISION))
  if (expectedAccount) headers.set('x-muni-account', expectedAccount)
  let res: Response
  try {
    res = await fetch(path, { ...init, method, headers, credentials: 'same-origin', body: init.json !== undefined ? JSON.stringify(init.json) : init.body })
  } catch {
    throw new ApiError(0, 'network', 'Couldn’t reach Muni. Check your connection and try again.')
  }
  if (res.status === 401) {
    unauthorizedListeners.forEach((l) => l())
    throw new ApiError(401, 'unauthorized', 'Your session has ended. Sign in again to continue.')
  }
  if (res.status === 426) {
    upgradeListeners.forEach((l) => l())
    throw new ApiError(426, 'upgrade_required', 'Muni has been updated. Reload to continue — anything you haven’t sent stays on this device.')
  }
  if (!res.ok) {
    let body: { error?: string; code?: string } & Record<string, unknown> = {}
    try {
      body = await res.json()
    } catch {
      /* not json */
    }
    if (res.status === 409 && body.code === 'account_changed') accountChangedListeners.forEach((l) => l())
    const { error, code, ...details } = body
    throw new ApiError(res.status, code ?? 'error', error ?? `Something went wrong (${res.status}).`, details)
  }
  // A new sign-in on this device supersedes a sign-out that was still waiting to reach the server.
  if (SIGN_IN_PATHS.has(path)) clearPendingSignOut()
  if (init.raw) return (await res.text()) as unknown as T
  if (res.status === 204) return undefined as T
  const data = await res.json()
  // Signed in (by any method): this tab acts for that account from now on.
  if (SIGN_IN_PATHS.has(path) && typeof data?.account_id === 'string') expectedAccount = data.account_id
  return (hooks && !init.plain ? await hooks.open(data, path) : data) as T
}

export const get = <T>(path: string) => api<T>(path)
export const post = <T>(path: string, json?: unknown) => api<T>(path, { method: 'POST', json: json ?? {} })
export const patch = <T>(path: string, json: unknown) => api<T>(path, { method: 'PATCH', json })
export const put = <T>(path: string, json: unknown) => api<T>(path, { method: 'PUT', json })
export const del = <T>(path: string, json?: unknown) => api<T>(path, { method: 'DELETE', json })

export function newKey(): string {
  return crypto.randomUUID()
}
