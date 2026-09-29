/**
 * Forms that edit what the server holds keep their own copy while someone types. When the server's
 * value changes underneath (another tab, a reload after this device unlocked), a field the person
 * hasn't touched follows it, and so does one still showing "can't be shown" — that was never their
 * text. Anything they changed stays theirs.
 */
import { hasPlaceholder } from '@/lib/e2ee/keyring'

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)

/** One value: `local` is what the form shows, `loaded` what it was last filled from, `fresh` the server's now. */
export function follow<T>(local: T, loaded: T, fresh: T): T {
  return same(local, loaded) || hasPlaceholder(local) ? fresh : local
}

/** Every field of a form at once (see `follow`). */
export function resync<T extends Record<string, unknown>>(local: T, loaded: T, fresh: T): T {
  const out = { ...local }
  for (const k of Object.keys(fresh) as (keyof T)[]) out[k] = follow(local[k], loaded[k], fresh[k])
  return out
}
