/**
 * This device's keys and the sprint keys it can open. The glue between the API and crypto.ts:
 *
 * - The account private key is held only in memory. It gets here by being reopened, never by being
 *   read from storage in plaintext (wrap.ts): from this device's envelope once the person is signed
 *   in, from a passkey's PRF output during a passkey sign-in, or from the recovery key. A brand-new
 *   account gets a key automatically. Signing out drops it from memory; what stays on the device
 *   can't be opened again without signing in again. "Forget this device" removes that too.
 * - Teammates' public keys are pinned the first time this device sees them. A later change is
 *   never used silently: sharing with that person stops until someone confirms the new key.
 * - Responses are decrypted as they arrive (`decryptDeep`); requests to encrypted sprints are
 *   sealed as they leave (`sealRequest`). If sealing fails, the request is not sent. If opening
 *   fails, the value becomes an explicit "can't show this" marker — never the ciphertext, never
 *   a guess.
 * - Every step of reopening checks an epoch: signing out (or switching account) while a step is in
 *   flight means its result is thrown away, so a sign-out can never be undone by a late response.
 */
import {
  b64u, CryptoError, fingerprint, fromB64u, isEnvelope, newKeyPair, newRecoveryKey, newSprintSecret, openEntry, openField, parseEnvelope, publicKeyOf, sealEntry, sealField,
  sprintKeys, unwrapSprintSecret, unwrapWithRecovery, wrapForRecovery, wrapSprintSecret, type EntryContent, type SprintKeys,
} from './crypto'
import { deviceKek, kekFromPrf, openForDevice, openPasskeyWrap, sealForDevice, wrapForPasskey, type WrapBinding } from './wrap'
import { defaultDeviceStore, type DeviceRecord, type DeviceStore } from './devicestore'
import type { MyKeys, SprintKeyView } from '@/api/types'

/** Shown in place of anything this device can't open. UI checks `isLocked`. */
export const LOCKED = '⁣Can’t be shown on this device — it doesn’t have the key.'
export const isLocked = (s: unknown) => typeof s === 'string' && s.startsWith('⁣')

type Fetcher = <T>(method: string, path: string, body?: unknown) => Promise<T>

// ------------------------------------------------------------------ state

/** The ways back in this account has, for honest warnings ("this device is the only one"). */
export type UnlockMethods = { passkeys: number; recovery: boolean; thisDevice: boolean }

export type DeviceState =
  | { kind: 'signed-out' }
  /** Reopening the key — usually a moment. At most a quiet "Unlocking…", never a warning. */
  | { kind: 'restoring' }
  /** `persisted`: kept for next time on this device (null while that's still being saved). */
  | { kind: 'ready'; fingerprint: string; recoverySaved: boolean; methods: UnlockMethods; persisted: boolean | null }
  /** One confirmation with a passkey unlocks this device. `note` explains a try that didn't. */
  | { kind: 'needs-passkey'; recoveryAvailable: boolean; note?: string }
  /** Nothing here can unlock it without the recovery key (or a passkey that unlocks, if it has one). */
  | { kind: 'locked'; recoveryAvailable: boolean; passkeys: number; note?: string }
  /** Muni can't be reached to reopen it. Writing still works; sending waits. */
  | { kind: 'offline' }
  | { kind: 'error'; message: string }

type SprintState = { view: SprintKeyView; keys: Map<number, SprintKeys>; fetchedAt: number }
export type KeyChange = { sprintId: string; accountId: string; name: string }
/** A passkey's wrapping key from a ceremony in this tab, waiting for the account it belongs to. */
type PendingPrf = { accountId: string; credentialId: string; rowId: string | null; kek: CryptoKey; at: number }

let store: DeviceStore = defaultDeviceStore()
let fetcher: Fetcher | null = null
let accountId: string | null = null
let sk: Uint8Array | null = null
let server: MyKeys | null = null
let state: DeviceState = { kind: 'signed-out' }
let epoch = 0
let keysEpoch = 0
let pendingPrf: PendingPrf[] = []
/** Set by the app: true when another tab signed out or switched account since this one looked. */
let staleCheck: (() => void) | null = null
/**
 * The page is being left (navigating away, reloading, closing: the app reports `pagehide`). While
 * it goes, the browser aborts storage writes — so a new key that couldn't be kept here for that
 * reason is never published. The next page sets one up afresh. Published with nothing on this
 * device to reopen it, it would have to ask for the passkey on the very next page.
 */
