/**
 * Unlocking the account key with a passkey (PRF) and keeping a device unlockable across sign-out,
 * through the real Worker and D1, with the real client constructions (web/src/lib/e2ee/wrap.ts).
 *
 * What this establishes: the server stores only wraps it can't open and device shares that open
 * nothing alone; it releases a device's share only under the rule in docs/encryption.md, "Keys"; wraps
 * and shares follow passkey removal and key replacement; nothing secret reaches D1; a stale tab
 * can't act for another account; a request carrying PRF output is refused. The PRF output here is
 * simulated (the software authenticator doesn't implement the extension): what the server sees is
 * identical either way, because the output never leaves the browser.
 */
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { b64u, newKeyPair } from '../../web/src/lib/e2ee/crypto'
import { deviceKek, kekFromPrf, openForDevice, openPasskeyWrap, sealForDevice, wrapForPasskey } from '../../web/src/lib/e2ee/wrap'
import { SoftAuthenticator } from './authenticator'
import { addPasskeyTo, ageSession, del, get, passkeyLogin, passkeySignup, post, put, rawReq, req, signin, tag, type User } from './harness'

const rand = (n = 32) => crypto.getRandomValues(new Uint8Array(n))
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
const fromB64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0))

async function dumpAll(): Promise<string> {
  const tables = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'").all<{ name: string }>()).results
  let dump = ''
  for (const t of tables) dump += JSON.stringify((await env.DB.prepare(`SELECT * FROM "${t.name}"`).all()).results)
  return dump
}

/** A passkey-only account that set up its key at sign-up, wrapped for that passkey. */
async function passkeyAccount() {
  const auth = new SoftAuthenticator()
  const r = await passkeySignup(auth, `Unlock ${tag()}`)
  expect(r.status).toBe(200)
  const user = r.user!
  const kp = newKeyPair()
  const keys = await get('/api/me/keys', user)
  expect(keys.body.session_passkey).toMatchObject({ webauthn_id: r.response.id })
  const prf = rand()
  const kek = await kekFromPrf(new Uint8Array(prf), { accountId: user.account_id, credentialId: r.response.id })
  const wrapped = await wrapForPasskey(kek, kp.sk, { accountId: user.account_id, id: r.response.id, keyVersion: 1, publicKey: b64u(kp.pk) })
  const set = await put('/api/me/keys', user, { public_key: b64u(kp.pk), passkey_wrap: { credential: keys.body.session_passkey.id, wrapped } })
  expect(set.status, JSON.stringify(set.body)).toBe(200)
  return { auth, user, kp, prf, credential: keys.body.session_passkey.id as string, webauthnId: r.response.id as string }
}

async function keepDevice(user: User, over: { replaces?: string; for_version?: number } = {}) {
  const id = crypto.randomUUID()
  const r = await put(`/api/me/devices/${id}`, user, { installed: false, ...over })
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  return { id, share: r.body.share as string, requires_passkey: r.body.requires_passkey as boolean }
}

