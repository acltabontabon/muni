/**
 * Sending queued thoughts. Plain TypeScript so the page and the service worker run the same code.
 *
 * Correctness does not depend on the browser: every send carries the item's stable id as the
 * server's idempotency key and the account that wrote it, and the server decides (it returns the
 * original entry for a repeat, refuses closed sprints, revoked members and other accounts). The
 * device only has to avoid needless duplicate work, which a Web Lock does across tabs and the
 * service worker.
 */
import type { LocalStore, OutboxItem, AttentionReason } from './store'

/** Sent as `x-muni-client`. Raise together with the server's MIN_CLIENT_REVISION. */
export const CLIENT_REVISION = 3
/** A queued thought for an encrypted sprint that this device can't seal yet (no key here). */
export const WAITING_KEY = 'waiting_key'
/** A send that has been "in flight" this long was interrupted (tab closed, device slept). */
const STALE_SENDING_MS = 2 * 60_000
const BACKOFF_MS = [5_000, 15_000, 45_000, 2 * 60_000, 5 * 60_000, 10 * 60_000]
export const backoff = (attempts: number) => BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1] ?? BACKOFF_MS[0]

export type FlushState = 'ok' | 'offline' | 'signed_out' | 'upgrade' | 'locked'
export type FlushResult = { state: FlushState; accountId: string | null; submitted: { id: string; entryId: string }[]; attention: string[] }

export interface SyncDeps {
  store: LocalStore
  fetch: typeof fetch
  /** The CSRF token for mutations (document.cookie in a page, cookieStore in a worker). */
  csrf: () => Promise<string | null>
  now?: () => number
  /** Runs `fn` exclusively across tabs and the worker; resolves 'locked' when another holder is busy. */
  lock?: <T>(fn: () => Promise<T>) => Promise<T | 'locked'>
  /** Told after every change so other tabs can re-read. */
  notify?: () => void
  /**
   * Seals a thought for an encrypted sprint (returns the request body), or null for a legacy sprint.
   * Throws { code: 'no-key' } when this device can't. Absent in the service worker, which holds no
   * keys: it leaves encrypted thoughts for the app to send.
   */
  seal?: (item: OutboxItem, plain: Record<string, unknown>) => Promise<Record<string, unknown> | null>
}

export function webLock<T>(fn: () => Promise<T>): Promise<T | 'locked'> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks
  if (!locks) return fn() // server-side idempotency still prevents duplicate entries
  return locks.request('muni-outbox', { ifAvailable: true }, async (l) => (l ? fn() : 'locked')) as Promise<T | 'locked'>
}

const headers = (csrf: string | null): HeadersInit => ({ 'content-type': 'application/json', 'x-muni-client': String(CLIENT_REVISION), ...(csrf ? { 'x-csrf-token': csrf } : {}) })

function classify(status: number, code: string | undefined): { kind: 'done' } | { kind: 'retry' } | { kind: 'stop'; state: FlushState } | { kind: 'attention'; reason: AttentionReason } {
  if (status >= 200 && status < 300) return { kind: 'done' }
  if (status === 401) return { kind: 'stop', state: 'signed_out' }
  if (status === 426) return { kind: 'stop', state: 'upgrade' }
  if (status === 409 && code === 'collection_closed') return { kind: 'attention', reason: 'closed' }
  if (status === 409 && code === 'account_mismatch') return { kind: 'attention', reason: 'account' }
  if (status === 409) return { kind: 'attention', reason: 'limit' }
  if (status === 403 || status === 404) return { kind: 'attention', reason: 'no_access' }
  if (status === 400 || status === 422) return { kind: 'attention', reason: 'invalid' }
  return { kind: 'retry' } // 429, 5xx, anything unexpected: transient
}

/**
 * Send every due item for the signed-in account. `force` ignores backoff (the person pressed Retry,
 * or connectivity just came back).
 */
export async function flush(deps: SyncDeps, opts: { force?: boolean } = {}): Promise<FlushResult> {
  const run = deps.lock ?? webLock
  const out = await run(() => flushLocked(deps, opts))
  return out === 'locked' ? { state: 'locked', accountId: null, submitted: [], attention: [] } : out
}

