import { beforeEach, describe, expect, it } from 'vitest'
import { b64u, newKeyPair, newSprintSecret, sealEntry, sealField, sprintKeys, wrapSprintSecret, type KeyPair } from './crypto'
import { isLocked, keyring, LOCKED } from './keyring'
import type { MyKeys, SprintKeyView } from '@/api/types'

/**
 * A stand-in for the server: it only ever holds public keys, wrapped keys and envelopes —
 * exactly what the real one stores.
 */
function fakeServer(me: string) {
  const s = {
    mine: { public_key: null, recovery_blob: null, recovery_confirmed_at: null, key_version: 0, created_at: null } as MyKeys,
    sprints: new Map<string, SprintKeyView>(),
    posts: [] as { method: string; path: string; body: unknown }[],
  }
  const fetcher = async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
    s.posts.push({ method, path, body })
    if (path === '/api/me/keys' && method === 'GET') return s.mine as T
    if (path === '/api/me/keys' && method === 'PUT') {
      const b = body as { public_key: string; recovery_blob: string }
      s.mine = { ...s.mine, public_key: b.public_key, recovery_blob: b.recovery_blob, key_version: 1 }
      return { ok: true } as T
    }
    if (path === '/api/me/keys/recovery') return { ok: true } as T
    const m = path.match(/^\/api\/sprints\/([^/]+)\/keys$/)
    if (m) return (s.sprints.get(m[1]) ?? { encryption: null }) as T
    throw Object.assign(new Error('not found'), { status: 404 })
  }
  return { s, fetcher, me }
}

async function signedIn() {
  const me = `acc-${crypto.randomUUID()}`
  const server = fakeServer(me)
  await keyring.use(me, server.fetcher)
  await keyring.setup()
  const pk = keyring.publicKey()!
  return { ...server, pk }
}

function sprintFor(server: ReturnType<typeof fakeServer>, pk: Uint8Array, opts: { others?: { id: string; name: string; keys: KeyPair }[]; holds?: boolean } = {}) {
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

beforeEach(async () => {
  await keyring.use(null, async () => ({}) as never)
})

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

  it('never sends plaintext when this device can’t seal', async () => {
    const srv = await signedIn()
    const sp = sprintFor(srv, srv.pk, { holds: false })
    await expect(keyring.sealRequest('PUT', `/api/sprints/${sp.id}/meeting/notes/t1`, { takeaway: 'Synthetic' })).rejects.toThrow()
  })

  it('seals a thought to the sprint and to its author, readable back by the author', async () => {
    const srv = await signedIn()
    const sp = sprintFor(srv, srv.pk, { holds: false })
    const env = await keyring.sealThought(sp.id, 'rec-1', { body: 'Synthetic mine', impact: null, might_help: null })
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

describe('device state', () => {
  it('is locked when the account has a key this device doesn’t hold', async () => {
    const me = `acc-${crypto.randomUUID()}`
    const srv = fakeServer(me)
    srv.s.mine = { ...srv.s.mine, public_key: b64u(newKeyPair().pk), recovery_blob: 'r1.x', key_version: 1 }
    await keyring.use(me, srv.fetcher)
    expect(keyring.state().kind).toBe('locked')
  })
  it('forgetting removes this device’s key', async () => {
    await signedIn()
    expect(keyring.state().kind).toBe('ready')
    await keyring.forget()
    expect(keyring.state().kind).toBe('locked')
    expect(keyring.publicKey()).not.toBeNull() // the account's public key is still known; the private one is gone
  })
})
