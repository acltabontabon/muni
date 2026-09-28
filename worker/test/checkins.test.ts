/** Check-ins during the talk: private until shared, one answer each, never the wrong topic, never who. */
import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { closeCollection, del, entry, get, go, openSocket, post, put, sleep, sprint, team, type User } from './harness'

async function live(owner: User, members: User[], ws: string) {
  const s = await sprint(owner, members, ws, 'collecting')
  for (let i = 0; i < 2; i++) await entry(members[i % members.length], s, 'improve', `entry ${i}`)
  const entries = await closeCollection(owner, s)
  const themes: string[] = []
  for (let i = 0; i < 2; i++) {
    const g = await post(`/api/sprints/${s}/themes`, owner, { title: `Theme ${i}`, entry_ids: [entries[i].id] })
    themes.push(g.body.themes.find((t: { title: string }) => t.title === `Theme ${i}`).id)
  }
  expect((await go(owner, s, 'live')).status).toBe(200)
  return { s, themes }
}
const open = (u: User, s: string, body: Record<string, unknown>) => post(`/api/sprints/${s}/checkins`, u, body)
const answer = (u: User, s: string, id: string, body: Record<string, unknown>) => put(`/api/sprints/${s}/checkins/${id}/response`, u, body)
const list = (u: User, s: string) => get(`/api/sprints/${s}/checkins`, u)

