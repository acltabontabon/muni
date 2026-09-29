/**
 * What Muni keeps on a device, and nothing else: the draft you are writing, thoughts waiting to be
 * sent, a little context about the sprints they are for, and who was signed in (for starting
 * offline). Every record is namespaced by account. No session tokens, no one else's entries, no
 * API responses beyond that.
 *
 * Two backends share one interface. `device` is IndexedDB, used only when the person chose "Keep
 * drafts on this device". `memory` lives as long as the tab, for everyone else and whenever
 * storage is unavailable. Neither is a backup.
 */
import type { Category, Period } from '@/api/types'

/** Bump with a migration in `upgradeRecord` when a stored shape changes. */
export const RECORD_VERSION = 1

export type Payload = { body: string; category: Category | null; impact: string; might_help: string; period: Period | null }
export const emptyPayload = (): Payload => ({ body: '', category: null, impact: '', might_help: '', period: null })
export const hasText = (p: Payload) => !!(p.body.trim() || p.impact.trim() || p.might_help.trim())

export type Draft = { key: string; accountId: string; sprintId: string; payload: Payload; updatedAt: number; v: number }

export type OutboxStatus = 'queued' | 'sending' | 'attention'
export type AttentionReason = 'closed' | 'no_access' | 'invalid' | 'account' | 'limit'
export type OutboxItem = {
  /** Stable, client-generated submission id; sent as the idempotency key. */
  id: string
  accountId: string
  workspaceId: string
  sprintId: string
  /** Display only. Removed when access to the sprint ends. */
  sprintName: string | null
  payload: Payload
  /** Bumped on every local edit; a send only completes against the revision it sent. */
  revision: number
  status: OutboxStatus
  attempts: number
  nextAttemptAt: number
  sendingSince: number | null
  reason: AttentionReason | null
  message: string | null
  createdAt: number
  updatedAt: number
  v: number
  /**
   * true: an encrypted sprint — sealed only when sent, by a page that holds the keys. false: known to
   * be set up without encryption. Absent: not known when it was written, so only a page that can
   * check sends it; never the service worker.
   */
  encrypted?: boolean
}

export type ContextSprint = { id: string; workspace_id: string; name: string; status: string; retro_local: string; timezone: string }
export type ContextRecord = { key: string; accountId: string; workspaceId: string; workspaceName: string | null; sprint: ContextSprint; fetchedAt: number; v: number }
export type Identity = { account_id: string; display_name: string; workspaces: { id: string; name: string; role: string }[]; savedAt: number }

export class StorageError extends Error {
  constructor(message: string, public quota = false) {
    super(message)
  }
}

export interface LocalStore {
  readonly kind: 'device' | 'memory'
  getDraft(accountId: string, sprintId: string): Promise<Draft | null>
  putDraft(d: Omit<Draft, 'key' | 'v'>): Promise<void>
  deleteDraft(accountId: string, sprintId: string): Promise<void>
  listDrafts(accountId: string): Promise<Draft[]>
  listOutbox(accountId: string): Promise<OutboxItem[]>
  getOutbox(id: string): Promise<OutboxItem | null>
  /** Atomically stores a new submission and removes the draft it came from. */
  enqueue(item: OutboxItem): Promise<void>
  /** Atomically swaps one submission for another (moved to another sprint); drafts are left alone. */
  replace(oldId: string, item: OutboxItem): Promise<void>
  /** Read-modify-write inside one transaction. Returning null leaves the record unchanged. */
  updateOutbox(id: string, fn: (item: OutboxItem) => OutboxItem | null): Promise<OutboxItem | null>
  deleteOutbox(id: string): Promise<void>
  getContext(accountId: string, sprintId: string): Promise<ContextRecord | null>
  putContext(c: Omit<ContextRecord, 'key' | 'v'>): Promise<void>
  listContexts(accountId: string): Promise<ContextRecord[]>
  /** Forget cached context for a workspace (access ended); unsent text stays, its labels go. */
  forgetWorkspace(accountId: string, workspaceId: string): Promise<void>
  getIdentity(): Promise<Identity | null>
  putIdentity(i: Identity): Promise<void>
  /** Everything this device holds for one account. */
  clearAccount(accountId: string): Promise<void>
}

const draftKey = (a: string, s: string) => `${a}|${s}`

/** Older record shapes are upgraded on read, never dropped. */
export function upgradeRecord<T extends { v?: number }>(r: T): T & { v: number } {
  const out = { ...r } as T & { v: number }
  if (!out.v) out.v = 1
  // Future: if (out.v === 1) { ...; out.v = 2 }
  return out
}

// ---------------------------------------------------------------- memory

