import { beforeEach, describe, expect, it } from 'vitest'
import { sha256 } from '@noble/hashes/sha2.js'
import { b64u, newKeyPair, newRecoveryKey, newSprintSecret, sealEntry, sealField, sprintKeys, wrapForRecovery, wrapSprintSecret, type KeyPair } from './crypto'
import { isLocked, keyring, LOCKED } from './keyring'
import { memoryDeviceStore } from './devicestore'
import { deviceKek, openForDevice, PRF_INPUT } from './wrap'
import type { MyKeys, SprintKeyView } from '@/api/types'

/**
 * A stand-in for the server. It only ever holds what the real one stores — public keys, wrapped
 * keys, envelopes, device shares — and applies the same rules to them: a device's share goes only
 * to a session started with a passkey that existed when the device was bound (or to any session of
 * an account without passkeys).
 */
type Passkey = { rowId: string; webauthnId: string; secret: Uint8Array; createdAt: number }
type Wait = { until: Promise<void> }
function fakeServer(me: string) {
  const s = {
    key: null as null | { public_key: string; recovery_blob: string | null; recovery_confirmed_at: string | null; key_version: number },
    wraps: new Map<string, { webauthn_id: string; key_version: number; public_key: string; wrapped: string }>(),
    passkeys: new Map<string, Passkey>(),
    devices: new Map<string, { share: string; key_version: number; requires_passkey: boolean; bound_at: number }>(),
    session: { method: 'passkey' as 'passkey' | 'email', credential: null as string | null, alive: true },
    sprints: new Map<string, SprintKeyView>(),
    posts: [] as { method: string; path: string; body: unknown }[],
    offline: false,
    /** Holds matching requests until released (to interleave a sign-out). */
    hold: null as null | { path: RegExp; wait: Wait; reached: () => void },
    failNext: null as null | RegExp,
  }
  const err = (status: number, code = 'error') => Object.assign(new Error(code), { status, code })
  const fetcher = async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
    if (s.offline) throw err(0, 'network')
    s.posts.push({ method, path, body })
    if (s.hold && s.hold.path.test(`${method} ${path}`)) {
      s.hold.reached()
      await s.hold.wait.until
    }
    if (s.failNext?.test(path)) {
      s.failNext = null
      throw err(503, 'unavailable')
    }
    if (!s.session.alive) throw err(401, 'unauthorized')
    if (path === '/api/me/keys' && method === 'GET') {
      const cred = s.session.method === 'passkey' && s.session.credential ? s.passkeys.get(s.session.credential) : undefined
      const k = s.key
      return {
        public_key: k?.public_key ?? null,
        recovery_blob: k?.recovery_blob ?? null,
        recovery_confirmed_at: k?.recovery_confirmed_at ?? null,
        key_version: k?.key_version ?? 0,
        created_at: null,
        passkeys: k ? [...s.wraps.entries()].filter(([, w]) => w.key_version === k.key_version && w.public_key === k.public_key).map(([credential, w]) => ({ credential, webauthn_id: w.webauthn_id, key_version: w.key_version, wrapped: w.wrapped })) : [],
        session_passkey: cred ? { id: cred.rowId, webauthn_id: cred.webauthnId } : null,
      } satisfies MyKeys as T
    }
    if (path === '/api/me/keys' && method === 'PUT') {
      const b = body as { public_key: string; recovery_blob?: string; replace?: boolean; passkey_wrap?: { credential: string; wrapped: string }; device?: string }
      if (s.key && s.key.public_key !== b.public_key && !b.replace) throw err(409, 'conflict')
      const version = s.key && b.replace ? s.key.key_version + 1 : s.key?.key_version ?? 1
      if (b.replace) {
        s.wraps.clear()
        for (const id of [...s.devices.keys()]) if (id !== b.device) s.devices.delete(id)
        if (b.device && s.devices.has(b.device)) s.devices.get(b.device)!.key_version = version
      }
      s.key = { public_key: b.public_key, recovery_blob: b.recovery_blob ?? null, recovery_confirmed_at: null, key_version: version }
      if (b.passkey_wrap) s.wraps.set(b.passkey_wrap.credential, { webauthn_id: s.passkeys.get(b.passkey_wrap.credential)!.webauthnId, key_version: version, public_key: b.public_key, wrapped: b.passkey_wrap.wrapped })
      return { ok: true, key_version: version } as T
    }
    const pk = path.match(/^\/api\/me\/keys\/passkeys\/([^/]+)$/)
    if (pk && method === 'PUT') {
      const b = body as { wrapped: string; key_version: number; public_key: string }
      const cred = s.passkeys.get(pk[1])
      if (!cred) throw err(404, 'not_found')
      if (b.public_key !== s.key?.public_key || b.key_version !== s.key.key_version) throw err(409, 'key_changed')
      s.wraps.set(pk[1], { webauthn_id: cred.webauthnId, key_version: b.key_version, public_key: b.public_key, wrapped: b.wrapped })
      return { ok: true } as T
    }
    if (path === '/api/me/keys/recovery') {
      const b = body as { recovery_blob?: string; confirmed?: boolean }
      if (b.recovery_blob) s.key = { ...s.key!, recovery_blob: b.recovery_blob, recovery_confirmed_at: null }
      if (b.confirmed) s.key = { ...s.key!, recovery_confirmed_at: new Date().toISOString() }
      return { ok: true } as T
    }
    const dev = path.match(/^\/api\/me\/devices\/([^/]+)(\/unlock)?$/)
    if (dev && method === 'PUT') {
      if (s.devices.has(dev[1])) return { created: false } as T
      const { replaces, for_version } = (body ?? {}) as { replaces?: string | null; for_version?: number }
      if (!s.key && !for_version) throw err(409, 'conflict')
      const version = for_version ?? s.key!.key_version
      if (replaces) s.devices.delete(replaces)
      const share = b64u(crypto.getRandomValues(new Uint8Array(32)))
      s.devices.set(dev[1], { share, key_version: version, requires_passkey: s.passkeys.size > 0, bound_at: Date.now() })
      return { created: true, share, key_version: version } as T
    }
    if (dev && dev[2] && method === 'POST') {
      const d = s.devices.get(dev[1])
      if (!d) throw err(404, 'device_unknown')
      if (d.requires_passkey) {
        const cred = s.session.method === 'passkey' && s.session.credential ? s.passkeys.get(s.session.credential) : undefined
        if (!cred || cred.createdAt > d.bound_at) throw err(403, 'passkey_required')
      }
      return { share: d.share, key_version: d.key_version } as T
    }
    if (dev && method === 'DELETE') {
      s.devices.delete(dev[1])
      return { ok: true } as T
    }
    const m = path.match(/^\/api\/sprints\/([^/]+)\/keys$/)
    if (m) return (s.sprints.get(m[1]) ?? { encryption: null }) as T
    throw err(404, 'not_found')
  }
  const addPasskey = (createdAt = Date.now() - 1000): Passkey => {
    const p = { rowId: crypto.randomUUID(), webauthnId: b64u(crypto.getRandomValues(new Uint8Array(16))), secret: crypto.getRandomValues(new Uint8Array(32)), createdAt }
    s.passkeys.set(p.rowId, p)
    return p
  }
  /** What the passkey's PRF returns for Muni's input: fixed per passkey, unknown to the server. */
  const prf = (p: Passkey) => sha256(new Uint8Array([...p.secret, ...PRF_INPUT]))
  /** Signing in with a passkey: a new session started with it, and (where supported) its PRF output handed over. */
  const signInWith = async (p: Passkey, opts: { prf?: boolean } = {}) => {
    s.session = { method: 'passkey', credential: p.rowId, alive: true }
    await keyring.acceptPasskeyUnlock(me, p.webauthnId, opts.prf === false ? null : prf(p))
    await keyring.use(me, fetcher)
  }
  const holdNext = (path: RegExp) => {
    let release!: () => void
    let reached!: () => void
    const wait = { until: new Promise<void>((r) => (release = r)) }
    const arrived = new Promise<void>((r) => (reached = r))
    s.hold = { path, wait, reached }
    return {
      arrived,
      release: () => {
        s.hold = null
        release()
      },
    }
  }
  return { s, fetcher, me, addPasskey, prf, signInWith, holdNext }
}
type Server = ReturnType<typeof fakeServer>

