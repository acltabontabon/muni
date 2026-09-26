/**
 * This device's keys and the sprint keys it can open. The glue between the API and crypto.ts:
 *
 * - The account private key lives in this browser's IndexedDB (never on Muni's servers, except
 *   sealed under the recovery key). Browser storage is not a vault: anyone who can use this
 *   browser profile can use the key. Signing out removes it.
 * - Teammates' public keys are pinned the first time this device sees them. A later change is
 *   never used silently: sharing with that person stops until someone confirms the new key.
 * - Responses are decrypted as they arrive (`decryptDeep`); requests to encrypted sprints are
 *   sealed as they leave (`sealRequest`). If sealing fails, the request is not sent. If opening
 *   fails, the value becomes an explicit "can't show this" marker — never the ciphertext, never
 *   a guess.
 */
import {
  b64u, CryptoError, fingerprint, fromB64u, isEnvelope, newKeyPair, newRecoveryKey, newSprintSecret, openEntry, openField, parseEnvelope, publicKeyOf, sealEntry, sealField,
  sprintKeys, unwrapSprintSecret, unwrapWithRecovery, wrapForRecovery, wrapSprintSecret, type EntryContent, type SprintKeys,
} from './crypto'
import type { MyKeys, SprintKeyView } from '@/api/types'

/** Shown in place of anything this device can't open. UI checks `isLocked`. */
export const LOCKED = '⁣Can’t be shown on this device — it doesn’t have the key.'
export const isLocked = (s: unknown) => typeof s === 'string' && s.startsWith('⁣')

type Fetcher = <T>(method: string, path: string, body?: unknown) => Promise<T>

// ------------------------------------------------------------------ device storage

type Stored = { accountId: string; sk: string; pk: string; savedAt: number }
const DB = 'muni-keys'
function idb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => {
      r.result.createObjectStore('keys', { keyPath: 'accountId' })
      r.result.createObjectStore('pins')
    }
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => resolve(null)
  })
}
const memory = { keys: new Map<string, Stored>(), pins: new Map<string, string>() }
async function tx<T>(store: 'keys' | 'pins', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const db = await idb()
  if (!db) return undefined
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode)
    const req = fn(t.objectStore(store))
    t.oncomplete = () => resolve(req.result)
    t.onerror = () => reject(t.error)
  })
}
const storage = {
  async getKey(accountId: string): Promise<Stored | null> {
    try {
      return ((await tx<Stored>('keys', 'readonly', (s) => s.get(accountId))) ?? memory.keys.get(accountId)) || null
    } catch {
      return memory.keys.get(accountId) ?? null
    }
  },
  async putKey(k: Stored) {
    memory.keys.set(k.accountId, k)
    await tx('keys', 'readwrite', (s) => s.put(k)).catch(() => {})
  },
  async deleteKey(accountId: string) {
    memory.keys.delete(accountId)
    await tx('keys', 'readwrite', (s) => s.delete(accountId)).catch(() => {})
    // Pins belong to the account too.
    const db = await idb()
    if (db) {
      const keys = (await tx<IDBValidKey[]>('pins', 'readonly', (s) => s.getAllKeys()).catch(() => [])) ?? []
      for (const k of keys) if (String(k).startsWith(`${accountId}|`)) await tx('pins', 'readwrite', (s) => s.delete(k)).catch(() => {})
    }
    for (const k of [...memory.pins.keys()]) if (k.startsWith(`${accountId}|`)) memory.pins.delete(k)
  },
  async getPin(key: string): Promise<string | null> {
    const v = (await tx<string>('pins', 'readonly', (s) => s.get(key)).catch(() => undefined)) ?? memory.pins.get(key)
    return v ?? null
  },
  async putPin(key: string, pk: string) {
    memory.pins.set(key, pk)
    await tx('pins', 'readwrite', (s) => s.put(pk, key)).catch(() => {})
  },
}

// ------------------------------------------------------------------ state

export type DeviceState =
  | { kind: 'unknown' }
  /** No key anywhere yet: set up on this device. */
  | { kind: 'none' }
  /** The account has a key, but this device doesn't hold it. */
  | { kind: 'locked'; recoveryAvailable: boolean }
  | { kind: 'ready'; fingerprint: string; recoverySaved: boolean }

