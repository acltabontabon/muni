import { count, run } from './db'
import { type AppError, rateLimited } from './errors'

/**
 * Sliding-window counters in D1. Single-writer D1 keeps them consistent across
 * isolates. Per-address limits protect codes; per-client limits are generous so
 * a team behind one NAT is never treated as one person.
 */
export async function limit(db: D1Database, bucket: string, max: number, windowMs: number, refuse: () => AppError = rateLimited): Promise<void> {
  const since = Date.now() - windowMs
  const n = await count(db, 'SELECT count(*) AS n FROM rate_events WHERE bucket = ? AND at > ?', bucket, since)
  if (n >= max) throw refuse()
  await run(db, 'INSERT INTO rate_events (bucket, at) VALUES (?, ?)', bucket, Date.now())
}

export function clientClass(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip')
  if (cf) return cf
  const xff = req.headers.get('x-forwarded-for')
  return xff ? xff.split(',')[0].trim() : 'direct'
}