describe('passkey wraps', () => {
  it('are stored for the account’s own passkeys and current key only, and opened only in the browser', async () => {
    const a = await passkeyAccount()
    const keys = await get('/api/me/keys', a.user)
    expect(keys.body.passkeys).toHaveLength(1)
    const w = keys.body.passkeys[0]
    expect(w).toMatchObject({ credential: a.credential, webauthn_id: a.webauthnId, key_version: 1 })
    // Opens with that passkey's PRF output (in the browser) to the account key.
    const kek = await kekFromPrf(new Uint8Array(a.prf), { accountId: a.user.account_id, credentialId: a.webauthnId })
    expect(await openPasskeyWrap(kek, w.wrapped, { accountId: a.user.account_id, id: a.webauthnId, keyVersion: 1, publicKey: b64u(a.kp.pk) })).toEqual(a.kp.sk)
    // Another account sees none of it.
    const b = await passkeyAccount()
    expect((await get('/api/me/keys', b.user)).body.passkeys.map((x: { credential: string }) => x.credential)).toEqual([b.credential])
  })

  it('are refused for another account’s passkey, an old key, a malformed value or a stale sign-in', async () => {
    const a = await passkeyAccount()
    const b = await passkeyAccount()
    const body = { wrapped: 'p1.eyJ2IjoxfQ', key_version: 1, public_key: b64u(a.kp.pk) }
    expect((await put(`/api/me/keys/passkeys/${b.credential}`, a.user, body)).status).toBe(404)
    expect((await put(`/api/me/keys/passkeys/${a.credential}`, a.user, { ...body, key_version: 2 })).body.code).toBe('key_changed')
    expect((await put(`/api/me/keys/passkeys/${a.credential}`, a.user, { ...body, public_key: b64u(newKeyPair().pk) })).body.code).toBe('key_changed')
    expect((await put(`/api/me/keys/passkeys/${a.credential}`, a.user, { ...body, wrapped: 'w1.notapasskeywrap' })).status).toBe(400)
    await ageSession(a.user)
    expect((await put(`/api/me/keys/passkeys/${a.credential}`, a.user, body)).body.code).toBe('reauth_required')
  })

  it('go with the passkey when it’s removed, and with the key when it’s replaced', async () => {
    const a = await passkeyAccount()
    // A second passkey that can unlock too.
    const added = await addPasskeyTo(a.user, a.auth, { name: 'Second' })
    expect(added.status).toBe(200)
    const kek = await kekFromPrf(rand(), { accountId: a.user.account_id, credentialId: added.response.id })
    const wrapped = await wrapForPasskey(kek, a.kp.sk, { accountId: a.user.account_id, id: added.response.id, keyVersion: 1, publicKey: b64u(a.kp.pk) })
    expect((await put(`/api/me/keys/passkeys/${added.body.id}`, a.user, { wrapped, key_version: 1, public_key: b64u(a.kp.pk) })).status).toBe(200)
    expect((await get('/api/me/keys', a.user)).body.passkeys).toHaveLength(2)
    expect((await del(`/api/auth/passkeys/${added.body.id}`, a.user, {})).status).toBe(200)
    expect((await get('/api/me/keys', a.user)).body.passkeys.map((x: { credential: string }) => x.credential)).toEqual([a.credential])
    expect(Number((await env.DB.prepare('SELECT count(*) AS n FROM passkey_key_wraps WHERE credential_id = ?').bind(added.body.id).first<{ n: number }>())!.n)).toBe(0)
    // Replacing the key ("Start over") drops every wrap and device of the old one.
    await keepDevice(a.user)
    const nk = newKeyPair()
    expect((await put('/api/me/keys', a.user, { public_key: b64u(nk.pk), replace: true })).status).toBe(200)
    const after = await get('/api/me/keys', a.user)
    expect(after.body).toMatchObject({ key_version: 2, passkeys: [] })
    expect((await get('/api/me/devices', a.user)).body).toEqual([])
  })
})