type SprintState = { view: SprintKeyView; keys: Map<number, SprintKeys>; fetchedAt: number }
export type KeyChange = { sprintId: string; accountId: string; name: string }

let fetcher: Fetcher | null = null
let accountId: string | null = null
let sk: Uint8Array | null = null
let server: MyKeys | null = null
let state: DeviceState = { kind: 'unknown' }
const sprints = new Map<string, SprintState>()
const listeners = new Set<() => void>()
const changes = new Map<string, KeyChange>()
const emit = () => listeners.forEach((l) => l())

export const keyring = {
  subscribe(l: () => void) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
  state: () => state,
  keyChanges: () => [...changes.values()],
  accountId: () => accountId,
  publicKey: () => (sk ? publicKeyOf(sk) : server?.public_key ? fromB64u(server.public_key, 32) : null),

  /** Called when the signed-in account changes (or on sign-out, with null). */
  async use(id: string | null, f: Fetcher) {
    fetcher = f
    if (id === accountId && state.kind !== 'unknown') return
    accountId = id
    sk = null
    server = null
    sprints.clear()
    changes.clear()
    state = { kind: 'unknown' }
    if (!id) return emit()
    await keyring.refresh()
  },

  async refresh() {
    if (!accountId || !fetcher) return
    const local = await storage.getKey(accountId)
    try {
      server = await fetcher<MyKeys>('GET', '/api/me/keys')
    } catch {
      // Offline: trust what this device has; the server check runs when it's back.
      if (local) sk = fromB64u(local.sk, 32)
      state = local ? { kind: 'ready', fingerprint: fingerprint(fromB64u(local.pk, 32)), recoverySaved: true } : { kind: 'unknown' }
      return emit()
    }
    if (!server.public_key) state = { kind: 'none' }
    else if (local && local.pk === server.public_key) {
      sk = fromB64u(local.sk, 32)
      state = { kind: 'ready', fingerprint: fingerprint(fromB64u(local.pk, 32)), recoverySaved: !!server.recovery_confirmed_at }
    } else {
      // A key this device kept no longer matches the account's (replaced elsewhere): don't use it.
      if (local) await storage.deleteKey(accountId)
      sk = null
      state = { kind: 'locked', recoveryAvailable: !!server.recovery_blob }
    }
    emit()
  },

  /** First device: create the account key and a recovery key. Returns the recovery key to show once. */
  async setup(opts: { replace?: boolean } = {}): Promise<string> {
    if (!accountId || !fetcher) throw new CryptoError('no-key', 'Sign in first.')
    const kp = newKeyPair()
    const recovery = newRecoveryKey()
    await fetcher('PUT', '/api/me/keys', { public_key: b64u(kp.pk), recovery_blob: wrapForRecovery(kp.sk, recovery, accountId), replace: opts.replace })
    await storage.putKey({ accountId, sk: b64u(kp.sk), pk: b64u(kp.pk), savedAt: Date.now() })
    sprints.clear()
    await keyring.refresh()
    return recovery
  },

  /** Another device, or after clearing this one: open the key with the recovery key. */
  async unlock(recoveryText: string) {
    if (!accountId || !fetcher) throw new CryptoError('no-key', 'Sign in first.')
    const k = await fetcher<MyKeys>('GET', '/api/me/keys')
    if (!k.recovery_blob || !k.public_key) throw new CryptoError('no-key', 'There’s no recovery information for this account.')
    const opened = unwrapWithRecovery(k.recovery_blob, recoveryText, accountId)
    // The unwrapped key must match the account's published key, or it's not ours to use.
    if (b64u(publicKeyOf(opened)) !== k.public_key) throw new CryptoError('mismatch', 'That recovery key belongs to an older key for this account.')
    await storage.putKey({ accountId, sk: b64u(opened), pk: k.public_key, savedAt: Date.now() })
    sprints.clear()
    await keyring.refresh()
  },

  /** A fresh recovery key replaces the old one. Needs this device's key. */
  async newRecovery(): Promise<string> {
    if (!accountId || !fetcher || !sk) throw new CryptoError('no-key', 'Unlock this device first.')
    const recovery = newRecoveryKey()
    await fetcher('POST', '/api/me/keys/recovery', { recovery_blob: wrapForRecovery(sk, recovery, accountId) })
    await keyring.refresh()
    return recovery
  },
  async confirmRecoverySaved() {
    await fetcher?.('POST', '/api/me/keys/recovery', { confirmed: true })
    await keyring.refresh()
  },

  /** Forget this device's copy (sign-out, or "remove keys from this device"). */
  async forget() {
    if (accountId) await storage.deleteKey(accountId)
    sk = null
    sprints.clear()
    state = server?.public_key ? { kind: 'locked', recoveryAvailable: !!server.recovery_blob } : { kind: 'none' }
    emit()
  },

  // ---------------------------------------------------------------- sprints

  /** The sprint's key view and the versions this device can open. Cached briefly. */
  async sprint(sprintId: string, fresh = false): Promise<SprintState | null> {
    const cur = sprints.get(sprintId)
    if (cur && !fresh && Date.now() - cur.fetchedAt < 20_000) return cur
    if (!fetcher) return null
    const pending = inflight.get(sprintId)
    if (pending && !fresh) return pending
    const p = loadSprint(sprintId).finally(() => inflight.delete(sprintId))
    inflight.set(sprintId, p)
    return p
  },
  forgetSprint(sprintId: string) {
    sprints.delete(sprintId)
  },
  /** Is this sprint encrypted? (Known from any detail response the app has seen.) */
  async isEncrypted(sprintId: string) {
    const s = await keyring.sprint(sprintId)
    return !!s?.view.encryption
  },

  /** Newest discussion key this device holds, for writing. */
  async writeKeys(sprintId: string): Promise<SprintKeys> {
    const s = await keyring.sprint(sprintId)
    const k = s ? [...s.keys.values()].sort((a, b) => b.version - a.version)[0] : null
    if (!k) throw new CryptoError('no-key', 'This device doesn’t have this sprint’s key yet.')
    return k
  },

  /** A thought, sealed to the sprint's newest key and to its author. */
  async sealThought(sprintId: string, recordId: string, content: EntryContent): Promise<string> {
    if (!accountId) throw new CryptoError('no-key', 'Sign in first.')
    const s = await keyring.sprint(sprintId)
    const latest = s?.view.versions?.at(-1)
    const mine = keyring.publicKey()
    if (!latest || !mine) throw new CryptoError('no-key', 'Set up encryption on this device to send thoughts to this sprint.')
    return sealEntry({ sprintId, recordId, version: latest.version, sprintPk: fromB64u(latest.public_key, 32), authorId: accountId, authorPk: mine }, content)
  },

  /**
   * Wraps for everyone in the sprint who should hold a version and doesn't: every version this
   * device holds, except a still-sealed one (which only ever goes to the facilitator). Keys that
   * changed since this device pinned them are skipped and reported, never used.
   */
  async missingWraps(sprintId: string, opts: { reveal?: boolean } = {}) {
    const s = await keyring.sprint(sprintId, true)
    if (!s?.view.encryption || !accountId) return []
    const out: { account_id: string; version: number; recipient_public_key: string; wrapped: string }[] = []
    for (const p of s.view.participants ?? []) {
      if (!p.public_key || p.account_id === accountId) continue
      if (!(await keyring.trust(sprintId, p.account_id, p.display_name, p.public_key))) continue
      for (const version of s.keys.keys()) {
        const sealed = s.view.sealed_version === version && !opts.reveal
        if (sealed && !p.is_facilitator) continue
        if (p.versions_held.includes(version)) continue
        out.push({ account_id: p.account_id, version, recipient_public_key: p.public_key, wrapped: '' })
      }
    }
    // The secrets themselves come from the unwrapped wraps this device holds.
    for (const w of out) {
      const secret = secretOf(sprintId, w.version)
      w.wrapped = wrapSprintSecret(fromB64u(w.recipient_public_key, 32), secret, { sprintId, version: w.version, recipientId: w.account_id })
    }
    return out
  },

  /** Share whatever this device can with people in the sprint who lack it. Quiet; best effort. */
  async shareMissing(sprintId: string) {
    try {
      const wraps = await keyring.missingWraps(sprintId)
      if (wraps.length && fetcher) {
        await fetcher('POST', `/api/sprints/${sprintId}/keys/wraps`, { wraps })
        sprints.delete(sprintId)
      }
    } catch {
      /* someone else's device, or the next visit, will do it */
    }
  },

  /** Trust on first use. False (and reported) if this person's key changed since it was pinned. */
  async trust(sprintId: string, otherId: string, name: string, pk: string) {
    if (!accountId) return false
    const pinKey = `${accountId}|${otherId}`
    const pinned = await storage.getPin(pinKey)
    if (!pinned) {
      await storage.putPin(pinKey, pk)
      return true
    }
    if (pinned === pk) return true
    changes.set(`${sprintId}|${otherId}`, { sprintId, accountId: otherId, name })
    emit()
    return false
  },
  /** After checking with them (in person, or by comparing the fingerprint), accept a new key. */
  async acceptKeyChange(otherId: string, pk: string) {
    if (!accountId) return
    await storage.putPin(`${accountId}|${otherId}`, pk)
    for (const [k, c] of changes) if (c.accountId === otherId) changes.delete(k)
    emit()
  },

  /** A new sprint (or a new key version on reopening): its secret, sealed to the facilitator. */
  newSprintKey(sprintId: string, version: number, facilitator: { account_id: string; public_key: string }) {
    const secret = newSprintSecret()
    const k = sprintKeys(secret, version)
    pendingSecrets.set(`${sprintId}|${version}`, secret)
    return {
      sprint_key: { version, public_key: b64u(k.pk) },
      key_wraps: [{ account_id: facilitator.account_id, version, recipient_public_key: facilitator.public_key, wrapped: wrapSprintSecret(fromB64u(facilitator.public_key, 32), secret, { sprintId, version, recipientId: facilitator.account_id }) }],
    }
  },

  /** Seal a field for a sprint this device is creating (its secret isn't on the server yet). */
  sealForNew(sprintId: string, version: number, field: string, text: string) {
    const secret = pendingSecrets.get(`${sprintId}|${version}`)
    if (!secret) throw new CryptoError('no-key', 'No key for the new sprint.')
    return sealField(sprintKeys(secret, version), sprintId, field, text)
  },

  /** Every version this device holds, sealed to one person (a new facilitator). */
  async wrapAllFor(sprintId: string, recipient: { account_id: string; public_key: string }) {
    const s = await keyring.sprint(sprintId, true)
    return [...(s?.keys.keys() ?? [])].map((version) => ({ account_id: recipient.account_id, version, recipient_public_key: recipient.public_key, wrapped: wrapSprintSecret(fromB64u(recipient.public_key, 32), secretOf(sprintId, version), { sprintId, version, recipientId: recipient.account_id }) }))
  },

  // ---------------------------------------------------------------- responses & requests

  decryptDeep,
  sealRequest,
}