let leaving = false
const sprints = new Map<string, SprintState>()
const listeners = new Set<() => void>()
const changes = new Map<string, KeyChange>()
const emit = () => listeners.forEach((l) => l())
const set = (s: DeviceState) => {
  state = s
  emit()
}

const PRF_TTL_MS = 2 * 60_000
const REQUEST_TIMEOUT_MS = 15_000
const status = (e: unknown) => (e as { status?: number } | null)?.status
const code = (e: unknown) => (e as { code?: string } | null)?.code
const unreachable = (e: unknown) => status(e) === 0
const matches = (opened: Uint8Array, k: MyKeys | null) => !!k?.public_key && b64u(publicKeyOf(opened)) === k.public_key
const installed = () => typeof window !== 'undefined' && !!window.matchMedia?.('(display-mode: standalone)').matches

/** A request that can't hang a reopening step (and the lock it holds) forever. */
function timed<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error('Muni took too long to answer.'), { status: 0, code: 'timeout' })), REQUEST_TIMEOUT_MS)
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    )
  })
}

/** One reopening at a time per account: across tabs (Web Locks), or within this one where there are none. */
const localLocks = new Map<string, Promise<unknown>>()
function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks
  if (locks) return locks.request(name, fn) as Promise<T>
  const next = (localLocks.get(name) ?? Promise.resolve()).catch(() => {}).then(fn)
  localLocks.set(name, next.catch(() => {}))
  return next
}

function pendingFor(id: string) {
  const now = Date.now()
  pendingPrf = pendingPrf.filter((p) => now - p.at < PRF_TTL_MS)
  return pendingPrf.filter((p) => p.accountId === id)
}
function clearCaches() {
  sprints.clear()
  inflight.clear()
}
function readyState(persisted: boolean | null): DeviceState {
  return {
    kind: 'ready',
    fingerprint: fingerprint(publicKeyOf(sk!)),
    recoverySaved: !!server?.recovery_confirmed_at,
    methods: { passkeys: server?.passkeys?.length ?? 0, recovery: !!server?.recovery_blob, thisDevice: persisted !== false },
    persisted,
  }
}
const binding = (k: MyKeys, id: string): WrapBinding => ({ accountId: accountId!, id, keyVersion: k.key_version, publicKey: k.public_key! })

// ------------------------------------------------------------------ reopening the account key

/**
 * Find a way to reopen the account key, in order: already open in this tab; this device's
 * envelope; a passkey used in this tab just now; a plaintext key an older build left here (moved
 * into an envelope). A new account gets a key. Otherwise the person is asked — as little as
 * possible. A missing key here is never taken to mean the account is new: only the server says so.
 */
