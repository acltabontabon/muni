/**
 * Reads on the path of every screen go to the database in a fixed number of round trips, however
 * much there is to read: the session with what the request is about, then one batch.
 */
import { describe, expect, it, vi } from 'vitest'
import { env } from 'cloudflare:test'
import { closeCollection, command, entry, get, go, post, put, sprint, team, type User } from './harness'
import { runDue } from '../src/jobs'

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

  it('the votes: the session and one batch, however many rounds there have been', async () => {
    const { owner, members, ws } = await team(2)
    const s = await sprint(owner, members, ws, 'collecting')
    for (const [i, u] of members.entries()) await entry(u, s, 'improve', `thought ${i}`)
    const shared = await closeCollection(owner, s)
    const themes: string[] = []
    for (const e of shared) themes.push((await post(`/api/sprints/${s}/themes`, owner, { title: `T ${e.id.slice(0, 4)}`, entry_ids: [e.id] })).body.themes.at(-1).id)
    expect((await go(owner, s, 'ready')).status).toBe(200)
    // A closed round, a cancelled one, and one open now.
    for (const action of ['close', 'cancel', null]) {
      expect((await post(`/api/sprints/${s}/votes/rounds`, owner)).status).toBe(200)
      for (const u of members) await post(`/api/sprints/${s}/votes`, u, { theme_id: themes[0], cast: true })
      await post(`/api/sprints/${s}/votes`, members[0], { theme_id: themes[1], cast: true })
      if (action) await post(`/api/sprints/${s}/votes/rounds/close`, owner, { action })
    }
    for (const u of [owner, members[0]]) expect(await trips(() => get(`/api/sprints/${s}/votes`, u))).toBe(2)
    const byFac = (await get(`/api/sprints/${s}/votes`, owner)).body
    expect(byFac.current).toMatchObject({ status: 'open', voters: 2, my_votes: [], totals: null })
    expect(byFac.previous.map((r: { status: string; totals: Record<string, number> | null }) => [r.status, r.totals])).toEqual([['cancelled', null], ['closed', { [themes[0]]: 2, [themes[1]]: 1 }]])
    const mine = (await get(`/api/sprints/${s}/votes`, members[0])).body
    expect(mine.current).toMatchObject({ voters: null, my_remaining: 1 })
    expect([...mine.current.my_votes].sort()).toEqual([...themes].sort())
    expect(mine.previous[1].my_votes.sort()).toEqual([...themes].sort())
  })

  it('making a sprint: the same trips for one participant or many', async () => {
    const small = await team(1)
    const large = await team(5)
    const make = (t: { owner: User; members: User[]; ws: string }) => () =>
      post(`/api/workspaces/${t.ws}/sprints`, t.owner, { name: 'S', timezone: 'Europe/Berlin', starts_on: '2026-09-14', ends_on: '2026-09-27', retro_date: '2026-09-28', retro_time: '14:00', participant_ids: t.members.map((m) => m.account_id), facilitator_id: t.owner.account_id, reminders_enabled: false })
    expect(await trips(make(large))).toBe(await trips(make(small)))
  })

  it('a reminder: the same trips for one recipient or many', async () => {
    const reminder = async (n: number) => {
      const { owner, members, ws } = await team(n)
      const s = await sprint(owner, members, ws, 'collecting', { reminders_enabled: true })
      await env.DB.prepare("INSERT INTO jobs (id, kind, payload, idempotency_key, run_at, created_at) VALUES (?, 'reminder', ?, ?, ?, ?)").bind(crypto.randomUUID(), JSON.stringify({ sprint_id: s, kind: 'midpoint' }), `test-reminder:${s}`, Date.now() - 1000, Date.now()).run()
      const n0 = await trips(async () => {
        await runDue(env as unknown as Parameters<typeof runDue>[0], 1)
        return { status: 200 }
      })
      const queued = await env.DB.prepare("SELECT count(*) AS n FROM jobs WHERE kind = 'email' AND instr(idempotency_key, ?) = 1").bind(`reminder-mail:${s}:`).first<{ n: number }>()
      expect(queued!.n).toBe(n + 1)
      return n0
    }
    expect(await reminder(4)).toBe(await reminder(1))
  })
})
