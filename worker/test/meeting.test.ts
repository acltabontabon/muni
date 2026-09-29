/** The live stage: versioned commands, the steps and their housekeeping, timer, attendance, context, notes, recovery. */
import { describe, expect, it, vi } from 'vitest'
import { env, runInDurableObject } from 'cloudflare:test'
import { MeetingRoom } from '../src/room'
import { closeCollection, command, entry, get, go, ids, openSocket, patch, post, put, roomCancel, roomPost, roomState, roomWipe, sleep, sprint, team, type User } from './harness'

/** A live sprint with `n` themes (one entry each) and everyone's attendance untouched. */
async function live(owner: User, members: User[], ws: string, n = 2, extra: Record<string, unknown> = {}) {
  const s = await sprint(owner, members, ws, 'collecting', extra)
  for (let i = 0; i < n; i++) await entry(members[i % members.length], s, 'improve', `entry ${i}`)
  const entries = await closeCollection(owner, s)
  const themes: string[] = []
  for (let i = 0; i < n; i++) {
    const g = await post(`/api/sprints/${s}/themes`, owner, { title: `Theme ${i}`, entry_ids: [entries[i].id] })
    themes.push(g.body.themes.find((t: { title: string }) => t.title === `Theme ${i}`).id)
  }
  expect((await go(owner, s, 'ready')).status).toBe(200)
  expect((await go(owner, s, 'live')).status).toBe(200)
  return { s, themes, entries }
}
const snap = (u: User, s: string) => get(`/api/sprints/${s}/meeting`, u)
const present = (u: User, s: string) => post(`/api/sprints/${s}/meeting/attendance`, u, { present: true })
const raw = (u: User, s: string, expected_version: number, cmd: unknown) => post(`/api/sprints/${s}/meeting/command`, u, { expected_version, command: cmd })

