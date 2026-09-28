import { useCallback, useState } from 'react'
import { keepsLocal } from '@/lib/prefs'

/**
 * Words written during a live retro that haven't been sent yet: a line for a check-in, something
 * added to the talk. Kept for this tab in memory, so a topic changing underneath, a reconnect, a
 * phone put down and picked up again, or a re-render never loses them. For someone who chose to keep
 * drafts on this device they also survive a reload (sessionStorage, gone with the tab and at sign-out).
 */
const memory = new Map<string, string>()
const storageKey = (key: string) => `muni:retro:${key}`

export function readRetroDraft(key: string, accountId: string | null): string {
  if (memory.has(key)) return memory.get(key) ?? ''
  if (!keepsLocal(accountId)) return ''
  try {
    return sessionStorage.getItem(storageKey(key)) ?? ''
  } catch {
    return ''
  }
}

export function writeRetroDraft(key: string, value: string, accountId: string | null) {
  if (value) memory.set(key, value)
  else memory.delete(key)
  if (!keepsLocal(accountId)) return
  try {
    if (value) sessionStorage.setItem(storageKey(key), value)
    else sessionStorage.removeItem(storageKey(key))
  } catch {
    /* private mode: memory still has it */
  }
}

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
