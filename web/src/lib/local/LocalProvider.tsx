/**
 * The device side of capture for the signed-in account: drafts, the queue of thoughts waiting to
 * be sent, and sending them. Every save goes through the queue, online or not, so there is one
 * path and it is always idempotent.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { csrfToken } from '@/api/client'
import { keptAccounts, setKeepsLocal } from '@/lib/prefs'
import { flush, nextDue, type FlushResult } from './outbox'
import { serialPasses } from './passes'
import { keyring } from '@/lib/e2ee/keyring'
import { deviceStore, destroyDeviceStore, emptyPayload, hasText, memoryStore, RECORD_VERSION, StorageError, type ContextSprint, type Draft, type LocalStore, type OutboxItem, type Payload } from './store'

export type SyncState = 'idle' | 'sending' | 'offline' | 'signed_out' | 'upgrade'
/** `encrypted` is left out when it isn't known (a sprint shown from the copy kept on this device). */
export type Destination = { workspaceId: string; sprintId: string; sprintName: string; encrypted?: boolean }

type LocalApi = {
  keepLocal: boolean
  kind: LocalStore['kind']
  storageError: string | null
  items: OutboxItem[]
  sync: SyncState
  /** Submission ids the server accepted in this session (for the "Submitted" moment). */
  recentlySubmitted: string[]
  setKeepLocal: (on: boolean, opts?: { discard?: boolean }) => Promise<void>
  loadDraft: (sprintId: string) => Promise<Draft | null>
  saveDraft: (sprintId: string, payload: Payload) => Promise<void>
  clearDraft: (sprintId: string) => Promise<void>
  enqueue: (dest: Destination, payload: Payload) => Promise<{ item: OutboxItem; result: FlushResult | null }>
  edit: (id: string, payload: Payload) => Promise<boolean>
  remove: (id: string) => Promise<void>
  moveTo: (id: string, dest: Destination) => Promise<void>
  retry: () => Promise<void>
  cacheContext: (sprint: ContextSprint, workspaceName: string | null) => Promise<void>
  cachedContexts: () => Promise<{ sprint: ContextSprint; workspaceName: string | null; fetchedAt: number }[]>
  clearLocal: () => Promise<void>
  /** Drafts with text kept for this account (in this tab or on this device). */
  draftCount: () => Promise<number>
  /** Bumped whenever local data is cleared, so views holding text in memory start over. */
  cleared: number
  unsentCount: number
}

const Ctx = createContext<LocalApi | null>(null)
export const useLocal = () => {
  const v = useContext(Ctx)
  if (!v) throw new Error('useLocal outside LocalProvider')
  return v
}

// One of each per tab. The memory store outlives route changes, so a draft survives a detour
// to sign in again; it does not outlive the tab.
const memory = memoryStore()
let device: LocalStore | null = null
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('muni-local') : null
// Bumped (synchronously) whenever local data is cleared, before anything is removed. A composer
// that outlives the clear — it's being torn down — compares against it and writes nothing back.
let generation = 0
export const localGeneration = () => generation

export function hasDeviceStorage() {
  return typeof indexedDB !== 'undefined'
}

