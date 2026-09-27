import { describe, expect, it } from 'vitest'
import { confirmCopy, PHASE_OF, sprintPlan, type Action, type PlanInput } from './lifecycle'

// The server's rule (worker/src/routes/sprints.ts allowedTransitions), mirrored for the fixtures.
const SERVER: Record<string, string[]> = {
  draft: ['collecting'],
  collecting: ['preparing'],
  preparing: ['live', 'collecting', 'ready'],
  ready: ['live', 'collecting', 'preparing'],
  live: ['completed', 'ready'],
  completed: ['archived'],
}
const STATES = ['draft', 'collecting', 'preparing', 'ready', 'live', 'completed', 'archived']
const future = new Date(Date.now() + 7 * 86_400_000).toISOString()

function sprint(status: string, role: 'facilitator' | 'member' | 'outsider', extra: Partial<PlanInput> = {}): PlanInput {
  const fac = role === 'facilitator'
  return {
    id: 's1',
    status,
    is_facilitator: fac,
    is_participant: role !== 'outsider',
    allowed_transitions: fac ? SERVER[status] ?? [] : [],
    entry_count: status === 'draft' || status === 'collecting' ? null : 5,
    theme_count: 2,
    retro_at: future,
    timezone: 'Asia/Manila',
    participant_count: 4,
    ...extra,
  }
}
const all = (p: ReturnType<typeof sprintPlan>): Action[] => [...(p.control ? [p.control] : []), ...p.secondary, ...p.more]
const transitions = (p: ReturnType<typeof sprintPlan>) => all(p).filter((a) => a.kind === 'transition')

describe('role boundaries', () => {
  it('never offers a member or an outsider a state change, or any control, in any state', () => {
    for (const st of STATES)
      for (const role of ['member', 'outsider'] as const) {
        const p = sprintPlan(sprint(st, role))
        expect(transitions(p), `${st}/${role}`).toHaveLength(0)
        expect(p.control, `${st}/${role}`).toBeNull()
        expect(p.more, `${st}/${role}`).toHaveLength(0)
      }
  })
  it('offers the facilitator only what the server allows', () => {
    for (const st of STATES) for (const a of transitions(sprintPlan(sprint(st, 'facilitator')))) expect(SERVER[st], st).toContain((a as { to: string }).to)
    const p = sprintPlan(sprint('collecting', 'facilitator', { allowed_transitions: [] }))
    expect(p.control).toBeNull()
  })
})

describe('the lifecycle people see', () => {
  it('has five phases; preparing and ready are the same "closed"', () => {
    expect(new Set(STATES.map((s) => PHASE_OF[s]))).toEqual(new Set(['draft', 'collecting', 'closed', 'live', 'done']))
    expect(PHASE_OF.preparing).toBe(PHASE_OF.ready)
    expect(sprintPlan(sprint('ready', 'facilitator')).status).toBe(sprintPlan(sprint('preparing', 'facilitator')).status)
  })
  it('draws three stops, the current one marked, and never as links', () => {
    const at = (st: string) => sprintPlan(sprint(st, 'member')).progress.map((p) => p.state)
    expect(at('draft')).toEqual(['now', 'next', 'next'])
    expect(at('collecting')).toEqual(['now', 'next', 'next'])
    expect(at('preparing')).toEqual(['done', 'next', 'next'])
    expect(at('live')).toEqual(['done', 'now', 'next'])
    expect(at('completed')).toEqual(['done', 'done', 'now'])
  })
  it('keeps the planned retro date apart from the retro starting', () => {
    const retro = (st: string) => sprintPlan(sprint(st, 'member')).progress[1].detail
    expect(retro('collecting')).toMatch(/^Planned /)
    expect(retro('preparing')).toMatch(/^Planned /)
    expect(retro('live')).toBe('In progress')
  })
})

