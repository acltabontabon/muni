import { describe, expect, it } from 'vitest'
import { dateRange, describeRetro, relativeTime, retroShort, zoneName } from './schedule'

const retro = Date.parse('2026-09-29T06:00:00Z') // 14:00 in Manila

describe('describeRetro', () => {
  it('reads in the sprint’s timezone, with a friendly zone name', () => {
    const r = describeRetro(retro, 'Asia/Manila', { now: retro - 3 * 86_400_000, deviceTz: 'Asia/Manila', locale: 'en-GB' })
    expect(r.date).toMatch(/^Tue 29 Sept?$/)
    expect(r.time).toBe('14:00')
    expect(r.zone).toBe('Manila time')
    expect(r.offset).toBe('GMT+8')
    expect(r.relative).toBe('in 3 days')
    expect(r.past).toBe(false)
    expect(r.yours).toBeNull()
  })

  it('adds the reader’s own time only when their offset differs', () => {
    const r = describeRetro(retro, 'Asia/Manila', { now: retro, deviceTz: 'Europe/Berlin', locale: 'en-GB' })
    expect(r.yours).toBe('08:00 your time')
    // Same offset, different zone name: nothing extra to say.
    expect(describeRetro(retro, 'Asia/Manila', { deviceTz: 'Asia/Singapore', locale: 'en-GB' }).yours).toBeNull()
  })

  it('names the weekday when the reader’s day is different', () => {
    const late = Date.parse('2026-09-29T01:00:00Z') // 09:00 Tue in Manila, 21:00 Mon in New York
    expect(describeRetro(late, 'Asia/Manila', { deviceTz: 'America/New_York', locale: 'en-GB' }).yours).toBe('21:00 Mon your time')
  })

  it('knows when the time has passed', () => {
    const r = describeRetro(retro, 'UTC', { now: retro + 2 * 86_400_000, deviceTz: 'UTC', locale: 'en-GB' })
    expect(r.past).toBe(true)
    expect(r.relative).toBe('2 days ago')
    expect(r.zone).toBe('UTC')
  })
})

describe('small formatters', () => {
  it('relative time picks a sensible unit', () => {
    const now = 1_000_000_000_000
    expect(relativeTime(now + 30 * 60_000, now, 'en')).toBe('in 30 minutes')
    expect(relativeTime(now + 5 * 3_600_000, now, 'en')).toBe('in 5 hours')
    expect(relativeTime(now + 86_400_000, now, 'en')).toBe('tomorrow')
    expect(relativeTime(now + 21 * 86_400_000, now, 'en')).toBe('in 3 weeks')
  })
  it('zone names and date ranges', () => {
    expect(zoneName('America/Argentina/Buenos_Aires')).toBe('Buenos Aires time')
    expect(dateRange('2026-09-14', '2026-09-27', 'en-GB')).toMatch(/^14 Sept? – 27 Sept?$/)
  })
})

describe('retroShort', () => {
  // Thu 1 Oct 2026, 15:00 in Manila (07:00 UTC).
  const at = Date.UTC(2026, 9, 1, 7, 0)
  const o = (now: number) => ({ now, locale: 'en-GB' })
  it('says only the next thing worth knowing', () => {
    expect(retroShort(at, 'Asia/Manila', o(at - 6 * 86_400_000))).toBe('retro Thu 1 Oct')
    expect(retroShort(at, 'Asia/Manila', o(at - 86_400_000))).toBe('retro tomorrow')
    expect(retroShort(at, 'Asia/Manila', o(at - 3 * 3_600_000))).toBe('retro today, 15:00')
    expect(retroShort(at, 'Asia/Manila', o(at + 3_600_000))).toBe('retro was today, 15:00')
    expect(retroShort(at, 'Asia/Manila', o(at + 3 * 86_400_000))).toBe('retro was Thu 1 Oct')
  })
  it('counts days on the sprint’s calendar, not the device’s', () => {
    // 23:30 UTC on 30 Sep is already 1 Oct in Manila: the retro is today there.
    expect(retroShort(at, 'Asia/Manila', o(Date.UTC(2026, 8, 30, 23, 30)))).toBe('retro today, 15:00')
    expect(retroShort(at, 'America/New_York', o(Date.UTC(2026, 8, 30, 23, 30)))).toBe('retro tomorrow')
  })
  it('has nothing to say without a schedule', () => {
    expect(retroShort(null, 'Asia/Manila')).toBeNull()
    expect(retroShort('', 'Asia/Manila')).toBeNull()
    expect(retroShort('not a date', 'Asia/Manila')).toBeNull()
  })
})