const inflight = new Map<string, Promise<SprintState>>()
async function loadSprint(sprintId: string): Promise<SprintState> {
  const view = await fetcher!<SprintKeyView>('GET', `/api/sprints/${sprintId}/keys`)
  const keys = new Map<number, SprintKeys>()
  if (view.encryption && sk && accountId)
    for (const w of view.my_wraps ?? []) {
      try {
        keys.set(w.version, sprintKeys(unwrapSprintSecret(sk, w.wrapped, { sprintId, version: w.version, recipientId: accountId }), w.version))
      } catch {
        /* sealed to an older key of ours: unusable, and never guessed around */
      }
    }
  const s = { view, keys, fetchedAt: Date.now() }
  sprints.set(sprintId, s)
  return s
}

/** Secrets unwrapped from this device's wraps, or created here and not yet round-tripped. */
const pendingSecrets = new Map<string, Uint8Array>()
function secretOf(sprintId: string, version: number): Uint8Array {
  const p = pendingSecrets.get(`${sprintId}|${version}`)
  if (p) return p
  const s = sprints.get(sprintId)
  const wrap = s?.view.my_wraps?.find((w) => w.version === version)
  if (!wrap || !sk || !accountId) throw new CryptoError('no-key', 'This device doesn’t hold that key.')
  return unwrapSprintSecret(sk, wrap.wrapped, { sprintId, version, recipientId: accountId })
}