export function memoryStore(): LocalStore {
  const drafts = new Map<string, Draft>()
  const outbox = new Map<string, OutboxItem>()
  const context = new Map<string, ContextRecord>()
  let identity: Identity | null = null
  const clone = <T,>(x: T): T => structuredClone(x)
  return {
    kind: 'memory',
    async getDraft(a, s) { const d = drafts.get(draftKey(a, s)); return d ? clone(d) : null },
    async putDraft(d) { drafts.set(draftKey(d.accountId, d.sprintId), { ...clone(d), key: draftKey(d.accountId, d.sprintId), v: RECORD_VERSION }) },
    async deleteDraft(a, s) { drafts.delete(draftKey(a, s)) },
    async listDrafts(a) { return [...drafts.values()].filter((d) => d.accountId === a).map(clone) },
    async listOutbox(a) { return [...outbox.values()].filter((i) => i.accountId === a).sort((x, y) => x.createdAt - y.createdAt).map(clone) },
    async getOutbox(id) { const i = outbox.get(id); return i ? clone(i) : null },
    async enqueue(item) { outbox.set(item.id, clone(item)); drafts.delete(draftKey(item.accountId, item.sprintId)) },
    async replace(oldId, item) { outbox.set(item.id, clone(item)); outbox.delete(oldId) },
    async updateOutbox(id, fn) {
      const cur = outbox.get(id)
      if (!cur) return null
      const next = fn(clone(cur))
      if (!next) return null
      outbox.set(id, clone(next))
      return clone(next)
    },
    async deleteOutbox(id) { outbox.delete(id) },
    async getContext(a, s) { const c = context.get(draftKey(a, s)); return c ? clone(c) : null },
    async listContexts(a) { return [...context.values()].filter((c) => c.accountId === a).map(clone) },
    async putContext(c) { context.set(draftKey(c.accountId, c.sprint.id), { ...clone(c), key: draftKey(c.accountId, c.sprint.id), v: RECORD_VERSION }) },
    async forgetWorkspace(a, w) {
      for (const [k, c] of context) if (c.accountId === a && c.workspaceId === w) context.delete(k)
      for (const [k, i] of outbox) if (i.accountId === a && i.workspaceId === w) outbox.set(k, { ...i, sprintName: null })
    },
    async getIdentity() { return identity ? clone(identity) : null },
    async putIdentity(i) { identity = clone(i) },
    async clearAccount(a) {
      for (const [k, d] of drafts) if (d.accountId === a) drafts.delete(k)
      for (const [k, i] of outbox) if (i.accountId === a) outbox.delete(k)
      for (const [k, c] of context) if (c.accountId === a) context.delete(k)
      if (identity?.account_id === a) identity = null
    },
  }
}

// ---------------------------------------------------------------- IndexedDB

const DB_NAME = 'muni-device'
/** IndexedDB schema version (stores and indexes). Record shapes are versioned separately. */
const DB_VERSION = 1

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (e) {
      reject(new StorageError(`This browser won’t let Muni store anything on this device (${(e as Error).message}).`))
      return
    }
    req.onupgradeneeded = (ev) => {
      const db = req.result
      // Each step upgrades from the version before it; nothing already stored is dropped.
      if (ev.oldVersion < 1) {
        db.createObjectStore('drafts', { keyPath: 'key' }).createIndex('accountId', 'accountId')
        db.createObjectStore('outbox', { keyPath: 'id' }).createIndex('accountId', 'accountId')
        db.createObjectStore('context', { keyPath: 'key' }).createIndex('accountId', 'accountId')
        db.createObjectStore('meta', { keyPath: 'key' })
      }
    }
    // Another tab running an older build holds the database open: ask it to let go.
    req.onblocked = () => reject(new StorageError('Muni is open in another tab with an older version. Close or reload that tab, then try again.'))
    req.onsuccess = () => {
      const db = req.result
      db.onversionchange = () => db.close()
      resolve(db)
    }
    req.onerror = () => reject(toStorageError(req.error))
  })
}

function toStorageError(e: DOMException | Error | null): StorageError {
  const quota = !!e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message))
  return new StorageError(quota ? 'This device is out of storage space for Muni.' : `Couldn’t use this device’s storage${e?.message ? ` (${e.message})` : ''}.`, quota)
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(toStorageError(tx.error))
    tx.onabort = () => reject(toStorageError(tx.error))
  })
const result = <T,>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(toStorageError(req.error))
  })