describe('facilitator control', () => {
  it('opens collection from a draft, and says what that does', () => {
    const p = sprintPlan(sprint('draft', 'facilitator'))
    expect(p.control).toMatchObject({ kind: 'transition', to: 'collecting' })
    expect(p.consequence).toMatch(/start adding thoughts/)
  })
  it('closes collection as the one primary action, any time, with a confirmation and no jump elsewhere', () => {
    const p = sprintPlan(sprint('collecting', 'facilitator'))
    expect(p.control).toMatchObject({ kind: 'transition', to: 'preparing', confirm: 'close' })
    expect((p.control as { then?: string }).then).toBeUndefined()
    expect(p.line).toMatch(/don’t have to wait/)
    expect(p.line).not.toMatch(/wraps up/)
    expect(p.consequence).toMatch(/reveals/)
  })
  it('starts the retro straight from closed; themes are optional; reopening is in the menu', () => {
    const p = sprintPlan(sprint('preparing', 'facilitator'))
    expect(p.control).toMatchObject({ kind: 'transition', to: 'live', confirm: 'start', then: '/sprints/s1/stage' })
    expect(p.secondary[0]).toMatchObject({ kind: 'link', href: '/sprints/s1/prepare' })
    expect(p.more.find((a) => a.kind === 'transition')).toMatchObject({ to: 'collecting', confirm: 'reopen' })
    expect(transitions(p).some((a) => (a as { to: string }).to === 'ready')).toBe(false)
  })
  it('explains why reopening is gone once the retro has started', () => {
    const p = sprintPlan(sprint('ready', 'facilitator', { allowed_transitions: ['live', 'preparing'], has_session: true }))
    expect(transitions(p).some((a) => (a as { to: string }).to === 'collecting')).toBe(false)
    expect(p.notes.join(' ')).toMatch(/can’t be reopened/)
  })
  it('points a closed sprint with no thoughts at its choices', () => {
    const p = sprintPlan(sprint('preparing', 'facilitator', { entry_count: 0 }))
    expect(p.line).toMatch(/no thoughts/)
    expect(p.notes.join(' ')).toMatch(/reopen collection, or hold the retro anyway/)
  })
  it('sends the facilitator to the stage while live, with pausing kept quiet', () => {
    const p = sprintPlan(sprint('live', 'facilitator'))
    expect(p.control).toMatchObject({ href: '/sprints/s1/stage' })
    expect(p.more[0]).toMatchObject({ to: 'ready', confirm: 'stop' })
  })
  it('keeps a finished sprint quiet: archiving only, from the menu', () => {
    const p = sprintPlan(sprint('completed', 'facilitator'))
    expect(p.control).toBeNull()
    expect(p.more).toEqual([expect.objectContaining({ to: 'archived' })])
  })
})

describe('notes', () => {
  it('says changing the sprint needs a connection', () => {
    expect(sprintPlan(sprint('collecting', 'facilitator'), { online: false }).notes.join(' ')).toMatch(/needs a connection/)
    expect(sprintPlan(sprint('collecting', 'member'), { online: false }).notes).toHaveLength(0)
  })
  it('a passed retro date changes nothing by itself, and says so to the facilitator', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString()
    expect(sprintPlan(sprint('collecting', 'facilitator', { retro_at: past })).notes.join(' ')).toMatch(/Nothing changes by itself/)
    expect(sprintPlan(sprint('collecting', 'member', { retro_at: past })).notes).toHaveLength(0)
  })
})

describe('confirmations', () => {
  const s = { retro_at: future, timezone: 'Asia/Manila', participant_count: 4 }
  it('closing: reveal, what stops, and that it doesn’t start the retro', () => {
    const c = confirmCopy('close', s).body.join(' ')
    expect(c).toMatch(/revealed, without names, to all 4 people/)
    expect(c).toMatch(/Nobody can add or edit/)
    expect(c).toMatch(/isn’t sent/)
    expect(c).toMatch(/doesn’t start the retro/)
    expect(c).toMatch(/reopen/)
  })
  it('reopening can’t make anything private again', () => {
    expect(confirmCopy('reopen', s).body.join(' ')).toMatch(/can’t make it private again/)
  })
  it('starting ends reopening', () => {
    expect(confirmCopy('start', s).body.join(' ')).toMatch(/can’t be reopened/)
  })
})