async function reopen(my: number, depth = 0): Promise<void> {
  const id = accountId
  if (!id || !fetcher || my !== epoch) return
  let k: MyKeys
  try {
    k = await timed(fetcher<MyKeys>('GET', '/api/me/keys'))
  } catch (e) {
    if (my !== epoch || sk) return
    return set(unreachable(e) ? { kind: 'offline' } : { kind: 'error', message: 'Muni couldn’t check your encryption key just now. Try again in a moment.' })
  }
  if (my !== epoch) return
  server = { ...k, passkeys: k.passkeys ?? [], session_passkey: k.session_passkey ?? null }
  k = server

  if (sk) {
    if (matches(sk, k)) return settleReady(my, state.kind === 'ready' ? state.persisted : true)
    // Replaced on another device ("Start over"): this key can't be used any more.
    sk = null
    clearCaches()
  }

  if (!k.public_key) {
    const [dev, legacy] = await Promise.all([store.getDevice(id).catch(() => null), store.getLegacy(id)])
    if (my !== epoch) return
    // A key made here whose publishing didn't finish (the tab closed or reloaded at that moment):
    // it was kept first, so open it and finish — never make a second one.
    if (dev && !legacy && depth === 0) {
      const resumed = await resumeSetup(my, id, dev)
      if (resumed || my !== epoch) return
    }
    if (dev || legacy) return set({ kind: 'error', message: 'Muni’s server says your account has no encryption key, but this device has one. Nothing was changed — try again later.' })
    if (depth > 0) return set({ kind: 'error', message: 'Couldn’t set up encryption on this device. Try again in a moment.' })
    return setUpNew(my, id, depth)
  }

  // This device's envelope: every reload, and signing in again here.
  let passkeyRequired = false
  let dev = await store.getDevice(id).catch(() => null)
  if (dev && (dev.keyVersion !== k.key_version || dev.pk !== k.public_key)) {
    await store.deleteDevice(id).catch(() => {})
    dev = null
  }
  if (dev) {
    try {
      const r = await timed(fetcher<{ share: string }>('POST', `/api/me/devices/${dev.deviceId}/unlock`, {}))
      if (my !== epoch) return
      const kek = await deviceKek(fromB64u(dev.ds, 32), fromB64u(r.share, 32), { accountId: id, deviceId: dev.deviceId })
      const opened = await openForDevice(kek, dev.envelope, binding(k, dev.deviceId))
      if (my !== epoch) return
      if (matches(opened, k)) return unlocked(my, opened, 'device')
    } catch (e) {
      if (my !== epoch) return
      if (code(e) === 'passkey_required') passkeyRequired = true
      else if (code(e) === 'device_unknown') await store.deleteDevice(id).catch(() => {})
      else if (unreachable(e)) return set({ kind: 'offline' })
      else if (!(e instanceof CryptoError)) return set({ kind: 'error', message: 'Muni couldn’t unlock your writing on this device just now. Try again in a moment.' })
    }
  }

  // A passkey used in this tab just now (signing in, or confirming it's you) that can unlock.
  const tried = pendingFor(id)
  for (const p of tried) {
    const w = k.passkeys.find((x) => x.webauthn_id === p.credentialId)
    if (!w) continue
    try {
      const opened = await openPasskeyWrap(p.kek, w.wrapped, binding(k, p.credentialId))
      if (my !== epoch) return
      if (matches(opened, k)) return unlocked(my, opened, 'passkey')
    } catch {
      /* not a wrap this passkey opens: try the next way */
    }
  }

  // A key an older build kept here in plaintext: moved into an envelope, then deleted.
  const legacy = await store.getLegacy(id)
  if (my !== epoch) return
  if (legacy && legacy.pk === k.public_key) {
    try {
      const opened = fromB64u(legacy.sk, 32)
      if (matches(opened, k)) return unlocked(my, opened, 'legacy')
    } catch {
      /* unreadable: keep it, never delete what might be someone's only copy */
    }
  }

  // Nothing here can reopen it without the person.
  const note = lastCeremony?.accountId === id && Date.now() - lastCeremony.at < PRF_TTL_MS ? (lastCeremony.prf ? 'That passkey can’t unlock your writing here. Try another passkey, or use your recovery key.' : 'The passkey you used can sign you in, but it can’t unlock encrypted writing in this browser.') : undefined
  if (k.passkeys.length || passkeyRequired) return set({ kind: 'needs-passkey', recoveryAvailable: !!k.recovery_blob, note })
  set({ kind: 'locked', recoveryAvailable: !!k.recovery_blob, passkeys: 0, note })
}

/** What the last passkey ceremony in this tab could offer (for honest messages). */
let lastCeremony: { accountId: string; credentialId: string; prf: boolean; at: number } | null = null

/** How the key was opened. 'kept': made here and kept before it was published; 'made': made here, not kept yet. */
type Via = 'device' | 'kept' | 'made' | 'passkey' | 'recovery' | 'legacy'

/** The key is open: usable at once; kept for next time (and passkeys enrolled) right after. */
async function unlocked(my: number, opened: Uint8Array, via: Via) {
  if (my !== epoch) return
  sk = opened
  clearCaches()
  keysEpoch++
  const alreadyKept = via === 'device' || via === 'kept'
  set(readyState(alreadyKept ? true : null))
  // An older build's copy stays until its envelope is verified, so it still counts as kept.
  const persisted = alreadyKept ? true : (await keepOpenKey(my, via)) || via === 'legacy'
  if (my !== epoch) return
  await settleReady(my, persisted)
}

async function settleReady(my: number, persisted: boolean | null) {
  await enrolPending(my)
  if (my !== epoch || !sk) return
  pendingPrf = pendingPrf.filter((p) => p.accountId !== accountId)
  set(readyState(persisted))
}

