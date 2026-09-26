import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError, get, onUnauthorized } from '@/api/client'
import type { Me } from '@/api/types'
import { readPrefs } from '@/lib/prefs'
import { deviceStore } from '@/lib/local/store'
import { hasDeviceStorage } from '@/lib/local/LocalProvider'

/**
 * Who is signed in. Three honest situations beyond "signed in":
 *  - `offline` with a cached identity (only on a device that keeps drafts): Muni opens so the
 *    person can write and queue; nothing claims to be current until the server answers.
 *  - `offline` without one: a first visit (or a device that keeps nothing) can't sign in offline.
 *  - `sessionEnded`: the server said 401 while someone was using Muni. They are asked to sign in
 *    again instead of being pulled away from what they were writing.
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
  if (!readPrefs().keepLocal || !hasDeviceStorage()) return null
  try {
    const i = await deviceStore().getIdentity()
    if (!i) return null
    return { account_id: i.account_id, display_name: i.display_name, email: '', workspaces: i.workspaces.map((w) => ({ ...w, is_demo: false })), session_expires_at: '', email_transport: '', ai_provider: '' }
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
    try {
      const m = await get<Me>('/api/auth/me')
      setMe(m)
      setOffline(false)
      setSessionEnded(false)
      if (readPrefs().keepLocal && hasDeviceStorage())
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
    const onOnline = () => refresh()
    window.addEventListener('online', onOnline)
    return () => {
      off()
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