export function deviceStore(): LocalStore {
  let dbp: Promise<IDBDatabase> | null = null
  // A handle another tab closed (clearing local data deletes the database) is opened afresh next time.
  const db = () =>
    (dbp ??= open().then(
      (d) => {
        d.addEventListener('close', () => { dbp = null })
        d.addEventListener('versionchange', () => { dbp = null })
        return d
      },
      (e) => { dbp = null; throw e },
    ))
  async function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<T> | T): Promise<T> {
    const d = await db()
    const t = d.transaction(stores, mode)
    const out = await fn(t)
    await done(t)
    return out
  }
  const byAccount = async <T,>(store: string, a: string) => tx([store], 'readonly', (t) => result(t.objectStore(store).index('accountId').getAll(a) as IDBRequest<T[]>))
  return {
    kind: 'device',
    async getDraft(a, s) { const r = await tx(['drafts'], 'readonly', (t) => result(t.objectStore('drafts').get(draftKey(a, s)))); return r ? upgradeRecord(r as Draft) : null },
    async putDraft(d) { await tx(['drafts'], 'readwrite', (t) => { t.objectStore('drafts').put({ ...d, key: draftKey(d.accountId, d.sprintId), v: RECORD_VERSION }) }) },
    async deleteDraft(a, s) { await tx(['drafts'], 'readwrite', (t) => { t.objectStore('drafts').delete(draftKey(a, s)) }) },
    async listDrafts(a) { return (await byAccount<Draft>('drafts', a)).map(upgradeRecord) },
    async listOutbox(a) { return (await byAccount<OutboxItem>('outbox', a)).map(upgradeRecord).sort((x, y) => x.createdAt - y.createdAt) },
    async getOutbox(id) { const r = await tx(['outbox'], 'readonly', (t) => result(t.objectStore('outbox').get(id))); return r ? upgradeRecord(r as OutboxItem) : null },
    async enqueue(item) {
      // One transaction: the submission exists before we ever say it was saved, and the draft goes with it.
      await tx(['outbox', 'drafts'], 'readwrite', (t) => {
        t.objectStore('outbox').add(item)
        t.objectStore('drafts').delete(draftKey(item.accountId, item.sprintId))
      })
    },
    async replace(oldId, item) {
      await tx(['outbox'], 'readwrite', (t) => {
        t.objectStore('outbox').add(item)
        t.objectStore('outbox').delete(oldId)
      })
    },
    async updateOutbox(id, fn) {
      return tx(['outbox'], 'readwrite', async (t) => {
        const s = t.objectStore('outbox')
        const cur = (await result(s.get(id))) as OutboxItem | undefined
        if (!cur) return null
        const next = fn(upgradeRecord(cur))
        if (!next) return null
        s.put(next)
        return next
      })
    },
    async deleteOutbox(id) { await tx(['outbox'], 'readwrite', (t) => { t.objectStore('outbox').delete(id) }) },
    async getContext(a, s) { const r = await tx(['context'], 'readonly', (t) => result(t.objectStore('context').get(draftKey(a, s)))); return r ? upgradeRecord(r as ContextRecord) : null },
    async listContexts(a) { return (await byAccount<ContextRecord>('context', a)).map(upgradeRecord) },
    async putContext(c) { await tx(['context'], 'readwrite', (t) => { t.objectStore('context').put({ ...c, key: draftKey(c.accountId, c.sprint.id), v: RECORD_VERSION }) }) },
    async forgetWorkspace(a, w) {
      await tx(['context', 'outbox'], 'readwrite', async (t) => {
        const ctx = (await result(t.objectStore('context').index('accountId').getAll(a))) as ContextRecord[]
        for (const c of ctx) if (c.workspaceId === w) t.objectStore('context').delete(c.key)
        const items = (await result(t.objectStore('outbox').index('accountId').getAll(a))) as OutboxItem[]
        for (const i of items) if (i.workspaceId === w) t.objectStore('outbox').put({ ...i, sprintName: null })
      })
    },
    async getIdentity() { const r = (await tx(['meta'], 'readonly', (t) => result(t.objectStore('meta').get('identity')))) as { value: Identity } | undefined; return r?.value ?? null },
    async putIdentity(i) { await tx(['meta'], 'readwrite', (t) => { t.objectStore('meta').put({ key: 'identity', value: i }) }) },
    async clearAccount(a) {
      await tx(['drafts', 'outbox', 'context', 'meta'], 'readwrite', async (t) => {
        for (const store of ['drafts', 'outbox', 'context']) {
          const keys = await result(t.objectStore(store).index('accountId').getAllKeys(a))
          for (const k of keys) t.objectStore(store).delete(k)
        }
        const id = (await result(t.objectStore('meta').get('identity'))) as { value: Identity } | undefined
        if (id?.value.account_id === a) t.objectStore('meta').delete('identity')
      })
    },
  }
}

/** Removes the whole device database (used when the person turns local keeping off and discards). */
export function destroyDeviceStore(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(toStorageError(req.error))
    req.onblocked = () => resolve() // other tabs close their handle via onversionchange
  })
}