/**
 * This device's envelope for a key, replacing any older one. Verified before it's relied on:
 * stored, read back and reopened to the right key. `forVersion` makes it for a key about to be
 * published (a first key, or starting over). Returns the device id, or null when the browser
 * wouldn't keep it.
 */
async function keepOnDevice(my: number, id: string, key: Uint8Array, target: { publicKey: string; keyVersion: number; forVersion?: number }): Promise<{ deviceId: string; share: Uint8Array } | null> {
  if (!fetcher) return null
  const old = await store.getDevice(id).catch(() => null)
  const deviceId = crypto.randomUUID()
  let share: Uint8Array
  try {
    const r = await timed(fetcher<{ created: boolean; share?: string }>('PUT', `/api/me/devices/${deviceId}`, { replaces: old?.deviceId ?? null, installed: installed(), ...(target.forVersion ? { for_version: target.forVersion } : {}) }))
    if (!r.created || !r.share) return null
    share = fromB64u(r.share, 32)
  } catch {
    return null
  }
  const ds = crypto.getRandomValues(new Uint8Array(32))
  const b: WrapBinding = { accountId: id, id: deviceId, keyVersion: target.keyVersion, publicKey: target.publicKey }
  try {
    const envelope = await sealForDevice(await deviceKek(ds, share, { accountId: id, deviceId }), key, b)
    if (my !== epoch) return null
    await store.putDevice({ accountId: id, deviceId, ds: b64u(ds), envelope, keyVersion: target.keyVersion, pk: target.publicKey, savedAt: Date.now() })
    const back = await store.getDevice(id)
    if (!back || back.deviceId !== deviceId) return null
    const reopened = await openForDevice(await deviceKek(fromB64u(back.ds, 32), share, { accountId: id, deviceId }), back.envelope, b)
    if (b64u(publicKeyOf(reopened)) !== target.publicKey) return null
  } catch {
    return null
  } finally {
    ds.fill(0)
  }
  return { deviceId, share }
}

/** Keep the key that's open now (after a passkey, recovery key or older build's copy opened it). */
async function keepOpenKey(my: number, via: Via): Promise<boolean> {
  const id = accountId
  const k = server
  if (!id || !k?.public_key || !sk) return false
  const kept = await keepOnDevice(my, id, sk, { publicKey: k.public_key, keyVersion: k.key_version })
  if (!kept) return false
  if (via === 'legacy') await retireLegacy(my, id, kept.deviceId, kept.share)
  return true
}

/** Finish a setup that kept its key here but didn't get to publish it. True if it did. */
async function resumeSetup(my: number, id: string, dev: DeviceRecord): Promise<boolean> {
  try {
    const r = await timed(fetcher!<{ share: string }>('POST', `/api/me/devices/${dev.deviceId}/unlock`, {}))
    if (my !== epoch) return false
    const opened = await openForDevice(await deviceKek(fromB64u(dev.ds, 32), fromB64u(r.share, 32), { accountId: id, deviceId: dev.deviceId }), dev.envelope, { accountId: id, id: dev.deviceId, keyVersion: dev.keyVersion, publicKey: dev.pk })
    if (b64u(publicKeyOf(opened)) !== dev.pk || dev.keyVersion !== 1) return false
    await timed(fetcher!('PUT', '/api/me/keys', { public_key: dev.pk, device: dev.deviceId }))
    const fresh = await timed(fetcher!<MyKeys>('GET', '/api/me/keys'))
    if (my !== epoch) return false
    server = { ...fresh, passkeys: fresh.passkeys ?? [], session_passkey: fresh.session_passkey ?? null }
    if (!matches(opened, server)) return false
    await unlocked(my, opened, 'kept')
    return true
  } catch {
    return false
  }
}

/**
 * The plaintext key an older build kept is deleted only once its envelope has been reopened with
 * a share the server released under its normal rule (so the next visit can reopen it too). If the
 * rule refuses this session (a passkey added after the device was set up), the old copy stays until
 * a sign-in with an earlier passkey, or until signing out.
 */
async function retireLegacy(my: number, id: string, deviceId: string, share: Uint8Array) {
  try {
    const r = await timed(fetcher!<{ share: string }>('POST', `/api/me/devices/${deviceId}/unlock`, {}))
    if (my !== epoch || r.share !== b64u(share)) return
    await store.deleteLegacy(id)
  } catch {
    /* kept for now: see above */
  }
}

