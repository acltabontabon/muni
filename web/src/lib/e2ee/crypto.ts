/**
 * Muni's content encryption: every cryptographic operation in the app, and nothing else.
 * Reviewed primitives only (the audited @noble libraries); no custom ciphers.
 *
 *   X25519            key agreement (account keys, sprint keys)
 *   HKDF-SHA256       key derivation
 *   XChaCha20-Poly1305  authenticated encryption; 192-bit random nonces, so nonce reuse
 *                       under one key is not a practical concern
 *
 * Constructions (see docs/encryption.md for the protocol and threat model):
 *
 * - sealed box — encrypt to a public key: a fresh ephemeral X25519 key, HKDF over the shared
 *   secret salted with both public keys, then XChaCha20-Poly1305 with a context string as AAD.
 *   (The same shape as libsodium's crypto_box_seal / HPKE base mode, over reviewed primitives.)
 * - account key — one X25519 key pair per person. The private key never leaves their devices
 *   except wrapped under a recovery key the server never sees.
 * - sprint secret S — 32 random bytes per sprint key version. HKDF derives the sprint's X25519
 *   key pair (thoughts are sealed to its public key) and the discussion key (themes, notes,
 *   outcomes). S is sealed to each person allowed to read.
 * - envelopes — every stored piece of content is an "e1." string: a versioned JSON record bound
 *   by AAD to its sprint, key version, field and (for thoughts) record id. Anything that fails to
 *   parse or authenticate throws; there is no plaintext fallback anywhere.
 */
import { x25519 } from '@noble/curves/ed25519.js'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { randomBytes } from '@noble/hashes/utils.js'

export const ENVELOPE = 'e1.'
export const WRAP = 'w1.'
export const RECOVERY = 'r1.'
/** The largest envelope a client will parse (the server enforces its own, smaller limits). */
const MAX_ENVELOPE = 64 * 1024

export type CryptoErrorCode = 'malformed' | 'auth' | 'no-key' | 'mismatch' | 'version'
export class CryptoError extends Error {
  constructor(public code: CryptoErrorCode, message: string) {
    super(message)
    this.name = 'CryptoError'
  }
}

const te = new TextEncoder()
const td = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
const utf8 = (s: string) => te.encode(s)

// ------------------------------------------------------------------ encoding

export function b64u(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export function fromB64u(s: string, expectLength?: number): Uint8Array {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s)) throw new CryptoError('malformed', 'not base64url')
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  if (expectLength !== undefined && out.length !== expectLength) throw new CryptoError('malformed', 'wrong length')
  return out
}
function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
function equal(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]
  return d === 0
}

// ------------------------------------------------------------------ primitives

const derive = (ikm: Uint8Array, salt: Uint8Array, info: string, len = 32) => hkdf(sha256, ikm, salt, utf8(info), len)

/** A key that was wiped (the keyring zeroes keys when it locks) is never used, for sealing or opening. */
function usable(key: Uint8Array) {
  if (key.every((b) => b === 0)) throw new CryptoError('no-key', 'this key is no longer available')
}

type Box = { n: string; c: string }
function aeadSeal(key: Uint8Array, plaintext: Uint8Array, aad: string): Box {
  usable(key)
  const n = randomBytes(24)
  return { n: b64u(n), c: b64u(xchacha20poly1305(key, n, utf8(aad)).encrypt(plaintext)) }
}
function aeadOpen(key: Uint8Array, box: Box, aad: string): Uint8Array {
  usable(key)
  const n = fromB64u(box.n, 24)
  const c = fromB64u(box.c)
  if (c.length < 16) throw new CryptoError('malformed', 'ciphertext too short')
  try {
    return xchacha20poly1305(key, n, utf8(aad)).decrypt(c)
  } catch {
    throw new CryptoError('auth', 'this content could not be verified')
  }
}

export type KeyPair = { sk: Uint8Array; pk: Uint8Array }
export function newKeyPair(): KeyPair {
  const sk = x25519.utils.randomSecretKey()
  return { sk, pk: x25519.getPublicKey(sk) }
}
export const publicKeyOf = (sk: Uint8Array) => x25519.getPublicKey(sk)

