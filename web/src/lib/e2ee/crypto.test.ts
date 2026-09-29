import { describe, expect, it } from 'vitest'
import {
  b64u, CryptoError, ENVELOPE, fingerprint, fromB64u, newKeyPair, newRecoveryKey, newSprintSecret, openEntry, openField, openSealed, parseEnvelope, parseRecoveryKey,
  sealEntry, sealField, sealTo, sprintKeys, unwrapSprintSecret, unwrapWithRecovery, wrapForRecovery, wrapSprintSecret, type EntryEnvelope, type FieldEnvelope,
} from './crypto'

const SYNTHETIC = 'Synthetic: staging broke on Wednesday and nobody owned it'
const te = new TextEncoder()
const code = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    return e instanceof CryptoError ? e.code : 'other'
  }
  return 'ok'
}
/** Rewrites one JSON field inside an envelope, the way a tampering server could. */
function tamper(env: string, edit: (o: Record<string, unknown>) => void) {
  const o = JSON.parse(new TextDecoder().decode(fromB64u(env.slice(3))))
  edit(o)
  return env.slice(0, 3) + b64u(te.encode(JSON.stringify(o)))
}
function flip(s: string) {
  const b = fromB64u(s)
  b[b.length - 1] ^= 1
  return b64u(b)
}

describe('sealed boxes', () => {
  it('open only with the recipient key and the exact context', () => {
    const alice = newKeyPair()
    const mallory = newKeyPair()
    const box = sealTo(alice.pk, te.encode('secret'), 'ctx-1')
    expect(new TextDecoder().decode(openSealed(alice.sk, box, 'ctx-1'))).toBe('secret')
    expect(code(() => openSealed(mallory.sk, box, 'ctx-1'))).toBe('auth')
    expect(code(() => openSealed(alice.sk, box, 'ctx-2'))).toBe('auth')
    expect(code(() => openSealed(alice.sk, { ...box, c: flip(box.c) }, 'ctx-1'))).toBe('auth')
  })
  it('refuses a low-order public key', () => {
    expect(code(() => sealTo(new Uint8Array(32), te.encode('x'), 'c'))).not.toBe('ok')
  })
  it('never reuses a nonce or ephemeral key', () => {
    const a = newKeyPair()
    const boxes = Array.from({ length: 200 }, () => sealTo(a.pk, te.encode('same'), 'c'))
    expect(new Set(boxes.map((b) => b.n)).size).toBe(200)
    expect(new Set(boxes.map((b) => b.e)).size).toBe(200)
  })
  it('fingerprints are stable, short and distinct', () => {
    const a = newKeyPair()
    expect(fingerprint(a.pk)).toBe(fingerprint(a.pk))
    expect(fingerprint(a.pk)).toMatch(/^[0-9A-Z]{4}( [0-9A-Z]{4}){3}$/)
    expect(fingerprint(a.pk)).not.toBe(fingerprint(newKeyPair().pk))
  })
})

describe('recovery key', () => {
  it('unwraps the account key; the wrapped blob alone reveals nothing', () => {
    const acct = newKeyPair()
    const rk = newRecoveryKey()
    expect(rk).toMatch(/^([0-9A-Z]{4}-){8}[0-9A-Z]{4}$/)
    const blob = wrapForRecovery(acct.sk, rk, 'acc-1')
    expect(blob).not.toContain(b64u(acct.sk))
    expect(unwrapWithRecovery(blob, rk.toLowerCase().replace(/-/g, ' '), 'acc-1')).toEqual(acct.sk)
  })
  it('rejects the wrong key, a typo, and another account', () => {
    const acct = newKeyPair()
    const rk = newRecoveryKey()
    const blob = wrapForRecovery(acct.sk, rk, 'acc-1')
    expect(code(() => unwrapWithRecovery(blob, newRecoveryKey(), 'acc-1'))).toBe('auth')
    const typo = (rk[0] === 'A' ? 'B' : 'A') + rk.slice(1)
    expect(code(() => parseRecoveryKey(typo))).toBe('mismatch')
    expect(code(() => unwrapWithRecovery(blob, rk, 'acc-2'))).toBe('auth')
  })
})

describe('sprint secret wraps', () => {
  it('bind to the sprint, version and recipient', () => {
    const maya = newKeyPair()
    const s = newSprintSecret()
    const w = wrapSprintSecret(maya.pk, s, { sprintId: 's1', version: 1, recipientId: 'maya' })
    expect(unwrapSprintSecret(maya.sk, w, { sprintId: 's1', version: 1, recipientId: 'maya' })).toEqual(s)
    expect(code(() => unwrapSprintSecret(maya.sk, w, { sprintId: 's2', version: 1, recipientId: 'maya' }))).toBe('auth')
    expect(code(() => unwrapSprintSecret(maya.sk, w, { sprintId: 's1', version: 2, recipientId: 'maya' }))).toBe('auth')
    expect(code(() => unwrapSprintSecret(newKeyPair().sk, w, { sprintId: 's1', version: 1, recipientId: 'maya' }))).toBe('auth')
  })
  it('keys are derived per sprint secret and version', () => {
    const s = newSprintSecret()
    expect(sprintKeys(s, 1).pk).toEqual(sprintKeys(s, 1).pk)
    expect(sprintKeys(s, 1).dk).not.toEqual(sprintKeys(newSprintSecret(), 1).dk)
  })
})

