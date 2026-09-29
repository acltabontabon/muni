import { count, one, run } from './db'
import { type AppError, rateLimited } from './errors'

/**
 * Sliding-window counters in D1. Single-writer D1 keeps them consistent across
 * isolates. Per-address limits protect codes; per-client limits are generous so
 * a team behind one NAT is never treated as one person.
 */
export async function limit(db: D1Database, bucket: string, max: number, windowMs: number, refuse: (retryAfterSecs: number) => AppError = rateLimited): Promise<void> {
  const since = Date.now() - windowMs
  const n = await count(db, 'SELECT count(*) AS n FROM rate_events WHERE bucket = ? AND at > ?', bucket, since)
  if (n >= max) {
    // When the oldest counted event leaves the window, one more is allowed.
    const oldest = await one<{ at: number }>(db, 'SELECT min(at) AS at FROM rate_events WHERE bucket = ? AND at > ?', bucket, since)
    throw refuse(Math.max(1, Math.ceil((Number(oldest?.at ?? Date.now()) + windowMs - Date.now()) / 1000)))
  }
  await run(db, 'INSERT INTO rate_events (bucket, at) VALUES (?, ?)', bucket, Date.now())
}

/** Whether one more event fits, without recording it (to refuse before starting something costly). */
export async function underLimit(db: D1Database, bucket: string, max: number, windowMs: number): Promise<boolean> {
  return (await count(db, 'SELECT count(*) AS n FROM rate_events WHERE bucket = ? AND at > ?', bucket, Date.now() - windowMs)) < max
}

/** Counts an event that has happened (after `underLimit` said it fit). */
export async function record(db: D1Database, bucket: string): Promise<void> {
  await run(db, 'INSERT INTO rate_events (bucket, at) VALUES (?, ?)', bucket, Date.now())
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