function agree(sk: Uint8Array, pk: Uint8Array) {
  const shared = x25519.getSharedSecret(sk, pk)
  // A low-order public key gives an all-zero secret: refuse it.
  if (equal(shared, new Uint8Array(32))) throw new CryptoError('auth', 'invalid public key')
  return shared
}

type Sealed = { e: string; n: string; c: string }
/** Encrypt to a public key. `context` is bound as AAD and must match exactly when opening. */
export function sealTo(recipient: Uint8Array, plaintext: Uint8Array, context: string): Sealed {
  const eph = newKeyPair()
  const key = derive(agree(eph.sk, recipient), concat(eph.pk, recipient), 'muni sealed box v1')
  return { e: b64u(eph.pk), ...aeadSeal(key, plaintext, context) }
}
/** `pk`: the recipient's public key when the caller already has it (deriving it again costs a scalar multiplication). */
export function openSealed(sk: Uint8Array, box: Sealed, context: string, pk: Uint8Array = publicKeyOf(sk)): Uint8Array {
  usable(sk)
  const eph = fromB64u(box.e, 32)
  const key = derive(agree(sk, eph), concat(eph, pk), 'muni sealed box v1')
  return aeadOpen(key, box, context)
}

/** A short, human-comparable fingerprint of a public key: "K7QD 2MXA 9PJF 4TRE". */
export function fingerprint(pk: Uint8Array): string {
  const h = sha256(concat(utf8('muni fingerprint v1'), pk)).slice(0, 10)
  return base32(h).match(/.{4}/g)!.join(' ')
}

// ------------------------------------------------------------------ recovery key

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32: no I, L, O, U
function base32(bytes: Uint8Array) {
  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}