let store = memoryDeviceStore()

/** A new account signing in with a PRF-capable passkey: its key is made and wrapped with no questions. */
async function newAccount(opts: { prf?: boolean } = {}) {
  const srv = fakeServer(`acc-${crypto.randomUUID()}`)
  const passkey = srv.addPasskey()
  await srv.signInWith(passkey, opts)
  return { ...srv, passkey, pk: keyring.publicKey()! }
}

/** An account whose key the test knows (set up earlier, elsewhere), unlocked here with its recovery key. */
async function knownKeyAccount(opts: { passkeys?: number } = {}) {
  const srv = fakeServer(`acc-${crypto.randomUUID()}`)
  const kp = newKeyPair()
  const recovery = newRecoveryKey()
  srv.s.key = { public_key: b64u(kp.pk), recovery_blob: wrapForRecovery(kp.sk, recovery, srv.me), recovery_confirmed_at: null, key_version: 1 }
  const passkeys = Array.from({ length: opts.passkeys ?? 1 }, () => srv.addPasskey())
  srv.s.session = { method: 'passkey', credential: passkeys[0]?.rowId ?? null, alive: true }
  return { ...srv, kp, recovery, passkeys }
}

function sprintFor(server: Server, pk: Uint8Array, opts: { others?: { id: string; name: string; keys: KeyPair }[]; holds?: boolean } = {}) {
  const id = crypto.randomUUID()
  const secret = newSprintSecret()
  const keys = sprintKeys(secret, 1)
  server.s.sprints.set(id, {
    encryption: 'e1',
    sealed_version: null,
    versions: [{ version: 1, public_key: b64u(keys.pk) }],
    my_wraps: opts.holds === false ? [] : [{ version: 1, wrapped: wrapSprintSecret(pk, secret, { sprintId: id, version: 1, recipientId: server.me }) }],
    participants: [
      { account_id: server.me, display_name: 'Me', is_facilitator: true, public_key: b64u(pk), key_version: 1, versions_held: [1], has_latest: true },
      ...(opts.others ?? []).map((o) => ({ account_id: o.id, display_name: o.name, is_facilitator: false, public_key: b64u(o.keys.pk), key_version: 1, versions_held: [], has_latest: false })),
    ],
  })
  return { id, secret, keys }
}

