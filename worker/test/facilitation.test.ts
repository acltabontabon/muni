/** An owner taking over facilitation of a sprint whose facilitator can't carry on (a lost passkey). */
import { describe, expect, it } from 'vitest'
import { del, entry, get, go, post, sprint, team } from './harness'

describe('taking over facilitation', () => {
  it('lets an owner take over, joining the sprint; then the old facilitator can leave or be removed', async () => {
    const { owner, members, ws } = await team(2)
    const [maya, ben] = members
    const s = await sprint(maya, [maya, ben], ws, 'collecting')
    await entry(ben, s, 'improve', 'Reviews waited two days')
    // Stuck: Maya facilitates, so the owner can't remove her, and nobody else can close collection.
    expect((await del(`/api/workspaces/${ws}/members/${maya.account_id}`, owner)).status).toBe(409)
    expect((await go(owner, s, 'preparing')).status).toBe(403)
    // Only owners, and they're told who facilitates now; a plain sprint needs no new key.
    expect((await post(`/api/sprints/${s}/facilitation`, ben, { confirm: true })).status).toBe(403)
    expect((await get(`/api/sprints/${s}/facilitation`, owner)).body).toMatchObject({ facilitator_name: 'Member 0', joins_sprint: true, new_key_version: null, sealed_thoughts: 0 })
    const r = await post(`/api/sprints/${s}/facilitation`, owner, { confirm: true })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.is_facilitator).toBe(true)
    const people = r.body.participants as { account_id: string; is_facilitator: boolean }[]
    expect(people.filter((p) => p.is_facilitator).map((p) => p.account_id)).toEqual([owner.account_id])
    expect(people.map((p) => p.account_id)).toContain(maya.account_id)
    // Maya is an ordinary participant now: her commands are refused, and she can be removed.
    expect((await go(maya, s, 'preparing')).status).toBe(403)
    expect((await go(owner, s, 'preparing')).status).toBe(200)
    expect((await del(`/api/workspaces/${ws}/members/${maya.account_id}`, owner)).status).toBe(200)
  })

  it('refuses a finished sprint, and one you already facilitate', async () => {
    const { owner, members, ws } = await team(1)
    const done = await sprint(owner, members, ws, 'completed')
    const mine = await sprint(owner, members, ws, 'collecting')
    expect((await post(`/api/sprints/${done}/facilitation`, owner, { confirm: true })).status).toBe(409)
    expect((await post(`/api/sprints/${mine}/facilitation`, owner, { confirm: true })).status).toBe(409)
  })
})
