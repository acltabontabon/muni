/**
 * Human-readable sprint times. The retro happens at a wall time in the sprint's timezone; people
 * elsewhere also see it in their own time, and everyone gets a rough "in 3 days".
 */

/** "Asia/Manila" → "Manila time"; "UTC" → "UTC". */
export function zoneName(tz: string): string {
  if (!tz || tz === 'UTC' || tz === 'Etc/UTC') return 'UTC'
  const city = tz.split('/').pop() ?? tz
  return `${city.replace(/_/g, ' ')} time`
}

/** The UTC offset of a timezone at an instant: "GMT+8", "GMT-4:30", "GMT". */
export function offsetLabel(tz: string, at: number, locale = 'en-GB'): string {
  try {
    const part = new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date(at)).find((p) => p.type === 'timeZoneName')
    return part?.value ?? ''
  } catch {
    return ''
  }
}

function offsetMinutes(tz: string, at: number): number {
  const label = offsetLabel(tz, at)
  const m = label.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
  if (!m) return 0
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0))
}

/** "in 3 days", "in 2 hours", "tomorrow", "2 days ago". */
export function relativeTime(at: number, now: number, locale?: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const diff = at - now
  const abs = Math.abs(diff)
  const mins = Math.round(diff / 60_000)
  if (abs < 60 * 60_000) return rtf.format(mins, 'minute')
  const hours = Math.round(diff / 3_600_000)
  if (abs < 22 * 3_600_000) return rtf.format(hours, 'hour')
  const days = Math.round(diff / 86_400_000)
  if (Math.abs(days) < 14) return rtf.format(days, 'day')
  return rtf.format(Math.round(days / 7), 'week')
}

export type RetroTime = {
  /** "Tue 29 Sep" in the sprint's timezone. */
  date: string
  /** "14:00" in the sprint's timezone. */
  time: string
  /** "Manila time". */
  zone: string
  /** "GMT+8". */
  offset: string
  /** "in 3 days". */
  relative: string
  past: boolean
  /** The same instant for someone whose device is in another offset: "08:00 Tue your time". */
  yours: string | null
}

export function describeRetro(retroAt: string | number, tz: string, opts: { now?: number; deviceTz?: string; locale?: string } = {}): RetroTime {
  const at = typeof retroAt === 'number' ? retroAt : Date.parse(retroAt)
  const now = opts.now ?? Date.now()
  const locale = opts.locale
  const deviceTz = opts.deviceTz ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const inTz = (o: Intl.DateTimeFormatOptions, zone: string) => {
    try {
      return new Intl.DateTimeFormat(locale, { ...o, timeZone: zone }).format(new Date(at))
    } catch {
      return new Intl.DateTimeFormat(locale, o).format(new Date(at))
    }
  }
  const date = inTz({ weekday: 'short', day: 'numeric', month: 'short' }, tz).replace(',', '')
  const time = inTz({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, tz)
  const differs = !!deviceTz && deviceTz !== tz && offsetMinutes(deviceTz, at) !== offsetMinutes(tz, at)
  let yours: string | null = null
  if (differs) {
    const yourDate = inTz({ weekday: 'short', day: 'numeric', month: 'short' }, deviceTz).replace(',', '')
    const yourTime = inTz({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, deviceTz)
    yours = `${yourTime}${yourDate !== date ? ` ${yourDate.split(' ')[0]}` : ''} your time`
  }
  return { date, time, zone: zoneName(tz), offset: offsetLabel(tz, at), relative: relativeTime(at, now, locale), past: at < now, yours }
}

/** "14 Sep – 27 Sep" (a sprint's dates, stored as local calendar dates). */
export function dateRange(startsOn: string, endsOn: string, locale?: string): string {
  const f = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return `${f(startsOn)} – ${f(endsOn)}`
}

/** A calendar date ("2026-10-04") as "Sun 4 Oct". */
export function shortDate(d: string, locale?: string): string {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '')
}

/**
 * The retro in a few words, for a label that also names the sprint: "retro today, 15:00",
 * "retro tomorrow", "retro Sat 3 Oct". Days are counted in the sprint's timezone (its calendar is
 * the one the retro is on). The whole picture — time, zone, the reader's own time — belongs in
 * details (describeRetro); this is only the next thing worth knowing.
 */
export function retroShort(retroAt: string | number | null | undefined, tz: string, opts: { now?: number; locale?: string } = {}): string | null {
  const at = typeof retroAt === 'number' ? retroAt : retroAt ? Date.parse(retroAt) : NaN
  if (!Number.isFinite(at)) return null
  const now = opts.now ?? Date.now()
  const r = describeRetro(at, tz, { now, locale: opts.locale, deviceTz: tz })
  const day = (t: number) => {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t))
    } catch {
      return new Date(t).toISOString().slice(0, 10)
    }
  }
  const days = Math.round((Date.parse(`${day(at)}T00:00:00Z`) - Date.parse(`${day(now)}T00:00:00Z`)) / 86_400_000)
  if (days === 0) return r.past ? `retro was today, ${r.time}` : `retro today, ${r.time}`
  if (days === 1) return 'retro tomorrow'
  if (days === -1) return 'retro was yesterday'
  return r.past ? `retro was ${r.date}` : `retro ${r.date}`
}
