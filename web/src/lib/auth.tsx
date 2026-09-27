import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError, get, onUnauthorized, post } from '@/api/client'
import type { Me } from '@/api/types'
import { adoptLegacyKeep, keepsLocal, keptAccounts, readPrefs, worldFor } from '@/lib/prefs'
import { deviceStore } from '@/lib/local/store'
import { hasDeviceStorage } from '@/lib/local/LocalProvider'
import { clearPendingSignOut, hasPendingSignOut, onSignOutElsewhere } from '@/lib/signout'

/**
 * Who is signed in. Three honest situations beyond "signed in":
 *  - `offline` with a cached identity (only on a device that keeps drafts): Muni opens so the
 *    person can write and queue; nothing claims to be current until the server answers.
 *  - `offline` without one: a first visit (or a device that keeps nothing) can't sign in offline.
 *  - `sessionEnded`: the server said 401 while someone was using Muni, or another tab signed out.
 *    They are asked to sign in again instead of being pulled away from what they were writing.
 * A device that signed out while Muni was unreachable stays signed out (lib/signout.ts): it never
 * opens as the old account, and it keeps asking the server to end that session.
 */
type AuthState = {
  me: Me | null
  loading: boolean
  offline: boolean
  sessionEnded: boolean
  refresh: () => Promise<Me | null>
  signOutLocal: () => void
}
const Ctx = createContext<AuthState>({ me: null, loading: true, offline: false, sessionEnded: false, refresh: async () => null, signOutLocal: () => {} })

async function cachedIdentity(): Promise<Me | null> {
  const legacy = !!readPrefs().keepLocal && readPrefs().keepLocalFor === undefined
  if ((!keptAccounts().length && !legacy) || !hasDeviceStorage()) return null
  try {
    const i = await deviceStore().getIdentity()
    // Only someone who chose to keep drafts on this device can open Muni from it offline.
    if (!i || (!legacy && !keptAccounts().includes(i.account_id))) return null
    // Their character comes from this device's copy; offline is never the moment for the chooser.
    const w = worldFor(i.account_id)
    return { account_id: i.account_id, display_name: i.display_name, needs_name: false, email: '', workspaces: i.workspaces.map((w) => ({ ...w, is_demo: false })), session_expires_at: '', email_transport: '', ai_provider: '', passkeys: 0, auth_method: null, recent_auth_until: '', pending_join_requests: [], avatar: { id: w?.avatar ?? null, theme: w?.theme ?? true, intro: 'done' } }
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [offline, setOffline] = useState(false)
  const [sessionEnded, setSessionEnded] = useState(false)
  const meRef = useRef<Me | null>(null)
  useEffect(() => {
    meRef.current = me
  }, [me])
  const refresh = useCallback(async () => {
    if (hasPendingSignOut()) {
      try {
        await post('/api/auth/logout')
        clearPendingSignOut()
      } catch (e) {
        // Already ended (401): done. Unreachable or refused: stay signed out here and retry next time.
        if (e instanceof ApiError && e.status === 401) clearPendingSignOut()
      }
      setMe(null)
      setOffline(false)
      setSessionEnded(false)
      setLoading(false)
      return null
    }
    try {
      const m = await get<Me>('/api/auth/me')
      setMe(m)
      setOffline(false)
      setSessionEnded(false)
      adoptLegacyKeep(m.account_id)
      if (keepsLocal(m.account_id) && hasDeviceStorage())
        deviceStore()
          .putIdentity({ account_id: m.account_id, display_name: m.display_name, workspaces: m.workspaces.map((w) => ({ id: w.id, name: w.name, role: w.role })), savedAt: Date.now() })
          .catch(() => {})
      return m
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        // No connection: open from what this device kept, if anything.
        setOffline(true)
        const cached = await cachedIdentity()
        setMe((cur) => cur ?? cached)
        return cached
      }
      if (e instanceof ApiError && e.status === 401 && meRef.current) {
        // The session ended while Muni was open: ask to sign in again, don't pull the page away.
        setSessionEnded(true)
        return meRef.current
      }
      setMe(null)
      return null
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    refresh()
    const off = onUnauthorized(() => setSessionEnded(true))
    const offElsewhere = onSignOutElsewhere(() => (meRef.current ? setSessionEnded(true) : setMe(null)))
    const onOnline = () => refresh()
    window.addEventListener('online', onOnline)
    return () => {
      off()
      offElsewhere()
      window.removeEventListener('online', onOnline)
    }
  }, [refresh])
  const value = useMemo(
    () => ({ me, loading, offline, sessionEnded, refresh, signOutLocal: () => { setMe(null); setSessionEnded(false) } }),
    [me, loading, offline, sessionEnded, refresh],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
