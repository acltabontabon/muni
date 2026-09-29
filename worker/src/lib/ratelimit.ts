import { count, one, run } from './db'
import { type AppError, rateLimited } from './errors'

/**
 * Sliding-window counters in D1. Single-writer D1 keeps them consistent across isolates, as long as
 * the count and the write are one statement: counted first and written after, two requests at once
 * would both see room for one more. Per-address limits protect codes; per-client limits are
 * generous so a team behind one NAT is never treated as one person.
 */
export async function limit(db: D1Database, bucket: string, max: number, windowMs: number, refuse: (retryAfterSecs: number) => AppError = rateLimited): Promise<void> {
  if (await reserve(db, bucket, max, windowMs)) return
  // When the oldest counted event leaves the window, one more is allowed.
  const since = Date.now() - windowMs
  const oldest = await one<{ at: number }>(db, 'SELECT min(at) AS at FROM rate_events WHERE bucket = ? AND at > ?', bucket, since)
  throw refuse(Math.max(1, Math.ceil((Number(oldest?.at ?? Date.now()) + windowMs - Date.now()) / 1000)))
}

/**
 * Takes one place in the window if there is one: the event is recorded by the same statement that
 * counts, so concurrent requests can't all take the last place. False (and nothing written) when full.
 */
export async function reserve(db: D1Database, bucket: string, max: number, windowMs: number): Promise<boolean> {
  const now = Date.now()
  const r = await run(db, 'INSERT INTO rate_events (bucket, at) SELECT ?, ? WHERE (SELECT count(*) FROM rate_events WHERE bucket = ? AND at > ?) < ?', bucket, now, bucket, now - windowMs, max)
  return !!r.meta.changes
}

/**
 * Whether one more event fits, without recording it (to refuse early, before starting something
 * costly). Advisory only: what enforces the limit is the `limit` or `reserve` that follows.
 */
export async function underLimit(db: D1Database, bucket: string, max: number, windowMs: number): Promise<boolean> {
  return (await count(db, 'SELECT count(*) AS n FROM rate_events WHERE bucket = ? AND at > ?', bucket, Date.now() - windowMs)) < max
}

/** Buckets that count one account's own actions. They name the account, so they go with it. */
export const ACCOUNT_BUCKETS = ['join-req', 'device-add', 'device-unlock', 'pk-reauth', 'pk-reg', 'invite-mail', 'workspace-new', 'sprint-new'] as const
export const accountBucket = (kind: (typeof ACCOUNT_BUCKETS)[number], accountId: string) => `${kind}:${accountId}`

export function clientClass(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip')
  if (cf) return cf
  const xff = req.headers.get('x-forwarded-for')
  return xff ? xff.split(',')[0].trim() : 'direct'
}

/**
 * Paths anyone can call signed out — passkey sign-in and sign-up, invitation and join-link previews —
 * and the rest under them. Every such request reads D1 and most write it (a counter, a challenge),
 * limits included, so a flood from one address could spend the D1 Free plan's daily writes before
 * any limit above refused it. The Workers Rate Limiting binding (`EDGE_LIMIT`, keyed by address)
 * refuses that flood first, without touching D1. GETs are left out: under these paths they're
 * signed-in reads (the app's /api/auth/me) that write nothing, and a team behind one address makes
 * plenty. How many requests, and per how long, is the binding's own configuration — see
 * `EDGE_LIMIT` in scripts/production-config.mjs.
 */
const EDGE_LIMITED = /^\/api\/(auth|join|invitations)\//

/**
 * Refuses a request to those paths once its address is over the edge limit. Without the binding
 * (tests, a deployment configured before it existed), or if the limiter itself fails, the request
 * goes on: the D1 limits still hold, this only spares them.
 */
export async function edgeLimit(env: { EDGE_LIMIT?: RateLimit }, req: Request): Promise<void> {
  if (!env.EDGE_LIMIT || req.method === 'GET' || req.method === 'HEAD' || !EDGE_LIMITED.test(new URL(req.url).pathname)) return
  let allowed = true
  try {
    allowed = (await env.EDGE_LIMIT.limit({ key: clientClass(req) })).success
  } catch {
    /* the limiter is unavailable: let it through */
  }
  if (!allowed) throw rateLimited()
}