export function LocalProvider({ accountId, children }: { accountId: string | null; children: ReactNode }) {
  // The provider is keyed by account (App.tsx), so this reads the choice of the person signed in here.
  const [kept, setKept] = useState(() => keptAccounts())
  const keepLocal = !!accountId && kept.includes(accountId) && hasDeviceStorage()
  const [cleared, setCleared] = useState(0)
  const [storageError, setStorageError] = useState<string | null>(null)
  const [items, setItems] = useState<OutboxItem[]>([])
  const [sync, setSync] = useState<SyncState>('idle')
  const [recentlySubmitted, setRecent] = useState<string[]>([])
  const store: LocalStore = keepLocal ? (device ??= deviceStore()) : memory
  const storeRef = useRef(store)
  storeRef.current = store

  const reload = useCallback(async () => {
    if (!accountId) return setItems([])
    try {
      setItems(await storeRef.current.listOutbox(accountId))
    } catch (e) {
      setStorageError((e as Error).message)
    }
  }, [accountId])

  const pass = useCallback(async (force: boolean): Promise<FlushResult | null> => {
    // Nothing waiting to go: no request at all (coming back to the app, reconnecting and timers
    // all end here when the queue is empty).
    if (accountId) {
      const waiting = await storeRef.current.listOutbox(accountId).catch(() => null)
      if (waiting && !waiting.some((i) => i.status === 'queued' || i.status === 'sending')) {
        setSync('idle')
        return { state: 'ok', accountId, submitted: [], attention: [] }
      }
    }
    setSync('sending')
    try {
      const r = await flush({ store: storeRef.current, fetch: (i, init) => fetch(i, init), csrf: async () => csrfToken() || null, notify: () => { reload(); channel?.postMessage('changed') }, seal: sealThought }, { force })
      setSync(r.state === 'ok' || r.state === 'locked' ? 'idle' : r.state)
      if (r.submitted.length) setRecent((prev) => [...prev, ...r.submitted.map((s) => s.id)].slice(-20))
      if (r.state === 'offline') registerBackgroundSync()
      return r
    } catch (e) {
      setStorageError((e as Error).message)
      setSync('idle')
      return null
    } finally {
      await reload()
      channel?.postMessage('changed')
    }
  }, [accountId, reload])

  const run = useMemo(() => {
    const serial = serialPasses(pass)
    return (force = false): Promise<FlushResult | null> => (accountId ? serial(force) : Promise.resolve(null))
  }, [accountId, pass])

  // Send when the app opens, comes back to the foreground, or the connection returns; follow
  // other tabs' changes; wake up when the next backoff is due; and when the worker asks.
  useEffect(() => {
    if (!accountId) return
    reload().then(() => run())
    const onOnline = () => run(true)
    const onVisible = () => document.visibilityState === 'visible' && run()
    const onMessage = () => reload()
    const onSw = (e: MessageEvent) => e.data === 'muni:flush' && run(true)
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    channel?.addEventListener('message', onMessage)
    navigator.serviceWorker?.addEventListener('message', onSw)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
      channel?.removeEventListener('message', onMessage)
      navigator.serviceWorker?.removeEventListener('message', onSw)
    }
  }, [accountId, keepLocal, reload, run])

  // The encryption key just became usable here: thoughts waiting for it go now, not at the next retry.
  useEffect(() => {
    if (!accountId) return
    let seen = keyring.keysEpoch()
    return keyring.subscribe(() => {
      if (keyring.keysEpoch() === seen || keyring.state().kind !== 'ready') return
      seen = keyring.keysEpoch()
      void run(true)
    })
  }, [accountId, run])

  useEffect(() => {
    const due = nextDue(items)
    if (due === null || sync === 'signed_out' || sync === 'upgrade') return
    const t = window.setTimeout(() => run(), Math.max(1000, due - Date.now()))
    return () => window.clearTimeout(t)
  }, [items, sync, run])

  // Another tab changed who keeps drafts here (e.g. turned it off): follow it rather than recreate the store.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === 'muni.prefs' && setKept(keptAccounts())
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const guard = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    try {
      const out = await fn()
      setStorageError(null)
      return out
    } catch (e) {
      const msg = e instanceof StorageError ? e.message : `Couldn’t use this device’s storage (${(e as Error).message}).`
      setStorageError(msg)
      throw e instanceof StorageError ? e : new StorageError(msg)
    }
  }, [])

  const api = useMemo<LocalApi>(() => {
    const need = () => {
      if (!accountId) throw new StorageError('Sign in to save thoughts.')
      return accountId
    }
    async function enqueue(dest: Destination, payload: Payload) {
      const now = Date.now()
      const item: OutboxItem = {
        id: crypto.randomUUID(), accountId: need(), workspaceId: dest.workspaceId, sprintId: dest.sprintId, sprintName: dest.sprintName,
        payload, revision: 1, status: 'queued', attempts: 0, nextAttemptAt: 0, sendingSince: null, reason: null, message: null, createdAt: now, updatedAt: now, v: RECORD_VERSION, encrypted: dest.encrypted,
      }
      // Persisted (atomically, with the draft removed) before anyone is told it was saved.
      await guard(() => store.enqueue(item))
      await reload()
      channel?.postMessage('changed')
      const result = await run(true)
      return { item, result }
    }
    return {
      keepLocal,
      kind: store.kind,
      storageError,
      items,
      sync,
      recentlySubmitted,
      unsentCount: items.length,
      async setKeepLocal(on, opts) {
        if (on === keepLocal) return
        if (on) {
          const dev = (device ??= deviceStore())
          // Carry this tab's drafts and queue over, so turning it on never loses anything.
          if (accountId) {
            for (const d of await memory.listDrafts(accountId)) await guard(() => dev.putDraft(d))
            for (const i of await memory.listOutbox(accountId)) await guard(() => dev.enqueue(i))
            await memory.clearAccount(accountId)
          }
        } else {
          if (accountId && device && !opts?.discard) {
            // Keep working in this tab: move what is here into memory before the device copy goes.
            for (const d of await device.listDrafts(accountId)) await memory.putDraft(d)
            for (const i of await device.listOutbox(accountId)) await memory.enqueue(i)
          }
          // Only this person's records go. Someone else who keeps drafts here keeps theirs; the
          // database itself is removed once nobody does.
          if (accountId && device) await device.clearAccount(accountId).catch(() => {})
          if (!keptAccounts().some((a) => a !== accountId)) {
            await destroyDeviceStore().catch(() => {})
            device = null
          }
        }
        if (accountId) setKeepsLocal(accountId, on)
        setKept(keptAccounts())
      },
      loadDraft: (sprintId) => (accountId ? store.getDraft(accountId, sprintId) : Promise.resolve(null)),
      saveDraft: (sprintId, payload) => guard(() => store.putDraft({ accountId: need(), sprintId, payload, updatedAt: Date.now() })),
      clearDraft: (sprintId) => (accountId ? store.deleteDraft(accountId, sprintId) : Promise.resolve()),
      enqueue,
      async edit(id, payload) {
        const next = await guard(() => store.updateOutbox(id, (c) => (c.status === 'sending' ? null : { ...c, payload, revision: c.revision + 1, status: c.status === 'attention' && c.reason !== 'closed' && c.reason !== 'no_access' ? 'queued' : c.status, updatedAt: Date.now() })))
        await reload()
        channel?.postMessage('changed')
        return !!next
      },
      async remove(id) {
        const cur = await store.getOutbox(id)
        if (cur?.status === 'sending') throw new StorageError('This thought is being sent right now. Try again in a moment.')
        await guard(() => store.deleteOutbox(id))
        await reload()
        channel?.postMessage('changed')
      },
      async moveTo(id, dest) {
        const cur = await store.getOutbox(id)
        if (!cur) return
        // A new submission for the new destination; never backdated, never silently redirected.
        await enqueue(dest, cur.payload)
        await store.deleteOutbox(id)
        await reload()
      },
      async retry() {
        if (accountId) for (const i of await store.listOutbox(accountId)) if (i.status === 'queued') await store.updateOutbox(i.id, (c) => ({ ...c, nextAttemptAt: 0 }))
        await run(true)
      },
      async cacheContext(sprint, workspaceName) {
        if (!accountId || store.kind !== 'device') return
        await store.putContext({ accountId, workspaceId: sprint.workspace_id, workspaceName, sprint, fetchedAt: Date.now() }).catch(() => {})
      },
      async cachedContexts() {
        if (!accountId || store.kind !== 'device') return []
        return (await store.listContexts(accountId).catch(() => [])).map((c) => ({ sprint: c.sprint, workspaceName: c.workspaceName, fetchedAt: c.fetchedAt }))
      },
      async clearLocal() {
        if (!accountId) return
        generation++
        await memory.clearAccount(accountId)
        if (device) await device.clearAccount(accountId).catch(() => {})
        setCleared((n) => n + 1)
        await reload()
        channel?.postMessage('changed')
      },
      async draftCount() {
        if (!accountId) return 0
        return (await store.listDrafts(accountId).catch(() => [])).filter((d) => hasText(d.payload)).length
      },
      cleared,
    }
  }, [accountId, cleared, guard, items, keepLocal, recentlySubmitted, reload, run, storageError, store, sync])

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

/**
 * Seals a queued thought for an encrypted sprint. Null only for a sprint known to be set up without
 * encryption (sent as it is). When that can't be checked, this throws and the thought waits: text is
 * never sent in plaintext on a guess.
 */
async function sealThought(item: OutboxItem, plain: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  // A sprint's encryption is chosen when it's set up and never changes.
  if (item.encrypted === false) return null
  const encrypted = item.encrypted || (await keyring.isEncrypted(item.sprintId))
  if (!encrypted) return null
  const body = await keyring.sealThought(item.sprintId, item.id, { body: item.payload.body, impact: item.payload.impact || null, might_help: item.payload.might_help || null }, item.accountId)
  return { id: item.id, body, category: plain.category, period: plain.period, idempotency_key: item.id, author_account_id: item.accountId }
}

function registerBackgroundSync() {
  // An enhancement only (Chromium). Correctness never depends on it.
  navigator.serviceWorker?.ready
    .then((reg) => (reg as ServiceWorkerRegistration & { sync?: { register: (tag: string) => Promise<void> } }).sync?.register('muni-outbox'))
    .catch(() => {})
}

export { emptyPayload }
