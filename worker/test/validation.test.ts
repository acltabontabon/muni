/** Malformed input is a plain 400 — never a crash, and never half-stored. */
import { describe, expect, it } from 'vitest'
import { env, SELF } from 'cloudflare:test'
import { closeCollection, entry, get, go, patch, post, req, roomState, sprint, team, type User } from './harness'

/** A request whose body is exactly `text` (not JSON-encoded by the harness). */
async function rawBody(method: string, path: string, user: User, text: string) {
  const r = await SELF.fetch(`https://muni.test${path}`, {
    method,
    headers: { origin: 'http://localhost:5173', 'content-type': 'application/json', cookie: `muni_session=${user.session}; muni_csrf=${user.csrf}`, 'x-csrf-token': user.csrf },
    body: text,
  })
  return { status: r.status, body: (await r.json()) as { code?: string; error?: string } }
}

/** A live sprint with one theme. */
async function live(owner: User, members: User[], ws: string) {
  const s = await sprint(owner, members, ws, 'collecting')
  await entry(members[0], s, 'improve', 'a thought')
  const shared = await closeCollection(owner, s)
  const theme = (await post(`/api/sprints/${s}/themes`, owner, { title: 'T', entry_ids: shared.map((e) => e.id) })).body.themes[0].id as string
  expect((await go(owner, s, 'live')).status).toBe(200)
  return { s, theme }
}

describe('request bodies', () => {
  it('answer JSON null, a list, a number or malformed JSON with a 400 on every route', async () => {
    const { owner, members, ws } = await team(1)
    const s = await sprint(owner, members, ws, 'collecting')
    const routes: [string, string][] = [
      ['POST', '/api/workspaces'],
      ['PATCH', `/api/workspaces/${ws}`],
      ['POST', `/api/workspaces/${ws}/invitations`],
      ['POST', `/api/workspaces/${ws}/join-links`],
      ['POST', `/api/workspaces/${ws}/sprints`],
      ['PATCH', `/api/sprints/${s}`],
      ['PATCH', `/api/sprints/${s}/me`],
      ['POST', `/api/sprints/${s}/participants`],
      ['POST', `/api/sprints/${s}/transition`],
      ['POST', `/api/sprints/${s}/entries`],
      ['PATCH', '/api/auth/me'],
      ['PUT', '/api/me/keys'],
      ['POST', '/api/join/request'],
      ['POST', '/api/join/preview'],
      ['POST', '/api/invitations/preview'],
      ['POST', '/api/invitations/accept'],
    ]
    for (const [method, path] of routes)
      for (const text of ['null', '[]', '42', '"a string"', '{not json']) {
        const r = await rawBody(method, path, owner, text)
        expect(r.status, `${method} ${path} with ${text}`).toBe(400)
        expect(r.body.code).toBe('bad_request')
      }
    // No body at all is an empty one, as before.
    expect((await req('POST', `/api/sprints/${s}/transition`, owner)).status).toBe(400) // "unknown status", not a crash
    expect((await rawBody('POST', `/api/sprints/${s}/transition`, owner, '')).body.error).toBe('unknown status')
  })

  it('refuse lists of ids that aren’t lists of ids', async () => {
    const { owner, members, ws } = await team(1)
    const base = { name: 'S', timezone: 'UTC', starts_on: '2026-09-01', ends_on: '2026-09-10', retro_date: '2026-09-11', retro_time: '10:00', facilitator_id: owner.account_id }
    for (const participant_ids of ['not-a-list', 5, { a: 1 }, [1, 2]]) expect((await post(`/api/workspaces/${ws}/sprints`, owner, { ...base, participant_ids })).status).toBe(400)
    expect((await post(`/api/workspaces/${ws}/sprints`, owner, { ...base, participant_ids: null })).status).toBe(200)
    const s = await sprint(owner, members, ws, 'collecting')
    await entry(members[0], s, 'improve', 'x')
    await closeCollection(owner, s)
    const theme = (await post(`/api/sprints/${s}/themes`, owner, { title: 'T' })).body.themes[0].id as string
    expect((await post(`/api/sprints/${s}/themes`, owner, { title: 'U', entry_ids: 'x' })).status).toBe(400)
    expect((await patch(`/api/sprints/${s}/themes/${theme}`, owner, { entry_ids: 7 })).status).toBe(400)
    expect((await post(`/api/sprints/${s}/themes/ungroup`, owner, { entry_ids: 'x' })).status).toBe(400)
    expect((await post(`/api/sprints/${s}/themes/${theme}/split`, owner, { title: 'V', entry_ids: {} })).status).toBe(400)
    expect((await post(`/api/sprints/${s}/themes/reorder`, owner, { theme_ids: 'x' })).status).toBe(400)
    // Nothing was created along the way.
    expect((await get(`/api/sprints/${s}/themes`, owner)).body.themes).toHaveLength(1)
  })

  it('refuse dates that don’t exist', async () => {
    const { owner, members, ws } = await team(1)
    const base = { name: 'S', timezone: 'UTC', starts_on: '2026-09-01', ends_on: '2026-09-10', retro_date: '2026-09-11', retro_time: '10:00', participant_ids: [], facilitator_id: owner.account_id }
    for (const bad of [{ starts_on: '2026-02-30' }, { ends_on: '2026-09-31' }, { retro_date: '2026-13-01' }]) {
      const r = await post(`/api/workspaces/${ws}/sprints`, owner, { ...base, ...bad })
      expect(r.status, JSON.stringify(bad)).toBe(400)
      expect(r.body.error).toContain('real dates')
    }
    const s = await sprint(owner, members, ws, 'live')
    expect((await patch(`/api/sprints/${s}`, owner, { schedule: { ...base, ends_on: '2026-04-31' } })).status).toBe(400)
    const change = 'For the next sprint, reserve a 15-minute daily review window'
    expect((await post(`/api/sprints/${s}/experiments`, owner, { change_to_try: change, success_signal: 'less waiting', review_on: '2026-02-30' })).status).toBe(400)
    const made = await post(`/api/sprints/${s}/experiments`, owner, { change_to_try: change, success_signal: 'less waiting', review_on: '' })
    expect(made.status).toBe(200)
    expect(made.body[0].review_on).toBe('2026-10-11') // no date given: two weeks after the sprint ends
    expect((await patch(`/api/sprints/${s}/experiments/${made.body[0].id}`, owner, { review_on: '2026-10-32' })).status).toBe(400)
    expect((await patch(`/api/sprints/${s}/experiments/${made.body[0].id}`, owner, { review_on: '2026-10-30' })).body[0].review_on).toBe('2026-10-30')
  })

  it('refuse fractional vote budgets and retro durations without storing any change', async () => {
    const { owner, members, ws } = await team(1)
    const base = { name: 'S', timezone: 'UTC', starts_on: '2026-09-01', ends_on: '2026-09-10', retro_date: '2026-09-11', retro_time: '10:00', participant_ids: [], facilitator_id: owner.account_id }
    for (const fields of [{ vote_budget: 1.5 }, { retro_duration_min: 45.5 }]) {
      expect((await post(`/api/workspaces/${ws}/sprints`, owner, { ...base, ...fields })).status).toBe(400)
    }
    expect((await get(`/api/workspaces/${ws}/sprints`, owner)).body).toHaveLength(0)
    const { s } = await live(owner, members, ws)
    const before = (await get(`/api/sprints/${s}`, owner)).body
    expect((await patch(`/api/sprints/${s}`, owner, { name: 'must not save', vote_budget: 2.5 })).status).toBe(400)
    expect((await patch(`/api/sprints/${s}`, owner, { name: 'must not save', schedule: { ...base, retro_duration_min: 45.5 } })).status).toBe(400)
    const after = (await get(`/api/sprints/${s}`, owner)).body
    expect(after.name).toBe(before.name)
    expect(after.vote_budget).toBe(before.vote_budget)
    expect(after.retro_duration_min).toBe(before.retro_duration_min)
    expect((await post(`/api/sprints/${s}/votes/rounds`, owner, { budget: 1.5 })).status).toBe(400)
    expect((await get(`/api/sprints/${s}/votes`, owner)).body.current).toBeNull()
    expect((await post(`/api/sprints/${s}/votes/rounds`, owner, { budget: 3 })).status).toBe(200)
  })

  it('refuse an invitation to an address or sprint that isn’t text', async () => {
    const { owner, ws } = await team(0)
    expect((await post(`/api/workspaces/${ws}/invitations`, owner, { email: 42 })).status).toBe(400)
    expect((await post(`/api/workspaces/${ws}/invitations`, owner, { email: 'x@example.com', sprint_id: { id: 1 } })).status).toBe(400)
  })
})