describe('device unlocks', () => {
  it('release the share to a passkey session of the account, and survive signing out', async () => {
    const a = await passkeyAccount()
    const d = await keepDevice(a.user)
    expect(d.requires_passkey).toBe(true)
    const ds = rand()
    const env1 = await sealForDevice(await deviceKek(ds, fromB64(d.share), { accountId: a.user.account_id, deviceId: d.id }), a.kp.sk, { accountId: a.user.account_id, id: d.id, keyVersion: 1, publicKey: b64u(a.kp.pk) })
    // Sign out: the session ends, the device row stays.
    expect((await post('/api/auth/logout', a.user)).status).toBe(200)
    expect((await post(`/api/me/devices/${d.id}/unlock`, a.user)).status).toBe(401)
    // Sign in again with the passkey: the share comes back and the envelope opens.
    const back = await passkeyLogin(a.auth)
    const r = await post(`/api/me/devices/${d.id}/unlock`, back.user!)
    expect(r.status).toBe(200)
    expect(r.body.share).toBe(d.share)
    expect(await openForDevice(await deviceKek(ds, fromB64(r.body.share), { accountId: a.user.account_id, deviceId: d.id }), env1, { accountId: a.user.account_id, id: d.id, keyVersion: 1, publicKey: b64u(a.kp.pk) })).toEqual(a.kp.sk)
    // The share is issued once: re-creating the same id never returns it again.
    expect((await put(`/api/me/devices/${d.id}`, back.user!, {})).body).toMatchObject({ created: false })
    expect((await put(`/api/me/devices/${d.id}`, back.user!, {})).body.share).toBeUndefined()
    // The wraps survived signing out too.
    expect((await get('/api/me/keys', back.user)).body.passkeys).toHaveLength(1)
  })

  it('release only to a passkey that existed when the device was bound — never one added later', async () => {
    const email = `unlock-${tag()}@example.com`
    const u = await signin(email, 'Mixed')
    const kp = newKeyPair()
    expect((await put('/api/me/keys', u, { public_key: b64u(kp.pk) })).status).toBe(200)
    const d = await keepDevice(u)
    expect(d.requires_passkey).toBe(true)
    // The passkey the account signed in with then can reopen it.
    expect((await post(`/api/me/devices/${d.id}/unlock`, u)).status).toBe(200)
    // A passkey added afterwards (say, by someone with a borrowed session) can't.
    await env.DB.prepare('UPDATE device_unlocks SET bound_at = bound_at - 5000 WHERE id = ?').bind(d.id).run()
    const later = new SoftAuthenticator()
    const second = await addPasskeyTo(u, later, { name: 'Later' })
    expect(second.status).toBe(200)
    const withSecond = await passkeyLogin(later, { credId: second.response.id })
    expect((await post(`/api/me/devices/${d.id}/unlock`, withSecond.user!)).body.code).toBe('passkey_required')
    // Nor does a removed passkey's old session.
    const first = (await get('/api/auth/passkeys', withSecond.user!)).body.find((p: { id: string; name: string }) => p.name !== 'Later').id
    expect((await del(`/api/auth/passkeys/${first}`, withSecond.user!, {})).status).toBe(200)
    expect((await post(`/api/me/devices/${d.id}/unlock`, u)).body.code).toBe('passkey_required')
  })

  it('are for one account: no other account can use or see them', async () => {
    const u = await signin(`owner-${tag()}@example.com`)
    const kp = newKeyPair()
    expect((await put('/api/me/keys', u, { public_key: b64u(kp.pk) })).status).toBe(200)
    const d = await keepDevice(u)
    expect((await post(`/api/me/devices/${d.id}/unlock`, u)).body.share).toBe(d.share)
    const other = await signin(`other-${tag()}@example.com`)
    const r = await post(`/api/me/devices/${d.id}/unlock`, other)
    expect(r.status).toBe(404)
    expect(r.body.code).toBe('device_unknown')
    expect((await get('/api/me/devices', other)).body).toEqual([])
    // Listing never includes a share; removing one stops it.
    const list = await get('/api/me/devices', u)
    expect(JSON.stringify(list.body)).not.toContain(d.share)
    expect((await del(`/api/me/devices/${d.id}`, u)).body.removed).toBe(true)
    expect((await post(`/api/me/devices/${d.id}/unlock`, u)).body.code).toBe('device_unknown')
  })

  it('can be made for a key before it’s published, and survive starting over on the device that did it', async () => {
    const u = await signin(`first-${tag()}@example.com`)
    // Nothing published yet: only for the first key.
    expect((await put(`/api/me/devices/${crypto.randomUUID()}`, u, {})).status).toBe(409)
    expect((await put(`/api/me/devices/${crypto.randomUUID()}`, u, { for_version: 2 })).status).toBe(400)
    const d = await keepDevice(u, { for_version: 1 })
    const kp = newKeyPair()
    expect((await put('/api/me/keys', u, { public_key: b64u(kp.pk), device: d.id })).status).toBe(200)
    expect((await get('/api/me/devices', u)).body).toMatchObject([{ id: d.id, key_version: 1 }])
    // Starting over from another device's row: this one is kept for the new version, the rest go.
    const other = await keepDevice(u)
    const next = await keepDevice(u, { for_version: 2 })
    expect((await put('/api/me/keys', u, { public_key: b64u(newKeyPair().pk), replace: true, device: next.id })).status).toBe(200)
    expect((await get('/api/me/devices', u)).body.map((x: { id: string; key_version: number }) => [x.id, x.key_version])).toEqual([[next.id, 2]])
    expect((await post(`/api/me/devices/${other.id}/unlock`, u)).body.code).toBe('device_unknown')
  })

  it('replace this device’s previous row when re-created, and keep at most 50', async () => {
    const u = await signin(`many-${tag()}@example.com`)
    expect((await put('/api/me/keys', u, { public_key: b64u(newKeyPair().pk) })).status).toBe(200)
    const d1 = await keepDevice(u)
    const d2 = await keepDevice(u, { replaces: d1.id })
    const ids = (await get('/api/me/devices', u)).body.map((d: { id: string }) => d.id)
    expect(ids).toEqual([d2.id])
    await env.DB.prepare('DELETE FROM rate_events WHERE bucket = ?').bind(`device-add:${u.account_id}`).run()
    for (let i = 0; i < 55; i++) {
      if (i % 25 === 24) await env.DB.prepare('DELETE FROM rate_events WHERE bucket = ?').bind(`device-add:${u.account_id}`).run()
      await keepDevice(u)
    }
    expect((await get('/api/me/devices', u)).body.length).toBe(50)
  })
})

