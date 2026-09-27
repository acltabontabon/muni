/**
 * Getting the account key back, without anyone typing anything: the two ways Muni wraps the
 * account private key (crypto.ts) so it can be reopened later. Web Crypto only:
 *
 *   HKDF-SHA256    derives a wrapping key, non-extractable, used for AES-GCM and nothing else
 *   AES-256-GCM    authenticated encryption; a fresh random 96-bit IV per wrap. Each wrapping key
 *                  encrypts a handful of times in its life, far below AES-GCM's random-IV limits.
 *
 * - passkey wrap `p1.` — the wrapping key comes from the passkey's PRF output (WebAuthn's `prf`
 *   extension), which the authenticator computes from a secret that never leaves it. The output
 *   stays in this browser; the wrap is stored on Muni's server, which can't open it. Not derived
 *   from anything the server knows: not the credential id, a signature, the account id or a session.
 * - device envelope `d1.` — the wrapping key comes from two random halves: one kept on this device
 *   (`ds`), one kept by the server (`share`) and released only to this account's own sessions. The
 *   envelope itself never leaves the device. After signing out, it can't be opened until the
 *   person signs in again.
 *
 * Every wrap is bound (as AAD) to the account, the passkey or device, the key version and the
 * account's public key; whoever opens one also checks that the key inside matches that public key.
 */
import { sha256 } from '@noble/hashes/sha2.js'
import { b64u, CryptoError, fromB64u } from './crypto'

export const PASSKEY_WRAP = 'p1.'
export const DEVICE_WRAP = 'd1.'
const te = new TextEncoder()

/**
 * What every Muni passkey ceremony asks the passkey's PRF to evaluate. Constant, so a sign-in that
 * doesn't know which passkey will be used (discoverable, no allow list) can still ask; the output
 * is different for every passkey. A new version would ask with a new input.
 */
export const PRF_INPUT = sha256(te.encode('muni:prf:account-key:v1'))

/** What a wrap is bound to. `id` is the WebAuthn credential id (passkey) or the device id. */
export type WrapBinding = { accountId: string; id: string; keyVersion: number; publicKey: string }

const buf = (b: Uint8Array) => new Uint8Array(b) as Uint8Array<ArrayBuffer>

async function hkdfAesKey(ikm: Uint8Array, salt: string, info: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', buf(ikm), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: te.encode(salt), info: te.encode(info) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

/** The wrapping key for one passkey. Zeroes `prf` (pass a copy you no longer need). */
export async function kekFromPrf(prf: Uint8Array, c: { accountId: string; credentialId: string }): Promise<CryptoKey> {
  try {
    if (prf.length < 32) throw new CryptoError('malformed', 'unexpected PRF output')
    return await hkdfAesKey(prf, `muni|${c.accountId}|${c.credentialId}`, 'muni passkey kek v1')
  } finally {
    prf.fill(0)
  }
}

/** The wrapping key for this device's envelope: both halves are needed. */
export async function deviceKek(ds: Uint8Array, share: Uint8Array, c: { accountId: string; deviceId: string }): Promise<CryptoKey> {
  if (ds.length !== 32 || share.length !== 32) throw new CryptoError('malformed', 'bad device key material')
  const ikm = new Uint8Array(64)
  ikm.set(ds, 0)
  ikm.set(share, 32)
  try {
    return await hkdfAesKey(ikm, `muni|${c.accountId}|${c.deviceId}`, 'muni device kek v1')
  } finally {
    ikm.fill(0)
  }
}

const aad = (kind: 'passkey' | 'device', b: WrapBinding) => te.encode(`muni:${kind}-wrap:v1|${b.accountId}|${b.id}|${b.keyVersion}|${b.publicKey}`)

async function seal(prefix: string, kind: 'passkey' | 'device', key: CryptoKey, sk: Uint8Array, b: WrapBinding): Promise<string> {
  if (sk.length !== 32) throw new CryptoError('malformed', 'bad key length')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const c = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(kind, b) }, key, buf(sk)))
  return prefix + b64u(te.encode(JSON.stringify({ v: 1, n: b64u(iv), c: b64u(c) })))
}

async function open(prefix: string, kind: 'passkey' | 'device', key: CryptoKey, blob: string, b: WrapBinding): Promise<Uint8Array> {
  let box: { v?: unknown; n?: unknown; c?: unknown }
  try {
    if (typeof blob !== 'string' || !blob.startsWith(prefix) || blob.length > 2000) throw new Error()
    box = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(fromB64u(blob.slice(prefix.length))))
  } catch {
    throw new CryptoError('malformed', 'not a wrapped key')
  }
  if (box.v !== 1) throw new CryptoError('version', 'unsupported key format')
  const iv = fromB64u(String(box.n), 12)
  const c = fromB64u(String(box.c), 48)
  let out: Uint8Array
  try {
    out = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(iv), additionalData: aad(kind, b) }, key, buf(c)))
  } catch {
    throw new CryptoError('auth', 'this key could not be opened')
  }
  if (out.length !== 32) throw new CryptoError('malformed', 'bad key length')
  return out
}

export const wrapForPasskey = (kek: CryptoKey, sk: Uint8Array, b: WrapBinding) => seal(PASSKEY_WRAP, 'passkey', kek, sk, b)
export const openPasskeyWrap = (kek: CryptoKey, blob: string, b: WrapBinding) => open(PASSKEY_WRAP, 'passkey', kek, blob, b)
export const sealForDevice = (kek: CryptoKey, sk: Uint8Array, b: WrapBinding) => seal(DEVICE_WRAP, 'device', kek, sk, b)
export const openForDevice = (kek: CryptoKey, blob: string, b: WrapBinding) => open(DEVICE_WRAP, 'device', kek, blob, b)
