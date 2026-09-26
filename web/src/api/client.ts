/**
 * One small fetch wrapper. Cookies carry the session; the CSRF token is
 * read from its (non-HttpOnly) cookie and sent as a header on every
 * mutating request. Errors surface as ApiError with the server's message.
 */
import { CLIENT_REVISION } from '@/lib/local/outbox'

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

export function csrfToken(): string {
  // `__Host-muni_csrf` over HTTPS (production); `muni_csrf` on http://localhost.
  const m = document.cookie.match(/(?:^|;\s*)(?:__Host-)?muni_csrf=([^;]*)/)
  return m ? decodeURIComponent(m[1]) : ''
}

type Listener = () => void
const unauthorizedListeners = new Set<Listener>()
export function onUnauthorized(fn: Listener) {
  unauthorizedListeners.add(fn)
  return () => unauthorizedListeners.delete(fn)
}
const upgradeListeners = new Set<Listener>()
/** The server no longer accepts this build (426): offer a reload rather than retrying. */
export function onUpgradeRequired(fn: Listener) {
  upgradeListeners.add(fn)
  return () => upgradeListeners.delete(fn)
}


export async function api<T>(path: string, init: RequestInit & { json?: unknown; raw?: boolean } = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const method = (init.method ?? 'GET').toUpperCase()
  if (init.json !== undefined) headers.set('content-type', 'application/json')
  if (method !== 'GET' && method !== 'HEAD') headers.set('x-csrf-token', csrfToken())
  headers.set('x-muni-client', String(CLIENT_REVISION))
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
    const { error, code, ...details } = body
    throw new ApiError(res.status, code ?? 'error', error ?? `Something went wrong (${res.status}).`, details)
  }
  if (init.raw) return (await res.text()) as unknown as T
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const get = <T>(path: string) => api<T>(path)
export const post = <T>(path: string, json?: unknown) => api<T>(path, { method: 'POST', json: json ?? {} })
export const patch = <T>(path: string, json: unknown) => api<T>(path, { method: 'PATCH', json })
export const put = <T>(path: string, json: unknown) => api<T>(path, { method: 'PUT', json })
export const del = <T>(path: string, json?: unknown) => api<T>(path, { method: 'DELETE', json })

export function newKey(): string {
  return crypto.randomUUID()
}
