/**
 * Content fields for encrypted sprints. The server never encrypts or decrypts anything: for a
 * sprint marked 'e1' it only checks that each content field is a well-formed client envelope and
 * refuses plaintext, so a buggy or outdated client can't store readable content by accident.
 * Sprints set up without encryption (NULL) take plaintext, with the usual limits.
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

/** Characters of base64url (unpadded) for `bytes` bytes. */
const b64Length = (bytes: number) => Math.ceil((bytes * 4) / 3)

/**
 * The longest a thought's envelope can be (sealEntry, web/src/lib/e2ee/crypto.ts), for `max`
 * characters in each of its three fields — body, impact, what might help — as the capture form
 * limits them (a textarea's maxLength, counted in UTF-16 units):
 *
 *   plaintext  {"body":"…","impact":"…","might_help":"…"} is 39 bytes of JSON plus 3 × max × 3:
 *              a UTF-16 unit is at most 3 bytes of UTF-8, or of JSON escaping (`"`, `\`, tabs and
 *              line breaks take 2); a character beyond the BMP is 4 bytes for its 2 units
 *   sealed     + 16 bytes of Poly1305 tag, as base64url: ⌈4n/3⌉ characters
 *   envelope   JSON around that: 486 bytes for v, t, the sprint and record ids (UUIDs), the 24-byte
 *              nonce and the two sealed copies of the 32-byte content key (an X25519 key, a nonce
 *              and 48 bytes each), plus up to 10 digits of key version
 *   outer      "e1." and that JSON as base64url
 *
 * For the default 2000: 18039 → 18055 → 24074 → 24570 → 32763 characters, and 33787 with 1024 of
 * headroom (about 3%; envelopeMax(3 × 2000) allowed 35840). The headroom is for what the arithmetic
 * leaves out: a pasted control character is escaped to 6 bytes, so a thought otherwise full of
 * 3-byte characters still fits with a couple of hundred of them.
 */
export const thoughtEnvelopeMax = (max: number) => 3 + b64Length(486 + 10 + b64Length(39 + 3 * max * 3 + 16)) + 1024

export const encryptionRequired = (label: string) => new AppError(400, 'encryption_required', `${label} must be encrypted on your device for this sprint — nothing was saved`)

/**
 * A content field: plaintext rules for a sprint without encryption; an envelope (and only an envelope) for
 * encrypted ones. `max` is the plaintext limit the client enforces before encrypting; an envelope
 * holding more than one field (a thought) passes its own `envelopeLimit`.
 */
export function content(encrypted: boolean, v: unknown, max: number, label: string, required: boolean, envelopeLimit = envelopeMax(max)): string | null {
  if (!encrypted) return required ? nonempty(v, max, label) : optional(v, max, label)
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${label} can’t be empty`)
    return null
  }
  if (typeof v !== 'string' || !ENVELOPE_RE.test(v)) throw encryptionRequired(label)
  if (v.length > envelopeLimit) throw bad(`${label} is too long`)
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

/** Exactly what a thought's envelope carries (format 2). Anything more is refused, whatever it's called. */
const ENTRY_FIELDS = ['c', 'k', 'n', 'r', 's', 't', 'v', 'wa', 'ws']

/**
 * The sprint and record a thought's envelope declares, or null when it isn't a thought envelope the
 * server may store. The envelope reaches every participant after reveal, so it must not say who
 * wrote it: one with any field beyond the format's own (an author id, say) is refused.
 */
export function entryBinding(v: string): { s: string; r: string } | null {
  try {
    const b64 = v.slice(3).replace(/-/g, '+').replace(/_/g, '/')
    const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64 + '==='.slice((b64.length + 3) % 4)), (ch) => ch.charCodeAt(0))))
    if (!json || typeof json !== 'object' || Array.isArray(json)) return null
    if (json.v !== 2 || json.t !== 'e' || typeof json.s !== 'string' || typeof json.r !== 'string') return null
    if (Object.keys(json).sort().join() !== ENTRY_FIELDS.join()) return null
    for (const box of [json.ws, json.wa]) if (!box || typeof box !== 'object' || Object.keys(box).sort().join() !== 'c,e,n') return null
    return { s: json.s, r: json.r }
  } catch {
    /* not parseable: refused by the caller */
  }
  return null
}
