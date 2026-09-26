/**
 * A software WebAuthn authenticator for tests (a "virtual authenticator"): ES256 keys from
 * WebCrypto, `none` attestation, and flags/counters/origins we can bend to exercise failures.
 * It proves the server follows the protocol; it says nothing about physical-device compatibility.
 */
import { isoBase64URL, isoCBOR } from '@simplewebauthn/server/helpers'

const enc = new TextEncoder()
const sha256 = async (b: Uint8Array<ArrayBufferLike>) => new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(b)))
const concat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
const u32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])

/** WebCrypto signs ECDSA as raw r‖s; WebAuthn wants ASN.1 DER. */
function derSignature(raw: Uint8Array): Uint8Array<ArrayBuffer> {
  const int = (b: Uint8Array) => {
    let i = 0
    while (i < b.length - 1 && b[i] === 0) i++
    let v = b.slice(i)
    if (v[0] & 0x80) v = concat(new Uint8Array([0]), v)
    return concat(new Uint8Array([0x02, v.length]), v)
  }
  const body = concat(int(raw.slice(0, 32)), int(raw.slice(32)))
  return concat(new Uint8Array([0x30, body.length]), body)
}

export interface SoftCredential {
  id: string
  keys: CryptoKeyPair
  userHandle: string
  counter: number
}

export interface Behaviour {
  origin?: string
  rpId?: string
  userPresent?: boolean
  userVerified?: boolean
  /** Backup eligible (a synced, multi-device passkey) and currently backed up. */
  synced?: boolean
  /** How the counter moves per assertion: +1 (a security key), 0 (typical synced passkey), or a fixed value. */
  counter?: 'increment' | 'zero' | number
  type?: string
}

export class SoftAuthenticator {
  creds = new Map<string, SoftCredential>()
  constructor(public b: Behaviour = {}) {}

  private flags(extra: number, over: Behaviour) {
    const b = { ...this.b, ...over }
    let f = extra
    if (b.userPresent !== false) f |= 0x01
    if (b.userVerified !== false) f |= 0x04
    if (b.synced) f |= 0x08 | 0x10
    return f
  }

  /** navigator.credentials.create(), from server options. `reuse` re-registers an existing credential id. */
  async register(options: any, over: Behaviour = {}, reuse?: SoftCredential): Promise<any> {
    const b = { ...this.b, ...over }
    const rpId = b.rpId ?? options.rp.id
    const keys = reuse?.keys ?? ((await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair)
    const idBytes = reuse ? isoBase64URL.toBuffer(reuse.id) : crypto.getRandomValues(new Uint8Array(32))
    const id = isoBase64URL.fromBuffer(idBytes)
    const jwk = (await crypto.subtle.exportKey('jwk', keys.publicKey)) as JsonWebKey
    const cose = new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, isoBase64URL.toBuffer(jwk.x!)],
      [-3, isoBase64URL.toBuffer(jwk.y!)],
    ])
    const counter = typeof b.counter === 'number' ? b.counter : 0
    const authData = concat(await sha256(enc.encode(rpId)), new Uint8Array([this.flags(0x40, over)]), u32(counter), new Uint8Array(16), new Uint8Array([idBytes.length >> 8, idBytes.length & 255]), idBytes, isoCBOR.encode(cose as any))
    const clientDataJSON = new Uint8Array(enc.encode(JSON.stringify({ type: b.type ?? 'webauthn.create', challenge: options.challenge, origin: b.origin ?? 'http://localhost:5173', crossOrigin: false })))
    const attestationObject = isoCBOR.encode(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]) as any)
    const cred = { id, keys, userHandle: options.user.id, counter }
    this.creds.set(id, cred)
    return {
      id,
      rawId: id,
      type: 'public-key',
      response: { clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON), attestationObject: isoBase64URL.fromBuffer(attestationObject), transports: ['internal', 'hybrid'] },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    }
  }

  /** navigator.credentials.get(), from server options (discoverable: picks the only or given credential). */
  async assert(options: any, credId?: string, over: Behaviour = {}): Promise<any> {
    const b = { ...this.b, ...over }
    const cred = credId ? this.creds.get(credId)! : [...this.creds.values()][0]
    if (!cred) throw new Error('no credential in the soft authenticator')
    if (b.counter === 'increment' || b.counter === undefined) cred.counter += this.b.synced && b.counter === undefined ? 0 : 1
    else if (b.counter === 'zero') cred.counter = 0
    else cred.counter = b.counter
    const authData = concat(await sha256(enc.encode(b.rpId ?? options.rpId)), new Uint8Array([this.flags(0, over)]), u32(cred.counter))
    const clientDataJSON = new Uint8Array(enc.encode(JSON.stringify({ type: b.type ?? 'webauthn.get', challenge: options.challenge, origin: b.origin ?? 'http://localhost:5173', crossOrigin: false })))
    const signed = concat(authData, await sha256(clientDataJSON))
    const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cred.keys.privateKey, new Uint8Array(signed)))
    return {
      id: cred.id,
      rawId: cred.id,
      type: 'public-key',
      response: { clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON), authenticatorData: isoBase64URL.fromBuffer(authData), signature: isoBase64URL.fromBuffer(derSignature(raw)), userHandle: cred.userHandle },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    }
  }
}
