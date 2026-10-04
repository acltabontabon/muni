import { describe, expect, it } from 'vitest'
import { moveDate, realDate, setupInstant, setupProblems, sprintLength } from './sprint-setup'
import type { SetupValues } from './setup-plan'

const form: SetupValues = { name: 'Checkout', external_ref: '', goal: '', opening_question: '', timezone: 'Asia/Manila', starts_on: '2026-10-04', ends_on: '2026-10-17', retro_date: '2026-10-17', retro_time: '14:00', retro_duration_min: 45, facilitator_id: 'mara', participant_ids: ['mara'], reminders_enabled: true, vote_budget: 3 }

describe('sprint setup schedule', () => {
  it('rejects impossible calendar dates instead of rolling into another month', () => {
    expect(realDate('2026-02-29')).toBe(false)
    expect(realDate('2028-02-29')).toBe(true)
    expect(setupProblems({ ...form, ends_on: '2026-02-30' }).ends_on).toMatch(/real calendar/)
    expect(moveDate('2026-12-28', 6)).toBe('2027-01-03')
  })

  it('resolves times on both sides of the spring clock change and refuses the skipped hour', () => {
    expect(setupInstant('2026-03-08', '01:30', 'America/New_York')).toBe(Date.parse('2026-03-08T06:30:00Z'))
    expect(setupInstant('2026-03-08', '03:30', 'America/New_York')).toBe(Date.parse('2026-03-08T07:30:00Z'))
    expect(setupInstant('2026-03-08', '02:30', 'America/New_York')).toBeNull()
    expect(setupProblems({ ...form, starts_on: '2026-03-01', ends_on: '2026-03-14', retro_date: '2026-03-08', retro_time: '02:30', timezone: 'America/New_York' }).retro_time).toMatch(/doesn’t exist/)
  })

  it('handles fractional timezone offsets and invalid times', () => {
    expect(setupInstant('2026-10-04', '14:00', 'Asia/Kathmandu')).toBe(Date.parse('2026-10-04T08:15:00Z'))
    expect(setupInstant('2026-10-04', '24:00', 'UTC')).toBeNull()
    expect(setupInstant('2026-10-04', '14:00', 'Unknown/Place')).toBeNull()
  })

  it('explains server schedule limits before saving', () => {
    expect(setupProblems(form)).toEqual({})
    expect(setupProblems({ ...form, ends_on: '2027-02-03' }).ends_on).toMatch(/120 days/)
    expect(setupProblems({ ...form, retro_date: '2026-10-03' }).retro_date).toMatch(/before/)
    expect(setupProblems({ ...form, vote_budget: 2.5 }).vote_budget).toMatch(/whole number/)
    expect(setupProblems({ ...form, retro_duration_min: 30.5 }).retro_duration_min).toMatch(/whole number/)
  })

  it('keeps a deliberately chosen retro date when changing sprint length', () => {
    expect(sprintLength(form, 1)).toEqual({ ends_on: '2026-10-10', retro_date: '2026-10-10' })
    expect(sprintLength({ ...form, retro_date: '2026-10-20' }, 3)).toEqual({ ends_on: '2026-10-24', retro_date: '2026-10-20' })
  })
})