// Some fields carry a copy of another field's text (an experiment keeps its theme's title).
const ALIASES: Record<string, string[]> = { theme_title: ['title'], cancel_reason: ['reason'], reason: ['order_reason', 'reason'] }

async function openString(value: string, field: string, owner: Record<string, unknown> | null, sprintHint: string | null): Promise<unknown> {
  let env
  try {
    env = parseEnvelope(value)
  } catch {
    return LOCKED
  }
  const sprintId = env.s
  // An envelope must belong to the sprint it was delivered with.
  const declared = (owner?.sprint_id as string | undefined) ?? sprintHint
  if (declared && declared !== sprintId) return LOCKED
  let s: SprintState | null
  try {
    s = await keyring.sprint(sprintId)
  } catch {
    return LOCKED
  }
  try {
    if (env.t === 'e') {
      const recordId = (owner?.id as string | undefined) ?? ''
      const content = openEntry(env, { sprintId, recordId }, { sprint: s?.keys.get(env.k) ?? null, accountSk: sk })
      return content
    }
    const keys = s?.keys.get(env.k)
    if (!keys) return LOCKED
    const allowed = ALIASES[field] ?? [field]
    for (const f of allowed) {
      if (env.f !== f) continue
      return openField(env, keys, { sprintId, field: f })
    }
    return LOCKED
  } catch {
    return LOCKED
  }
}