describe('check-ins', () => {
  it('are opened by the facilitator, on a topic of this sprint, while the retro is live', async () => {
    const { owner, members, ws } = await team(2)
    const { s, themes } = await live(owner, members, ws)
    expect((await open(members[0], s, { theme_id: themes[0], kind: 'topic' })).status).toBe(403)
    expect((await open(owner, s, { theme_id: crypto.randomUUID(), kind: 'topic' })).status).toBe(404)
    expect((await open(owner, s, { theme_id: themes[0], kind: 'poll' })).status).toBe(400)
    // An action check-in needs an idea to ask about.
    expect((await open(owner, s, { theme_id: themes[0], kind: 'action' })).status).toBe(409)
    const c = await open(owner, s, { theme_id: themes[0], kind: 'topic' })
    expect(c.status).toBe(200)
    expect(c.body).toMatchObject({ theme_id: themes[0], kind: 'topic', status: 'open', mine: null, answers: 0, results: null })
    // Opening again (revisiting the topic) finds the same one.
    expect((await open(owner, s, { theme_id: themes[0], kind: 'topic' })).body.id).toBe(c.body.id)
    const other = await sprint(owner, members, ws, 'collecting')
    expect((await open(owner, other, { theme_id: themes[0], kind: 'topic' })).status).toBe(409)
  })

  it('keeps answers private until shared: yours to you, a count to the facilitator, nothing to anyone else', async () => {
    const { owner, members, ws } = await team(3)
    const { s, themes } = await live(owner, members, ws)
    const id = (await open(owner, s, { theme_id: themes[0], kind: 'topic' })).body.id
    expect((await answer(members[0], s, id, { choice: 'worth' })).status).toBe(400) // an action's answer, on a topic
    expect((await answer(members[0], s, id, {})).status).toBe(400)
    const a = await answer(members[0], s, id, { choice: 'felt', note: 'Needle-7 acceptance criteria moved' })
    expect(a.status).toBe(200)
    expect(a.body.mine).toEqual({ choice: 'felt', note: 'Needle-7 acceptance criteria moved' })
    expect(a.body.answers).toBeNull()
    // Change it, twice: still one answer.
    await answer(members[0], s, id, { choice: 'not_mine' })
    expect((await answer(members[0], s, id, { choice: 'felt' })).body.mine).toEqual({ choice: 'felt', note: 'Needle-7 acceptance criteria moved' })
    await answer(members[1], s, id, { choice: 'context' })
    const n = await env.DB.prepare('SELECT count(*) AS n FROM checkin_responses WHERE checkin_id = ?').bind(id).first<{ n: number }>()
    expect(n!.n).toBe(2)
    // The facilitator: a count, no choices, no lines.
    const fac = (await list(owner, s)).body[0]
    expect(fac.answers).toBe(2)
    expect(fac.results).toBeNull()
    expect(JSON.stringify(fac)).not.toContain('Needle-7')
    // Another participant: nothing about anyone's answer, not even a count.
    const peer = (await list(members[2], s)).body[0]
    expect(peer).toMatchObject({ mine: null, answers: null, results: null })
    expect(JSON.stringify(peer)).not.toContain('Needle-7')
    // Taking it back.
    await answer(members[1], s, id, { choice: 'felt' })
    expect((await del(`/api/sprints/${s}/checkins/${id}/response`, members[1])).body.mine).toBeNull()
    expect((await list(owner, s)).body[0].answers).toBe(1)
  })

  it('shares counts and lines without anything that identifies who, and closes to late answers', async () => {
    const { owner, members, ws } = await team(3)
    const { s, themes } = await live(owner, members, ws)
    const id = (await open(owner, s, { theme_id: themes[0], kind: 'topic' })).body.id
    await answer(members[0], s, id, { choice: 'felt', note: 'Tickets reached QE on the last day' })
    await answer(members[1], s, id, { choice: 'not_mine', note: 'Our smaller tickets reached QE earlier' })
    await answer(members[2], s, id, { choice: 'felt' })
    expect((await post(`/api/sprints/${s}/checkins/${id}/share`, members[0])).status).toBe(403)
    const shared = await post(`/api/sprints/${s}/checkins/${id}/share`, owner)
    expect(shared.status).toBe(200)
    expect(shared.body.status).toBe('shared')
    expect(shared.body.results).toMatchObject({ responded: 3, counts: { felt: 2, not_mine: 1 } })
    expect(shared.body.results.notes.map((x: { note: string }) => x.note).sort()).toEqual(['Our smaller tickets reached QE earlier', 'Tickets reached QE on the last day'])
    const everyone = await list(members[2], s)
    const text = JSON.stringify(everyone.body)
    for (const u of [owner, ...members]) expect(text).not.toContain(u.account_id)
    expect(Object.keys(everyone.body[0].results.notes[0]).sort()).toEqual(['choice', 'note'])
    // After sharing: no new answers, no changes; the author keeps their words (they're refused, not lost).
    const late = await answer(members[2], s, id, { choice: 'context', note: 'late' })
    expect(late.status).toBe(409)
    expect(late.body.code).toBe('checkin_shared')
    expect((await del(`/api/sprints/${s}/checkins/${id}/response`, members[0])).status).toBe(409)
    // Sharing again changes nothing.
    expect((await post(`/api/sprints/${s}/checkins/${id}/share`, owner)).body.results.responded).toBe(3)
  })

  it('shares nothing awkward when nobody answered', async () => {
    const { owner, members, ws } = await team(2)
    const { s, themes } = await live(owner, members, ws)
    const id = (await open(owner, s, { theme_id: themes[1], kind: 'topic' })).body.id
    const shared = await post(`/api/sprints/${s}/checkins/${id}/share`, owner)
    expect(shared.body.results).toEqual({ responded: 0, counts: {}, notes: [] })
  })

  it('ties an answer to its check-in: another sprint’s id is not found, and a moved-on topic still gets its own', async () => {
    const { owner, members, ws } = await team(2)
    const A = await live(owner, members, ws)
    const B = await live(owner, members, ws)
    const idA = (await open(owner, A.s, { theme_id: A.themes[0], kind: 'topic' })).body.id
    expect((await answer(members[0], B.s, idA, { choice: 'felt' })).status).toBe(404)
    // The room moves to the next topic while a phone is still on the first: the answer lands where it was given.
    await post(`/api/sprints/${A.s}/meeting/command`, owner, { expected_version: 1, command: { type: 'set_topic', theme_id: A.themes[1] } })
    expect((await answer(members[0], A.s, idA, { choice: 'felt' })).status).toBe(200)
    const row = await env.DB.prepare('SELECT c.theme_id FROM checkin_responses r JOIN checkins c ON c.id = r.checkin_id WHERE r.checkin_id = ?').bind(idA).first<{ theme_id: string }>()
    expect(row!.theme_id).toBe(A.themes[0])
    // Someone outside the sprint can't answer or read.
    const { owner: stranger } = await team(0)
    expect([403, 404]).toContain((await answer(stranger, A.s, idA, { choice: 'felt' })).status)
    expect([403, 404]).toContain((await list(stranger, A.s)).status)
  })

  it('asks about an idea as it was worded; a reworded idea is asked about again', async () => {
    const { owner, members, ws } = await team(2)
    const { s, themes } = await live(owner, members, ws)
    await put(`/api/sprints/${s}/meeting/notes/${themes[0]}`, owner, { could_try: 'Pair on first reviews' })
    const c = await open(owner, s, { theme_id: themes[0], kind: 'action' })
    expect(c.body).toMatchObject({ kind: 'action', could_try: 'Pair on first reviews' })
    await answer(members[0], s, c.body.id, { choice: 'concern', note: 'We’d lose standup time' })
    await answer(members[1], s, c.body.id, { choice: 'worth' })
    expect((await answer(members[1], s, c.body.id, { choice: 'felt' })).status).toBe(400)
    const shared = await post(`/api/sprints/${s}/checkins/${c.body.id}/share`, owner)
    expect(shared.body.results.counts).toEqual({ concern: 1, worth: 1 })
    // Editing the idea later doesn't move the answers to the new words.
    await put(`/api/sprints/${s}/meeting/notes/${themes[0]}`, owner, { could_try: 'Pair on first reviews, mornings only' })
    expect((await list(owner, s)).body[0].could_try).toBe('Pair on first reviews')
    const renewed = await open(owner, s, { theme_id: themes[0], kind: 'action', renew: true })
    expect(renewed.body).toMatchObject({ id: c.body.id, status: 'open', could_try: 'Pair on first reviews, mornings only', results: null, answers: 0 })
  })

  it('tells only the facilitator and your own tabs that you answered', async () => {
    const { owner, members, ws } = await team(2)
    const { s, themes } = await live(owner, members, ws)
    const id = (await open(owner, s, { theme_id: themes[0], kind: 'topic' })).body.id
    const fac = await openSocket(owner, s)
    const self = await openSocket(members[0], s)
    const peer = await openSocket(members[1], s)
    await Promise.all([fac.waitFor((m) => m.includes('hello')), self.waitFor((m) => m.includes('hello')), peer.waitFor((m) => m.includes('hello'))])
    await answer(members[0], s, id, { choice: 'felt' })
    const isHint = (m: string) => m.includes('"checkins"')
    expect(await fac.waitFor(isHint)).toBe(true)
    expect(await self.waitFor(isHint)).toBe(true)
    await sleep(300)
    expect(peer.messages.some(isHint)).toBe(false)
    // Sharing is for everyone.
    await post(`/api/sprints/${s}/checkins/${id}/share`, owner)
    expect(await peer.waitFor(isHint)).toBe(true)
    for (const x of [fac, self, peer]) x.socket.close()
  })

  it('goes with the sprint’s content when it’s purged', async () => {
    const { owner, members, ws } = await team(1)
    const { s, themes } = await live(owner, members, ws)
    const id = (await open(owner, s, { theme_id: themes[0], kind: 'topic' })).body.id
    await answer(members[0], s, id, { choice: 'felt', note: 'x' })
    const { purgeSprintContent } = await import('../src/jobs')
    await purgeSprintContent(env.DB, s, ws)
    expect((await env.DB.prepare('SELECT count(*) AS n FROM checkins WHERE sprint_id = ?').bind(s).first<{ n: number }>())!.n).toBe(0)
    expect((await env.DB.prepare('SELECT count(*) AS n FROM checkin_responses WHERE checkin_id = ?').bind(id).first<{ n: number }>())!.n).toBe(0)
  })
})