describe('thoughts', () => {
  const sprint = sprintKeys(newSprintSecret(), 1)
  const author = newKeyPair()
  const c = { sprintId: 's1', recordId: 'r1', version: 1, sprintPk: sprint.pk, authorPk: author.pk }
  const env = sealEntry(c, { body: SYNTHETIC, impact: 'half a day', might_help: null })

  it('contain no plaintext', () => {
    expect(env.startsWith(ENVELOPE)).toBe(true)
    expect(env).not.toContain('staging')
    expect(atob(env.slice(3).replace(/-/g, '+').replace(/_/g, '/'))).not.toContain('staging')
  })
  it('say nothing about who wrote them: every participant receives them after reveal', () => {
    const o = JSON.parse(new TextDecoder().decode(fromB64u(env.slice(3))))
    expect(Object.keys(o).sort()).toEqual(['c', 'k', 'n', 'r', 's', 't', 'v', 'wa', 'ws'])
    expect(o.v).toBe(2)
    // The author's copy of the key is a sealed box like the sprint's: it doesn't name its recipient.
    expect(Object.keys(o.wa).sort()).toEqual(['c', 'e', 'n'])
    expect(env).not.toContain(b64u(author.pk))
    // Two thoughts by the same person share nothing that links them.
    const again = JSON.parse(new TextDecoder().decode(fromB64u(sealEntry({ ...c, recordId: 'r2' }, { body: SYNTHETIC, impact: null, might_help: null }).slice(3))))
    expect(again.wa.e).not.toBe(o.wa.e)
  })
  it('refuse an envelope in any other format', () => {
    expect(code(() => parseEnvelope(tamper(env, (o) => { o.v = 1 })))).toBe('version')
    expect(code(() => parseEnvelope(tamper(env, (o) => { o.v = 3 })))).toBe('version')
  })
  it('open with the sprint key (after reveal) or the author’s key (always)', () => {
    const e = parseEnvelope(env) as EntryEnvelope
    expect(openEntry(e, { sprintId: 's1', recordId: 'r1' }, { sprint }).body).toBe(SYNTHETIC)
    expect(openEntry(e, { sprintId: 's1', recordId: 'r1' }, { accountSk: author.sk }).impact).toBe('half a day')
  })
  it('cannot be opened by anyone else', () => {
    const e = parseEnvelope(env) as EntryEnvelope
    expect(code(() => openEntry(e, { sprintId: 's1', recordId: 'r1' }, { accountSk: newKeyPair().sk }))).toBe('auth')
    expect(code(() => openEntry(e, { sprintId: 's1', recordId: 'r1' }, {}))).toBe('no-key')
    expect(code(() => openEntry(e, { sprintId: 's1', recordId: 'r1' }, { sprint: sprintKeys(newSprintSecret(), 1) }))).toBe('auth')
  })
  it('detect substitution into another sprint or record', () => {
    const e = parseEnvelope(env) as EntryEnvelope
    expect(code(() => openEntry(e, { sprintId: 's2', recordId: 'r1' }, { sprint }))).toBe('mismatch')
    expect(code(() => openEntry(e, { sprintId: 's1', recordId: 'r2' }, { sprint }))).toBe('mismatch')
    // Rewriting the claimed ids inside the envelope breaks authentication instead.
    const moved = parseEnvelope(tamper(env, (o) => { o.r = 'r2' })) as EntryEnvelope
    expect(code(() => openEntry(moved, { sprintId: 's1', recordId: 'r2' }, { sprint }))).toBe('auth')
    const rekeyed = parseEnvelope(tamper(env, (o) => { o.k = 2 })) as EntryEnvelope
    expect(code(() => openEntry(rekeyed, { sprintId: 's1', recordId: 'r1' }, { accountSk: author.sk }))).toBe('auth')
  })
  it('detect a modified ciphertext', () => {
    const bad = parseEnvelope(tamper(env, (o) => { o.c = flip(o.c as string) })) as EntryEnvelope
    expect(code(() => openEntry(bad, { sprintId: 's1', recordId: 'r1' }, { sprint }))).toBe('auth')
  })
})

describe('discussion fields', () => {
  const keys = sprintKeys(newSprintSecret(), 1)
  const env = sealField(keys, 's1', 'title', 'Staging ownership')
  it('round-trip, bound to sprint and field', () => {
    const e = parseEnvelope(env) as FieldEnvelope
    expect(openField(e, keys, { sprintId: 's1', field: 'title' })).toBe('Staging ownership')
    expect(code(() => openField(e, keys, { sprintId: 's1', field: 'summary' }))).toBe('mismatch')
    expect(code(() => openField(e, keys, { sprintId: 's9', field: 'title' }))).toBe('mismatch')
    const relabeled = parseEnvelope(tamper(env, (o) => { o.f = 'summary' })) as FieldEnvelope
    expect(code(() => openField(relabeled, keys, { sprintId: 's1', field: 'summary' }))).toBe('auth')
    expect(code(() => openField(e, sprintKeys(newSprintSecret(), 1), { sprintId: 's1', field: 'title' }))).toBe('auth')
  })
})

describe('malformed input', () => {
  it('is rejected, never passed through as text', () => {
    for (const bad of ['e1.', 'e1.!!!', 'e1.' + b64u(te.encode('[]')), 'e1.' + b64u(te.encode('{"v":2}')), 'e1.' + b64u(te.encode('{"v":1,"t":"f"}')), 'plain text', 'e1.' + 'A'.repeat(70000)])
      expect(code(() => parseEnvelope(bad)), bad.slice(0, 20)).not.toBe('ok')
  })
})
