import type { SetupValues } from './setup-plan'

const DAY = 86_400_000

/** Calendar dates keep their meaning regardless of the device's timezone. */
export function realDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const at = Date.parse(`${value}T12:00:00Z`)
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === value
}

export function moveDate(value: string, days: number): string {
  return new Date(Date.parse(`${value}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10)
}

/** Match the server's wall-time resolution, including skipped hours at daylight-saving changes. */
export function setupInstant(date: string, time: string, timezone: string): number | null {
  if (!realDate(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    const target = Date.parse(`${date}T${time}:00Z`)
    let guess = target
    const shown = (at: number) => {
      const parts = fmt.formatToParts(new Date(at))
      const n = (type: string) => Number(parts.find((p) => p.type === type)?.value)
      return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'))
    }
    for (let i = 0; i < 2; i++) guess += target - shown(guess)
    return shown(guess) === target ? guess : null
  } catch {
    return null
  }
}

/** Explain a bad schedule before the person spends time sending it to the server. */
export function setupProblems(f: SetupValues): Partial<Record<keyof SetupValues, string>> {
  const p: Partial<Record<keyof SetupValues, string>> = {}
  if (!f.name.trim()) p.name = 'Give the sprint a name people will recognise.'
  for (const [field, empty] of [['starts_on', 'Choose when the sprint starts.'], ['ends_on', 'Choose when it ends.'], ['retro_date', 'Choose a day for the retro.']] as const) {
    if (!f[field]) p[field] = empty
    else if (!realDate(f[field])) p[field] = 'Choose a real calendar date.'
  }
  if (!p.starts_on && !p.ends_on) {
    if (f.ends_on < f.starts_on) p.ends_on = 'The sprint can’t end before it starts.'
    else if ((Date.parse(f.ends_on) - Date.parse(f.starts_on)) / DAY > 120) p.ends_on = 'Keep the sprint within 120 days of its start.'
  }
  if (!p.starts_on && !p.retro_date && f.retro_date < f.starts_on) p.retro_date = 'The retro can’t be before the sprint starts.'
  if (!f.retro_time) p.retro_time = 'Choose a time.'
  else if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(f.retro_time)) p.retro_time = 'Choose a time between 00:00 and 23:59.'
  else if (!p.retro_date && setupInstant(f.retro_date, f.retro_time, f.timezone) === null) p.retro_time = 'That time doesn’t exist in this timezone on that day. Choose another time.'
  if (!Number.isInteger(f.retro_duration_min) || !(f.retro_duration_min >= 10 && f.retro_duration_min <= 240)) p.retro_duration_min = 'A whole number between 10 and 240 minutes.'
  if (!Number.isInteger(f.vote_budget) || !(f.vote_budget >= 1 && f.vote_budget <= 10)) p.vote_budget = 'A whole number between 1 and 10.'
  if (!f.facilitator_id) p.facilitator_id = 'Choose who will guide the retro.'
  return p
}

/** A preset follows the retro date only while it is still following the sprint's end. */
export function sprintLength(f: SetupValues, weeks: number): Pick<SetupValues, 'ends_on' | 'retro_date'> {
  const ends_on = moveDate(f.starts_on, weeks * 7 - 1)
  return { ends_on, retro_date: f.retro_date === f.ends_on ? ends_on : f.retro_date }
}
