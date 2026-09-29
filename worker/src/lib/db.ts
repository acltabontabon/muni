/** Thin D1 helpers. Every query is a prepared statement with bound values. */
export type DB = D1Database
/** One SQL statement and its bound values, for `batch`. */
export type Statement = [string, ...unknown[]]

export async function one<T = Record<string, unknown>>(db: DB, sql: string, ...args: unknown[]): Promise<T | null> {
  return (await db.prepare(sql).bind(...args).first<T>()) ?? null
}
export async function all<T = Record<string, unknown>>(db: DB, sql: string, ...args: unknown[]): Promise<T[]> {
  const r = await db.prepare(sql).bind(...args).all<T>()
  return r.results
}
export async function run(db: DB, sql: string, ...args: unknown[]): Promise<D1Result> {
  return db.prepare(sql).bind(...args).run()
}
export async function count(db: DB, sql: string, ...args: unknown[]): Promise<number> {
  const r = await one<{ n: number }>(db, sql, ...args)
  return Number(r?.n ?? 0)
}
/** Runs statements in one transaction (D1 batches are atomic). */
export async function batch(db: DB, stmts: Statement[]): Promise<D1Result[]> {
  if (!stmts.length) return []
  return db.batch(stmts.map(([sql, ...args]) => db.prepare(sql).bind(...args)))
}
/** SET clauses gathered for one UPDATE, each with its values, so a change is written all at once. */
export function assignments() {
  const sets: string[] = []
  const args: unknown[] = []
  const set = (sql: string, ...values: unknown[]) => {
    sets.push(sql)
    args.push(...values)
  }
  return { sets, args, set }
}
export const b = (v: unknown) => (v ? 1 : 0)
export const bool = (v: unknown) => Number(v) === 1

export async function audit(db: DB, workspaceId: string, sprintId: string | null, actorId: string | null, action: string, meta: Record<string, unknown> = {}) {
  await run(db, 'INSERT INTO audit_events (workspace_id, sprint_id, actor_id, action, meta, created_at) VALUES (?,?,?,?,?,?)', workspaceId, sprintId, actorId, action, JSON.stringify(meta), Date.now())
}
export const auditStmt = (workspaceId: string, sprintId: string | null, actorId: string | null, action: string, meta: Record<string, unknown> = {}): [string, ...unknown[]] => [
  'INSERT INTO audit_events (workspace_id, sprint_id, actor_id, action, meta, created_at) VALUES (?,?,?,?,?,?)',
  workspaceId,
  sprintId,
  actorId,
  action,
  JSON.stringify(meta),
  Date.now(),
]
