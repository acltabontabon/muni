/**
 * The Worker talks to a sprint's MeetingRoom object over its stub. The room
 * is the only place live meeting state lives; the Worker never caches it.
 * Hints carry a resource name only, never content.
 */
export type Resource = 'sprint' | 'entries' | 'themes' | 'meeting' | 'votes' | 'commitments' | 'ai' | 'all'

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

/** Fire-and-forget hint; failures are swallowed (clients also resync on reconnect and visibility). */
export async function hint(env: { ROOMS: DurableObjectNamespace }, sprintId: string, resource: Resource): Promise<void> {
  try {
    await call(room(env, sprintId), '/hint', { resource })
  } catch {
    /* best effort */
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
