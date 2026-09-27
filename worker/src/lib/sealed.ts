/**
 * Content fields for encrypted sprints. The server never encrypts or decrypts anything: for a
 * sprint marked 'e1' it only checks that each content field is a well-formed client envelope and
 * refuses plaintext, so a buggy or outdated client can't store readable content by accident.
 * Legacy (NULL) sprints keep the plaintext rules they always had.
 */
import { AppError, bad } from './errors'
import { nonempty, optional } from './util'

export const ENCRYPTION = 'e1'
export const isEncrypted = (s: { encryption?: string | null }) => s.encryption === ENCRYPTION

const ENVELOPE_RE = /^e1\.[A-Za-z0-9_-]+$/
const WRAP_RE = /^w1\.[A-Za-z0-9_-]+$/
const RECOVERY_RE = /^r1\.[A-Za-z0-9_-]+$/
const KEY_RE = /^[A-Za-z0-9_-]{43}$/ // a 32-byte X25519 public key, base64url

/** Worst case for `max` characters of text: 4 UTF-8 bytes each, AEAD and JSON overhead, base64. */
export const envelopeMax = (max: number) => Math.ceil((max * 4 + 1600) * 1.4)

export const encryptionRequired = (label: string) => new AppError(400, 'encryption_required', `${label} must be encrypted on your device for this sprint — nothing was saved`)

/**
 * A content field: plaintext rules for legacy sprints; an envelope (and only an envelope) for
 * encrypted ones. `max` is the plaintext limit the client enforces before encrypting.
 */
export function content(encrypted: boolean, v: unknown, max: number, label: string, required: boolean): string | null {
  if (!encrypted) return required ? nonempty(v, max, label) : optional(v, max, label)
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${label} can’t be empty`)
    return null
  }
  if (typeof v !== 'string' || !ENVELOPE_RE.test(v)) throw encryptionRequired(label)
  if (v.length > envelopeMax(max)) throw bad(`${label} is too long`)
  return v
}

export function publicKey(v: unknown): string {
  if (typeof v !== 'string' || !KEY_RE.test(v)) throw bad('not a public key')
  return v
}
export function wrapped(v: unknown): string {
  if (typeof v !== 'string' || !WRAP_RE.test(v) || v.length > 2000) throw bad('not a wrapped key')
  return v
}
export function recoveryBlob(v: unknown): string {
  if (typeof v !== 'string' || !RECOVERY_RE.test(v) || v.length > 2000) throw bad('not a recovery blob')
  return v
}
const PASSKEY_WRAP_RE = /^p1\.[A-Za-z0-9_-]+$/
/** The account key wrapped under a passkey's PRF-derived key (opened only in the browser). */
export function passkeyWrap(v: unknown): string {
  if (typeof v !== 'string' || !PASSKEY_WRAP_RE.test(v) || v.length > 1000) throw bad('not a wrapped key')
  return v
}

/**
 * The binding a thought's envelope declares (sprint, record, author). The server can't check the
 * encryption, but it can refuse an envelope that names someone else as its author — one sealed by
 * a tab still holding another account's key — before it's stored under this account.
 */
export function entryBinding(v: string): { s: string; r: string; a: string } | null {
  try {
    const b64 = v.slice(3).replace(/-/g, '+').replace(/_/g, '/')
    const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64 + '==='.slice((b64.length + 3) % 4)), (ch) => ch.charCodeAt(0))))
    if (json && json.t === 'e' && typeof json.s === 'string' && typeof json.r === 'string' && typeof json.a === 'string') return { s: json.s, r: json.r, a: json.a }
  } catch {
    /* not parseable: refused by the caller */
  }
  return null
}
