/** Private capture: ownership, phases, idempotency and the close race. */
import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { closeCollection, del, entry, get, go, patch, post, sleep, sprint, team } from './harness'

describe('entries', () => {
  it('lets only the author edit or delete, and only while collecting', async () => {
    const { owner, members, ws } = await team(2)
    const s = await sprint(owner, members, ws, 'collecting')
    const e = await entry(members[0], s, 'improve', 'original text')
    // Another participant (and the facilitator) get 404: the entry's existence is not confirmed.
    expect((await patch(`/api/sprints/${s}/entries/${e.id}`, members[1], { category: 'keep', body: 'hijacked' })).status).toBe(404)
    expect((await del(`/api/sprints/${s}/entries/${e.id}`, members[1])).status).toBe(404)
    expect((await patch(`/api/sprints/${s}/entries/${e.id}`, owner, { category: 'keep', body: 'hijacked' })).status).toBe(404)
    // The owner can edit while collecting.
    const edited = await patch(`/api/sprints/${s}/entries/${e.id}`, members[0], { category: 'keep', body: 'edited text', period: 'late' })
    expect(edited.status).toBe(200)
    expect(edited.body.body).toBe('edited text')
    expect(edited.body.category).toBe('keep')
    expect(edited.body.period).toBe('late')
    expect(edited.body.editable).toBe(true)
    const mine = await get(`/api/sprints/${s}/entries/mine`, members[0])
    expect(mine.body[0].body).toBe('edited text')
    // After close, originals are read-only for everyone including the author.
    await closeCollection(owner, s)
    expect((await patch(`/api/sprints/${s}/entries/${e.id}`, members[0], { category: 'keep', body: 'too late' })).status).toBe(409)
    expect((await del(`/api/sprints/${s}/entries/${e.id}`, members[0])).status).toBe(409)
    expect((await get(`/api/sprints/${s}/entries/mine`, members[0])).body[0].editable).toBe(false)
    // Delete works while collecting (second entry, fresh sprint).
    const s2 = await sprint(owner, members, ws, 'collecting')
    const e2 = await entry(members[0], s2, null, 'to delete')
    expect((await del(`/api/sprints/${s2}/entries/${e2.id}`, members[0])).status).toBe(200)
    expect((await get(`/api/sprints/${s2}/entries/mine`, members[0])).body).toHaveLength(0)
  })

  it('accepts submissions only while collecting', async () => {
    const { owner, members, ws } = await team(1)
    const draft = await sprint(owner, members, ws, 'draft')
    expect((await post(`/api/sprints/${draft}/entries`, members[0], { category: 'keep', body: 'too early' })).status).toBe(409)
    const s = await sprint(owner, members, ws, 'collecting')
    expect((await post(`/api/sprints/${s}/entries`, members[0], { category: 'keep', body: 'in time' })).status).toBe(200)
    await closeCollection(owner, s)
    expect((await post(`/api/sprints/${s}/entries`, members[0], { category: 'keep', body: 'too late' })).status).toBe(409)
    await go(owner, s, 'ready')
    expect((await post(`/api/sprints/${s}/entries`, members[0], { category: 'keep', body: 'too late' })).status).toBe(409)
    // A non-participant workspace member can't submit; a stranger sees nothing.
    const other = await team(1)
    expect((await post(`/api/sprints/${s}/entries`, other.owner, { body: 'x' })).status).toBe(404)
  })

  it('stores exactly one row for concurrent submissions with the same idempotency key', async () => {
    const { owner, members, ws } = await team(1)
    const s = await sprint(owner, members, ws, 'collecting')
    const key = crypto.randomUUID()
    const results = await Promise.all(Array.from({ length: 5 }, () => post(`/api/sprints/${s}/entries`, members[0], { category: 'improve', body: 'double tap', idempotency_key: key })))
    for (const r of results) expect(r.status).toBe(200)
    const idSet = new Set(results.map((r) => r.body.id))
    expect(idSet.size).toBe(1)
    const n = await env.DB.prepare('SELECT count(*) AS n FROM entries WHERE sprint_id = ? AND author_account_id = ?').bind(s, members[0].account_id).first<{ n: number }>()
    expect(n!.n).toBe(1)
    expect((await get(`/api/sprints/${s}/entries/mine`, members[0])).body).toHaveLength(1)
    // A different key is a different entry.
    expect((await post(`/api/sprints/${s}/entries`, members[0], { category: 'improve', body: 'double tap', idempotency_key: crypto.randomUUID() })).status).toBe(200)
    expect((await get(`/api/sprints/${s}/entries/mine`, members[0])).body).toHaveLength(2)
  })

  it('loses no entry when collection closes while submissions race in', async () => {
    const { owner, members, ws } = await team(2)
    const s = await sprint(owner, members, ws, 'collecting')
    await entry(members[1], s, 'keep', 'already there')
    const posts = Array.from({ length: 20 }, (_, i) => post(`/api/sprints/${s}/entries`, members[i % 2], { category: 'improve', body: `race-${i}` }))
    const closing = (async () => {
      await sleep(3)
      return go(owner, s, 'preparing')
    })()
    const [results, closeRes] = await Promise.all([Promise.all(posts), closing])
    expect(closeRes.status).toBe(200)
    expect(closeRes.body.status).toBe('preparing')
    const shared = await get(`/api/sprints/${s}/entries`, owner)
    expect(shared.status).toBe(200)
    const sharedIds = new Set(shared.body.map((e: { id: string }) => e.id))
    const sharedBodies = new Set(shared.body.map((e: { body: string }) => e.body))
    let accepted = 0
    results.forEach((r, i) => {
      if (r.status === 200) {
        accepted++
        expect(sharedIds.has(r.body.id), `accepted entry ${i} must be in the shared list`).toBe(true)
      } else {
        expect(r.status).toBe(409)
        expect(sharedBodies.has(`race-${i}`), `refused entry ${i} must not be in the shared list`).toBe(false)
      }
    })
    expect(shared.body).toHaveLength(accepted + 1)
    // Nothing accepted after the close was lost and nothing refused slipped in.
    const n = await env.DB.prepare('SELECT count(*) AS n FROM entries WHERE sprint_id = ?').bind(s).first<{ n: number }>()
    expect(n!.n).toBe(accepted + 1)
    expect((await post(`/api/sprints/${s}/entries`, members[0], { category: 'improve', body: 'after' })).status).toBe(409)
  })

  it('allows uncategorised entries and optional fields', async () => {
    const { owner, members, ws } = await team(1)
    const s = await sprint(owner, members, ws, 'collecting')
    const e = await entry(members[0], s, null, 'just a thought')
    expect(e.category).toBeNull()
    expect(e.period).toBeNull()
    expect(e.impact).toBeNull()
    const e2 = await post(`/api/sprints/${s}/entries`, members[0], { body: 'no category key at all', impact: 'some impact', might_help: 'a fix', period: 'early' })
    expect(e2.status).toBe(200)
    expect(e2.body.category).toBeNull()
    expect(e2.body.impact).toBe('some impact')
    expect(e2.body.might_help).toBe('a fix')
    expect(e2.body.period).toBe('early')
    expect((await post(`/api/sprints/${s}/entries`, members[0], { category: 'bogus', body: 'x' })).status).toBe(400)
    expect((await post(`/api/sprints/${s}/entries`, members[0], { body: 'x', period: 'never' })).status).toBe(400)
    expect((await post(`/api/sprints/${s}/entries`, members[0], { body: '   ' })).status).toBe(400)
    const shared = await closeCollection(owner, s)
    expect(shared.some((x) => x.category === null)).toBe(true)
  })

  it('bounds the size of a single entry', async () => {
    const { owner, members, ws } = await team(1)
    const s = await sprint(owner, members, ws, 'collecting')
    const ok = await post(`/api/sprints/${s}/entries`, members[0], { body: 'x'.repeat(2000) })
    expect(ok.status).toBe(200)
    const tooLong = await post(`/api/sprints/${s}/entries`, members[0], { body: 'x'.repeat(2001) })
    expect(tooLong.status).toBe(400)
    expect(tooLong.body.error).toContain('too long')
    expect(tooLong.body.error).toContain('2000')
    const impactTooLong = await post(`/api/sprints/${s}/entries`, members[0], { body: 'fine', impact: 'y'.repeat(2001) })
    expect(impactTooLong.status).toBe(400)
  })

  it('caps one person at 200 entries per sprint with a clear message', async () => {
    const { owner, members, ws } = await team(1)
    const s = await sprint(owner, members, ws, 'collecting')
    const now = Date.now()
    const stmts = Array.from({ length: 200 }, (_, i) => env.DB.prepare('INSERT INTO entries (id, sprint_id, author_account_id, category, body, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(), s, members[0].account_id, 'keep', `bulk ${i}`, now, now))
    for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50))
    const r = await post(`/api/sprints/${s}/entries`, members[0], { category: 'keep', body: 'one too many' })
    expect(r.status).toBe(409)
    expect(r.body.error).toBe('you’ve saved 200 entries for this sprint — that’s the limit')
    // The cap is per person: another participant can still submit.
    expect((await post(`/api/sprints/${s}/entries`, owner, { category: 'keep', body: 'facilitator thought' })).status).toBe(200)
  })
})
