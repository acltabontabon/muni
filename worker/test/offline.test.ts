/**
 * The server half of offline capture. A device queues a thought with a stable submission id
 * (sent as `idempotency_key`) and the account that wrote it; whatever happens to the network,
 * the sprint or the account afterwards, the server decides and never duplicates.
 */
import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { del, go, post, req, signin, sprint, tag, team } from './harness'

const submit = (u: Parameters<typeof post>[1], s: string, key: string, extra: Record<string, unknown> = {}) =>
  post(`/api/sprints/${s}/entries`, u, { body: `queued thought ${key.slice(0, 6)}`, category: 'improve', idempotency_key: key, author_account_id: u?.account_id, ...extra })
const count = async (s: string) => (await env.DB.prepare('SELECT count(*) AS n FROM entries WHERE sprint_id = ?').bind(s).first<{ n: number }>())!.n

describe('offline submissions', () => {
  it('resolves a lost response to the original entry, even after collection closes', async () => {
    const { owner, members, ws } = await team(1)
    const s = await sprint(owner, members, ws, 'collecting')
    const key = crypto.randomUUID()
    const first = await submit(members[0], s, key)
    expect(first.status).toBe(200)
    // The response was lost; the device retries, possibly after the facilitator closed collection.
    expect((await go(owner, s, 'preparing')).status).toBe(200)
    const retry = await submit(members[0], s, key)
    expect(retry.status).toBe(200)
    expect(retry.body.id).toBe(first.body.id)
    expect(retry.body.created_at).toBe(first.body.created_at) // never backdated or re-created
    expect(await count(s)).toBe(1)
  })

  it('creates exactly one entry when several tabs send the same submission at once', async () => {
    const { owner, members, ws } = await team(1)
    const s = await sprint(owner, members, ws, 'collecting')
    const key = crypto.randomUUID()
    const results = await Promise.all(Array.from({ length: 5 }, () => submit(members[0], s, key)))
    expect(results.every((r) => r.status === 200)).toBe(true)
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1)
    expect(await count(s)).toBe(1)
  })

  it('refuses a new submission once collection has closed, with a distinct code', async () => {
    const { owner, members, ws } = await team(1)
    const s = await sprint(owner, members, ws, 'collecting')
    expect((await go(owner, s, 'preparing')).status).toBe(200)
    const r = await submit(members[0], s, crypto.randomUUID())
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('collection_closed')
    expect(r.body.error).toContain('wasn’t saved')
    const draft = await sprint(owner, members, ws, 'draft')
    const early = await submit(members[0], draft, crypto.randomUUID())
    expect(early.body.code).toBe('collection_closed')
    expect(early.body.error).toContain('hasn’t opened')
  })

  it('never lands a queued thought under a different account', async () => {
    const { owner, members, ws } = await team(2)
    const s = await sprint(owner, members, ws, 'collecting')
    // Written while signed in as member 0, sent after member 1 signed in on the same device.
    const r = await post(`/api/sprints/${s}/entries`, members[1], { body: 'not mine', idempotency_key: crypto.randomUUID(), author_account_id: members[0].account_id })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('account_mismatch')
    expect(await count(s)).toBe(0)
    // The same submission id from two accounts stays two separate authors' entries (keys are per author).
    const key = crypto.randomUUID()
    expect((await submit(members[0], s, key)).status).toBe(200)
    expect((await submit(members[1], s, key)).status).toBe(200)
    expect(await count(s)).toBe(2)
  })

  it('stops accepting from a revoked member, including retries of an accepted submission', async () => {
    const { owner, members, ws } = await team(1)
    const s = await sprint(owner, members, ws, 'collecting')
    const key = crypto.randomUUID()
    expect((await submit(members[0], s, key)).status).toBe(200)
    expect((await del(`/api/workspaces/${ws}/members/${members[0].account_id}`, owner)).status).toBe(200)
    const retry = await submit(members[0], s, key)
    expect([403, 404]).toContain(retry.status)
    const fresh = await submit(members[0], s, crypto.randomUUID())
    expect([403, 404]).toContain(fresh.status)
  })

  it('asks an outdated client to update instead of accepting its payload', async () => {
    const u = await signin(`old-client-${tag()}@example.com`)
    const r = await req('GET', '/api/auth/me', u, undefined, { 'x-muni-client': '0.5' })
    expect(r.status).toBe(426)
    expect((r.body as { code: string }).code).toBe('upgrade_required')
    expect((await req('GET', '/api/auth/me', u, undefined, { 'x-muni-client': '1' })).status).toBe(426)
    expect((await req('GET', '/api/auth/me', u, undefined, { 'x-muni-client': '2' })).status).toBe(200)
    expect((await req('GET', '/api/auth/me', u)).status).toBe(200) // no header: browsers, curl, tests
  })
})
