import { describe, expect, it } from 'vitest'
import { LOCKED } from '@/lib/e2ee/keyring'
import { follow, resync } from './forms'
import { planSetup, setupSteps, type SetupValues } from './setup-plan'

const saved: SetupValues = {
  name: 'Sprint 14',
  external_ref: '',
  goal: 'Faster checkout',
  opening_question: LOCKED,
  timezone: 'Asia/Manila',
  starts_on: '2026-09-14',
  ends_on: '2026-09-27',
  retro_date: '2026-09-28',
  retro_time: '14:00',
  retro_duration_min: 45,
  facilitator_id: 'me',
  participant_ids: ['me', 'ana', 'ben'],
  reminders_enabled: true,
  vote_budget: 3,
}

describe('saving a sprint’s setup', () => {
  it('sends only what changed — never the budget during a vote, never a question this device can’t show', () => {
    expect(planSetup(saved, { ...saved })).toEqual({ add: [], fields: {}, handover: null, remove: [] })
    expect(setupSteps(planSetup(saved, { ...saved }))).toEqual([])
    const p = planSetup(saved, { ...saved, name: 'Sprint 14 — Checkout' })
    expect(p.fields).toEqual({ name: 'Sprint 14 — Checkout' })
    expect(planSetup(saved, { ...saved, retro_time: '15:00' }).fields).toEqual({ schedule: { timezone: 'Asia/Manila', starts_on: '2026-09-14', ends_on: '2026-09-27', retro_date: '2026-09-28', retro_time: '15:00', retro_duration_min: 45 } })
    expect(planSetup(saved, { ...saved, opening_question: 'What surprised you?' }).fields).toEqual({ opening_question: 'What surprised you?' })
  })

  it('adds a new facilitator before handing over, and removes people before the handover', () => {
    const p = planSetup(saved, { ...saved, facilitator_id: 'cy', participant_ids: ['me', 'ana'] })
    expect(p).toMatchObject({ add: ['cy'], handover: 'cy', remove: ['ben'] })
    expect(p.fields).toEqual({ facilitator_id: 'cy' })
    expect(setupSteps(p)).toEqual([{ kind: 'add', accountId: 'cy' }, { kind: 'remove', accountId: 'ben' }, { kind: 'save' }])
  })

  it('without a handover, saves the sprint between adding and removing people', () => {
    const p = planSetup(saved, { ...saved, goal: '', participant_ids: ['me', 'ana', 'dee'] })
    expect(setupSteps(p)).toEqual([{ kind: 'add', accountId: 'dee' }, { kind: 'save' }, { kind: 'remove', accountId: 'ben' }])
  })

  it('never takes the current facilitator out of the sprint', () => {
    const p = planSetup(saved, { ...saved, facilitator_id: 'ana', participant_ids: ['ana', 'ben'] })
    expect(p.remove).toEqual([])
    expect(p.add).toEqual([])
  })
})

describe('a form following the server', () => {
  it('follows where the person hasn’t typed, or where it showed “can’t be shown”', () => {
    expect(follow('old', 'old', 'new')).toBe('new')
    expect(follow('mine', 'old', 'new')).toBe('mine')
    expect(follow(LOCKED, LOCKED, 'Readable now')).toBe('Readable now')
    expect(follow(`${LOCKED} edited`, LOCKED, 'Readable now')).toBe('Readable now')
    expect(resync({ a: 'x', b: ['1'], c: 2 }, { a: 'x', b: ['1'], c: 1 }, { a: 'y', b: ['1', '2'], c: 3 })).toEqual({ a: 'y', b: ['1', '2'], c: 2 })
  })
})
