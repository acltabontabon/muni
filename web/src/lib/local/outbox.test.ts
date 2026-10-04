import { describe, expect, it } from 'vitest'
import { backoff, CLIENT_REVISION, flush, nextDue, type SyncDeps } from './outbox'
import { emptyPayload, memoryStore, upgradeRecord, type LocalStore, type OutboxItem } from './store'

/** A tiny stand-in for the Worker with the same rules the real one enforces. */
function fakeServer() {
  const s = {
    signedIn: 'acct-a' as string | null,
    sprintOpen: true,
    members: new Set(['acct-a', 'acct-b']),
    entries: new Map<string, { id: string; body: string }>(), // `${author}|${key}`
    posts: 0,
    offline: false,
    loseNextResponse: false,
    nextStatus: null as number | null,
    minClient: 1,
  }
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (s.offline) throw new TypeError('Failed to fetch')
    const h = new Headers(init?.headers)
    if (Number(h.get('x-muni-client')) < s.minClient) return json(426, { code: 'upgrade_required' })
    if (!s.signedIn) return json(401, { code: 'unauthorized' })
    if (url === '/api/auth/me') return json(200, { account_id: s.signedIn })
    s.posts++
    if (s.nextStatus) { const st = s.nextStatus; s.nextStatus = null; return json(st, { code: 'error', error: 'temporary' }) }
    const body = JSON.parse(String(init?.body)) as { body: string; idempotency_key: string; author_account_id: string }
    if (!s.members.has(s.signedIn)) return json(403, { code: 'forbidden' })
    if (body.author_account_id !== s.signedIn) return json(409, { code: 'account_mismatch' })
    const k = `${s.signedIn}|${body.idempotency_key}`
    let e = s.entries.get(k)
    if (!e) {
      if (!s.sprintOpen) return json(409, { code: 'collection_closed', error: 'collection for this sprint has closed — this thought wasn’t saved' })
      e = { id: `entry-${s.entries.size + 1}`, body: body.body }
      s.entries.set(k, e)
    }
    if (s.loseNextResponse) { s.loseNextResponse = false; throw new TypeError('connection reset') }
    return json(200, e)
  }) as unknown as typeof fetch
  return { s, fetchImpl }
}

let clock = 1_000_000
const item = (over: Partial<OutboxItem> = {}): OutboxItem => ({
  id: crypto.randomUUID(), accountId: 'acct-a', workspaceId: 'ws-1', sprintId: 'sp-1', sprintName: 'Sprint 42',
  payload: { ...emptyPayload(), body: 'Reviews waited three days' }, revision: 1, status: 'queued', attempts: 0, nextAttemptAt: 0,
  sendingSince: null, reason: null, message: null, createdAt: clock, updatedAt: clock, v: 1, encrypted: false, ...over,
})
const deps = (store: LocalStore, fetchImpl: typeof fetch, lock?: SyncDeps['lock']): SyncDeps => ({ store, fetch: fetchImpl, csrf: async () => 'csrf', now: () => clock, lock: lock ?? ((fn) => fn()) })