describe('nothing secret on the server', () => {
  it('holds no account key, PRF output or device half — in any table', async () => {
    const a = await passkeyAccount()
    const d = await keepDevice(a.user)
    const ds = rand()
    await sealForDevice(await deviceKek(ds, fromB64(d.share), { accountId: a.user.account_id, deviceId: d.id }), a.kp.sk, { accountId: a.user.account_id, id: d.id, keyVersion: 1, publicKey: b64u(a.kp.pk) })
    const dump = await dumpAll()
    for (const secret of [a.kp.sk, a.prf, ds]) {
      expect(dump).not.toContain(b64u(secret))
      expect(dump).not.toContain(hex(secret))
    }
  })

  it('refuses a sign-in or registration that carries PRF output', async () => {
    const a = await passkeyAccount()
    const leaked = { prf: { enabled: true, results: { first: b64u(a.prf) } } }
    const r = await passkeyLogin(a.auth, { tamper: (resp) => (resp.clientExtensionResults = leaked) })
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('prf_not_allowed')
    expect(await dumpAll()).not.toContain(b64u(a.prf))
    const reg = await passkeySignup(new SoftAuthenticator(), 'Leaky', { tamper: (resp) => (resp.clientExtensionResults = leaked) })
    expect(reg.body.code).toBe('prf_not_allowed')
    // "enabled" alone says nothing secret, and is fine.
    const ok = await passkeyLogin(a.auth, { tamper: (resp) => (resp.clientExtensionResults = { prf: { enabled: true } }) })
    expect(ok.status).toBe(200)
  })
})

describe('a tab acting for someone else', () => {
  it('is refused, except to find out who is signed in, or to sign out', async () => {
    const a = await signin(`tab-a-${tag()}@example.com`)
    const other = crypto.randomUUID()
    const h = { 'x-muni-account': other }
    const keys = await req('GET', '/api/me/keys', a, undefined, h)
    expect(keys.status).toBe(409)
    expect((keys.body as { code: string }).code).toBe('account_changed')
    expect((await req('PUT', '/api/me/keys', a, { public_key: b64u(newKeyPair().pk) }, h)).status).toBe(409)
    expect((await req('PATCH', '/api/auth/me', a, { display_name: 'Nope' }, h)).status).toBe(409)
    expect((await req('GET', '/api/auth/me', a, undefined, h)).status).toBe(200)
    expect((await req('GET', '/api/me/keys', a, undefined, { 'x-muni-account': a.account_id })).status).toBe(200)
    expect((await req('POST', '/api/auth/logout', a, {}, h)).status).toBe(200)
  })

  it('asks for one particular passkey when confirming, to let it unlock', async () => {
    const a = await passkeyAccount()
    const o = await rawReq('POST', '/api/auth/passkey/reauth/options', { cookie: `muni_session=${a.user.session}; muni_csrf=${a.user.csrf}`, csrf: a.user.csrf, json: { credential: a.credential } })
    expect(o.status).toBe(200)
    expect(o.body.allowCredentials.map((c: { id: string }) => c.id)).toEqual([a.webauthnId])
    const missing = await rawReq('POST', '/api/auth/passkey/reauth/options', { cookie: `muni_session=${a.user.session}; muni_csrf=${a.user.csrf}`, csrf: a.user.csrf, json: { credential: crypto.randomUUID() } })
    expect(missing.status).toBe(404)
  })
})
