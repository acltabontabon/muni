import { describe, expect, it } from 'vitest'
import { sha256 } from '@noble/hashes/sha2.js'
import { b64u, newKeyPair } from './crypto'
import { deviceKek, kekFromPrf, openForDevice, openPasskeyWrap, PRF_INPUT, sealForDevice, wrapForPasskey, type WrapBinding } from './wrap'

const rand = (n = 32) => crypto.getRandomValues(new Uint8Array(n))
const binding = (over: Partial<WrapBinding> = {}): WrapBinding => ({ accountId: 'acc-1', id: 'cred-1', keyVersion: 1, publicKey: 'PK', ...over })

describe('passkey wraps', () => {
  it('round-trip the account key under a PRF-derived key', async () => {
    const kp = newKeyPair()
    const prf = rand()
    const kek = await kekFromPrf(new Uint8Array(prf), { accountId: 'acc-1', credentialId: 'cred-1' })
    const w = await wrapForPasskey(kek, kp.sk, binding())
    expect(w.startsWith('p1.')).toBe(true)
    expect(w).not.toContain(b64u(kp.sk))
    const again = await kekFromPrf(new Uint8Array(prf), { accountId: 'acc-1', credentialId: 'cred-1' })
    expect(await openPasskeyWrap(again, w, binding())).toEqual(kp.sk)
  })

  it('open only with the same PRF output, account, passkey, key version and public key', async () => {
    const kp = newKeyPair()
    const prf = rand()
    const kek = await kekFromPrf(new Uint8Array(prf), { accountId: 'acc-1', credentialId: 'cred-1' })
    const w = await wrapForPasskey(kek, kp.sk, binding())
    const other = await kekFromPrf(rand(), { accountId: 'acc-1', credentialId: 'cred-1' })
    await expect(openPasskeyWrap(other, w, binding())).rejects.toMatchObject({ code: 'auth' })
    // Same PRF output, but derived for another account or passkey: a different key.
    const wrongAccount = await kekFromPrf(new Uint8Array(prf), { accountId: 'acc-2', credentialId: 'cred-1' })
    await expect(openPasskeyWrap(wrongAccount, w, binding())).rejects.toMatchObject({ code: 'auth' })
    const wrongCred = await kekFromPrf(new Uint8Array(prf), { accountId: 'acc-1', credentialId: 'cred-2' })
    await expect(openPasskeyWrap(wrongCred, w, binding())).rejects.toMatchObject({ code: 'auth' })
    // The right key, but the wrap relabelled (another version, public key, passkey or account).
    for (const over of [{ keyVersion: 2 }, { publicKey: 'OTHER' }, { id: 'cred-2' }, { accountId: 'acc-2' }]) await expect(openPasskeyWrap(kek, w, binding(over))).rejects.toMatchObject({ code: 'auth' })
    // Tampering is caught.
    const flipped = w.slice(0, -3) + (w.at(-3) === 'A' ? 'B' : 'A') + w.slice(-2)
    await expect(openPasskeyWrap(kek, flipped, binding())).rejects.toBeTruthy()
  })

  it('never reuses an IV, and the derived key can’t be exported', async () => {
    const kp = newKeyPair()
    const kek = await kekFromPrf(rand(), { accountId: 'a', credentialId: 'c' })
    const ivs = new Set<string>()
    for (let i = 0; i < 50; i++) ivs.add(JSON.parse(atob((await wrapForPasskey(kek, kp.sk, binding())).slice(3).replace(/-/g, '+').replace(/_/g, '/'))).n)
    expect(ivs.size).toBe(50)
    expect(kek.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('raw', kek)).rejects.toBeTruthy()
  })

  it('zeroes the PRF output it was given, and asks every passkey the same fixed question', async () => {
    const prf = rand()
    await kekFromPrf(prf, { accountId: 'a', credentialId: 'c' })
    expect(prf.every((b) => b === 0)).toBe(true)
    expect(b64u(PRF_INPUT)).toBe(b64u(sha256(new TextEncoder().encode('muni:prf:account-key:v1'))))
  })
})

describe('device envelopes', () => {
  it('need both halves: what the device keeps and the share the server releases', async () => {
    const kp = newKeyPair()
    const ds = rand()
    const share = rand()
    const b = binding({ id: 'device-1' })
    const env = await sealForDevice(await deviceKek(ds, share, { accountId: 'acc-1', deviceId: 'device-1' }), kp.sk, b)
    expect(env.startsWith('d1.')).toBe(true)
    expect(await openForDevice(await deviceKek(ds, share, { accountId: 'acc-1', deviceId: 'device-1' }), env, b)).toEqual(kp.sk)
    await expect(openForDevice(await deviceKek(ds, rand(), { accountId: 'acc-1', deviceId: 'device-1' }), env, b)).rejects.toMatchObject({ code: 'auth' })
    await expect(openForDevice(await deviceKek(rand(), share, { accountId: 'acc-1', deviceId: 'device-1' }), env, b)).rejects.toMatchObject({ code: 'auth' })
    // Another account's share (or device id) never opens it.
    await expect(openForDevice(await deviceKek(ds, share, { accountId: 'acc-2', deviceId: 'device-1' }), env, b)).rejects.toMatchObject({ code: 'auth' })
    // A passkey wrap and a device envelope are not interchangeable.
    await expect(openPasskeyWrap(await deviceKek(ds, share, { accountId: 'acc-1', deviceId: 'device-1' }), env, b)).rejects.toMatchObject({ code: 'malformed' })
  })
})