describe('meeting', () => {
  it('rejects stale versions and lets exactly one of two conflicting commands win', async () => {
    const { owner, members, ws } = await team(1)
    const { s } = await live(owner, members, ws)
    const first = await snap(owner, s)
    expect(first.status).toBe(200)
    expect(first.body.version).toBe(1)
    expect(first.body.phase).toBe('look_back')
    const stale = await raw(owner, s, 0, { type: 'set_phase', phase: 'choose' })
    expect(stale.status).toBe(409)
    expect(stale.body.error).toContain('changed since you last saw it')
    expect((await snap(owner, s)).body.version).toBe(1)
    const [a, b] = await Promise.all([raw(owner, s, 1, { type: 'set_phase', phase: 'look_back' }), raw(owner, s, 1, { type: 'set_phase', phase: 'agree' })])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    const after = await snap(owner, s)
    expect(after.body.version).toBe(2)
    expect(after.body.phase).toBe(a.status === 200 ? 'look_back' : 'agree')
    // Members never command; unknown phases and commands are 400.
    expect((await raw(members[0], s, 2, { type: 'set_phase', phase: 'talk' })).status).toBe(403)
    expect((await raw(owner, s, 2, { type: 'set_phase', phase: 'lunch' })).status).toBe(400)
    expect((await raw(owner, s, 2, { type: 'teleport' })).status).toBe(400)
    expect((await snap(owner, s)).body.version).toBe(2)
    // Commands need a live sprint.
    const ready = await sprint(owner, members, ws, 'ready')
    expect((await raw(owner, ready, 1, { type: 'set_phase', phase: 'choose' })).status).toBe(409)
    expect((await snap(owner, ready)).status).toBe(404)
  })

  it('drives the steps and a timer whose remaining time derives from one deadline', async () => {
    const { owner, members, ws } = await team(1)
    const { s } = await live(owner, members, ws)
    const phase = await command(owner, s, { type: 'set_phase', phase: 'choose' })
    expect(phase.status).toBe(200)
    expect(phase.body.phase).toBe('choose')
    expect(phase.body.phases).toEqual(['look_back', 'choose', 'talk', 'agree'])
    // Only the talk keeps a clock.
    expect(phase.body.timer).toMatchObject({ running: false, total_secs: 0 })
    const started = await command(owner, s, { type: 'timer_start', secs: 120 })
    expect(started.body.timer.running).toBe(true)
    expect(started.body.timer.total_secs).toBe(120)
    expect(started.body.timer.remaining_secs).toBeGreaterThanOrEqual(118)
    expect(started.body.timer.remaining_secs).toBeLessThanOrEqual(120)
    const deadline = started.body.timer.ends_at as string
    expect(new Date(deadline).getTime() - new Date(started.body.server_time).getTime()).toBeGreaterThan(115_000)
    await sleep(1100)
    const later = await snap(members[0], s)
    expect(later.body.timer.ends_at).toBe(deadline)
    expect(later.body.timer.remaining_secs).toBeLessThan(started.body.timer.remaining_secs)
    expect(later.body.version).toBe(started.body.version)
    const paused = await command(owner, s, { type: 'timer_pause' })
    expect(paused.body.timer.running).toBe(false)
    expect(paused.body.timer.ends_at).toBeNull()
    const frozen = paused.body.timer.remaining_secs as number
    expect(frozen).toBeGreaterThanOrEqual(116)
    await sleep(300)
    expect((await snap(owner, s)).body.timer.remaining_secs).toBe(frozen)
    const resumed = await command(owner, s, { type: 'timer_resume' })
    expect(resumed.body.timer.running).toBe(true)
    expect(Math.abs(resumed.body.timer.remaining_secs - frozen)).toBeLessThanOrEqual(1)
    const adjusted = await command(owner, s, { type: 'timer_adjust', delta_secs: 60 })
    expect(adjusted.body.timer.remaining_secs).toBeGreaterThanOrEqual(frozen + 57)
    expect(adjusted.body.timer.total_secs).toBe(180)
    expect(new Date(adjusted.body.timer.ends_at).getTime()).toBeGreaterThan(new Date(deadline).getTime())
    const cleared = await command(owner, s, { type: 'timer_clear' })
    expect(cleared.body.timer).toEqual({ running: false, ends_at: null, remaining_secs: 0, total_secs: 0 })
    // Clamped inputs, plan edits, and a topic that budgets the talk and starts its clock.
    expect((await command(owner, s, { type: 'timer_start', secs: 1 })).body.timer.total_secs).toBe(10)
    const plan = await command(owner, s, { type: 'set_plan', plan: { talk: 30, look_back: 0 } })
    expect(plan.body.plan.talk).toBe(30)
    expect(plan.body.plan.look_back).toBe(1)
    const topic = await command(owner, s, { type: 'set_topic', theme_id: plan.body.agenda[0].theme_id })
    expect(topic.body.current_theme_id).toBe(plan.body.agenda[0].theme_id)
    expect(topic.body.timer.total_secs).toBe(Math.floor((30 * 60) / 2))
    expect(topic.body.timer.running).toBe(true)
    expect((await command(owner, s, { type: 'set_topic', theme_id: crypto.randomUUID() })).status).toBe(404)
  })

  it('opens the vote on choosing; talking closes it, follows its order and opens the first topic', async () => {
    const { owner, members, ws } = await team(2)
    const { s, themes } = await live(owner, members, ws)
    expect((await get(`/api/sprints/${s}/votes`, members[0])).body.current).toBeNull()
    await command(owner, s, { type: 'set_phase', phase: 'choose' })
    expect((await get(`/api/sprints/${s}/votes`, members[0])).body.current.status).toBe('open')
    for (const u of members) expect((await post(`/api/sprints/${s}/votes`, u, { theme_id: themes[1], cast: true })).status).toBe(200)
    const talk = await command(owner, s, { type: 'set_phase', phase: 'talk' })
    expect(talk.body.agenda.map((a: { theme_id: string }) => a.theme_id)).toEqual([themes[1], themes[0]])
    expect(talk.body.current_theme_id).toBe(themes[1])
    expect(talk.body.timer.running).toBe(true)
    expect(talk.body.discussed_theme_ids).toEqual([themes[1]])
    const votes = await get(`/api/sprints/${s}/votes`, members[0])
    expect(votes.body.current).toBeNull()
    expect(votes.body.previous[0].totals[themes[1]]).toBe(2)
    // Opening a topic counts it as discussed; going back to choose shows the result without reopening the vote.
    const next = await command(owner, s, { type: 'set_topic', theme_id: themes[0] })
    expect(next.body.discussed_theme_ids.sort()).toEqual([...themes].sort())
    expect((await command(owner, s, { type: 'set_phase', phase: 'choose' })).body.timer.total_secs).toBe(0)
    expect((await get(`/api/sprints/${s}/votes`, members[0])).body.current).toBeNull()
    // Back to the talk: the topic in hand stays open.
    expect((await command(owner, s, { type: 'set_phase', phase: 'talk' })).body.current_theme_id).toBe(themes[0])
  })

  it('without themes, goes from looking back to talking through the thoughts as they are', async () => {
    const { owner, members, ws } = await team(1)
    const s = await sprint(owner, members, ws, 'collecting')
    await entry(members[0], s, 'improve', 'one thought')
    await closeCollection(owner, s)
    expect((await go(owner, s, 'live')).status).toBe(200)
    expect((await snap(owner, s)).body.phases).toEqual(['look_back', 'talk', 'agree'])
    const talk = await command(owner, s, { type: 'set_phase', phase: 'talk' })
    expect(talk.body.current_theme_id).toBe('ungrouped')
    expect(talk.body.agenda).toEqual([])
    expect((await get(`/api/sprints/${s}/votes`, owner)).body.current).toBeNull()
  })

  it('leaves the stage to the new facilitator after a handover, though the old one is still connected', async () => {
    const { owner, members, ws } = await team(1)
    const { s } = await live(owner, members, ws)
    const before = await snap(owner, s)
    expect(before.body.you_control).toBe(true)
    expect(before.body.controller_stale).toBe(true) // no socket yet
    const { socket, waitFor } = await openSocket(owner, s)
    await waitFor((m) => m.includes('"hello"'))
    expect((await snap(owner, s)).body.controller_stale).toBe(false)
    // Facilitation moves to a member while the old facilitator is still connected, as a participant now.
    expect((await patch(`/api/sprints/${s}`, owner, { facilitator_id: members[0].account_id })).status).toBe(200)
    expect((await roomState(s)).meeting.controller_account_id).toBeNull()
    const next = await command(members[0], s, { type: 'set_phase', phase: 'choose' })
    expect(next.status).toBe(200)
    expect(next.body.you_control).toBe(true)
    expect(next.body.controller_name).toBe('Member 0')
    expect((await command(owner, s, { type: 'set_phase', phase: 'talk' })).status).toBe(403)
    // A controller who no longer facilitates holds nothing, even if the room still names them.
    await runInDurableObject(env.ROOMS.get(env.ROOMS.idFromName(s)), async (_room, state) => {
      const m = (await state.storage.get<Record<string, unknown>>('meeting'))!
      await state.storage.put('meeting', { ...m, controller_account_id: owner.account_id })
    })
    expect((await command(members[0], s, { type: 'set_phase', phase: 'look_back' })).status).toBe(200)
    // Taking control stays a command anyone facilitating may send.
    expect((await command(members[0], s, { type: 'take_control' })).status).toBe(200)
    socket.close()
  })

  it('requires an explicit take_control while another facilitator is connected and controlling', async () => {
    const { owner, members, ws } = await team(1)
    const { s } = await live(owner, members, ws)
    // Another facilitator's open socket, controlling the stage (as two facilitators' screens would).
    const other = await env.ROOMS.get(env.ROOMS.idFromName(s)).fetch('https://room/ws', { headers: { upgrade: 'websocket', 'x-muni-account': members[0].account_id, 'x-muni-fac': '1', 'x-muni-at': String(Date.now()) } })
    other.webSocket!.accept()
    await runInDurableObject(env.ROOMS.get(env.ROOMS.idFromName(s)), async (_room, state) => {
      const m = (await state.storage.get<Record<string, unknown>>('meeting'))!
      await state.storage.put('meeting', { ...m, controller_account_id: members[0].account_id })
    })
    const blocked = await command(owner, s, { type: 'set_phase', phase: 'choose' })
    expect(blocked.status).toBe(409)
    expect(blocked.body.error).toContain('take control')
    // Refused by the stage, so D1 is untouched: no vote was opened.
    expect(Number((await env.DB.prepare('SELECT count(*) AS n FROM vote_rounds WHERE sprint_id = ?').bind(s).first<{ n: number }>())!.n)).toBe(0)
    const taken = await command(owner, s, { type: 'take_control' })
    expect(taken.status).toBe(200)
    expect(taken.body.you_control).toBe(true)
    expect((await command(owner, s, { type: 'set_phase', phase: 'choose' })).status).toBe(200)
    other.webSocket!.close()
  })

  it('marks who is here: people themselves, or the facilitator correcting it', async () => {
    const { owner, members, ws } = await team(2)
    const { s } = await live(owner, members, ws)
    await present(members[0], s)
    const att = (await snap(owner, s)).body.attendance as { account_id: string; present: boolean }[]
    expect(att.find((a) => a.account_id === members[0].account_id)!.present).toBe(true)
    expect(att.find((a) => a.account_id === members[1].account_id)!.present).toBe(false)
    expect((await post(`/api/sprints/${s}/meeting/attendance/${members[1].account_id}`, members[0], { present: true })).status).toBe(403)
    await post(`/api/sprints/${s}/meeting/attendance/${members[1].account_id}`, owner, { present: true })
    // Arriving doesn't turn the facilitator's next command into a conflict.
    const v = (await snap(owner, s)).body.version
    await present(members[1], s)
    expect((await raw(owner, s, v, { type: 'set_phase', phase: 'choose' })).status).toBe(200)
    const after = (await snap(members[1], s)).body
    expect(after.attendance.every((a: { present: boolean; is_facilitator: boolean }) => a.present || a.is_facilitator)).toBe(true)
    // Nothing about speaking turns or readiness remains in the snapshot.
    expect(after).not.toHaveProperty('speaking')
    expect(after.attendance[0]).not.toHaveProperty('ready')
    expect((await command(owner, s, { type: 'speaking_start' })).status).toBe(400)
    expect((await post(`/api/sprints/${s}/meeting/pass`, members[0])).status).toBe(404)
  })

  it('collects context privately and reveals it under the theme only on release', async () => {
    const { owner, members, ws } = await team(2)
    const { s, themes } = await live(owner, members, ws)
    const add = (u: User, body: Record<string, unknown>) => post(`/api/sprints/${s}/meeting/context`, u, body)
    expect((await add(members[0], { theme_id: crypto.randomUUID(), body: 'x' })).status).toBe(404)
    expect((await add(members[0], { theme_id: themes[0], body: '   ' })).status).toBe(400)
    const key = crypto.randomUUID()
    const one = await add(members[0], { theme_id: themes[0], body: 'ctx-needle', idempotency_key: key })
    expect(one.status).toBe(200)
    const two = await add(members[0], { theme_id: themes[0], body: 'ctx-needle', idempotency_key: key })
    expect(two.status).toBe(200)
    expect(two.body.my_context).toHaveLength(1)
    expect(two.body.my_context[0]).toMatchObject({ theme_id: themes[0], body: 'ctx-needle', released: false })
    const n = await env.DB.prepare('SELECT count(*) AS n FROM context_additions WHERE sprint_id = ?').bind(s).first<{ n: number }>()
    expect(n!.n).toBe(1)
    // Invisible to others until release; the facilitator only learns that something waits.
    expect((await snap(members[1], s)).body.my_context).toEqual([])
    expect((await snap(members[1], s)).body.has_unreleased_context).toBeNull()
    expect((await snap(owner, s)).body.has_unreleased_context).toBe(true)
    const themesBefore = await get(`/api/sprints/${s}/themes`, members[1])
    expect(themesBefore.body.themes.find((t: { id: string }) => t.id === themes[0]).context).toEqual([])
    expect(JSON.stringify(themesBefore.body)).not.toContain('ctx-needle')
    expect((await command(members[1], s, { type: 'release_context' })).status).toBe(403)
    const released = await command(owner, s, { type: 'release_context' })
    expect(released.status).toBe(200)
    expect(released.body.has_unreleased_context).toBe(false)
    const themesAfter = await get(`/api/sprints/${s}/themes`, members[1])
    const ctx = themesAfter.body.themes.find((t: { id: string }) => t.id === themes[0]).context
    expect(ctx).toHaveLength(1)
    expect(ctx[0].body).toBe('ctx-needle')
    expect(Object.keys(ctx[0]).sort()).toEqual(['body', 'id', 'kind'])
    // An addition may say what it is; only the three kinds.
    expect((await add(members[1], { theme_id: themes[0], body: 'q', kind: 'rant' })).status).toBe(400)
    expect((await add(members[1], { theme_id: themes[0], body: 'Did anyone check the old cluster?', kind: 'question' })).body.my_context[0]).toMatchObject({ kind: 'question', released: false })
    expect((await snap(members[0], s)).body.my_context[0].released).toBe(true)
    // Context is a live-only affordance.
    const ready = await sprint(owner, members, ws, 'ready')
    expect((await add(members[0], { theme_id: themes[0], body: 'nope' })).status).toBe(200) // still live here
    expect((await post(`/api/sprints/${ready}/meeting/context`, members[0], { theme_id: themes[0], body: 'nope' })).status).toBe(409)
  })

  it('stores the facilitator’s takeaway and notes per theme, merging partial updates', async () => {
    const { owner, members, ws } = await team(1)
    const { s, themes } = await live(owner, members, ws)
    expect((await put(`/api/sprints/${s}/meeting/notes/${themes[0]}`, members[0], { takeaway: 'no' })).status).toBe(403)
    expect((await put(`/api/sprints/${s}/meeting/notes/${crypto.randomUUID()}`, owner, { takeaway: 'no' })).status).toBe(404)
    await command(owner, s, { type: 'set_topic', theme_id: themes[0] })
    const saved = await put(`/api/sprints/${s}/meeting/notes/${themes[0]}`, owner, { takeaway: 'We agreed to pair on reviews', notes: 'long discussion' })
    expect(saved.status).toBe(200)
    expect(saved.body.notes).toMatchObject({ takeaway: 'We agreed to pair on reviews', notes: 'long discussion', impact: '', discussed: true })
    const partial = await put(`/api/sprints/${s}/meeting/notes/${themes[0]}`, owner, { impact: 'fewer stalls' })
    expect(partial.body.notes).toMatchObject({ takeaway: 'We agreed to pair on reviews', notes: 'long discussion', impact: 'fewer stalls' })
    const g = await get(`/api/sprints/${s}/themes`, members[0])
    expect(g.body.themes.find((t: { id: string }) => t.id === themes[0]).takeaway).toBe('We agreed to pair on reviews')
    expect(g.body.themes.find((t: { id: string }) => t.id === themes[0]).discussed).toBe(true)
    const could = await put(`/api/sprints/${s}/meeting/notes/${themes[0]}`, owner, { could_try: 'Pair on the first review' })
    expect(could.body.notes.could_try).toBe('Pair on the first review')
    expect((await get(`/api/sprints/${s}/themes`, members[0])).body.themes.find((t: { id: string }) => t.id === themes[0]).could_try).toBe('Pair on the first review')
    const unmarked = await command(owner, s, { type: 'mark_discussed', theme_id: themes[0], discussed: false })
    expect(unmarked.body.discussed_theme_ids).toEqual([])
    expect(unmarked.body.notes.discussed).toBe(false)
    // Notes for a theme that isn't the current topic are kept but not shown on stage.
    await put(`/api/sprints/${s}/meeting/notes/${themes[1]}`, owner, { takeaway: 'other' })
    expect((await snap(owner, s)).body.notes.takeaway).toBe('We agreed to pair on reviews')
  })

  it('serves one authoritative snapshot to everyone and re-initialises a wiped room', async () => {
    const { owner, members, ws } = await team(2)
    const { s } = await live(owner, members, ws)
    await command(owner, s, { type: 'set_phase', phase: 'agree' })
    await command(owner, s, { type: 'timer_start', secs: 300 })
    const a = await snap(owner, s)
    const b = await snap(members[0], s)
    const c = await snap(members[1], s)
    for (const v of [b, c]) {
      expect(v.status).toBe(200)
      expect(v.body.version).toBe(a.body.version)
      expect(v.body.session_id).toBe(a.body.session_id)
      expect(v.body.phase).toBe('agree')
      expect(v.body.timer.ends_at).toBe(a.body.timer.ends_at)
      expect(v.body.agenda).toEqual(a.body.agenda)
      expect(v.body.is_facilitator).toBe(false)
    }
    expect(a.body.version).toBe(3)
    // The room forgets its session (e.g. a failed start): the next read rebuilds a fresh one from D1.
    await roomWipe(s)
    const fresh = await snap(members[0], s)
    expect(fresh.status).toBe(200)
    expect(fresh.body.version).toBe(1)
    expect(fresh.body.phase).toBe('look_back')
    expect(fresh.body.cancelled).toBe(false)
    expect(fresh.body.ended_at).toBeNull()
    expect(fresh.body.timer.running).toBe(false)
    expect(fresh.body.agenda).toEqual(a.body.agenda)
    expect((await snap(owner, s)).body.version).toBe(1)
    expect((await get(`/api/sprints/${s}`, owner)).body.status).toBe('live')
    // A read racing the retro's cancellation — the room has cancelled it, D1 still says live —
    // doesn't bring it back.
    await roomCancel(s)
    expect((await snap(members[0], s)).body.cancelled).toBe(true)
    expect((await roomState(s)).meeting.cancelled).toBe(true)
    // Cancelling the session from the lifecycle (live → ready) ends it; going live again starts a fresh one.
    await command(owner, s, { type: 'set_phase', phase: 'talk' })
    expect((await go(owner, s, 'ready')).status).toBe(200)
    const cancelled = await snap(owner, s)
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.cancelled).toBe(true)
    expect(cancelled.body.ended_at).not.toBeNull()
    expect((await get(`/api/sprints/${s}`, owner)).body.session_cancelled).toBe(true)
    expect((await command(owner, s, { type: 'set_phase', phase: 'look_back' })).status).toBe(409)
    expect((await go(owner, s, 'live')).status).toBe(200)
    const restarted = await snap(owner, s)
    expect(restarted.body.version).toBe(1)
    expect(restarted.body.cancelled).toBe(false)
    expect(restarted.body.phase).toBe('look_back')
    expect((await go(owner, s, 'completed')).status).toBe(200)
    const ended = await snap(members[0], s)
    expect(ended.status).toBe(200)
    expect(ended.body.ended_at).not.toBeNull()
    expect(ended.body.phase).toBe('agree')
    expect((await command(owner, s, { type: 'set_phase', phase: 'look_back' })).status).toBe(409)
  })

  it('leaves D1 alone when the stage refuses a command', async () => {
    const { owner, members, ws } = await team(2)
    const { s, themes } = await live(owner, members, ws)
    const count = async (sql: string) => Number((await env.DB.prepare(sql).bind(s).first<{ n: number }>())!.n)
    const rounds = () => count("SELECT count(*) AS n FROM vote_rounds WHERE sprint_id = ? AND status = 'open'")
    const discussed = () => count('SELECT count(*) AS n FROM discussion_notes WHERE sprint_id = ? AND discussed = 1')
    // A stale "choose" opens no vote.
    const v1 = (await snap(owner, s)).body.version
    expect((await raw(owner, s, v1 - 1, { type: 'set_phase', phase: 'choose' })).status).toBe(409)
    expect(await count('SELECT count(*) AS n FROM vote_rounds WHERE sprint_id = ?')).toBe(0)
    expect((await command(owner, s, { type: 'set_phase', phase: 'choose' })).status).toBe(200)
    expect(await rounds()).toBe(1)
    await post(`/api/sprints/${s}/votes`, members[0], { theme_id: themes[1], cast: true })
    // A stale "talk" neither closes the vote (nor reorders the themes) nor marks a topic discussed;
    // nor does a stale topic.
    const v = (await snap(owner, s)).body.version
    const order = (await get(`/api/sprints/${s}/themes`, owner)).body.themes.map((t: { id: string }) => t.id)
    const stale = await raw(owner, s, v - 1, { type: 'set_phase', phase: 'talk' })
    expect(stale.status).toBe(409)
    expect(stale.body.error).toContain('changed since you last saw it')
    expect((await raw(owner, s, v - 1, { type: 'set_topic', theme_id: themes[0] })).status).toBe(409)
    expect(await rounds()).toBe(1)
    expect(await discussed()).toBe(0)
    expect((await get(`/api/sprints/${s}/themes`, owner)).body.themes.map((t: { id: string }) => t.id)).toEqual(order)
    // While another command holds the stage (its D1 changes under way), everything else waits.
    expect((await roomPost(s, '/claim', { account: owner.account_id, expected_version: v, type: 'set_phase' })).status).toBe(200)
    const held = await raw(owner, s, v, { type: 'set_phase', phase: 'talk' })
    expect(held.status).toBe(409)
    expect(held.body.error).toContain('changing')
    expect(await rounds()).toBe(1)
    // A hold whose request never finished lapses on its own.
    await runInDurableObject(env.ROOMS.get(env.ROOMS.idFromName(s)), async (_room, state) => {
      const m = (await state.storage.get<{ claim: { until: number } }>('meeting'))!
      await state.storage.put('meeting', { ...m, claim: { ...m.claim, until: Date.now() - 1 } })
    })
    const talk = await raw(owner, s, v, { type: 'set_phase', phase: 'talk' })
    expect(talk.status).toBe(200)
    expect(talk.body.agenda.map((a: { theme_id: string }) => a.theme_id)).toEqual([themes[1], themes[0]])
    expect(await rounds()).toBe(0)
    expect(await discussed()).toBe(1)
  })

  it('after a handover, lets one of two commands through and closes the vote once', async () => {
    const { owner, members, ws } = await team(2)
    const { s, themes } = await live(owner, members, ws)
    const { socket } = await openSocket(owner, s)
    await sleep(100)
    expect((await patch(`/api/sprints/${s}`, owner, { facilitator_id: members[0].account_id })).status).toBe(200)
    expect((await command(members[0], s, { type: 'set_phase', phase: 'choose' })).status).toBe(200)
    await post(`/api/sprints/${s}/votes`, members[1], { theme_id: themes[0], cast: true })
    // Two commands at once: one goes ahead, and the vote is closed once.
    const v = (await snap(members[0], s)).body.version
    const both = await Promise.all([raw(members[0], s, v, { type: 'set_phase', phase: 'talk' }), raw(members[0], s, v, { type: 'set_phase', phase: 'agree' })])
    expect(both.map((r) => r.status).sort()).toEqual([200, 409])
    expect(Number((await env.DB.prepare("SELECT count(*) AS n FROM audit_events WHERE sprint_id = ? AND action = 'votes.round_closed'").bind(s).first<{ n: number }>())!.n)).toBe(1)
    expect((await snap(members[0], s)).body.version).toBe(v + 1)
    socket.close()
  })

  it('asks the room twice for a step — hold, then apply and announce — and reads nothing back', async () => {
    const { owner, members, ws } = await team(1)
    const { s } = await live(owner, members, ws)
    const v = (await snap(owner, s)).body.version
    const paths: string[] = []
    const real = MeetingRoom.prototype.fetch
    const spy = vi.spyOn(MeetingRoom.prototype, 'fetch').mockImplementation(function (this: MeetingRoom, r: Request) {
      paths.push(new URL(r.url).pathname)
      return real.call(this, r)
    })
    try {
      const talk = await raw(owner, s, v, { type: 'set_phase', phase: 'talk' })
      expect(talk.status).toBe(200)
      expect(talk.body.phase).toBe('talk')
    } finally {
      spy.mockRestore()
    }
    expect(paths).toEqual(['/claim', '/command'])
  })

  it('validates agenda items against the sprint’s themes', async () => {
    const { owner, members, ws } = await team(1)
    const { s, themes } = await live(owner, members, ws)
    const r = await command(owner, s, { type: 'set_agenda', items: [{ theme_id: themes[1], reason: 'most votes' }, { theme_id: crypto.randomUUID() }, { theme_id: themes[0] }] })
    expect(r.status).toBe(200)
    expect(r.body.agenda).toEqual([{ theme_id: themes[1], reason: 'most votes' }, { theme_id: themes[0], reason: null }])
    void ids
  })

  it('coming back to the talk keeps its agenda, its reasons, what’s been discussed and the topic in hand', async () => {
    const { owner, members, ws } = await team(1)
    const { s, themes } = await live(owner, members, ws)
    const talk = await command(owner, s, { type: 'set_phase', phase: 'talk' })
    const first = talk.body.current_theme_id as string
    expect(talk.body.discussed_theme_ids).toEqual([first])
    const second = themes.find((t) => t !== first)!
    const agenda = [{ theme_id: second, reason: 'the team asked for it' }, { theme_id: first, reason: null }]
    expect((await command(owner, s, { type: 'set_agenda', items: agenda })).body.agenda).toEqual(agenda)
    // The first topic turns out not to have been discussed after all.
    expect((await command(owner, s, { type: 'mark_discussed', theme_id: first, discussed: false })).body.discussed_theme_ids).toEqual([])
    await command(owner, s, { type: 'set_phase', phase: 'agree' })
    const back = await command(owner, s, { type: 'set_phase', phase: 'talk' })
    expect(back.status).toBe(200)
    expect(back.body.agenda).toEqual(agenda)
    expect(back.body.current_theme_id).toBe(first)
    expect(back.body.discussed_theme_ids).toEqual([])
  })

  it('keeps a topic’s clock while the room steps away from the talk, and brings it back paused', async () => {
    const { owner, members, ws } = await team(1)
    const { s } = await live(owner, members, ws)
    const talk = await command(owner, s, { type: 'set_phase', phase: 'talk' })
    const total = talk.body.timer.total_secs as number
    expect(total).toBeGreaterThan(0)
    const plus = await command(owner, s, { type: 'timer_adjust', delta_secs: 120 })
    const left = plus.body.timer.remaining_secs as number
    // Elsewhere, only the talk keeps a clock.
    expect((await command(owner, s, { type: 'set_phase', phase: 'agree' })).body.timer).toMatchObject({ running: false, total_secs: 0 })
    await sleep(1100)
    const back = await command(owner, s, { type: 'set_phase', phase: 'talk' })
    expect(back.body.timer.running).toBe(false)
    expect(back.body.timer.total_secs).toBe(total + 120)
    expect(Math.abs(back.body.timer.remaining_secs - left)).toBeLessThanOrEqual(1)
    // …so the facilitator can resume it, or give it more.
    expect((await command(owner, s, { type: 'timer_adjust', delta_secs: 120 })).body.timer.remaining_secs).toBe(back.body.timer.remaining_secs + 120)
    const resumed = await command(owner, s, { type: 'timer_resume' })
    expect(resumed.body.timer.running).toBe(true)
    // Another topic opens with its own clock; the kept one doesn't come back for it.
    await command(owner, s, { type: 'set_phase', phase: 'agree' })
    const other = (await snap(owner, s)).body.agenda.map((a: { theme_id: string }) => a.theme_id).find((id: string) => id !== back.body.current_theme_id)
    await command(owner, s, { type: 'set_topic', theme_id: other })
    expect((await command(owner, s, { type: 'set_phase', phase: 'talk' })).body.timer.total_secs).not.toBe(total + 240)
  })

  it('adds time to what’s left, even long after it ran out, and resuming at zero starts the timebox again', async () => {
    const { owner, members, ws } = await team(1)
    const { s } = await live(owner, members, ws)
    const talk = await command(owner, s, { type: 'set_phase', phase: 'talk' })
    const per = talk.body.timer.total_secs as number
    // Five minutes over.
    await runInDurableObject(env.ROOMS.get(env.ROOMS.idFromName(s)), async (_room, state) => {
      const m = (await state.storage.get<Record<string, unknown>>('meeting'))!
      await state.storage.put('meeting', { ...m, timer_ends_at: Date.now() - 5 * 60_000 })
    })
    expect((await snap(owner, s)).body.timer.remaining_secs).toBe(0)
    const plus = await command(owner, s, { type: 'timer_adjust', delta_secs: 120 })
    expect(plus.body.timer.running).toBe(true)
    expect(plus.body.timer.remaining_secs).toBeGreaterThanOrEqual(118)
    expect(plus.body.timer.remaining_secs).toBeLessThanOrEqual(120)
    // Paused, +2 adds to what's left too.
    const paused = await command(owner, s, { type: 'timer_pause' })
    expect((await command(owner, s, { type: 'timer_adjust', delta_secs: 120 })).body.timer.remaining_secs).toBe(paused.body.timer.remaining_secs + 120)
    // Run out and paused at zero: resuming gives the topic its time back rather than doing nothing.
    await command(owner, s, { type: 'timer_adjust', delta_secs: -3600 })
    expect((await snap(owner, s)).body.timer).toMatchObject({ running: false, remaining_secs: 0 })
    const resumed = await command(owner, s, { type: 'timer_resume' })
    expect(resumed.body.timer.running).toBe(true)
    expect(resumed.body.timer.total_secs).toBe(per)
    expect(resumed.body.timer.remaining_secs).toBeGreaterThanOrEqual(per - 2)
  })

  it('a room told to forget its retro closes every connection, as ended', async () => {
    const { owner, members, ws } = await team(1)
    const { s } = await live(owner, members, ws)
    const sockets = await Promise.all([openSocket(owner, s), openSocket(members[0], s)])
    await Promise.all(sockets.map((x) => x.waitFor((m) => m.includes('"hello"'))))
    const codes = sockets.map((x) => new Promise<number>((resolve) => x.socket.addEventListener('close', (e) => resolve(e.code))))
    expect((await roomPost(s, '/forget')).status).toBe(200)
    const closed = await Promise.race([Promise.all(codes), sleep(3000).then(() => null)])
    expect(closed).toEqual([4003, 4003])
    expect((await roomState(s)).meeting).toBeNull()
  })

  it('remembers a handover in storage, so a room woken from eviction still refuses a stale facilitator socket', async () => {
    const { owner, members, ws } = await team(2)
    const { s, themes } = await live(owner, members, ws)
    const before = Date.now()
    expect((await patch(`/api/sprints/${s}`, owner, { facilitator_id: members[0].account_id })).status).toBe(200)
    // Evicted: nothing the object held in memory survives.
    const stub = env.ROOMS.get(env.ROOMS.idFromName(s))
    await runInDurableObject(stub, (room) => {
      ;(room as unknown as Record<string, unknown>).handover = null
    })
    // The old facilitator's reconnect, checked against D1 just before the handover was saved.
    const res = await stub.fetch('https://room/ws', { headers: { upgrade: 'websocket', 'x-muni-account': owner.account_id, 'x-muni-fac': '1', 'x-muni-at': String(before - 1) } })
    const stale = res.webSocket!
    stale.accept()
    const messages: string[] = []
    stale.addEventListener('message', (e) => messages.push(String(e.data)))
    // Opening the vote is news for everyone; a vote coming in is the facilitator's alone.
    expect((await post(`/api/sprints/${s}/votes/rounds`, members[0])).status).toBe(200)
    await sleep(200)
    const mark = messages.length
    expect((await post(`/api/sprints/${s}/votes`, members[1], { theme_id: themes[0], cast: true })).status).toBe(200)
    await sleep(300)
    expect(messages.slice(mark).some((m) => m.includes('"resource":"votes"'))).toBe(false)
    stale.close()
  })

  it('ends the retro in D1 even when the room can’t be reached, and the room catches up on the next read', async () => {
    const { owner, members, ws } = await team(1)
    for (const [to, path] of [['ready', '/cancel'], ['completed', '/end']] as const) {
      const { s } = await live(owner, members, ws)
      const real = MeetingRoom.prototype.fetch
      const spy = vi.spyOn(MeetingRoom.prototype, 'fetch').mockImplementation(function (this: MeetingRoom, r: Request) {
        if (new URL(r.url).pathname === path) throw new Error('the room is unreachable')
        return real.call(this, r)
      })
      try {
        const moved = await go(owner, s, to)
        expect(moved.status).toBe(200)
        expect(moved.body.status).toBe(to)
      } finally {
        spy.mockRestore()
      }
      const audited = await env.DB.prepare("SELECT count(*) AS n FROM audit_events WHERE sprint_id = ? AND action = 'sprint.transition' AND meta = ?").bind(s, JSON.stringify({ from: 'live', to })).first<{ n: number }>()
      expect(audited!.n).toBe(1)
      // The room didn't hear it: it still holds a running retro…
      const stale = (await roomState(s)).meeting
      expect(stale.ended_at).toBeNull()
      // …until the stage is read, which sees D1 and tells the room.
      const seen = await snap(owner, s)
      expect(seen.status).toBe(200)
      expect(seen.body.ended_at).not.toBeNull()
      expect(seen.body.cancelled).toBe(to === 'ready')
      expect((await roomState(s)).meeting.ended_at).not.toBeNull()
    }
  })
})
