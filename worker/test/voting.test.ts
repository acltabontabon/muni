/** Private prioritisation: budgets, rounds and their interaction with grouping changes. */
import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { closeCollection, del, entry, get, go, patch, post, sprint, team, type User } from './harness'

/** Collecting sprint → ready with `n` themes (one entry each). */
async function readyWithThemes(owner: User, members: User[], ws: string, n: number, extra: Record<string, unknown> = {}) {
  const s = await sprint(owner, members, ws, 'collecting', extra)
  for (let i = 0; i < n; i++) await entry(members[i % members.length], s, 'improve', `entry ${i}`)
  const entries = await closeCollection(owner, s)
  const themes: string[] = []
  for (let i = 0; i < n; i++) {
    const g = await post(`/api/sprints/${s}/themes`, owner, { title: `Theme ${i}`, entry_ids: [entries[i].id] })
    expect(g.status).toBe(200)
    themes.push(g.body.themes.find((t: { title: string }) => t.title === `Theme ${i}`).id)
  }
  expect((await go(owner, s, 'ready')).status).toBe(200)
  return { s, themes, entries }
}

describe('voting', () => {
  it('enforces the budget under concurrent casts', async () => {
    const { owner, members, ws } = await team(1)
    const { s, themes } = await readyWithThemes(owner, members, ws, 5, { vote_budget: 3 })
    expect((await post(`/api/sprints/${s}/votes/rounds`, owner)).status).toBe(200)
    const casts = Array.from({ length: 10 }, (_, i) => post(`/api/sprints/${s}/votes`, members[0], { theme_id: themes[i % 5], cast: true }))
    const results = await Promise.all(casts)
    for (const r of results) expect([200, 409]).toContain(r.status)
    const n = await env.DB.prepare('SELECT count(*) AS n FROM votes WHERE account_id = ? AND round_id IN (SELECT id FROM vote_rounds WHERE sprint_id = ?)').bind(members[0].account_id, s).first<{ n: number }>()
    expect(n!.n).toBeLessThanOrEqual(3)
    expect(n!.n).toBeGreaterThan(0)
    const v = await get(`/api/sprints/${s}/votes`, members[0])
    expect(v.body.current.my_votes.length).toBe(n!.n)
    expect(v.body.current.my_remaining).toBe(3 - n!.n)
    // Spending the last vote leaves an explicit refusal, not a silent drop.
    const unused = themes.filter((t) => !v.body.current.my_votes.includes(t))
    if (v.body.current.my_remaining === 0) {
      const over = await post(`/api/sprints/${s}/votes`, members[0], { theme_id: unused[0], cast: true })
      expect(over.status).toBe(409)
      expect(over.body.error).toContain('used all your votes')
    }
  })

  it('allows one vote per theme, and withdrawing', async () => {
    const { owner, members, ws } = await team(1)
    const { s, themes } = await readyWithThemes(owner, members, ws, 2, { vote_budget: 3 })
    await post(`/api/sprints/${s}/votes/rounds`, owner)
    const first = await post(`/api/sprints/${s}/votes`, members[0], { theme_id: themes[0], cast: true })
    expect(first.status).toBe(200)
    expect(first.body.current.my_votes).toEqual([themes[0]])
    // A second tap on the same theme is a no-op, not a second vote.
    const again = await post(`/api/sprints/${s}/votes`, members[0], { theme_id: themes[0], cast: true })
    expect(again.status).toBe(200)
    expect(again.body.current.my_votes).toEqual([themes[0]])
    expect(again.body.current.my_remaining).toBe(2)
    const withdrawn = await post(`/api/sprints/${s}/votes`, members[0], { theme_id: themes[0], cast: false })
    expect(withdrawn.status).toBe(200)
    expect(withdrawn.body.current.my_votes).toEqual([])
    expect(withdrawn.body.current.my_remaining).toBe(3)
    // Withdrawing what you never cast is harmless; voting on a parked or unknown theme is refused.
    expect((await post(`/api/sprints/${s}/votes`, members[0], { theme_id: themes[1], cast: false })).status).toBe(200)
    expect((await post(`/api/sprints/${s}/votes`, members[0], { theme_id: crypto.randomUUID(), cast: true })).status).toBe(404)
    // Nobody outside the participant list votes.
    const outsider = await team(0)
    expect((await post(`/api/sprints/${s}/votes`, outsider.owner, { theme_id: themes[0], cast: true })).status).toBe(404)
  })

  it('shows totals only after the round closes', async () => {
    const { owner, members, ws } = await team(2)
    const { s, themes } = await readyWithThemes(owner, members, ws, 2)
    // No round yet: casting is refused.
    expect((await post(`/api/sprints/${s}/votes`, members[0], { theme_id: themes[0], cast: true })).status).toBe(409)
    await post(`/api/sprints/${s}/votes/rounds`, owner)
    await post(`/api/sprints/${s}/votes`, members[0], { theme_id: themes[0], cast: true })
    await post(`/api/sprints/${s}/votes`, members[1], { theme_id: themes[0], cast: true })
    await post(`/api/sprints/${s}/votes`, members[1], { theme_id: themes[1], cast: true })
    for (const u of [owner, members[0], members[1]]) {
      const v = await get(`/api/sprints/${s}/votes`, u)
      expect(v.body.current.totals).toBeNull()
      const g = await get(`/api/sprints/${s}/themes`, u)
      for (const t of g.body.themes) expect(t.votes).toBeNull()
    }
    expect((await post(`/api/sprints/${s}/votes/rounds/close`, members[0], { action: 'close' })).status).toBe(403)
    expect((await post(`/api/sprints/${s}/votes/rounds/close`, owner, { action: 'bogus' })).status).toBe(400)
    const closed = await post(`/api/sprints/${s}/votes/rounds/close`, owner, { action: 'close' })
    expect(closed.status).toBe(200)
    expect(closed.body.current).toBeNull()
    expect(closed.body.previous[0].totals).toEqual({ [themes[0]]: 2, [themes[1]]: 1 })
    const g = await get(`/api/sprints/${s}/themes`, members[0])
    expect(g.body.themes.find((t: { id: string }) => t.id === themes[0]).votes).toBe(2)
    expect(g.body.themes.find((t: { id: string }) => t.id === themes[1]).votes).toBe(1)
    // Nothing more can be cast, and closing again is a conflict.
    expect((await post(`/api/sprints/${s}/votes`, members[0], { theme_id: themes[1], cast: true })).status).toBe(409)
    expect((await post(`/api/sprints/${s}/votes/rounds/close`, owner, { action: 'close' })).status).toBe(409)
  })

  it('requires a reason for structural theme changes during an open round, which cancels it', async () => {
    const { owner, members, ws } = await team(1)
    const { s, themes, entries } = await readyWithThemes(owner, members, ws, 2)
    await post(`/api/sprints/${s}/votes/rounds`, owner)
    await post(`/api/sprints/${s}/votes`, members[0], { theme_id: themes[0], cast: true })
    const rev = (await get(`/api/sprints/${s}`, owner)).body.grouping_revision
    // Every structural edit is refused without a reason.
    const refusals = [
      () => post(`/api/sprints/${s}/themes`, owner, { title: 'New' }),
      () => del(`/api/sprints/${s}/themes/${themes[1]}`, owner),
      () => post(`/api/sprints/${s}/themes/${themes[1]}/merge`, owner, { into_theme_id: themes[0] }),
      () => post(`/api/sprints/${s}/themes/${themes[0]}/split`, owner, { title: 'Split', entry_ids: [entries[0].id] }),
      () => post(`/api/sprints/${s}/themes/ungroup`, owner, { entry_ids: [entries[0].id] }),
      () => patch(`/api/sprints/${s}/themes/${themes[1]}`, owner, { entry_ids: [entries[0].id] }),
    ]
    for (const call of refusals) {
      const r = await call()
      expect(r.status).toBe(409)
      expect(r.body.error).toContain('voting round is open')
    }
    expect((await get(`/api/sprints/${s}/themes`, owner)).body.voting_open).toBe(true)
    expect((await get(`/api/sprints/${s}/themes`, owner)).body.themes).toHaveLength(2)
    // Non-structural edits (title, reorder) don't touch the round.
    expect((await patch(`/api/sprints/${s}/themes/${themes[0]}`, owner, { title: 'Renamed' })).status).toBe(200)
    expect((await post(`/api/sprints/${s}/themes/reorder`, owner, { theme_ids: [themes[1], themes[0]] })).status).toBe(200)
    expect((await get(`/api/sprints/${s}/votes`, members[0])).body.current.my_votes).toEqual([themes[0]])
    expect((await get(`/api/sprints/${s}`, owner)).body.grouping_revision).toBe(rev)
    // With a reason: the round is cancelled, the reason is shown, the revision moves on.
    const ok = await post(`/api/sprints/${s}/themes`, owner, { title: 'New', reset_voting_reason: 'merged two overlapping themes' })
    expect(ok.status).toBe(200)
    expect(ok.body.voting_open).toBe(false)
    expect(ok.body.grouping_revision).toBe(rev + 1)
    const v = await get(`/api/sprints/${s}/votes`, members[0])
    expect(v.body.current).toBeNull()
    expect(v.body.previous[0].status).toBe('cancelled')
    expect(v.body.previous[0].cancel_reason).toBe('merged two overlapping themes')
    expect(v.body.previous[0].totals).toBeNull()
    // Without an open round, structural edits need no reason.
    expect((await post(`/api/sprints/${s}/themes`, owner, { title: 'Another' })).status).toBe(200)
  })

  it('rejects votes once the grouping revision moved on', async () => {
    const { owner, members, ws } = await team(1)
    const { s, themes } = await readyWithThemes(owner, members, ws, 1)
    await post(`/api/sprints/${s}/votes/rounds`, owner)
    // Defence in depth: even if a round survived a revision bump, it accepts nothing.
    await env.DB.prepare('UPDATE sprints SET grouping_revision = grouping_revision + 1 WHERE id = ?').bind(s).run()
    const r = await post(`/api/sprints/${s}/votes`, members[0], { theme_id: themes[0], cast: true })
    expect(r.status).toBe(409)
    expect(r.body.error).toContain('themes changed')
    expect((await get(`/api/sprints/${s}/votes`, members[0])).body.current.my_votes).toEqual([])
  })

  it('refuses a second open round and opens only with themes in ready or live', async () => {
    const { owner, members, ws } = await team(1)
    const noThemes = await sprint(owner, members, ws, 'collecting')
    await entry(members[0], noThemes, 'keep', 'x')
    await closeCollection(owner, noThemes)
    expect((await post(`/api/sprints/${noThemes}/votes/rounds`, owner)).status).toBe(409) // preparing
    await go(owner, noThemes, 'ready')
    expect((await post(`/api/sprints/${noThemes}/votes/rounds`, owner)).status).toBe(409) // no themes
    const { s } = await readyWithThemes(owner, members, ws, 1)
    expect((await post(`/api/sprints/${s}/votes/rounds`, members[0])).status).toBe(403)
    expect((await post(`/api/sprints/${s}/votes/rounds`, owner, { budget: 0 })).status).toBe(400)
    expect((await post(`/api/sprints/${s}/votes/rounds`, owner, { budget: 2 })).status).toBe(200)
    const second = await post(`/api/sprints/${s}/votes/rounds`, owner)
    expect(second.status).toBe(409)
    expect(second.body.error).toBe('a voting round is already open')
    // Concurrent opens: still exactly one open round.
    await post(`/api/sprints/${s}/votes/rounds/close`, owner, { action: 'cancel', reason: 'restart' })
    const opens = await Promise.all([1, 2, 3].map(() => post(`/api/sprints/${s}/votes/rounds`, owner)))
    expect(opens.filter((r) => r.status === 200)).toHaveLength(1)
    const open = await env.DB.prepare("SELECT count(*) AS n FROM vote_rounds WHERE sprint_id = ? AND status = 'open'").bind(s).first<{ n: number }>()
    expect(open!.n).toBe(1)
    // The budget can't change while a round is open.
    expect((await patch(`/api/sprints/${s}`, owner, { vote_budget: 5 })).status).toBe(409)
    // After a close, a new round can open (a second round in sequence) with the current budget.
    await post(`/api/sprints/${s}/votes/rounds/close`, owner, { action: 'close' })
    const third = await post(`/api/sprints/${s}/votes/rounds`, owner)
    expect(third.status).toBe(200)
    expect(third.body.current.budget).toBe(3)
    expect(third.body.previous).toHaveLength(2)
  })

  it('suggests an order from the totals on close, sinking parked themes', async () => {
    const { owner, members, ws } = await team(2)
    const { s, themes } = await readyWithThemes(owner, members, ws, 4)
    const [a, b, c, d] = themes
    expect((await patch(`/api/sprints/${s}/themes/${d}`, owner, { parked: true })).status).toBe(200)
    await post(`/api/sprints/${s}/votes/rounds`, owner)
    await post(`/api/sprints/${s}/votes`, members[0], { theme_id: c, cast: true })
    await post(`/api/sprints/${s}/votes`, members[1], { theme_id: c, cast: true })
    await post(`/api/sprints/${s}/votes`, members[0], { theme_id: b, cast: true })
    expect((await post(`/api/sprints/${s}/votes`, members[1], { theme_id: d, cast: true })).status).toBe(404) // parked
    const before = await get(`/api/sprints/${s}/themes`, owner)
    expect(before.body.themes.map((t: { id: string }) => t.id)).toEqual([a, b, c, d])
    await post(`/api/sprints/${s}/votes/rounds/close`, owner, { action: 'close' })
    const after = await get(`/api/sprints/${s}/themes`, owner)
    expect(after.body.themes.map((t: { id: string }) => t.id)).toEqual([c, b, a, d])
    expect(after.body.themes.map((t: { votes: number }) => t.votes)).toEqual([2, 1, 0, 0])
    expect(after.body.themes.map((t: { position: number }) => t.position)).toEqual([0, 1, 2, 3])
  })
})
