import { describe, expect, it } from 'vitest'
import { sprintGuide, STEP_OF, type GuideInput } from './lifecycle'

// The server's rule (worker/src/routes/sprints.ts allowedTransitions), mirrored for the fixtures.
const SERVER: Record<string, string[]> = {
  draft: ['collecting'],
  collecting: ['preparing'],
  preparing: ['ready', 'collecting'],
  ready: ['live', 'preparing'],
  live: ['completed', 'ready'],
  completed: ['archived'],
}
const STATES = ['draft', 'collecting', 'preparing', 'ready', 'live', 'completed', 'archived']
const future = new Date(Date.now() + 7 * 86_400_000).toISOString()

function sprint(status: string, role: 'facilitator' | 'member' | 'outsider', extra: Partial<GuideInput> = {}): GuideInput {
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
    reopened_count: 0,
    participant_count: 4,
    ...extra,
  }
}
const transitions = (g: ReturnType<typeof sprintGuide>) => [...g.actions, ...(g.facilitator?.actions ?? [])].filter((a) => a.kind === 'transition')

describe('role boundaries', () => {
  it('never offers a member or an outsider a state change, in any state', () => {
    for (const st of STATES)
      for (const role of ['member', 'outsider'] as const) {
        const g = sprintGuide(sprint(st, role))
        expect(g.facilitator, `${st}/${role}`).toBeNull()
        expect(transitions(g), `${st}/${role}`).toHaveLength(0)
      }
  })

  it('offers the facilitator only transitions the server allows', () => {
    for (const st of STATES) {
      const g = sprintGuide(sprint(st, 'facilitator'))
      for (const a of transitions(g)) expect(SERVER[st], `${st} → ${a.kind === 'transition' && a.to}`).toContain(a.kind === 'transition' ? a.to : '')
    }
  })

  it('drops a transition the server didn’t allow, even for a facilitator', () => {
    const g = sprintGuide(sprint('collecting', 'facilitator', { allowed_transitions: [] }))
    expect(transitions(g)).toHaveLength(0)
  })

  it('only participants are asked to write', () => {
    expect(sprintGuide(sprint('collecting', 'member')).actions.map((a) => a.kind)).toContain('write')
    expect(sprintGuide(sprint('collecting', 'outsider')).actions).toHaveLength(0)
  })
})

describe('each state says what happens next', () => {
  it('maps every server state to a step', () => {
    for (const st of STATES) expect(STEP_OF[st]).toBeTruthy()
    expect(STEP_OF.ready).toBe(STEP_OF.live)
  })

  it('draft: open collection first', () => {
    const g = sprintGuide(sprint('draft', 'facilitator'))
    expect(g.facilitator?.actions[0]).toMatchObject({ kind: 'transition', to: 'collecting', tone: 'primary' })
  })

  it('collecting: closing is explained first and leads to preparation', () => {
    const close = sprintGuide(sprint('collecting', 'facilitator')).facilitator?.actions.find((a) => a.kind === 'transition')
    expect(close).toMatchObject({ to: 'preparing', confirm: 'close', then: '/sprints/s1/prepare' })
    // Closing never competes with writing: it isn't the primary action on the page.
    expect(close?.tone).not.toBe('primary')
  })

  it('preparing: an empty collection is named, with a way forward', () => {
    const g = sprintGuide(sprint('preparing', 'facilitator', { entry_count: 0, theme_count: 0 }))
    expect(g.notes.join(' ')).toMatch(/No thoughts were added/)
    expect(g.notes.join(' ')).toMatch(/reopen collection/)
    // Reopening is consequential.
    expect(g.facilitator?.actions.find((a) => a.kind === 'transition' && a.to === 'collecting')).toMatchObject({ confirm: 'reopen' })
  })

  it('preparing: no themes yet is guidance, not a blocker', () => {
    const g = sprintGuide(sprint('preparing', 'facilitator', { theme_count: 0 }))
    expect(g.notes.join(' ')).toMatch(/Grouping is optional/)
    expect(transitions(g).map((a) => a.kind === 'transition' && a.to)).toContain('ready')
  })

  it('ready and live: participants join the room; facilitators get the stage', () => {
    expect(sprintGuide(sprint('live', 'member')).actions[0]).toMatchObject({ href: '/sprints/s1/room' })
    expect(sprintGuide(sprint('live', 'facilitator')).facilitator?.actions[0]).toMatchObject({ href: '/sprints/s1/stage' })
    expect(sprintGuide(sprint('ready', 'facilitator')).facilitator?.actions[0]).toMatchObject({ to: 'live', then: '/sprints/s1/stage' })
  })

  it('completed: everyone gets the outcomes', () => {
    for (const role of ['member', 'facilitator'] as const) expect(sprintGuide(sprint('completed', role)).actions[0]).toMatchObject({ href: '/sprints/s1/outcomes' })
  })

  it('says when a change needs a connection', () => {
    expect(sprintGuide(sprint('collecting', 'facilitator'), { online: false }).notes.join(' ')).toMatch(/needs a connection/)
    expect(sprintGuide(sprint('collecting', 'member'), { online: false }).notes).toHaveLength(0)
  })

  it('flags a retro time that has passed while still collecting', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString()
    expect(sprintGuide(sprint('collecting', 'member', { retro_at: past })).notes.join(' ')).toMatch(/has passed/)
    expect(sprintGuide(sprint('completed', 'member', { retro_at: past })).notes).toHaveLength(0)
  })
})
