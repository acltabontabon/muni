/**
 * Reads on the path of every screen go to the database in a fixed number of round trips, however
 * much there is to read: the session with what the request is about, then one batch.
 */
import { describe, expect, it, vi } from 'vitest'
import { env } from 'cloudflare:test'
import { closeCollection, command, entry, get, go, post, put, sprint, team } from './harness'

/** Round trips to D1 while `fn` runs: each statement run on its own, and each batch, counts once. */
async function trips(fn: () => Promise<{ status: number }>) {
  const db = Object.getPrototypeOf(env.DB)
  const stmt = Object.getPrototypeOf(env.DB.prepare('SELECT 1'))
  const spies = [vi.spyOn(db, 'batch'), ...(['first', 'run', 'all', 'raw'] as const).map((m) => vi.spyOn(stmt, m))]
  try {
    expect((await fn()).status).toBe(200)
    return spies.reduce((n, s) => n + s.mock.calls.length, 0)
  } finally {
    spies.forEach((s) => s.mockRestore())
  }
}

describe('database round trips', () => {
  it('starting the app: the session, then everything about the person in one batch', async () => {
    const { owner } = await team(2)
    expect(await trips(() => get('/api/auth/me', owner))).toBe(2)
  })

  it('a live sprint’s themes, check-ins and stage: the same few trips, however many there are', async () => {
    const { owner, members, ws } = await team(3)
    const s = await sprint(owner, members, ws, 'collecting')
    for (const [i, u] of members.entries()) await entry(u, s, 'improve', `thought ${i}`)
    const shared = await closeCollection(owner, s)
    const themes: string[] = []
    for (const e of shared) themes.push((await post(`/api/sprints/${s}/themes`, owner, { title: `T ${e.id.slice(0, 4)}`, entry_ids: [e.id] })).body.themes.at(-1).id)
    expect((await go(owner, s, 'live')).status).toBe(200)
    for (const t of themes) {
      const id = (await post(`/api/sprints/${s}/checkins`, owner, { theme_id: t, kind: 'topic' })).body.id as string
      for (const u of members) await put(`/api/sprints/${s}/checkins/${id}/response`, u, { choice: 'felt', note: 'a line' })
      if (t === themes[0]) await post(`/api/sprints/${s}/checkins/${id}/share`, owner)
    }
    await command(owner, s, { type: 'set_topic', theme_id: themes[0] })
    for (const u of [owner, members[0]]) {
      expect(await trips(() => get(`/api/sprints/${s}/checkins`, u))).toBe(2)
      expect(await trips(() => get(`/api/sprints/${s}/themes`, u))).toBe(2)
      // The stage: the session, one batch, and the notes of the topic in hand.
      expect(await trips(() => get(`/api/sprints/${s}/meeting`, u))).toBe(3)
    }
    const list = (await get(`/api/sprints/${s}/checkins`, owner)).body as { status: string; answers: number | null; results: { responded: number } | null }[]
    expect(list.map((c) => [c.status, c.answers, c.results?.responded ?? null])).toEqual([['shared', null, 3], ['open', 3, null], ['open', 3, null]])
    const mine = (await get(`/api/sprints/${s}/checkins`, members[0])).body as { mine: { choice: string } | null; answers: number | null }[]
    expect(mine.map((c) => [c.mine?.choice, c.answers])).toEqual([['felt', null], ['felt', null], ['felt', null]])
  })
})