describe('meeting commands', () => {
  it('refuse a malformed command without changing the stage', async () => {
    const { owner, members, ws } = await team(1)
    const { s, theme } = await live(owner, members, ws)
    const before = (await get(`/api/sprints/${s}/meeting`, owner)).body
    const send = (command: unknown) => post(`/api/sprints/${s}/meeting/command`, owner, { expected_version: before.version, command })
    for (const command of [
      null,
      'set_phase',
      { phase: 'talk' },
      { type: 'set_agenda', items: 'not a list' },
      { type: 'set_agenda', items: [null] },
      { type: 'set_agenda', items: [{ theme_id: 5 }] },
      { type: 'timer_start' },
      { type: 'timer_start', secs: '120' },
      { type: 'timer_adjust', delta_secs: null },
      { type: 'set_topic', theme_id: { id: theme } },
      { type: 'set_phase', phase: 'lunch' },
    ]) {
      const r = await send(command)
      expect(r.status, JSON.stringify(command)).toBe(400)
    }
    const after = (await get(`/api/sprints/${s}/meeting`, owner)).body
    expect(after.version).toBe(before.version)
    expect(after.timer).toEqual(before.timer)
    expect(after.agenda).toEqual(before.agenda)
    // The room refuses one too, if one ever reached it.
    const stub = env.ROOMS.get(env.ROOMS.idFromName(s))
    const direct = await stub.fetch('https://room/command', { method: 'POST', body: JSON.stringify({ account: owner.account_id, expected_version: before.version, command: { type: 'timer_start', secs: 'soon' } }) })
    expect(direct.status).toBe(400)
    expect((await roomState(s)).meeting.version).toBe(before.version)
    // Well-formed commands still work.
    expect((await send({ type: 'timer_start', secs: 120 })).body.timer.total_secs).toBe(120)
  })
})
