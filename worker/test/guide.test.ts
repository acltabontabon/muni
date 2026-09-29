/**
 * The first evening: a new account's guide through its team's first sprint and retro. The Worker
 * keeps where the person is (prologue, on, hidden, done) and answers which milestones they've
 * reached; both are only ever about the person asking.
 */
import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { SoftAuthenticator } from './authenticator'
import { closeCollection, entry, get, go, passkeySignup, patch, post, req, signin, sprint, tag, team, type User } from './harness'

const me = async (u: User) => (await get('/api/auth/me', u)).body
const view = async (u: User) => (await get('/api/me/guide', u)).body as { track: string; reached: string[] }
const events = async (u: User) => ((await get('/api/auth/security-events', u)).body as unknown[]).length

describe('the first evening', () => {
  it('starts with the prologue for a new account', async () => {
    const r = await passkeySignup(new SoftAuthenticator(), 'Nia New')
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.guide).toBe('prologue')
    expect((await me(r.user!)).guide).toBe('prologue')
  })

  it('never interrupts development accounts unless asked', async () => {
    const dev = await req<{ guide: string }>('POST', '/api/dev/session', null, { name: 'Dev' })
    expect(dev.body.guide).toBe('done')
    for (const guide of ['prologue', 'on'] as const) {
      const asked = await req<{ guide: string }>('POST', '/api/dev/session', null, { name: 'Guided', guide })
      expect(asked.body.guide).toBe(guide)
    }
  })

  it('can be hidden and brought back, stays done once done, and is never security activity', async () => {
    const u = await signin(`guide-${tag()}@example.com`, 'Gia Guide')
    expect((await me(u)).guide).toBe('prologue')
    const before = await events(u)
    for (const next of ['on', 'hidden', 'on', 'done'] as const) {
      const r = await patch('/api/auth/me', u, { guide: next })
      expect(r.status).toBe(200)
      expect(r.body.guide).toBe(next)
    }
    // Done is for good.
    for (const again of ['on', 'hidden'] as const) expect((await patch('/api/auth/me', u, { guide: again })).body.guide).toBe('done')
    // Refused, changing nothing: the prologue is only ever a new account's.
    for (const bad of [{ guide: 'prologue' }, { guide: true }, { guide: 3 }, { guide: '' }, { guide: null }]) {
      const x = await patch('/api/auth/me', u, bad)
      expect(x.status, JSON.stringify(bad)).toBe(400)
    }
    expect((await me(u)).guide).toBe('done')
    expect((await me(u)).display_name).toBe('Gia Guide')
    expect(await events(u)).toBe(before)
  })

  it('lights a starter’s seven stars as the team’s first sprint goes by', async () => {
    const { owner, members, ws } = await team(1)
    const member = members[0]
    expect(await view(owner)).toEqual({ track: 'starter', reached: ['team'] })
    expect(await view(member)).toEqual({ track: 'member', reached: [] })

    // Alone in a sprint first: no people yet.
    const alone = await sprint(owner, [], ws, 'draft', { name: 'Alone' })
    expect((await view(owner)).reached).toEqual(['team', 'sprint'])
    expect((await post(`/api/sprints/${alone}/participants`, owner, { account_id: member.account_id })).status).toBe(200)
    expect((await view(owner)).reached).toEqual(['team', 'sprint', 'people'])

    expect((await go(owner, alone, 'collecting')).status).toBe(200)
    await entry(member, alone, 'keep', 'Pairing on the release helped')
    // Someone else's thought never lights your star.
    expect((await view(owner)).reached).toEqual(['team', 'sprint', 'people'])
    expect((await view(member)).reached).toEqual(['thought'])
    await entry(owner, alone, 'improve', 'Too many meetings')
    expect((await view(owner)).reached).toContain('thought')

    await closeCollection(owner, alone)
    expect((await view(member)).reached).toEqual(['thought', 'reveal'])
    expect((await go(owner, alone, 'live')).status).toBe(200)
    expect((await view(member)).reached).toEqual(['thought', 'reveal', 'retro'])
    expect((await go(owner, alone, 'completed')).status).toBe(200)
    expect(await view(owner)).toEqual({ track: 'starter', reached: ['team', 'sprint', 'people', 'thought', 'reveal', 'retro', 'agreed'] })
    expect(await view(member)).toEqual({ track: 'member', reached: ['thought', 'reveal', 'retro', 'agreed'] })
  })

  it('ignores demo workspaces', async () => {
    const u = await signin(`demo-${tag()}@example.com`, 'Dee Demo')
    expect((await post('/api/demo/seed', u)).status).toBe(200)
    expect(await view(u)).toEqual({ track: 'member', reached: [] })
  })

  it('a member who facilitates walks the starter’s evening', async () => {
    const { owner, members, ws } = await team(1)
    await sprint(owner, members, ws, 'draft', { facilitator_id: members[0].account_id, participant_ids: [owner.account_id, members[0].account_id] })
    const v = await view(members[0])
    expect(v.track).toBe('starter')
    expect(v.reached).toEqual(['sprint', 'people'])
    // The owner started the team but doesn't facilitate this one.
    expect((await view(owner)).reached).toEqual(['team'])
  })

  it('is only for the signed-in person', async () => {
    expect((await req('GET', '/api/me/guide', null)).status).toBe(401)
    const r = await req<{ account_id: string }>('POST', '/api/dev/session', null, { name: 'Row' })
    const row = await env.DB.prepare('SELECT guide FROM accounts WHERE id = ?').bind(r.body.account_id).first<{ guide: number }>()
    expect(row!.guide).toBe(3)
  })
})
