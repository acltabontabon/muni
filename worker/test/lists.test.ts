/** Sprint lists: every sprint's per-person fields are right, whatever the list's size (one query for the whole list). */
import { describe, expect, it } from 'vitest'
import { get, patch, sprint, team } from './harness'

describe('sprint lists', () => {
  it('summarises each sprint for the person asking: counts, facilitator, participation and reminders', async () => {
    const { owner, members, ws } = await team(2)
    const [a, b] = members
    // Owner facilitates both; `a` is in the first only; `b` in neither.
    const first = await sprint(owner, [a], ws, 'collecting', { name: 'With A' })
    const second = await sprint(owner, [], ws, 'draft', { name: 'Owner only', starts_on: '2026-09-28', ends_on: '2026-10-09', retro_date: '2026-10-09' })
    expect((await patch(`/api/sprints/${first}/me`, a, { reminders_opt_out: true })).status).toBe(200)

    const as = async (u: typeof owner) => Object.fromEntries(((await get<any[]>(`/api/workspaces/${ws}/sprints`, u)).body).map((s) => [s.id, s]))
    const byOwner = await as(owner)
    expect(byOwner[first]).toMatchObject({ name: 'With A', participant_count: 2, facilitator_name: 'Owner', is_facilitator: true, is_participant: true, my_reminders_opt_out: false, allowed_transitions: ['preparing'] })
    expect(byOwner[second]).toMatchObject({ participant_count: 1, facilitator_name: 'Owner', is_facilitator: true, is_participant: true, allowed_transitions: ['collecting'] })
    // Newest first.
    expect((await get<any[]>(`/api/workspaces/${ws}/sprints`, owner)).body.map((s) => s.id)).toEqual([second, first])

    const byA = await as(a)
    expect(byA[first]).toMatchObject({ participant_count: 2, facilitator_name: 'Owner', is_facilitator: false, is_participant: true, my_reminders_opt_out: true, allowed_transitions: [] })
    expect(byA[second]).toMatchObject({ is_facilitator: false, is_participant: false, my_reminders_opt_out: false })

    const byB = await as(b)
    expect(byB[first]).toMatchObject({ is_participant: false, is_facilitator: false, my_reminders_opt_out: false })

    // The single-sprint view agrees with the list.
    const d = (await get<any>(`/api/sprints/${first}`, a)).body
    expect(d).toMatchObject({ participant_count: 2, facilitator_name: 'Owner', is_participant: true, is_facilitator: false, my_reminders_opt_out: true, workspace_name: expect.stringMatching(/^Team /) })
    expect(d.participants).toHaveLength(2)

    // Where to write: only sprints the person is in.
    const target = (await get<any>('/api/me/capture-target', a)).body
    expect(target.collecting.map((s: any) => s.id)).toEqual([first])
    expect((await get<any>('/api/me/capture-target', b)).body.collecting).toEqual([])
  })
})
