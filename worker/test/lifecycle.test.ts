/** Sprint lifecycle: transitions, reopen, deletion, scheduling, participants. */
import { describe, expect, it } from 'vitest'
import { closeCollection, del, entry, get, go, ids, patch, post, signin, sprint, tag, team, inviteToken } from './harness'

describe('lifecycle', () => {
  it('refuses invalid transitions and demands confirmation where entries are revealed or history kept', async () => {
    const { owner, members, ws } = await team(1)
    const s = await sprint(owner, members, ws, 'draft')
    const bad = await post(`/api/sprints/${s}/transition`, owner, { to: 'ready' })
    expect(bad.status).toBe(409)
    expect(bad.body.error).toBe('can’t move from draft to ready')
    expect((await post(`/api/sprints/${s}/transition`, owner, { to: 'live' })).status).toBe(409)
    expect((await post(`/api/sprints/${s}/transition`, owner, { to: 'nonsense' })).status).toBe(400)
    // Members can't transition at all.
    expect((await post(`/api/sprints/${s}/transition`, members[0], { to: 'collecting' })).status).toBe(403)
    expect((await go(owner, s, 'collecting')).status).toBe(200)
    // Closing collection reveals entries: needs confirm.
    const noConfirm = await post(`/api/sprints/${s}/transition`, owner, { to: 'preparing' })
    expect(noConfirm.status).toBe(409)
    expect(noConfirm.body.error).toContain('confirm')
    expect((await get(`/api/sprints/${s}`, owner)).body.status).toBe('collecting')
    expect((await go(owner, s, 'preparing')).status).toBe(200)
    // Reopening keeps history visible: needs confirm.
    const reopenNoConfirm = await post(`/api/sprints/${s}/transition`, owner, { to: 'collecting' })
    expect(reopenNoConfirm.status).toBe(409)
    expect(reopenNoConfirm.body.error).toContain('confirm')
    expect((await post(`/api/sprints/${s}/transition`, owner, { to: 'live' })).status).toBe(409)
    expect((await post(`/api/sprints/${s}/transition`, owner, { to: 'completed' })).status).toBe(409)
    expect((await post(`/api/sprints/${s}/transition`, owner, { to: 'draft' })).status).toBe(409)
  })

  it('exposes allowed_transitions per status and role', async () => {
    const { owner, members, ws } = await team(1)
    const s = await sprint(owner, members, ws, 'draft')
    const expected: Record<string, string[]> = {
      draft: ['collecting'],
      collecting: ['preparing'],
      preparing: ['ready', 'collecting'],
      ready: ['live', 'preparing'],
      live: ['completed', 'ready'],
      completed: ['archived'],
      archived: [],
    }
    for (const status of ['draft', 'collecting', 'preparing', 'ready', 'live', 'completed', 'archived']) {
      if (status !== 'draft') expect((await go(owner, s, status)).status).toBe(200)
      const d = await get(`/api/sprints/${s}`, owner)
      expect(d.body.status).toBe(status)
      expect(d.body.allowed_transitions, status).toEqual(expected[status])
      expect((await get(`/api/sprints/${s}`, members[0])).body.allowed_transitions).toEqual([])
    }
  })

  it('reopening collection cancels an open vote round and bumps revision and reopened_count', async () => {
    const { owner, members, ws } = await team(1)
    const s = await sprint(owner, members, ws, 'collecting')
    await entry(members[0], s, 'improve', 'a thought')
    const entries = await closeCollection(owner, s)
    await post(`/api/sprints/${s}/themes`, owner, { title: 'T', entry_ids: ids(entries) })
    await go(owner, s, 'ready')
    expect((await post(`/api/sprints/${s}/votes/rounds`, owner)).status).toBe(200)
    const before = (await get(`/api/sprints/${s}`, owner)).body
    expect(before.reopened_count).toBe(0)
    expect((await go(owner, s, 'preparing')).status).toBe(200)
    expect((await get(`/api/sprints/${s}/votes`, owner)).body.current).not.toBeNull()
    const reopened = await go(owner, s, 'collecting')
    expect(reopened.status).toBe(200)
    expect(reopened.body.status).toBe('collecting')
    expect(reopened.body.reopened_count).toBe(1)
    expect(reopened.body.grouping_revision).toBe(before.grouping_revision + 1)
    expect(reopened.body.revealed_once).toBe(true)
    expect(reopened.body.entry_count).toBeNull()
    const votes = await get(`/api/sprints/${s}/votes`, owner)
    expect(votes.body.current).toBeNull()
    expect(votes.body.previous[0].status).toBe('cancelled')
    expect(votes.body.previous[0].cancel_reason).toBe('collection reopened')
    // People can add again; the earlier entry is still theirs.
    expect((await post(`/api/sprints/${s}/entries`, members[0], { category: 'keep', body: 'second thought' })).status).toBe(200)
    expect((await get(`/api/sprints/${s}/entries/mine`, members[0])).body).toHaveLength(2)
  })

  it('deletes only drafts', async () => {
    const { owner, members, ws } = await team(1)
    const draft = await sprint(owner, members, ws, 'draft')
    expect((await del(`/api/sprints/${draft}`, members[0])).status).toBe(403)
    expect((await del(`/api/sprints/${draft}`, owner)).status).toBe(200)
    expect((await get(`/api/sprints/${draft}`, owner)).status).toBe(404)
    const collecting = await sprint(owner, members, ws, 'collecting')
    const r = await del(`/api/sprints/${collecting}`, owner)
    expect(r.status).toBe(409)
    expect(r.body.error).toContain('only draft sprints')
    expect((await get(`/api/sprints/${collecting}`, owner)).status).toBe(200)
  })

  it('rejects a retro time that falls in a DST gap and resolves a valid one', async () => {
    const { owner, members, ws } = await team(1)
    const base = { name: 'DST', timezone: 'Europe/Berlin', starts_on: '2026-03-01', ends_on: '2026-03-28', retro_date: '2026-03-29', retro_duration_min: 45, participant_ids: [members[0].account_id], facilitator_id: owner.account_id }
    const gap = await post(`/api/workspaces/${ws}/sprints`, owner, { ...base, retro_time: '02:30' })
    expect(gap.status).toBe(400)
    expect(gap.body.error).toContain('doesn’t exist')
    const ok = await post(`/api/workspaces/${ws}/sprints`, owner, { ...base, retro_time: '03:30' })
    expect(ok.status).toBe(200)
    expect(ok.body.retro_at).toBe('2026-03-29T01:30:00.000Z') // CEST is UTC+2
    expect(ok.body.retro_local_time).toBe('03:30')
    expect(ok.body.retro_local).toContain('UTC+02:00')
    // Before the switch the same wall time is UTC+1.
    const winter = await post(`/api/workspaces/${ws}/sprints`, owner, { ...base, retro_date: '2026-03-28', retro_time: '03:30' })
    expect(winter.body.retro_at).toBe('2026-03-28T02:30:00.000Z')
    // Editing the schedule into a gap is refused too.
    const s = ok.body.id
    expect((await patch(`/api/sprints/${s}`, owner, { schedule: { ...base, retro_time: '02:00' } })).status).toBe(400)
    expect((await patch(`/api/sprints/${s}`, owner, { schedule: { ...base, retro_time: '01:59' } })).status).toBe(200)
    expect((await post(`/api/workspaces/${ws}/sprints`, owner, { ...base, timezone: 'Mars/Olympus', retro_time: '10:00' })).status).toBe(400)
  })

  it('adds and removes participants, and a facilitator can’t remove themselves', async () => {
    const { owner, members, ws } = await team(2)
    const s = await sprint(owner, [members[0]], ws, 'collecting')
    expect((await get(`/api/sprints/${s}`, members[1])).status).toBe(403)
    const add = await post(`/api/sprints/${s}/participants`, owner, { account_id: members[1].account_id })
    expect(add.status).toBe(200)
    const d = await get(`/api/sprints/${s}`, owner)
    expect(d.body.participant_count).toBe(3)
    expect(d.body.participants.map((p: { account_id: string }) => p.account_id)).toContain(members[1].account_id)
    expect((await get(`/api/sprints/${s}`, members[1])).status).toBe(200)
    // Not a workspace member: refused.
    const stranger = await signin(`stranger-${tag()}@example.com`)
    expect((await post(`/api/sprints/${s}/participants`, owner, { account_id: stranger.account_id })).status).toBe(400)
    // Members can't manage participants.
    expect((await post(`/api/sprints/${s}/participants`, members[0], { account_id: members[1].account_id })).status).toBe(403)
    expect((await del(`/api/sprints/${s}/participants/${members[1].account_id}`, members[0])).status).toBe(403)
    // Removal.
    expect((await del(`/api/sprints/${s}/participants/${members[1].account_id}`, owner)).status).toBe(200)
    expect((await get(`/api/sprints/${s}`, owner)).body.participant_count).toBe(2)
    expect((await get(`/api/sprints/${s}`, members[1])).status).toBe(403)
    const self = await del(`/api/sprints/${s}/participants/${owner.account_id}`, owner)
    expect(self.status).toBe(409)
    expect(self.body.error).toContain('hand facilitation')
    expect((await get(`/api/sprints/${s}`, owner)).body.participant_count).toBe(2)
  })

  it('hands facilitation to a participant', async () => {
    const { owner, members, ws } = await team(2)
    const s = await sprint(owner, members, ws, 'collecting')
    const outsider = await team(1)
    void outsider
    expect((await patch(`/api/sprints/${s}`, owner, { facilitator_id: crypto.randomUUID() })).status).toBe(400)
    const r = await patch(`/api/sprints/${s}`, owner, { facilitator_id: members[0].account_id })
    expect(r.status).toBe(200)
    expect(r.body.is_facilitator).toBe(false)
    expect(r.body.facilitator_name).toBe('Member 0')
    const asNew = await get(`/api/sprints/${s}`, members[0])
    expect(asNew.body.is_facilitator).toBe(true)
    expect(asNew.body.allowed_transitions).toEqual(['preparing'])
    expect(asNew.body.participants.filter((p: { is_facilitator: boolean }) => p.is_facilitator)).toHaveLength(1)
    // The old facilitator is now an ordinary participant.
    expect((await post(`/api/sprints/${s}/transition`, owner, { to: 'preparing', confirm: true })).status).toBe(403)
    expect((await patch(`/api/sprints/${s}`, owner, { name: 'nope' })).status).toBe(403)
    expect((await get(`/api/sprints/${s}`, owner)).body.allowed_transitions).toEqual([])
    expect((await go(members[0], s, 'preparing')).status).toBe(200)
    // The old facilitator can now be removed by the new one.
    expect((await del(`/api/sprints/${s}/participants/${owner.account_id}`, members[0])).status).toBe(200)
    // The workspace owner still reads the sprint (owner role) but is no longer a participant.
    const asOwner = await get(`/api/sprints/${s}`, owner)
    expect(asOwner.status).toBe(200)
    expect(asOwner.body.is_participant).toBe(false)
  })

  it('invites straight into a sprint', async () => {
    const { owner, members, ws } = await team(1)
    const s = await sprint(owner, members, ws, 'collecting')
    const email = `direct-${tag()}@example.com`
    expect((await post(`/api/workspaces/${ws}/invitations`, owner, { email, sprint_id: s })).status).toBe(200)
    const token = await inviteToken(email)
    const u = await signin(email, 'Direct')
    expect((await post('/api/invitations/accept', u, { token: token })).status).toBe(200)
    expect((await get(`/api/sprints/${s}`, u)).status).toBe(200)
    expect((await get(`/api/sprints/${s}`, u)).body.is_participant).toBe(true)
  })
})
