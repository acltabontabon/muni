/**
 * The workspace the person is looking at. Remembered per device (their last explicit choice) and
 * always validated against the workspaces they belong to now: a remembered id they lost access
 * to is never used.
 */
import { useSyncExternalStore } from 'react'
import type { Me } from '@/api/types'
import { readPrefs, writePrefs } from '@/lib/prefs'

const listeners = new Set<() => void>()
let explicit: string | null = readPrefs().lastWorkspace ?? null

export function chooseWorkspace(id: string) {
  explicit = id
  writePrefs({ lastWorkspace: id })
  listeners.forEach((l) => l())
}

const useExplicit = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => explicit)

/** `hint` is where something is collecting, used only when nothing was chosen before. */
export function useCurrentWorkspace(me: Me | null, hint?: string | null): Me['workspaces'][number] | null {
  const chosen = useExplicit()
  if (!me || me.workspaces.length === 0) return null
  return me.workspaces.find((w) => w.id === chosen) ?? me.workspaces.find((w) => w.id === hint) ?? me.workspaces[0]
}
