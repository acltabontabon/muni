import { describe, expect, it } from 'vitest'
import { guideFor, starsFor, type GuidePage, type GuideState } from './guide'

const NOW = Date.parse('2026-09-30T09:00:00Z')
const state = (page: GuidePage | null, extra: Partial<GuideState> = {}): GuideState => ({ stage: 'on', page, demo: false, later: [], now: NOW, ...extra })
type SprintPage = Extract<GuidePage, { at: 'sprint' }>
const sprint = (extra: Partial<SprintPage> = {}): SprintPage => ({
  at: 'sprint',
  workspaceId: 'w',
  phase: 'draft',
  fac: true,
  participant: true,
  people: 4,
  wrote: false,
  themes: 0,
  can: { open: true, close: true, start: true },
  endsOn: '2026-10-09',
  retroAt: '2026-10-10T12:00:00Z',
  online: true,
  ...extra,
})
const step = (s: GuideState) => guideFor(s)?.step ?? null

describe('the starter’s evening', () => {
  it('walks from a team to the stage, one real control at a time', () => {
    expect(guideFor(state({ at: 'welcome' }))).toMatchObject({ step: 'team', spots: ['new-workspace'] })
    expect(guideFor(state({ at: 'workspace', workspaceId: 'w', sprints: 0, online: true }))).toMatchObject({ step: 'sprint', spots: ['setup-sprint'] })
    expect(guideFor(state({ at: 'setup', workspaceId: 'w', creating: true, online: true }))).toMatchObject({ step: 'create-open', spots: ['create-open'] })
    expect(guideFor(state(sprint({ people: 1 })))).toMatchObject({ step: 'invite', spots: ['invite', 'details', 'more'] })
    expect(guideFor(state(sprint()))).toMatchObject({ step: 'open', spots: ['sprint-primary', 'details'] })
    expect(guideFor(state(sprint({ phase: 'collecting' })))).toMatchObject({ step: 'write', spots: ['writer'] })
    expect(step(state(sprint({ phase: 'closed' })))).toBe('themes')
    expect(step(state(sprint({ phase: 'closed', themes: 3 })))).toBe('start')
    expect(step(state(sprint({ phase: 'live' })))).toBe('stage')
    expect(step(state(sprint({ phase: 'done' })))).toBeNull()
  })

  it('says nothing where the page already does', () => {
    expect(step(state({ at: 'workspace', workspaceId: 'w', sprints: 2, online: true }))).toBeNull()
    expect(step(state({ at: 'workspace', workspaceId: 'w', sprints: null, online: true }))).toBeNull()
    expect(step(state({ at: 'setup', workspaceId: 'w', creating: false, online: true }))).toBeNull()
    // Collecting and written: nothing to do until the sprint ends.
    expect(step(state(sprint({ phase: 'collecting', wrote: true })))).toBeNull()
  })

  it('never nudges the facilitator to close collection early', () => {
    const collecting = (now: number) => step(state(sprint({ phase: 'collecting', wrote: true }), { now }))
    expect(collecting(NOW)).toBeNull()
    expect(collecting(Date.parse('2026-10-09T08:00:00'))).toBe('close')
    // The retro is less than a day away, even if the sprint's dates say otherwise.
    expect(step(state(sprint({ phase: 'collecting', wrote: true, endsOn: '2026-12-31', retroAt: '2026-09-30T20:00:00Z' })))).toBe('close')
    // Not allowed: nothing.
    expect(step(state(sprint({ phase: 'collecting', wrote: true, endsOn: '2026-09-01', can: { open: false, close: false, start: false } })))).toBeNull()
  })

  it('moves past what was put off, and past the optional themes', () => {
    expect(step(state(sprint({ people: 1 }), { later: ['invite'] }))).toBe('open')
    expect(guideFor(state(sprint({ phase: 'closed' })))?.optional).toBe(true)
    expect(step(state(sprint({ phase: 'closed' }), { later: ['themes'] }))).toBe('start')
    expect(step(state({ at: 'welcome' }, { later: ['team'] }))).toBeNull()
  })

  it('waits for what the page doesn’t know yet', () => {
    expect(step(state(sprint({ phase: 'collecting', wrote: null })))).toBeNull()
    expect(step(state(null))).toBeNull()
  })
})

describe('a member’s evening', () => {
  const member = (extra: Partial<SprintPage>) => sprint({ fac: false, can: { open: false, close: false, start: false }, ...extra })
  it('writes, then waits quietly, then joins the retro', () => {
    expect(step(state(member({ phase: 'draft' })))).toBeNull()
    expect(step(state(member({ phase: 'collecting' })))).toBe('write')
    expect(step(state(member({ phase: 'collecting', wrote: true })))).toBeNull()
    expect(step(state(member({ phase: 'closed' })))).toBeNull()
    expect(guideFor(state(member({ phase: 'live' })))).toMatchObject({ step: 'join', spots: ['join-retro'] })
  })
  it('has nothing for someone outside the sprint', () => {
    expect(step(state(member({ phase: 'collecting', participant: false })))).toBeNull()
    expect(step(state(member({ phase: 'live', participant: false })))).toBeNull()
  })
})

describe('when the guide is quiet', () => {
  it('is hidden, done, offline or in the demo team', () => {
    for (const stage of ['hidden', 'done'] as const) expect(step(state({ at: 'welcome' }, { stage }))).toBeNull()
    expect(step(state({ at: 'welcome' }, { stage: 'prologue' }))).toBe('team')
    expect(step(state(sprint(), { demo: true }))).toBeNull()
    expect(step(state(sprint({ online: false })))).toBeNull()
    expect(step(state({ at: 'workspace', workspaceId: 'w', sprints: 0, online: false }))).toBeNull()
  })
  it('never points anywhere without a line to say', () => {
    const pages: GuidePage[] = [{ at: 'welcome' }, { at: 'workspace', workspaceId: 'w', sprints: 0, online: true }, { at: 'setup', workspaceId: 'w', creating: true, online: true }, sprint({ people: 1 }), sprint(), sprint({ phase: 'collecting' }), sprint({ phase: 'closed' }), sprint({ phase: 'live' })]
    for (const p of pages) {
      const f = guideFor(state(p))!
      expect(f.line.length, f.step).toBeGreaterThan(8)
      expect(f.text.length, f.step).toBeGreaterThan(20)
      expect(f.spots.length, f.step).toBeGreaterThan(0)
    }
  })
})

describe('the sky', () => {
  it('has seven stars for a starter and four for a member, the next one marked', () => {
    const s = starsFor({ track: 'starter', reached: ['team', 'sprint'] })
    expect(s.map((x) => x.id)).toEqual(['team', 'sprint', 'people', 'thought', 'reveal', 'retro', 'agreed'])
    expect(s.filter((x) => x.lit).map((x) => x.id)).toEqual(['team', 'sprint'])
    expect(s.find((x) => x.next)?.id).toBe('people')
    const m = starsFor({ track: 'member', reached: ['thought', 'reveal', 'retro', 'agreed'] })
    expect(m).toHaveLength(4)
    expect(m.some((x) => x.next)).toBe(false)
  })
  it('ends on the mark’s dot', () => {
    for (const track of ['starter', 'member'] as const) expect(starsFor({ track, reached: [] }).at(-1)!.mark).toEqual([52, 40])
  })
})