/** Replaces every envelope in a response with what it says (or LOCKED). Returns a new value. */
async function decryptDeep<T>(data: T, sprintHint: string | null = null): Promise<T> {
  const walk = async (v: unknown, field: string, owner: Record<string, unknown> | null): Promise<unknown> => {
    if (typeof v === 'string') return isEnvelope(v) ? openString(v, field, owner, sprintHint) : v
    if (Array.isArray(v)) return Promise.all(v.map((x) => walk(x, field, owner)))
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(o)) {
        const opened = await walk(x, k, o)
        // A thought's envelope opens to its text and its context.
        if (k === 'body' && opened && typeof opened === 'object' && !Array.isArray(opened) && typeof (opened as EntryContent).body === 'string') {
          out.body = (opened as EntryContent).body
          out.impact = (opened as EntryContent).impact
          out.might_help = (opened as EntryContent).might_help
        } else if (!(k in out)) out[k] = opened
        else if (k !== 'impact' && k !== 'might_help') out[k] = opened
      }
      if (Object.values(out).some(isLocked)) out.__locked = true
      return out
    }
    return v
  }
  return (await walk(data, '', null)) as T
}

/** Content fields per endpoint. Anything listed is sealed before it leaves this device. */
const SEALED: [RegExp, string[]][] = [
  [/^\/api\/sprints\/[^/]+\/themes(\/[^/]+)?(\/split)?$/, ['title', 'summary', 'question', 'draft_experiment', 'order_reason', 'reset_voting_reason']],
  [/^\/api\/sprints\/[^/]+\/themes\/(ungroup|reorder|[^/]+\/merge)$/, ['reset_voting_reason', 'reason']],
  [/^\/api\/sprints\/[^/]+\/ai\/proposals\/[^/]+\/apply$/, ['reset_voting_reason']],
  [/^\/api\/sprints\/[^/]+\/meeting\/notes\/[^/]+$/, ['takeaway', 'what_happened', 'impact', 'could_try', 'notes']],
  [/^\/api\/sprints\/[^/]+\/meeting\/context$/, ['body']],
  [/^\/api\/sprints\/[^/]+\/experiments(\/[^/]+)?$/, ['change_to_try', 'success_signal', 'outcome_note']],
  [/^\/api\/sprints\/[^/]+\/recap$/, ['body']],
  [/^\/api\/sprints\/[^/]+\/votes\/rounds\/close$/, ['reason']],
  [/^\/api\/sprints\/[^/]+$/, ['opening_question']],
]

async function sealRequest(method: string, path: string, body: unknown): Promise<unknown> {
  if (method === 'GET' || !body || typeof body !== 'object') return body
  const m = path.match(/^\/api\/sprints\/([^/?]+)/)
  if (!m) return body
  const rule = SEALED.find(([re]) => re.test(path.split('?')[0]))
  if (!rule) return body
  const sprintId = m[1]
  if (!(await keyring.isEncrypted(sprintId))) return body
  const o = { ...(body as Record<string, unknown>) }
  const present = rule[1].filter((f) => typeof o[f] === 'string' && (o[f] as string).trim() !== '')
  if (!present.length) return body
  // Throws when this device can't seal: the request is never sent in plaintext.
  const keys = await keyring.writeKeys(sprintId)
  for (const f of present) o[f] = sealField(keys, sprintId, f === 'reset_voting_reason' ? 'reason' : f, (o[f] as string).trim())
  return o
}

export { fingerprint, fromB64u }
