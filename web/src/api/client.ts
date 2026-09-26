/**
 * One small fetch wrapper. Cookies carry the session; the CSRF token is
 * read from its (non-HttpOnly) cookie and sent as a header on every
 * mutating request. Errors surface as ApiError with the server's message.
 */
export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

function csrf(): string {
  const m = document.cookie.match(/(?:^|;\s*)muni_csrf=([^;]*)/)
  return m ? decodeURIComponent(m[1]) : ''
}

type Listener = () => void
const unauthorizedListeners = new Set<Listener>()
export function onUnauthorized(fn: Listener) {
  unauthorizedListeners.add(fn)
  return () => unauthorizedListeners.delete(fn)
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown; raw?: boolean } = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const method = (init.method ?? 'GET').toUpperCase()
  if (init.json !== undefined) headers.set('content-type', 'application/json')
  if (method !== 'GET' && method !== 'HEAD') headers.set('x-csrf-token', csrf())
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
  if (!res.ok) {
    let body: { error?: string; code?: string } = {}
    try {
      body = await res.json()
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, body.code ?? 'error', body.error ?? `Something went wrong (${res.status}).`)
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
