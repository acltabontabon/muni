import { bad } from './errors'

export const now = () => Date.now()

/**
 * A request's JSON body as a plain object. No body at all reads as `{}`; anything else that isn't a
 * JSON object (malformed JSON, `null`, a list, a number) is a 400 here rather than a crash later.
 */
export async function jsonBody<T = Record<string, unknown>>(c: { req: { text: () => Promise<string> } }): Promise<T> {
  const text = await c.req.text()
  if (!text.trim()) return {} as T
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    throw bad('the request body isn’t valid JSON')
  }
  if (!isObject(v)) throw bad('the request body must be a JSON object')
  return v as T
}

export const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** An optional list of ids in a request: absent is empty; anything but a list of strings is a 400. */
export function idList(v: unknown, field: string): string[] {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) throw bad(`${field} must be a list of ids`)
  return v
}

/** A calendar date as YYYY-MM-DD that exists (no 2026-02-30). */
export function isDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const e = raw.trim().toLowerCase()
  const at = e.indexOf('@')
  if (at <= 0) return null
  const domain = e.slice(at + 1)
  if (!domain || !domain.includes('.') || e.length > 254) return null
  if (/[\s<>,]/.test(e)) return null
  return e
}

export function nonempty(s: unknown, max: number, field: string): string {
  const t = typeof s === 'string' ? s.trim() : ''
  if (!t) throw bad(`${field} can’t be empty`)
  if ([...t].length > max) throw bad(`${field} is too long (max ${max} characters)`)
  return t
}

export function optional(s: unknown, max: number, field: string): string | null {
  if (s === undefined || s === null) return null
  const t = typeof s === 'string' ? s.trim() : ''
  if (!t) return null
  if ([...t].length > max) throw bad(`${field} is too long (max ${max} characters)`)
  return t
}

export function clip(s: string, max: number): string {
  return [...s].slice(0, max).join('')
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  return `${(local ?? '•')[0] ?? '•'}•••@${domain ?? ''}`
}

export const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

/** Formats an instant in an IANA timezone as "Mon 3 Nov 2026, 14:00 (UTC+08:00)". */
export function localLabel(tz: string, atMs: number): string {
  try {
    const d = new Date(atMs)
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'longOffset' }).formatToParts(d)
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
    const off = g('timeZoneName').replace('GMT', 'UTC')
    return `${g('weekday')} ${g('day')} ${g('month')} ${g('year')}, ${g('hour')}:${g('minute')} (${off === 'UTC' ? 'UTC+00:00' : off})`
  } catch {
    return new Date(atMs).toISOString()
  }
}

/** Resolves a local date + wall time in a timezone to an instant. Nonexistent local times are rejected. */
export function resolveLocal(tz: string, date: string, time: string): number {
  if (!isDate(date)) throw bad('dates must be real dates, as YYYY-MM-DD')
  const m = /^(\d{2}):(\d{2})$/.exec(time)
  if (!m) throw bad('retro time must be HH:MM')
  let fmt: Intl.DateTimeFormat
  try {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  } catch {
    throw bad(`unknown timezone “${tz}”`)
  }
  const [y, mo, d] = date.split('-').map(Number)
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (hh > 23 || mm > 59) throw bad('retro time must be HH:MM')
  let guess = Date.UTC(y, mo - 1, d, hh, mm, 0)
  for (let i = 0; i < 2; i++) {
    const p = fmt.formatToParts(new Date(guess))
    const g = (t: string) => Number(p.find((x) => x.type === t)?.value)
    const shown = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), 0)
    const target = Date.UTC(y, mo - 1, d, hh, mm, 0)
    guess += target - shown
  }
  const p = fmt.formatToParts(new Date(guess))
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value)
  if (g('hour') % 24 !== hh || g('minute') !== mm || g('day') !== d) throw bad('that local time doesn’t exist on that date (clocks skip forward) — pick another time')
  return guess
}

export function localDate(tz: string, atMs: number): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(atMs))
  } catch {
    return new Date(atMs).toISOString().slice(0, 10)
  }
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number)
  const [y2, m2, d2] = b.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000)
}