/** Passkeys used in this tab that can't unlock yet get a wrap of the open key (no extra prompt). */
async function enrolPending(my: number) {
  const id = accountId
  if (!id || !fetcher) return
  for (const p of pendingFor(id)) {
    const k = server
    if (!sk || !k?.public_key || my !== epoch) return
    if (k.passkeys.some((w) => w.webauthn_id === p.credentialId)) continue
    const rowId = p.rowId ?? (k.session_passkey?.webauthn_id === p.credentialId ? k.session_passkey.id : null)
    if (!rowId) continue
    const b = binding(k, p.credentialId)
    try {
      const wrapped = await wrapForPasskey(p.kek, sk, b)
      if (!matches(await openPasskeyWrap(p.kek, wrapped, b), k)) continue
      await timed(fetcher('PUT', `/api/me/keys/passkeys/${rowId}`, { wrapped, key_version: k.key_version, public_key: k.public_key }))
      if (my !== epoch) return
      server = { ...k, passkeys: [...k.passkeys, { credential: rowId, webauthn_id: p.credentialId, key_version: k.key_version, wrapped }] }
    } catch {
      /* the next time this passkey is used */
    }
  }
}

/** A genuinely new account (the server says it has no key): make one, no questions. */
async function setUpNew(my: number, id: string, depth: number) {
  const kp = newKeyPair()
  const publicKey = b64u(kp.pk)
  const k = server!
  const p = pendingFor(id).find((x) => x.rowId || k.session_passkey?.webauthn_id === x.credentialId)
  let passkey_wrap: { credential: string; wrapped: string } | undefined
  if (p) passkey_wrap = { credential: p.rowId ?? k.session_passkey!.id, wrapped: await wrapForPasskey(p.kek, kp.sk, { accountId: id, id: p.credentialId, keyVersion: 1, publicKey }) }
  // Kept on this device first, then published: a reload or a closed tab in between can't leave the
  // account with a key nobody holds. (If this browser won't keep it, it's published anyway — a
  // passkey wrap, if any, still holds it — and the person is told it isn't saved here.)
  const kept = await keepOnDevice(my, id, kp.sk, { publicKey, keyVersion: 1, forVersion: 1 })
  if (my !== epoch) return
  // Not kept because the page is going away: publish nothing (see `leaving`). If it stays after all
  // (a navigation that didn't happen), try again in a moment.
  if (!kept && leaving) {
    setTimeout(() => {
      if (my === epoch && !leaving && !sk) void keyring.refresh()
    }, 2000)
    return
  }
  try {
    await timed(fetcher!('PUT', '/api/me/keys', { public_key: publicKey, ...(passkey_wrap ? { passkey_wrap } : {}), ...(kept ? { device: kept.deviceId } : {}) }))
  } catch (e) {
    if (my !== epoch) return
    // Another tab (or device) made one first: open that one instead (this one was never used).
    if (status(e) === 409) {
      if (kept && (await store.getDevice(id).catch(() => null))?.deviceId === kept.deviceId) await store.deleteDevice(id).catch(() => {})
      return reopen(my, depth + 1)
    }
    return set(unreachable(e) ? { kind: 'offline' } : { kind: 'error', message: 'Couldn’t set up encryption on this device. Try again in a moment.' })
  }
  if (my !== epoch) return
  try {
    const fresh = await timed(fetcher!<MyKeys>('GET', '/api/me/keys'))
    server = { ...fresh, passkeys: fresh.passkeys ?? [], session_passkey: fresh.session_passkey ?? null }
  } catch {
    server = { ...k, public_key: publicKey, key_version: 1, recovery_blob: null, passkeys: [] }
  }
  if (my !== epoch) return
  if (!matches(kp.sk, server)) return reopen(my, depth + 1)
  if (kept) return unlocked(my, kp.sk, 'kept')
  sk = kp.sk
  clearCaches()
  keysEpoch++
  return settleReady(my, false)
}