async function flushLocked(deps: SyncDeps, opts: { force?: boolean }): Promise<FlushResult> {
  const now = deps.now ?? Date.now
  const res: FlushResult = { state: 'ok', accountId: null, submitted: [], attention: [] }
  // Who is signed in right now decides what may be sent. Never someone else's queue.
  let me: Response
  try {
    me = await deps.fetch('/api/auth/me', { credentials: 'same-origin', headers: { 'x-muni-client': String(CLIENT_REVISION) } })
  } catch {
    return { ...res, state: 'offline' }
  }
  if (me.status === 401) return { ...res, state: 'signed_out' }
  if (me.status === 426) return { ...res, state: 'upgrade' }
  if (!me.ok) return { ...res, state: 'offline' }
  const accountId = ((await me.json()) as { account_id: string }).account_id
  res.accountId = accountId
  const csrf = await deps.csrf()
  if (!csrf) return { ...res, state: 'signed_out' }

  const items = await deps.store.listOutbox(accountId)
  for (const item of items) {
    const t = now()
    const interrupted = item.status === 'sending' && (item.sendingSince ?? 0) < t - STALE_SENDING_MS
    const due = item.status === 'queued' && (opts.force || item.nextAttemptAt <= t)
    if (!due && !interrupted) continue
    if (item.encrypted && !deps.seal) continue
    // Claim it: only this exact revision, still queued (or abandoned mid-send), becomes 'sending'.
    const claimed = await deps.store.updateOutbox(item.id, (cur) =>
      cur.revision === item.revision && (cur.status === 'queued' || (cur.status === 'sending' && interrupted)) ? { ...cur, status: 'sending', sendingSince: t, updatedAt: t } : null,
    )
    if (!claimed) continue
    deps.notify?.()
    let status: number
    let body: { id?: string; code?: string; error?: string } = {}
    let payload: Record<string, unknown> = {
      body: claimed.payload.body,
      category: claimed.payload.category,
      impact: claimed.payload.impact || undefined,
      might_help: claimed.payload.might_help || undefined,
      period: claimed.payload.period,
      idempotency_key: claimed.id,
      author_account_id: claimed.accountId,
    }
    // Encrypted sprints: sealed here, at send time, with this device's keys. If it can't be
    // sealed, it isn't sent — it waits, and says so.
    if (deps.seal) {
      let sealed: Record<string, unknown> | null
      try {
        sealed = await deps.seal(claimed, payload)
      } catch (e) {
        const waiting = (e as { code?: string }).code === 'no-key'
        await deps.store.updateOutbox(claimed.id, (cur) => ({ ...cur, status: 'queued', sendingSince: null, message: waiting ? WAITING_KEY : cur.message, nextAttemptAt: now() + (waiting ? 60_000 : backoff(cur.attempts + 1)), attempts: waiting ? cur.attempts : cur.attempts + 1, updatedAt: now() }))
        deps.notify?.()
        if (!waiting) return { ...res, state: 'offline' }
        continue
      }
      if (sealed) payload = sealed
    }
    try {
      const r = await deps.fetch(`/api/sprints/${claimed.sprintId}/entries`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: headers(csrf),
        body: JSON.stringify(payload),
      })
      status = r.status
      body = await r.json().catch(() => ({}))
    } catch {
      status = 0 // the request or its response was lost; the next attempt resolves which
    }
    const verdict = status === 0 ? ({ kind: 'retry' } as const) : classify(status, body.code)
    const at = now()
    if (verdict.kind === 'done') {
      await deps.store.deleteOutbox(claimed.id)
      res.submitted.push({ id: claimed.id, entryId: body.id ?? '' })
    } else if (verdict.kind === 'attention') {
      await deps.store.updateOutbox(claimed.id, (cur) => ({ ...cur, status: 'attention', reason: verdict.reason, message: body.error ?? null, sendingSince: null, updatedAt: at }))
      if (verdict.reason === 'no_access') await deps.store.forgetWorkspace(claimed.accountId, claimed.workspaceId)
      res.attention.push(claimed.id)
    } else {
      // Back to the queue without losing anything; transient failures wait longer each time.
      await deps.store.updateOutbox(claimed.id, (cur) => ({
        ...cur,
        status: 'queued',
        sendingSince: null,
        attempts: verdict.kind === 'retry' ? cur.attempts + 1 : cur.attempts,
        nextAttemptAt: verdict.kind === 'retry' ? at + backoff(cur.attempts + 1) : cur.nextAttemptAt,
        updatedAt: at,
      }))
      deps.notify?.()
      if (verdict.kind === 'stop') return { ...res, state: verdict.state }
      if (status === 0) return { ...res, state: 'offline' } // no point trying the rest now
    }
    deps.notify?.()
  }
  return res
}

/** When the next queued item becomes due (for a timer while the page is open). */
export function nextDue(items: OutboxItem[]): number | null {
  const due = items.filter((i) => i.status === 'queued').map((i) => i.nextAttemptAt)
  return due.length ? Math.min(...due) : null
}