describe('outbox', () => {
  it('moves a thought to another sprint without touching the draft being written there', async () => {
    const store = memoryStore()
    const old = item({ sprintId: 'sp-closed', status: 'attention', reason: 'closed' })
    await store.enqueue(old)
    await store.putDraft({ accountId: 'acct-a', sprintId: 'sp-2', payload: { ...emptyPayload(), body: 'half a thought' }, updatedAt: clock })
    const moved = item({ sprintId: 'sp-2' })
    expect(await store.replace(old.id, moved, old.revision)).toBe(true)
    expect((await store.listOutbox('acct-a')).map((i) => i.id)).toEqual([moved.id])
    expect((await store.getDraft('acct-a', 'sp-2'))?.payload.body).toBe('half a thought')
  })

  it('never moves a thought that another tab started sending, edited or already removed', async () => {
    const store = memoryStore()
    const old = item()
    await store.enqueue(old)
    const moved = item({ sprintId: 'sp-2' })
    await store.updateOutbox(old.id, (c) => ({ ...c, status: 'sending', sendingSince: clock }))
    expect(await store.replace(old.id, moved, old.revision)).toBe(false)
    await store.updateOutbox(old.id, (c) => ({ ...c, status: 'queued', revision: 2, payload: { ...c.payload, body: 'New words' } }))
    expect(await store.replace(old.id, moved, old.revision)).toBe(false)
    expect((await store.listOutbox('acct-a'))[0].payload.body).toBe('New words')
    await store.deleteOutbox(old.id)
    expect(await store.replace(old.id, moved, 2)).toBe(false)
    expect(await store.listOutbox('acct-a')).toHaveLength(0)
  })

  it('checks whether a thought is still unsent at the moment it is removed', async () => {
    const store = memoryStore()
    const queued = item()
    await store.enqueue(queued)
    await store.updateOutbox(queued.id, (c) => ({ ...c, status: 'sending', sendingSince: clock }))
    expect(await store.deleteOutbox(queued.id, (c) => c.status !== 'sending')).toBe(false)
    expect(await store.getOutbox(queued.id)).toMatchObject({ status: 'sending' })
  })

  it('schedules abandoned sends even when no queued thoughts remain', () => {
    expect(nextDue([item({ status: 'sending', sendingSince: clock })])).toBe(clock + 2 * 60_000)
    expect(nextDue([item({ status: 'attention' })])).toBeNull()
    expect(nextDue([item({ nextAttemptAt: clock + 5000 }), item({ status: 'sending', sendingSince: clock })])).toBe(clock + 5000)
  })

  it('sends a queued thought and forgets it only after the server accepts', async () => {
    const store = memoryStore()
    const { s, fetchImpl } = fakeServer()
    await store.enqueue(item())
    const r = await flush(deps(store, fetchImpl))
    expect(r.state).toBe('ok')
    expect(r.submitted).toHaveLength(1)
    expect(await store.listOutbox('acct-a')).toHaveLength(0)
    expect(s.entries.size).toBe(1)
  })

  it('keeps the thought while offline and backs off, without losing text', async () => {
    const store = memoryStore()
    const { s, fetchImpl } = fakeServer()
    await store.enqueue(item())
    s.offline = true
    expect((await flush(deps(store, fetchImpl))).state).toBe('offline')
    const [kept] = await store.listOutbox('acct-a')
    expect(kept.status).toBe('queued')
    expect(kept.payload.body).toBe('Reviews waited three days')
  })

  it('treats an interrupted or malformed identity response as offline and keeps the queue', async () => {
    for (const body of ['', '{}', '{"account_id":null}']) {
      const store = memoryStore()
      const queued = item()
      await store.enqueue(queued)
      const fetchImpl = (async () => new Response(body)) as typeof fetch
      expect((await flush(deps(store, fetchImpl))).state).toBe('offline')
      expect(await store.getOutbox(queued.id)).toMatchObject({ status: 'queued', attempts: 0 })
    }
  })

  it('resolves a lost response to the one accepted entry on retry', async () => {
    const store = memoryStore()
    const { s, fetchImpl } = fakeServer()
    await store.enqueue(item())
    s.loseNextResponse = true
    expect((await flush(deps(store, fetchImpl))).state).toBe('offline')
    const [after] = await store.listOutbox('acct-a')
    expect(after.status).toBe('queued')
    expect(after.attempts).toBe(1)
    expect(after.nextAttemptAt).toBe(clock + backoff(1))
    // Not due yet: nothing is re-sent before the backoff, unless forced (Retry / back online).
    expect((await flush(deps(store, fetchImpl))).submitted).toHaveLength(0)
    const r = await flush(deps(store, fetchImpl), { force: true })
    expect(r.submitted).toHaveLength(1)
    expect(s.entries.size).toBe(1) // the retry found the original instead of creating a second
    expect(await store.listOutbox('acct-a')).toHaveLength(0)
  })

  it('sends each item once when two tabs flush at the same moment', async () => {
    const store = memoryStore()
    const { s, fetchImpl } = fakeServer()
    await store.enqueue(item())
    await store.enqueue(item())
    // A shared lock, as navigator.locks provides: the second tab finds it held and stands down.
    let held = false
    const lock: SyncDeps['lock'] = async (fn) => { if (held) return 'locked'; held = true; try { return await fn() } finally { held = false } }
    const [a, b] = await Promise.all([flush(deps(store, fetchImpl, lock)), flush(deps(store, fetchImpl, lock))])
    expect([a.state, b.state].sort()).toEqual(['locked', 'ok'])
    expect(s.posts).toBe(2)
    expect(s.entries.size).toBe(2)
  })

  it('claims each item once even without a lock (no Web Locks support)', async () => {
    const store = memoryStore()
    const { s, fetchImpl } = fakeServer()
    await store.enqueue(item())
    await Promise.all([flush(deps(store, fetchImpl)), flush(deps(store, fetchImpl))])
    expect(s.posts).toBe(1)
  })

  it('does not re-send an item another tab is sending right now, but recovers an abandoned one', async () => {
    const store = memoryStore()
    const { s, fetchImpl } = fakeServer()
    await store.enqueue(item({ status: 'sending', sendingSince: clock - 5_000 }))
    await flush(deps(store, fetchImpl))
    expect(s.posts).toBe(0)
    clock += 3 * 60_000 // the tab that claimed it was closed mid-send
    await flush(deps(store, fetchImpl))
    expect(s.posts).toBe(1)
    expect(await store.listOutbox('acct-a')).toHaveLength(0)
  })

  it('checks a recovered send’s current timestamp before claiming a stale list snapshot', async () => {
    const store = memoryStore()
    const { s, fetchImpl } = fakeServer()
    const abandoned = item({ status: 'sending', sendingSince: clock - 3 * 60_000 })
    await store.enqueue(abandoned)
    const racing: LocalStore = {
      ...store,
      async listOutbox(a) {
        const snapshot = await store.listOutbox(a)
        // Another sender has already recovered this item by the time our list comes back.
        await store.updateOutbox(abandoned.id, (c) => ({ ...c, sendingSince: clock }))
        return snapshot
      },
    }
    await flush(deps(racing, fetchImpl))
    expect(s.posts).toBe(0)
    expect(await store.getOutbox(abandoned.id)).toMatchObject({ status: 'sending', sendingSince: clock })
  })

  it('never lets a late response remove a thought claimed by a newer sender', async () => {
    const store = memoryStore()
    const queued = item()
    await store.enqueue(queued)
    let answer!: (response: Response) => void
    let started!: () => void
    const sending = new Promise<void>((resolve) => { started = resolve })
    const fetchImpl = (async (url: string) => {
      if (url === '/api/auth/me') return new Response(JSON.stringify({ account_id: 'acct-a' }))
      started()
      return new Promise<Response>((resolve) => { answer = resolve })
    }) as unknown as typeof fetch
    const pending = flush(deps(store, fetchImpl))
    await sending
    clock += 3 * 60_000
    await store.updateOutbox(queued.id, (c) => ({ ...c, sendingSince: clock }))
    answer(new Response(JSON.stringify({ id: 'accepted-entry' })))
    expect((await pending).submitted).toEqual([])
    expect(await store.getOutbox(queued.id)).toMatchObject({ status: 'sending', sendingSince: clock })
  })

  it('stops at a closed sprint and keeps the text for the person to decide', async () => {
    const store = memoryStore()
    const { s, fetchImpl } = fakeServer()
    await store.enqueue(item())
    s.sprintOpen = false
    const r = await flush(deps(store, fetchImpl))
    expect(r.attention).toHaveLength(1)
    const [it2] = await store.listOutbox('acct-a')
    expect(it2).toMatchObject({ status: 'attention', reason: 'closed' })
    expect(it2.payload.body).toBe('Reviews waited three days')
    // Permanent: it is not retried on its own.
    await flush(deps(store, fetchImpl), { force: true })
    expect(s.posts).toBe(1)
  })

  it('pauses on an expired session without spending attempts', async () => {
    const store = memoryStore()
    const { s, fetchImpl } = fakeServer()
    await store.enqueue(item())
    s.signedIn = null
    expect((await flush(deps(store, fetchImpl))).state).toBe('signed_out')
    const [kept] = await store.listOutbox('acct-a')
    expect(kept).toMatchObject({ status: 'queued', attempts: 0 })
  })

  it('never sends one account’s queue while another account is signed in', async () => {
    const store = memoryStore()
    const { s, fetchImpl } = fakeServer()
    await store.enqueue(item({ accountId: 'acct-a' }))
    s.signedIn = 'acct-b'
    const r = await flush(deps(store, fetchImpl))
    expect(r.accountId).toBe('acct-b')
    expect(s.posts).toBe(0)
    expect(await store.listOutbox('acct-a')).toHaveLength(1)
  })

  it('treats revoked access as final and forgets the sprint’s labels, not the text', async () => {
    const store = memoryStore()
    const { s, fetchImpl } = fakeServer()
    await store.putContext({ accountId: 'acct-a', workspaceId: 'ws-1', workspaceName: 'Payments', sprint: { id: 'sp-1', workspace_id: 'ws-1', name: 'Sprint 42', status: 'collecting', retro_local: 'Mon', timezone: 'UTC' }, fetchedAt: clock })
    await store.enqueue(item())
    s.members.delete('acct-a')
    await flush(deps(store, fetchImpl))
    const [it2] = await store.listOutbox('acct-a')
    expect(it2).toMatchObject({ status: 'attention', reason: 'no_access', sprintName: null })
    expect(it2.payload.body).toBe('Reviews waited three days')
    expect(await store.getContext('acct-a', 'sp-1')).toBeNull()
  })

  it('asks for an update instead of retrying a payload the server no longer accepts', async () => {
    const store = memoryStore()
    const { s, fetchImpl } = fakeServer()
    await store.enqueue(item())
    s.minClient = CLIENT_REVISION + 1
    expect((await flush(deps(store, fetchImpl))).state).toBe('upgrade')
    expect(s.posts).toBe(0)
    expect((await store.listOutbox('acct-a'))[0].status).toBe('queued')
  })

  it('retries transient server errors with bounded backoff', async () => {
    const store = memoryStore()
    const { s, fetchImpl } = fakeServer()
    await store.enqueue(item())
    for (let i = 0; i < 12; i++) {
      s.nextStatus = 503
      await flush(deps(store, fetchImpl), { force: true })
    }
    const [kept] = await store.listOutbox('acct-a')
    expect(kept.attempts).toBe(12)
    expect(kept.nextAttemptAt - clock).toBeLessThanOrEqual(10 * 60_000)
  })

  it('skips a send when the text was edited after it was read (the new revision goes next time)', async () => {
    const store = memoryStore()
    const { s, fetchImpl } = fakeServer()
    const it1 = item()
    await store.enqueue(it1)
    // An edit lands between the flush reading the queue and claiming the item.
    const racing: LocalStore = { ...store, listOutbox: async (a) => { const l = await store.listOutbox(a); await store.updateOutbox(it1.id, (c) => ({ ...c, revision: 2, payload: { ...c.payload, body: 'edited' } })); return l } }
    await flush(deps(racing, fetchImpl))
    expect(s.posts).toBe(0)
    await flush(deps(store, fetchImpl))
    expect([...s.entries.values()][0].body).toBe('edited')
  })

  it('without a sealer (the service worker), sends only thoughts known to be unencrypted', async () => {
    const store = memoryStore()
    const { s, fetchImpl } = fakeServer()
    await store.enqueue(item({ encrypted: true }))
    await store.enqueue(item({ encrypted: undefined }))
    const plain = item()
    await store.enqueue(plain)
    const r = await flush(deps(store, fetchImpl))
    expect(r.submitted.map((x) => x.id)).toEqual([plain.id])
    expect(s.posts).toBe(1)
    expect(await store.listOutbox('acct-a')).toHaveLength(2)
  })

  it('sends nothing for a thought it can’t seal or can’t tell is unencrypted', async () => {
    const store = memoryStore()
    const { s, fetchImpl } = fakeServer()
    const fail = (e: object): SyncDeps['seal'] => async () => { throw e }
    await store.enqueue(item())
    // No key on this device: it waits, and says so.
    expect((await flush({ ...deps(store, fetchImpl), seal: fail({ code: 'no-key' }) }, { force: true })).state).toBe('ok')
    expect((await store.listOutbox('acct-a'))[0]).toMatchObject({ status: 'queued', message: 'waiting_key' })
    // The check failed (a server error): it backs off, like an offline send.
    expect((await flush({ ...deps(store, fetchImpl), seal: fail({ status: 500 }) }, { force: true })).state).toBe('offline')
    expect((await store.listOutbox('acct-a'))[0].status).toBe('queued')
    // Signed out meanwhile: it stays queued for the next sign-in.
    expect((await flush({ ...deps(store, fetchImpl), seal: fail({ status: 401 }) }, { force: true })).state).toBe('signed_out')
    // No access any more: it needs the person.
    const r = await flush({ ...deps(store, fetchImpl), seal: fail({ status: 403 }) }, { force: true })
    expect(r.attention).toHaveLength(1)
    expect((await store.listOutbox('acct-a'))[0]).toMatchObject({ status: 'attention', reason: 'no_access' })
    expect(s.posts).toBe(0)
  })

  it('upgrades records written before versioning instead of dropping them', () => {
    const unversioned = { id: 'x', payload: { body: 'kept' } } as unknown as Omit<OutboxItem, 'v'> & { v?: number }
    expect(upgradeRecord(unversioned)).toMatchObject({ id: 'x', v: 1, payload: { body: 'kept' } })
  })

  it('namespaces everything by account and clears only one account', async () => {
    const store = memoryStore()
    await store.enqueue(item({ accountId: 'acct-a' }))
    await store.enqueue(item({ accountId: 'acct-b' }))
    await store.putDraft({ accountId: 'acct-a', sprintId: 'sp-1', payload: { ...emptyPayload(), body: 'draft' }, updatedAt: clock })
    await store.clearAccount('acct-a')
    expect(await store.listOutbox('acct-a')).toHaveLength(0)
    expect(await store.getDraft('acct-a', 'sp-1')).toBeNull()
    expect(await store.listOutbox('acct-b')).toHaveLength(1)
  })
})