export const keyring = {
  subscribe(l: () => void): () => void {
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  },
  state: () => state,
  keyChanges: () => [...changes.values()],
  accountId: () => accountId,
  /** Bumped each time a key becomes usable here: views that showed "can't be shown" read again. */
  keysEpoch: () => keysEpoch,
  publicKey: () => (sk ? publicKeyOf(sk) : server?.public_key ? fromB64u(server.public_key, 32) : null),
  /** Whether this passkey (WebAuthn credential id) can unlock the account's current key. */
  canUnlockWith: (webauthnId: string) => !!server?.passkeys?.some((w) => w.webauthn_id === webauthnId),
  /** This device's id for the signed-in account's envelope, if it keeps one. */
  async deviceId(): Promise<string | null> {
    if (!accountId) return null
    return (await store.getDevice(accountId).catch(() => null))?.deviceId ?? null
  },
  /** Our ids of the passkeys that can unlock the current key. */
  unlockingPasskeys: () => (server?.passkeys ?? []).map((w) => w.credential),
  /** For tests: the device storage (a fresh module state over the same store is a "restart"). */
  useStore(s: DeviceStore) {
    store = s
  },
  /** The app checks whether another tab signed out before anything is sealed or opened. */
  setStaleCheck(fn: (() => void) | null) {
    staleCheck = fn
  },
  /** The page is being left (`pagehide`), or shown again (`pageshow`, from the back-forward cache). */
  pageLeaving(on: boolean) {
    leaving = on
  },

  /** The signed-in account changed, signed in again, or signed out (null). */
  async use(id: string | null, f: Fetcher) {
    if (!id) {
      if (accountId || state.kind !== 'signed-out') keyring.lock()
      return
    }
    if (id !== accountId) {
      // A passkey just used to sign in to this account is kept across the switch; nothing else is.
      const keep = pendingFor(id)
      const ceremony = lastCeremony?.accountId === id ? lastCeremony : null
      keyring.lock()
      pendingPrf = keep
      lastCeremony = ceremony
      accountId = id
    }
    fetcher = f
    if (state.kind !== 'ready') set({ kind: 'restoring' })
    await keyring.refresh()
  },

  /** Try again to reopen the key (after coming back online, or when asked). */
  async refresh() {
    const id = accountId
    if (!id || !fetcher) return
    const my = epoch
    await withLock(`muni-keys:${id}`, () => reopen(my))
  },

  /** Resolves once the key is open or clearly not (never while it's still being reopened). */
  whenSettled(ms = 10_000): Promise<void> {
    if (state.kind !== 'restoring') return Promise.resolve()
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(t)
        off()
        resolve()
      }
      const t = setTimeout(done, ms)
      const off = keyring.subscribe(() => state.kind !== 'restoring' && done())
    })
  },

  /**
   * A passkey ceremony in this tab produced PRF output for `credentialId` (WebAuthn id) of `forAccount`.
   * It becomes a wrapping key held only in memory, for a couple of minutes, and the bytes are
   * zeroed. `prf` null: the passkey or browser didn't give one (remembered for honest messages).
   */
  async acceptPasskeyUnlock(forAccount: string, credentialId: string, prf: Uint8Array | null, rowId: string | null = null) {
    lastCeremony = { accountId: forAccount, credentialId, prf: !!prf, at: Date.now() }
    if (prf) {
      const kek = await kekFromPrf(prf, { accountId: forAccount, credentialId })
      pendingPrf = [...pendingPrf.filter((p) => !(p.accountId === forAccount && p.credentialId === credentialId)), { accountId: forAccount, credentialId, rowId, kek, at: Date.now() }]
    }
    if (accountId === forAccount) await keyring.refresh()
  },

  /**
   * Signing out (here or in another tab), or the session ended: the key and everything opened with
   * it leave memory, and nothing in flight can bring them back. What stays on the device can't be
   * opened without signing in again.
   */
  lock() {
    epoch++
    accountId = null
    sk = null
    server = null
    fetcher = null
    pendingPrf = []
    lastCeremony = null
    clearCaches()
    pendingSecrets.clear()
    changes.clear()
    set({ kind: 'signed-out' })
  },

  /**
   * "Forget this device": also remove what would let it reopen the key (its envelope, and its
   * share on the server while the session still works), an older build's plaintext copy, and
   * teammates' pins. Then locks. Passkeys stay wherever the person keeps them.
   */
  async forgetDevice(opts: { serverToo?: boolean; keepSignedIn?: boolean } = {}) {
    const id = accountId
    if (id) {
      const dev = await store.getDevice(id).catch(() => null)
      if (dev && fetcher && opts.serverToo !== false) await timed(fetcher('DELETE', `/api/me/devices/${dev.deviceId}`, {})).catch(() => {})
      await store.deleteDevice(id).catch(() => {})
      await store.deleteLegacy(id)
      await store.deletePins(id).catch(() => {})
    }
    if (!opts.keepSignedIn) keyring.lock()
  },

  /** Before signing out: true when this device holds the only copy and signing out would lose it. */
  async signOutRisk(): Promise<'none' | 'only-copy'> {
    const id = accountId
    if (!id) return 'none'
    const [dev, legacy] = await Promise.all([store.getDevice(id).catch(() => null), store.getLegacy(id)])
    const others = (server?.passkeys?.length ?? 0) > 0 || !!server?.recovery_blob
    if (others) return 'none'
    if (legacy && !dev) return 'only-copy'
    if (state.kind === 'ready' && state.persisted === false) return 'only-copy'
    return 'none'
  },
  /**
   * Signing out keeps the envelope, but not an older build's plaintext copy (the envelope replaces
   * it; when there's no envelope, `signOutRisk` warned first).
   */
  async dropLegacy() {
    if (accountId) await store.deleteLegacy(accountId)
  },

  /** Another device, or after clearing this one: open the key with the recovery key. */
  async unlock(recoveryText: string) {
    const id = accountId
    if (!id || !fetcher) throw new CryptoError('no-key', 'Sign in first.')
    const my = epoch
    const k = await fetcher<MyKeys>('GET', '/api/me/keys')
    if (!k.recovery_blob || !k.public_key) throw new CryptoError('no-key', 'There’s no recovery information for this account.')
    const opened = unwrapWithRecovery(k.recovery_blob, recoveryText, id)
    // The unwrapped key must match the account's published key, or it's not ours to use.
    if (b64u(publicKeyOf(opened)) !== k.public_key) throw new CryptoError('mismatch', 'That recovery key belongs to an older key for this account.')
    if (my !== epoch) throw new CryptoError('no-key', 'You signed out.')
    server = { ...k, passkeys: k.passkeys ?? [], session_passkey: k.session_passkey ?? null }
    await withLock(`muni-keys:${id}`, () => unlocked(my, opened, 'recovery'))
  },

  /**
   * Only when every way back in is gone: a new key (content sealed to the old one stays sealed).
   * Refused when this device can already read — confirming it's you with a passkey may just have
   * unlocked it, and replacing a working key would lose content for nothing.
   */
  async replace() {
    const id = accountId
    if (!id || !fetcher) throw new CryptoError('no-key', 'Sign in first.')
    if (state.kind === 'ready') throw new CryptoError('mismatch', 'This device can read your encrypted writing now, so nothing was replaced.')
    const my = epoch
    const current = await fetcher<MyKeys>('GET', '/api/me/keys')
    const kp = newKeyPair()
    const publicKey = b64u(kp.pk)
    const version = (current.key_version ?? 0) + 1
    const p = pendingFor(id).find((x) => x.rowId || current.session_passkey?.webauthn_id === x.credentialId)
    const passkey_wrap = p ? { credential: p.rowId ?? current.session_passkey!.id, wrapped: await wrapForPasskey(p.kek, kp.sk, { accountId: id, id: p.credentialId, keyVersion: version, publicKey }) } : undefined
    if (my !== epoch || keyring.state().kind === 'ready') throw new CryptoError('mismatch', 'This device can read your encrypted writing now, so nothing was replaced.')
    const kept = await keepOnDevice(my, id, kp.sk, { publicKey, keyVersion: version, forVersion: version })
    await fetcher('PUT', '/api/me/keys', { public_key: publicKey, replace: true, ...(passkey_wrap ? { passkey_wrap } : {}), ...(kept ? { device: kept.deviceId } : {}) })
    const k = await fetcher<MyKeys>('GET', '/api/me/keys')
    server = { ...k, passkeys: k.passkeys ?? [], session_passkey: k.session_passkey ?? null }
    if (my !== epoch) return
    await store.deleteLegacy(id)
    await withLock(`muni-keys:${id}`, () => (kept ? unlocked(my, kp.sk, 'kept') : unlocked(my, kp.sk, 'made')))
  },

  /** A recovery key (a new one replaces the old). Needs the key open here. Returns it, to show once. */
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

  // ---------------------------------------------------------------- sprints

  /** The sprint's key view and the versions this device can open. Cached briefly. */
  async sprint(sprintId: string, fresh = false): Promise<SprintState | null> {
    // While the account key is being reopened, wait: loading now would cache "no keys".
    await keyring.whenSettled()
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
    // Not knowing is never "not encrypted": nothing may be sent in plaintext on a guess.
    if (!accountId || !fetcher) throw new CryptoError('no-key', 'Sign in to send this.')
    const s = await keyring.sprint(sprintId)
    if (!s) throw new CryptoError('no-key', 'Sign in to send this.')
    return !!s.view.encryption
  },

  /** Newest discussion key this device holds, for writing. */
  async writeKeys(sprintId: string): Promise<SprintKeys> {
    const s = await keyring.sprint(sprintId)
    const k = s ? [...s.keys.values()].sort((a, b) => b.version - a.version)[0] : null
    if (!k) throw new CryptoError('no-key', 'This device doesn’t have this sprint’s key yet.')
    return k
  },

  /**
   * A thought, sealed to the sprint's newest key and to its author. `authorId` is the account that
   * wrote it: a tab holding another account's key never seals it (it waits instead).
   */
  async sealThought(sprintId: string, recordId: string, content: EntryContent, authorId?: string): Promise<string> {
    staleCheck?.()
    if (!accountId) throw new CryptoError('no-key', 'Sign in first.')
    if (authorId && authorId !== accountId) throw new CryptoError('no-key', 'This thought was written while signed in as someone else.')
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
    const pinned = await store.getPin(pinKey)
    if (!pinned) {
      await store.putPin(pinKey, pk)
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
    await store.putPin(`${accountId}|${otherId}`, pk)
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
  const my = epoch
  const view = await fetcher!<SprintKeyView>('GET', `/api/sprints/${sprintId}/keys`)
  const keys = new Map<number, SprintKeys>()
  // Signed out (or switched account) while this was loading: open nothing, keep nothing.
  if (my !== epoch) return { view, keys, fetchedAt: 0 }
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
  staleCheck?.()
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
  [/^\/api\/sprints\/[^/]+\/meeting\/notes\/[^/]+$/, ['takeaway', 'what_happened', 'impact', 'could_try', 'notes']],
  [/^\/api\/sprints\/[^/]+\/meeting\/context$/, ['body']],
  [/^\/api\/sprints\/[^/]+\/checkins\/[^/]+\/response$/, ['note']],
  [/^\/api\/sprints\/[^/]+\/experiments(\/[^/]+)?$/, ['change_to_try', 'success_signal', 'outcome_note']],
  [/^\/api\/sprints\/[^/]+\/recap$/, ['body']],
  [/^\/api\/sprints\/[^/]+\/votes\/rounds\/close$/, ['reason']],
  [/^\/api\/sprints\/[^/]+$/, ['opening_question']],
]

/** A submitted thought, edited in place: its whole content travels as one envelope, bound to that record. */
const ENTRY = /^\/api\/sprints\/([^/]+)\/entries\/([^/]+)$/

async function sealRequest(method: string, path: string, body: unknown): Promise<unknown> {
  if (method === 'GET' || !body || typeof body !== 'object') return body
  const m = path.match(/^\/api\/sprints\/([^/?]+)/)
  if (!m) return body
  const entry = method === 'PATCH' ? path.split('?')[0].match(ENTRY) : null
  if (entry) {
    const [, sprintId, recordId] = entry
    staleCheck?.()
    if (!(await keyring.isEncrypted(sprintId))) return body
    // Sealed like a new thought (the send queue): text and context inside, category and period beside it.
    const o = body as Record<string, unknown>
    const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)
    const sealed = await keyring.sealThought(sprintId, recordId, { body: text(o.body) ?? '', impact: text(o.impact), might_help: text(o.might_help) })
    return { category: o.category ?? null, period: o.period ?? null, body: sealed }
  }
  const rule = SEALED.find(([re]) => re.test(path.split('?')[0]))
  if (!rule) return body
  const sprintId = m[1]
  staleCheck?.()
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