function unbase32(s: string) {
  const out: number[] = []
  let bits = 0
  let value = 0
  for (const ch of s) {
    const v = ALPHABET.indexOf(ch)
    if (v < 0) throw new CryptoError('malformed', 'not a recovery key')
    value = (value << 5) | v
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

/** 160 random bits plus a 2-byte checksum, shown as nine groups of four characters. */
export function newRecoveryKey(): string {
  const secret = randomBytes(20)
  const check = sha256(concat(utf8('muni recovery check v1'), secret)).slice(0, 2)
  return base32(concat(secret, check)).match(/.{1,4}/g)!.join('-')
}
/** Accepts what people actually type: spaces, lower case, and O/I/L for 0/1/1. */
export function parseRecoveryKey(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  if (clean.length !== 36) throw new CryptoError('malformed', 'A recovery key has 36 characters.')
  const bytes = unbase32(clean)
  const secret = bytes.slice(0, 20)
  const check = sha256(concat(utf8('muni recovery check v1'), secret)).slice(0, 2)
  if (!equal(check, bytes.slice(20, 22))) throw new CryptoError('mismatch', 'That recovery key has a typo — check each group.')
  return secret
}

/** The account private key, encrypted under the recovery key. Safe to store on the server. */
export function wrapForRecovery(sk: Uint8Array, recoveryKey: string, accountId: string): string {
  const key = derive(parseRecoveryKey(recoveryKey), utf8(accountId), 'muni recovery v1')
  return RECOVERY + b64u(utf8(JSON.stringify({ v: 1, ...aeadSeal(key, sk, `muni:recovery:v1|${accountId}`) })))
}
export function unwrapWithRecovery(blob: string, recoveryKey: string, accountId: string): Uint8Array {
  const box = parseJson(blob, RECOVERY) as Box & { v: number }
  if (box.v !== 1) throw new CryptoError('version', 'unsupported recovery format')
  const key = derive(parseRecoveryKey(recoveryKey), utf8(accountId), 'muni recovery v1')
  const sk = aeadOpen(key, box, `muni:recovery:v1|${accountId}`)
  if (sk.length !== 32) throw new CryptoError('malformed', 'bad key length')
  return sk
}

// ------------------------------------------------------------------ sprint keys

export type SprintKeys = { version: number; sk: Uint8Array; pk: Uint8Array; dk: Uint8Array }
export const newSprintSecret = () => randomBytes(32)
export function sprintKeys(secret: Uint8Array, version: number): SprintKeys {
  if (secret.length !== 32) throw new CryptoError('malformed', 'bad sprint secret')
  const sk = derive(secret, utf8('muni sprint'), 'muni sprint x25519 v1')
  return { version, sk, pk: publicKeyOf(sk), dk: derive(secret, utf8('muni sprint'), 'muni sprint discussion v1') }
}
const wrapContext = (sprintId: string, version: number, recipientId: string) => `muni:sprint-secret:v1|${sprintId}|${version}|${recipientId}`
/** The sprint secret, sealed to one person's account key and bound to them. */
export function wrapSprintSecret(recipientPk: Uint8Array, secret: Uint8Array, c: { sprintId: string; version: number; recipientId: string }): string {
  return WRAP + b64u(utf8(JSON.stringify({ v: 1, ...sealTo(recipientPk, secret, wrapContext(c.sprintId, c.version, c.recipientId)) })))
}
export function unwrapSprintSecret(sk: Uint8Array, wrapped: string, c: { sprintId: string; version: number; recipientId: string }, pk?: Uint8Array): Uint8Array {
  const box = parseJson(wrapped, WRAP) as Sealed & { v: number }
  if (box.v !== 1) throw new CryptoError('version', 'unsupported key format')
  const secret = openSealed(sk, box, wrapContext(c.sprintId, c.version, c.recipientId), pk)
  if (secret.length !== 32) throw new CryptoError('malformed', 'bad sprint secret')
  return secret
}

// ------------------------------------------------------------------ envelopes

function parseJson(s: string, prefix: string): Record<string, unknown> {
  if (typeof s !== 'string' || !s.startsWith(prefix) || s.length > MAX_ENVELOPE) throw new CryptoError('malformed', 'not an encrypted value')
  try {
    const v = JSON.parse(td.decode(fromB64u(s.slice(prefix.length))))
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error()
    return v as Record<string, unknown>
  } catch (e) {
    if (e instanceof CryptoError) throw e
    throw new CryptoError('malformed', 'not an encrypted value')
  }
}

export type FieldEnvelope = { v: 1; t: 'f'; s: string; k: number; f: string; n: string; c: string }
/** A thought. It names its sprint and record, never its author: after reveal, every participant receives it. */
export type EntryEnvelope = { v: 2; t: 'e'; s: string; k: number; r: string; n: string; c: string; ws: Sealed; wa: Sealed }
export type Envelope = FieldEnvelope | EntryEnvelope
/** The format each kind of envelope is written and read in (`v`). Any other is refused. */
const FORMAT = { f: 1, e: 2 } as const

export const isEnvelope = (x: unknown): x is string => typeof x === 'string' && x.startsWith(ENVELOPE)

export function parseEnvelope(s: string): Envelope {
  const e = parseJson(s, ENVELOPE)
  if (e.t !== 'f' && e.t !== 'e') throw new CryptoError('malformed', 'unknown envelope')
  if (e.v !== FORMAT[e.t]) throw new CryptoError('version', 'unsupported format')
  const str = (k: string) => typeof e[k] === 'string' && (e[k] as string).length > 0
  const sealed = (x: unknown) => !!x && typeof x === 'object' && ['e', 'n', 'c'].every((k) => typeof (x as Record<string, unknown>)[k] === 'string')
  if (!str('s') || !Number.isInteger(e.k) || (e.k as number) < 1 || !str('n') || !str('c')) throw new CryptoError('malformed', 'incomplete envelope')
  if (e.t === 'f' && str('f')) return e as unknown as FieldEnvelope
  if (e.t === 'e' && str('r') && sealed(e.ws) && sealed(e.wa)) return e as unknown as EntryEnvelope
  throw new CryptoError('malformed', 'incomplete envelope')
}

const fieldAad = (sprintId: string, version: number, field: string) => `muni:field:v1|${sprintId}|${version}|${field}`

/** A piece of discussion content (a theme title, a note, an experiment) under the discussion key. */
export function sealField(keys: SprintKeys, sprintId: string, field: string, text: string): string {
  const env: FieldEnvelope = { v: 1, t: 'f', s: sprintId, k: keys.version, f: field, ...aeadSeal(keys.dk, utf8(text), fieldAad(sprintId, keys.version, field)) }
  return ENVELOPE + b64u(utf8(JSON.stringify(env)))
}
export function openField(env: FieldEnvelope, keys: SprintKeys, expect: { sprintId: string; field: string }): string {
  if (env.s !== expect.sprintId) throw new CryptoError('mismatch', 'content from another sprint')
  if (env.f !== expect.field) throw new CryptoError('mismatch', 'content in the wrong place')
  if (env.k !== keys.version) throw new CryptoError('no-key', 'wrong key version')
  return td.decode(aeadOpen(keys.dk, env, fieldAad(env.s, env.k, env.f)))
}

export type EntryContent = { body: string; impact: string | null; might_help: string | null }
const entryAad = (sprintId: string, recordId: string, version: number) => `muni:entry:v2|${sprintId}|${recordId}|${version}`

/**
 * A thought: one fresh content key, sealed twice — to the sprint (readable by whoever holds the
 * sprint secret, which during collection is only the facilitator) and to its author, so they can
 * always reread it. Neither copy says whose key it was sealed to, and nothing else in the envelope
 * names the author: after reveal every participant receives it, and it stays anonymous.
 */
export function sealEntry(c: { sprintId: string; recordId: string; version: number; sprintPk: Uint8Array; authorPk: Uint8Array }, content: EntryContent): string {
  const cek = randomBytes(32)
  const aad = entryAad(c.sprintId, c.recordId, c.version)
  const body = aeadSeal(cek, utf8(JSON.stringify({ body: content.body, impact: content.impact || null, might_help: content.might_help || null })), aad)
  const env: EntryEnvelope = { v: 2, t: 'e', s: c.sprintId, k: c.version, r: c.recordId, ...body, ws: sealTo(c.sprintPk, cek, `muni:cek:sprint|${aad}`), wa: sealTo(c.authorPk, cek, `muni:cek:author|${aad}`) }
  return ENVELOPE + b64u(utf8(JSON.stringify(env)))
}
/**
 * Opens a thought with whichever key this device has: the sprint's, or the author's own. The
 * public keys that go with them are passed when known (`accountPk`), so none is derived again.
 */
export function openEntry(env: EntryEnvelope, expect: { sprintId: string; recordId: string }, keys: { sprint?: SprintKeys | null; accountSk?: Uint8Array | null; accountPk?: Uint8Array | null }): EntryContent {
  if (env.s !== expect.sprintId) throw new CryptoError('mismatch', 'thought from another sprint')
  if (env.r !== expect.recordId) throw new CryptoError('mismatch', 'thought in the wrong place')
  const aad = entryAad(env.s, env.r, env.k)
  let cek: Uint8Array | null = null
  if (keys.sprint && keys.sprint.version === env.k) cek = openSealed(keys.sprint.sk, env.ws, `muni:cek:sprint|${aad}`, keys.sprint.pk)
  else if (keys.accountSk) cek = openSealed(keys.accountSk, env.wa, `muni:cek:author|${aad}`, keys.accountPk ?? undefined)
  if (!cek) throw new CryptoError('no-key', 'this device doesn’t have the key')
  const v = JSON.parse(td.decode(aeadOpen(cek, env, aad)))
  if (typeof v?.body !== 'string') throw new CryptoError('malformed', 'bad thought')
  return { body: v.body, impact: typeof v.impact === 'string' ? v.impact : null, might_help: typeof v.might_help === 'string' ? v.might_help : null }
}