/** Signing out: the session ends and this tab forgets the account (what the sign-out dialog does). */
async function signOut(srv: Server) {
  await keyring.dropLegacy()
  keyring.lock()
  srv.s.session = { ...srv.s.session, alive: false }
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')

beforeEach(async () => {
  keyring.lock()
  keyring.setStaleCheck(null)
  store = memoryDeviceStore()
  keyring.useStore(store)
})

describe('the original bug: signing out and back in on a configured device', () => {
  it('unlocks again with the passkey sign-in — no recovery key, no “doesn’t have the key”', async () => {
    const srv = await newAccount()
    expect(keyring.state().kind).toBe('ready')
    const sp = sprintFor(srv, srv.pk, { holds: false })
    const old = await keyring.sealThought(sp.id, 'rec-old', { body: 'Synthetic old thought', impact: null, might_help: null })

    await signOut(srv)
    expect(keyring.state().kind).toBe('signed-out')
    expect(keyring.publicKey()).toBeNull()

    const seen: string[] = []
    const off = keyring.subscribe(() => seen.push(keyring.state().kind))
    await srv.signInWith(srv.passkey)
    off()
    expect(keyring.state().kind).toBe('ready')
    // Never "locked" (the banner) on the way, and nothing about recovery was asked for or sent.
    expect(seen).not.toContain('locked')
    expect(srv.s.posts.some((p) => p.path.includes('/recovery'))).toBe(false)
    // Old content reads; new content seals.
    expect((await keyring.decryptDeep({ id: 'rec-old', body: old }, sp.id)).body).toBe('Synthetic old thought')
    const fresh = await keyring.sealThought(sp.id, 'rec-new', { body: 'Synthetic new thought', impact: null, might_help: null })
    expect((await keyring.decryptDeep({ id: 'rec-new', body: fresh }, sp.id)).body).toBe('Synthetic new thought')
  })

  it('also works for a passkey without PRF, and after the session expired (me kept, signed in again)', async () => {
    const srv = await newAccount({ prf: false })
    expect(keyring.state().kind).toBe('ready')
    // Session expiry: the key leaves memory, the person signs in again as the same account.
    keyring.lock()
    srv.s.session = { method: 'passkey', credential: srv.passkey.rowId, alive: true }
    await keyring.use(srv.me, srv.fetcher)
    expect(keyring.state().kind).toBe('ready')
  })

  it('reopens after a reload (fresh memory, same storage) without any prompt', async () => {
    const srv = await knownKeyAccount()
    await keyring.use(srv.me, srv.fetcher)
    await keyring.unlock(srv.recovery)
    keyring.lock() // a reload: memory gone, storage kept, still signed in
    await keyring.use(srv.me, srv.fetcher)
    expect(keyring.state().kind).toBe('ready')
    expect(b64u(keyring.publicKey()!)).toBe(b64u(srv.kp.pk))
  })
})

describe('what stays on the device', () => {
  it('holds no plaintext key, and can’t be opened without signing in again', async () => {
    const srv = await knownKeyAccount()
    await keyring.use(srv.me, srv.fetcher)
    await keyring.unlock(srv.recovery)
    expect(keyring.state()).toMatchObject({ kind: 'ready', persisted: true })
    await signOut(srv)
    const dump = store.dump()
    expect(dump).not.toContain(b64u(srv.kp.sk))
    expect(dump).not.toContain(hex(srv.kp.sk))
    // Signed out, the server won't release the other half: nothing reopens it.
    await keyring.use(srv.me, srv.fetcher)
    expect(keyring.state().kind).not.toBe('ready')
    expect(keyring.publicKey()).toBeNull()
  })

  it('an email-code session can’t reopen a passkey account’s device envelope', async () => {
    const srv = await knownKeyAccount()
    await keyring.use(srv.me, srv.fetcher)
    await keyring.unlock(srv.recovery)
    await signOut(srv)
    srv.s.session = { method: 'email', credential: null, alive: true }
    await keyring.use(srv.me, srv.fetcher)
    expect(keyring.state().kind).toBe('needs-passkey')
    // A passkey added later (through that email session) doesn't count either.
    const added = srv.addPasskey(Date.now() + 60_000)
    keyring.lock()
    srv.s.session = { method: 'passkey', credential: added.rowId, alive: true }
    await keyring.use(srv.me, srv.fetcher)
    expect(keyring.state().kind).not.toBe('ready')
  })

  it('“Forget this device” removes the envelope, the server’s half and teammates’ pins', async () => {
    const srv = await newAccount({ prf: false })
    const deviceId = await keyring.deviceId()
    expect(deviceId).toBeTruthy()
    await keyring.forgetDevice()
    expect(keyring.state().kind).toBe('signed-out')
    expect(srv.s.devices.has(deviceId!)).toBe(false)
    expect(JSON.parse(store.dump()).devices).toHaveLength(0)
    // Without a passkey that unlocks or a recovery key, it can't be reopened here.
    await keyring.use(srv.me, srv.fetcher)
    expect(keyring.state()).toMatchObject({ kind: 'locked', recoveryAvailable: false })
  })
})

describe('passkey unlocking (PRF)', () => {
  it('restores access after the browser’s storage was cleared, with the same passkey', async () => {
    const srv = await newAccount()
    expect(srv.s.wraps.size).toBe(1) // wrapped for the passkey used at sign-up
    const sp = sprintFor(srv, srv.pk)
    const title = sealField(sp.keys, sp.id, 'title', 'Synthetic theme')
    await signOut(srv)
    store = memoryDeviceStore() // cleared site data
    keyring.useStore(store)
    await srv.signInWith(srv.passkey)
    expect(keyring.state().kind).toBe('ready')
    expect((await keyring.decryptDeep({ title }, sp.id)).title).toBe('Synthetic theme')
    // And the device keeps an envelope again for next time.
    expect(await keyring.deviceId()).toBeTruthy()
  })

  it('a passkey without PRF falls back to this device, and never makes a new key for an existing account', async () => {
    const srv = await knownKeyAccount()
    await srv.signInWith(srv.passkeys[0], { prf: false })
    // No envelope here, no wrap for this passkey: it asks, it doesn't invent a key.
    expect(keyring.state()).toMatchObject({ kind: 'locked', recoveryAvailable: true })
    expect(srv.s.posts.filter((p) => p.path === '/api/me/keys' && p.method === 'PUT')).toHaveLength(0)
    expect(srv.s.key!.public_key).toBe(b64u(srv.kp.pk))
  })

  it('a passkey used on an unlocked device learns to unlock, with no extra prompt', async () => {
    const srv = await knownKeyAccount({ passkeys: 2 })
    await keyring.use(srv.me, srv.fetcher)
    await keyring.unlock(srv.recovery)
    expect(srv.s.wraps.size).toBe(0)
    // Signing in (or confirming it's you) with the second passkey, which supports PRF:
    srv.s.session = { method: 'passkey', credential: srv.passkeys[1].rowId, alive: true }
    await keyring.acceptPasskeyUnlock(srv.me, srv.passkeys[1].webauthnId, srv.prf(srv.passkeys[1]))
    expect(srv.s.wraps.has(srv.passkeys[1].rowId)).toBe(true)
    expect(keyring.canUnlockWith(srv.passkeys[1].webauthnId)).toBe(true)
    // It now unlocks on a device that has nothing.
    await signOut(srv)
    store = memoryDeviceStore()
    keyring.useStore(store)
    await srv.signInWith(srv.passkeys[1])
    expect(keyring.state().kind).toBe('ready')
  })

  it('a new passkey gets no access from a locked device', async () => {
    const srv = await knownKeyAccount({ passkeys: 1 })
    const fresh = srv.addPasskey()
    await srv.signInWith(fresh)
    expect(keyring.state().kind).toBe('locked')
    expect(srv.s.posts.some((p) => p.path.startsWith('/api/me/keys/passkeys/'))).toBe(false)
    expect(srv.s.wraps.size).toBe(0)
  })

  it('a passkey whose wrap doesn’t open is asked about honestly, not treated as a lost key', async () => {
    const srv = await newAccount()
    await signOut(srv)
    store = memoryDeviceStore()
    keyring.useStore(store)
    const other = srv.addPasskey()
    await srv.signInWith(other)
    expect(keyring.state()).toMatchObject({ kind: 'needs-passkey' })
    expect((keyring.state() as { note?: string }).note).toMatch(/can’t unlock/)
  })
})

describe('never a guess', () => {
  it('offline: says so, never sets up a key', async () => {
    const srv = await knownKeyAccount()
    srv.s.offline = true
    await keyring.use(srv.me, srv.fetcher)
    expect(keyring.state().kind).toBe('offline')
    srv.s.offline = false
    expect(srv.s.posts.filter((p) => p.method === 'PUT')).toHaveLength(0)
  })

  it('never makes a second key when the server says there is none but this device holds one', async () => {
    const srv = await newAccount({ prf: false })
    const had = srv.s.key!.public_key
    keyring.lock()
    srv.s.key = null // publishing never finished (or a server restored from an old backup)
    await keyring.use(srv.me, srv.fetcher)
    // The key this device kept is published again — the same one — and opens.
    expect(srv.s.key!.public_key).toBe(had)
    expect(keyring.state().kind).toBe('ready')
    // An older build's plaintext copy is never republished or replaced on its own: it's an error to look at.
    keyring.lock()
    const stale = newKeyPair()
    await keyring.forgetDevice({ serverToo: false })
    store.legacy.set(srv.me, { accountId: srv.me, sk: b64u(stale.sk), pk: b64u(stale.pk), savedAt: 1 })
    srv.s.key = null
    const puts = srv.s.posts.length
    await keyring.use(srv.me, srv.fetcher)
    expect(keyring.state().kind).toBe('error')
    expect(srv.s.posts.slice(puts).some((p) => p.method === 'PUT' && p.path === '/api/me/keys')).toBe(false)
  })

  it('keeps a new key on the device before publishing it, so a reload in between loses nothing', async () => {
    const srv = fakeServer(`acc-${crypto.randomUUID()}`)
    const p = srv.addPasskey()
    srv.s.session = { method: 'passkey', credential: p.rowId, alive: true }
    // The tab "reloads" the moment the key would be published.
    const hold = srv.holdNext(/^PUT \/api\/me\/keys$/)
    const run = keyring.use(srv.me, srv.fetcher)
    await hold.arrived
    expect(JSON.parse(store.dump()).devices).toHaveLength(1) // already kept here
    keyring.lock()
    srv.s.hold = null
    hold.release()
    await run
    // Whether or not that PUT landed, the next load opens the same key.
    const published = srv.s.key?.public_key ?? null
    await keyring.use(srv.me, srv.fetcher)
    expect(keyring.state().kind).toBe('ready')
    expect(b64u(keyring.publicKey()!)).toBe(srv.s.key!.public_key)
    if (published) expect(srv.s.key!.public_key).toBe(published)
  })

  it('two tabs setting up at once end with one key, opened by both', async () => {
    const srv = fakeServer(`acc-${crypto.randomUUID()}`)
    const p = srv.addPasskey()
    srv.s.session = { method: 'passkey', credential: p.rowId, alive: true }
    // Another tab wins the race: its key lands between this tab's check and its own PUT.
    const other = newKeyPair()
    const hold = srv.holdNext(/^PUT \/api\/me\/keys$/)
    const run = keyring.use(srv.me, srv.fetcher)
    await hold.arrived
    srv.s.key = { public_key: b64u(other.pk), recovery_blob: null, recovery_confirmed_at: null, key_version: 1 }
    hold.release()
    await run
    // This tab's PUT was refused (409): the other tab's key stands, untouched…
    expect(srv.s.key!.public_key).toBe(b64u(other.pk))
    // …and this tab reads it again instead of overwriting or reporting an error. (In a real browser
    // the other tab's envelope is in the same storage; here it isn't, so this tab is plainly locked.)
    expect(keyring.state().kind).toBe('locked')
  })

  it('“Start over” is refused when this device can already read', async () => {
    await newAccount()
    await expect(keyring.replace()).rejects.toMatchObject({ code: 'mismatch' })
  })
})

describe('signing out while unlocking', () => {
  it('a late response can’t unlock a signed-out tab', async () => {
    const srv = await knownKeyAccount()
    await keyring.use(srv.me, srv.fetcher)
    await keyring.unlock(srv.recovery)
    keyring.lock()
    const kinds: string[] = []
    const hold = srv.holdNext(/\/unlock$/)
    const run = keyring.use(srv.me, srv.fetcher)
    await hold.arrived
    keyring.lock() // signed out while the share was on its way
    const off = keyring.subscribe(() => kinds.push(keyring.state().kind))
    hold.release()
    await run
    off()
    expect(kinds).not.toContain('ready')
    expect(keyring.state().kind).toBe('signed-out')
    expect(keyring.publicKey()).toBeNull()
  })

  it('switching accounts keeps nothing of the first: keys, envelopes or thoughts', async () => {
    const a = await newAccount({ prf: false })
    const sp = sprintFor(a, a.pk, { holds: false })
    const aDevice = JSON.parse(store.dump()).devices[0]
    const b = await newAccount({ prf: false })
    expect(keyring.accountId()).toBe(b.me)
    // A thought written as A can't be sealed while B is signed in: it waits.
    await expect(keyring.sealThought(sp.id, 'r', { body: 'Synthetic', impact: null, might_help: null }, a.me)).rejects.toMatchObject({ code: 'no-key' })
    // B's share doesn't open A's envelope.
    const bShare = [...b.s.devices.values()][0].share
    const kek = await deviceKek(Uint8Array.from(atob(aDevice.ds.replace(/-/g, '+').replace(/_/g, '/') + '='), (c) => c.charCodeAt(0)), Uint8Array.from(atob(bShare.replace(/-/g, '+').replace(/_/g, '/') + '='), (c) => c.charCodeAt(0)), { accountId: a.me, deviceId: aDevice.deviceId })
    await expect(openForDevice(kek, aDevice.envelope, { accountId: a.me, id: aDevice.deviceId, keyVersion: 1, publicKey: b64u(a.pk) })).rejects.toBeTruthy()
  })

  it('another tab signing out locks this one before anything is sealed or opened', async () => {
    const srv = await newAccount()
    const sp = sprintFor(srv, srv.pk)
    const title = sealField(sp.keys, sp.id, 'title', 'Synthetic')
    keyring.setStaleCheck(() => keyring.lock())
    expect((await keyring.decryptDeep({ title }, sp.id)).title).toBe(LOCKED)
    expect(keyring.state().kind).toBe('signed-out')
  })

  it('waits for unlocking instead of showing “can’t be shown”', async () => {
    const srv = await knownKeyAccount()
    await keyring.use(srv.me, srv.fetcher)
    await keyring.unlock(srv.recovery)
    const sp = sprintFor(srv, srv.kp.pk)
    const title = sealField(sp.keys, sp.id, 'title', 'Synthetic theme')
    keyring.lock()
    const hold = srv.holdNext(/\/unlock$/)
    const run = keyring.use(srv.me, srv.fetcher)
    await hold.arrived
    expect(keyring.state().kind).toBe('restoring')
    const opened = keyring.decryptDeep({ title }, sp.id)
    hold.release()
    await run
    expect((await opened).title).toBe('Synthetic theme')
  })
})

describe('moving keys from older builds', () => {
  it('moves a plaintext key into an envelope, verifies it, then deletes the plaintext', async () => {
    const srv = await knownKeyAccount()
    store.legacy.set(srv.me, { accountId: srv.me, sk: b64u(srv.kp.sk), pk: b64u(srv.kp.pk), savedAt: 1 })
    await keyring.use(srv.me, srv.fetcher)
    expect(keyring.state()).toMatchObject({ kind: 'ready', persisted: true })
    expect(store.legacy.has(srv.me)).toBe(false)
    expect(store.dump()).not.toContain(b64u(srv.kp.sk))
    // The envelope reopens it after signing out and in.
    await signOut(srv)
    srv.s.session = { method: 'passkey', credential: srv.passkeys[0].rowId, alive: true }
    await keyring.use(srv.me, srv.fetcher)
    expect(keyring.state().kind).toBe('ready')
  })

  it('an interrupted move keeps the old copy and finishes next time', async () => {
    const srv = await knownKeyAccount()
    store.legacy.set(srv.me, { accountId: srv.me, sk: b64u(srv.kp.sk), pk: b64u(srv.kp.pk), savedAt: 1 })
    srv.s.failNext = /^\/api\/me\/devices\//
    await keyring.use(srv.me, srv.fetcher)
    expect(keyring.state().kind).toBe('ready') // usable now
    expect(store.legacy.has(srv.me)).toBe(true) // and nothing was lost
    keyring.lock() // reload
    await keyring.use(srv.me, srv.fetcher)
    expect(store.legacy.has(srv.me)).toBe(false)
    expect(keyring.state().kind).toBe('ready')
  })

  it('keeps the old copy while the envelope can’t be verified (an email session on a passkey account)', async () => {
    const srv = await knownKeyAccount()
    store.legacy.set(srv.me, { accountId: srv.me, sk: b64u(srv.kp.sk), pk: b64u(srv.kp.pk), savedAt: 1 })
    srv.s.session = { method: 'email', credential: null, alive: true }
    await keyring.use(srv.me, srv.fetcher)
    expect(keyring.state().kind).toBe('ready')
    expect(store.legacy.has(srv.me)).toBe(true)
  })

  it('never deletes an old key that doesn’t match the account’s (it may be someone’s only copy)', async () => {
    const srv = await knownKeyAccount()
    const stale = newKeyPair()
    store.legacy.set(srv.me, { accountId: srv.me, sk: b64u(stale.sk), pk: b64u(stale.pk), savedAt: 1 })
    await keyring.use(srv.me, srv.fetcher)
    expect(keyring.state()).toMatchObject({ kind: 'locked', recoveryAvailable: true })
    expect(store.legacy.has(srv.me)).toBe(true)
  })

  it('two refreshes at once move it once', async () => {
    const srv = await knownKeyAccount()
    store.legacy.set(srv.me, { accountId: srv.me, sk: b64u(srv.kp.sk), pk: b64u(srv.kp.pk), savedAt: 1 })
    await Promise.all([keyring.use(srv.me, srv.fetcher), keyring.refresh(), keyring.refresh()])
    expect(srv.s.posts.filter((p) => p.method === 'PUT' && p.path.startsWith('/api/me/devices/'))).toHaveLength(1)
  })
})

describe('nothing secret leaves the browser', () => {
  it('no key, PRF output, device half, recovery key or plaintext in any request', async () => {
    const srv = await newAccount()
    const p = srv.passkey
    const sp = sprintFor(srv, srv.pk)
    await keyring.sealRequest('POST', `/api/sprints/${sp.id}/themes`, { title: 'Synthetic-9d2e secret theme' })
    const recovery = await keyring.newRecovery()
    await signOut(srv)
    await srv.signInWith(p)
    const second = srv.addPasskey()
    srv.s.session = { method: 'passkey', credential: second.rowId, alive: true }
    await keyring.acceptPasskeyUnlock(srv.me, second.webauthnId, srv.prf(second))
    expect(keyring.state().kind).toBe('ready')
    const sent = JSON.stringify(srv.s.posts)
    const device = JSON.parse(store.dump()).devices[0]
    const secrets: string[] = [recovery, recovery.replace(/-/g, ''), 'Synthetic-9d2e', device.ds]
    for (const bytes of [srv.prf(p), srv.prf(second)]) secrets.push(b64u(bytes), hex(bytes))
    for (const s of secrets) expect(sent).not.toContain(s)
    // The account's private key: recover it from the device the only way possible (both halves) and check.
    const share = [...srv.s.devices.values()][0].share
    const toBytes = (x: string) => Uint8Array.from(atob(x.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((x.length + 3) % 4)), (c) => c.charCodeAt(0))
    const sk = await openForDevice(await deviceKek(toBytes(device.ds), toBytes(share), { accountId: srv.me, deviceId: device.deviceId }), device.envelope, { accountId: srv.me, id: device.deviceId, keyVersion: device.keyVersion, publicKey: device.pk })
    expect(sent).not.toContain(b64u(sk))
    expect(sent).not.toContain(hex(sk))
  })
})

// ------------------------------------------------------------------ sprint content (unchanged behaviour)

async function signedIn() {
  const srv = await newAccount()
  return srv
}

describe('reading', () => {
  it('opens thoughts and fields in responses, and fills in a thought’s context', async () => {
    const srv = await signedIn()
    const sp = sprintFor(srv, srv.pk)
    const body = sealEntry({ sprintId: sp.id, recordId: 'r1', version: 1, sprintPk: sp.keys.pk, authorId: 'someone', authorPk: newKeyPair().pk }, { body: 'Synthetic thought', impact: 'Synthetic impact', might_help: null })
    const title = sealField(sp.keys, sp.id, 'title', 'Synthetic theme')
    const out = await keyring.decryptDeep({ themes: [{ id: 't1', title, entries: [{ id: 'r1', body, impact: null, might_help: null, category: 'keep' }] }] }, sp.id)
    expect(out.themes[0].title).toBe('Synthetic theme')
    expect(out.themes[0].entries[0]).toMatchObject({ body: 'Synthetic thought', impact: 'Synthetic impact', category: 'keep' })
  })

  it('shows an explicit marker — never ciphertext or a guess — when it can’t open something', async () => {
    const srv = await signedIn()
    const sp = sprintFor(srv, srv.pk, { holds: false })
    const title = sealField(sprintKeys(newSprintSecret(), 1), sp.id, 'title', 'Synthetic')
    const out = await keyring.decryptDeep({ id: 't', title }, sp.id)
    expect(out.title).toBe(LOCKED)
    expect(isLocked(out.title)).toBe(true)
    expect((out as Record<string, unknown>).__locked).toBe(true)
  })

  it('refuses content moved to another field, sprint or record', async () => {
    const srv = await signedIn()
    const a = sprintFor(srv, srv.pk)
    const b = sprintFor(srv, srv.pk)
    const title = sealField(a.keys, a.id, 'title', 'Synthetic')
    expect((await keyring.decryptDeep({ summary: title }, a.id)).summary).toBe(LOCKED)
    expect((await keyring.decryptDeep({ title }, b.id)).title).toBe(LOCKED)
    expect((await keyring.decryptDeep({ sprint_id: b.id, title }, null)).title).toBe(LOCKED)
    const body = sealEntry({ sprintId: a.id, recordId: 'r1', version: 1, sprintPk: a.keys.pk, authorId: 'x', authorPk: newKeyPair().pk }, { body: 'Synthetic', impact: null, might_help: null })
    expect((await keyring.decryptDeep({ id: 'r2', body }, a.id)).body).toBe(LOCKED)
  })
})

describe('writing', () => {
  it('seals content fields for encrypted sprints and leaves legacy ones alone', async () => {
    const srv = await signedIn()
    const sp = sprintFor(srv, srv.pk)
    const sealed = (await keyring.sealRequest('POST', `/api/sprints/${sp.id}/themes`, { title: 'Synthetic', entry_ids: ['a'] })) as { title: string; entry_ids: string[] }
    expect(sealed.title.startsWith('e1.')).toBe(true)
    expect(sealed.entry_ids).toEqual(['a'])
    expect((await keyring.decryptDeep({ title: sealed.title }, sp.id)).title).toBe('Synthetic')
    const legacy = crypto.randomUUID()
    expect(await keyring.sealRequest('POST', `/api/sprints/${legacy}/themes`, { title: 'Plain' })).toEqual({ title: 'Plain' })
  })

  it('never sends plaintext when this device can’t seal, or can’t tell whether it should', async () => {
    const srv = await signedIn()
    const sp = sprintFor(srv, srv.pk, { holds: false })
    await expect(keyring.sealRequest('PUT', `/api/sprints/${sp.id}/meeting/notes/t1`, { takeaway: 'Synthetic' })).rejects.toThrow()
    keyring.lock()
    await expect(keyring.isEncrypted(sp.id)).rejects.toMatchObject({ code: 'no-key' })
  })

  it('seals a thought to the sprint and to its author, readable back by the author', async () => {
    const srv = await signedIn()
    const sp = sprintFor(srv, srv.pk, { holds: false })
    const env = await keyring.sealThought(sp.id, 'rec-1', { body: 'Synthetic mine', impact: null, might_help: null }, srv.me)
    expect((await keyring.decryptDeep({ id: 'rec-1', body: env }, sp.id)).body).toBe('Synthetic mine')
  })
})

describe('sharing keys', () => {
  it('pins teammates’ keys on first use, and refuses a changed key until it’s confirmed', async () => {
    const srv = await signedIn()
    const maya = { id: 'maya', name: 'Maya', keys: newKeyPair() }
    const sp = sprintFor(srv, srv.pk, { others: [maya] })
    expect((await keyring.missingWraps(sp.id)).map((w) => w.account_id)).toEqual(['maya'])
    // The server now reports a different key for Maya (a reset — or a substitution).
    const swapped = newKeyPair()
    const view = srv.s.sprints.get(sp.id)!
    view.participants![1].public_key = b64u(swapped.pk)
    keyring.forgetSprint(sp.id)
    expect(await keyring.missingWraps(sp.id)).toHaveLength(0)
    expect(keyring.keyChanges().map((c) => c.accountId)).toEqual(['maya'])
    await keyring.acceptKeyChange('maya', b64u(swapped.pk))
    expect((await keyring.missingWraps(sp.id)).map((w) => w.recipient_public_key)).toEqual([b64u(swapped.pk)])
  })

  it('never shares a still-sealed version except with the facilitator', async () => {
    const srv = await signedIn()
    const maya = { id: 'maya', name: 'Maya', keys: newKeyPair() }
    const sp = sprintFor(srv, srv.pk, { others: [maya] })
    srv.s.sprints.get(sp.id)!.sealed_version = 1
    keyring.forgetSprint(sp.id)
    expect(await keyring.missingWraps(sp.id)).toHaveLength(0)
    expect(await keyring.missingWraps(sp.id, { reveal: true })).toHaveLength(1)
  })
})
