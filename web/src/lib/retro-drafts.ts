import { useCallback, useState } from 'react'
import { expectedAccountId, onExpectedAccount } from '@/api/client'
import { keepsLocal } from '@/lib/prefs'

/**
 * Words written during a live retro that haven't been sent yet: a line for a check-in, something
 * added to the talk. Kept for this tab in memory, so a topic changing underneath, a reconnect, a
 * phone put down and picked up again, or a re-render never loses them. For someone who chose to keep
 * drafts on this device they also survive a reload (sessionStorage, gone with the tab).
 *
 * They belong to one person: kept under the account this tab acts for (the auth layer says who
 * that is, whatever a caller passes), and gone when that person signs out, someone else signs in
 * here, or "Clear local data" is used.
 */
const memory = new Map<string, string>()
const PREFIX = 'muni:retro:'
const storageKey = (who: string, key: string) => `${PREFIX}${who}:${key}`

/** Whose words these are: the signed-in account, and only if the caller means the same one. */
function owner(accountId: string | null): string | null {
  const who = expectedAccountId()
  return who && (!accountId || accountId === who) ? who : null
}

export function readRetroDraft(key: string, accountId: string | null): string {
  const who = owner(accountId)
  if (!who) return ''
  const k = storageKey(who, key)
  if (memory.has(k)) return memory.get(k) ?? ''
  if (!keepsLocal(who)) return ''
  try {
    return sessionStorage.getItem(k) ?? ''
  } catch {
    return ''
  }
}

export function writeRetroDraft(key: string, value: string, accountId: string | null) {
  const who = owner(accountId)
  if (!who) return
  const k = storageKey(who, key)
  if (value) memory.set(k, value)
  else memory.delete(k)
  if (!keepsLocal(who)) return
  try {
    if (value) sessionStorage.setItem(k, value)
    else sessionStorage.removeItem(k)
  } catch {
    /* private mode: memory still has it */
  }
}

/** Every unsent retro word in this tab, for everyone: signing out, and "Clear local data". */
export function clearRetroDrafts() {
  memory.clear()
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith(PREFIX)) sessionStorage.removeItem(k)
  } catch {
    /* private mode: nothing was stored */
  }
}

// The person this tab acts for signed out, or someone else signed in: their words go with them.
let current = expectedAccountId()
onExpectedAccount((id) => {
  if (current && id !== current) clearRetroDrafts()
  current = id
})

export function useRetroDraft(key: string, accountId: string | null): [string, (v: string) => void] {
  const [state, setState] = useState(() => ({ key, value: readRetroDraft(key, accountId) }))
  const value = state.key === key ? state.value : readRetroDraft(key, accountId)
  const set = useCallback(
    (v: string) => {
      writeRetroDraft(key, v, accountId)
      setState({ key, value: v })
    },
    [key, accountId],
  )
  return [value, set]
}
