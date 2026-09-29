/**
 * The Worker talks to a sprint's MeetingRoom object over its stub. The room
 * is the only place live meeting state lives; the Worker never caches it.
 * Hints carry a resource name only, never content.
 */
export type Resource = 'sprint' | 'entries' | 'themes' | 'meeting' | 'votes' | 'commitments' | 'checkins' | 'all'
/** Who a hint goes to, when not everyone: the facilitator's sockets, and/or particular accounts' own (their other tabs). */
export interface Audience {
  facilitators?: boolean
  accounts?: string[]
}

export function room(env: { ROOMS: DurableObjectNamespace }, sprintId: string): DurableObjectStub {
  return env.ROOMS.get(env.ROOMS.idFromName(sprintId))
}

async function call<T = unknown>(stub: DurableObjectStub, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await stub.fetch(`https://room${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = text
  }
  return { status: res.status, body: parsed as T }
}

/**
 * Fire-and-forget hint — one or several resources in one call to the room; failures are swallowed
 * (clients also resync on reconnect and visibility). Sent only after the writes it announces.
 */
export async function hint(env: { ROOMS: DurableObjectNamespace }, sprintId: string, resource: Resource | Resource[], to?: Audience): Promise<void> {
  try {
    await call(room(env, sprintId), '/hint', { resources: Array.isArray(resource) ? resource : [resource], to })
  } catch {
    /* best effort */
  }
}

/** Tells the room who facilitates now (saved in D1 at `at`), so open sockets follow without reconnecting. */
export async function handOver(env: { ROOMS: DurableObjectNamespace }, sprintId: string, accountId: string, at: number): Promise<void> {
  try {
    await call(room(env, sprintId), '/facilitator', { account_id: accountId, at })
  } catch {
    /* best effort: a reconnect carries the facilitator from D1 */
  }
}

export async function revokeLive(env: { ROOMS: DurableObjectNamespace }, sprintId: string, accountId: string): Promise<void> {
  try {
    await call(room(env, sprintId), '/revoke', { account_id: accountId })
  } catch {
    /* best effort; membership is re-checked on every join and command */
  }
}

export const roomCall = call

/** The only client headers a room needs to accept a socket; nothing else (cookies, CSRF, auth) is passed on. */
const SOCKET_HEADERS = ['upgrade', 'connection', 'sec-websocket-key', 'sec-websocket-version', 'sec-websocket-protocol', 'sec-websocket-extensions']

/**
 * Headers for the room's `/ws` request: the WebSocket handshake plus who is connecting, as
 * established by the Worker, and when it read that (so a handover the room hears of later wins).
 * The session cookie stays behind, so it never appears in the room's request (or in a log of it).
 */
export function roomSocketHeaders(client: Headers, accountId: string, isFacilitator: boolean, readAt = Date.now()): Headers {
  const out = new Headers()
  for (const name of SOCKET_HEADERS) {
    const v = client.get(name)
    if (v !== null) out.set(name, v)
  }
  out.set('x-muni-account', accountId)
  out.set('x-muni-fac', isFacilitator ? '1' : '0')
  out.set('x-muni-at', String(readAt))
  return out
}
