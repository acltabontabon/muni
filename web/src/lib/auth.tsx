import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError, get, onAccountChanged, onUnauthorized, post, setExpectedAccount } from '@/api/client'
import type { Me } from '@/api/types'
import { keepsLocal, keptAccounts, worldFor } from '@/lib/prefs'
import { deviceStore } from '@/lib/local/store'
import { hasDeviceStorage } from '@/lib/local/LocalProvider'
import { announceSignIn, clearPendingSignOut, hasPendingSignOut, onAuthElsewhere } from '@/lib/signout'

/**
 * Who is signed in. Three honest situations beyond "signed in":
 *  - `offline` with a cached identity (only on a device that keeps drafts): Muni opens so the
 *    person can write and queue; nothing claims to be current until the server answers.
 *  - `offline` without one: a first visit (or a device that keeps nothing) can't sign in offline.
 *  - `sessionEnded`: the session ended while someone was using Muni (a 401, confirmed — a request
 *    can also 401 because signing in again just replaced the session). They are asked to sign in
 *    again instead of being pulled away from what they were writing; the encryption key leaves
 *    memory meanwhile (lib/e2ee), and signing in again reopens it.
 * Signing out in another tab signs this one out too (keys and decrypted content go with it), and
 * signing in as someone else in another tab makes this one follow. `sessionEpoch` counts successful
 * checks with the server, so the encryption key is reopened after each new sign-in.
 * A device that signed out while Muni was unreachable stays signed out (lib/signout.ts): it never
 * opens as the old account, and it keeps asking the server to end that session.
 */
type AuthState = {
  me: Me | null
  loading: boolean
  offline: boolean
  sessionEnded: boolean
  sessionEpoch: number
  refresh: () => Promise<Me | null>
  signOutLocal: () => void
}
const Ctx = createContext<AuthState>({ me: null, loading: true, offline: false, sessionEnded: false, sessionEpoch: 0, refresh: async () => null, signOutLocal: () => {} })

async function cachedIdentity(): Promise<Me | null> {
  if (!keptAccounts().length || !hasDeviceStorage()) return null
  try {
    const i = await deviceStore().getIdentity()
    // Only someone who chose to keep drafts on this device can open Muni from it offline.
    if (!i || !keptAccounts().includes(i.account_id)) return null
    // Their character comes from this device's copy; offline is never the moment for the chooser.
    const w = worldFor(i.account_id)
    // Offline, the guide keeps quiet: it would point at controls that need a connection.
    return { account_id: i.account_id, display_name: i.display_name, needs_name: false, email: '', workspaces: i.workspaces.map((w) => ({ ...w, is_demo: false })), session_expires_at: '', email_transport: '', passkeys: 0, auth_method: null, recent_auth_until: '', pending_join_requests: [], avatar: { id: w?.avatar ?? null, theme: w?.theme ?? true, intro: 'done' }, guide: 'done' }
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [offline, setOffline] = useState(false)
  const [sessionEnded, setSessionEnded] = useState(false)
  const [sessionEpoch, setSessionEpoch] = useState(0)
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
      setExpectedAccount(null)
      setMe(null)
      setOffline(false)
      setSessionEnded(false)
      setLoading(false)
      return null
    }
    try {
      const m = await get<Me>('/api/auth/me')
      if (m.account_id !== meRef.current?.account_id) announceSignIn(m.account_id)
      setExpectedAccount(m.account_id)
      meRef.current = m
      setMe(m)
      setOffline(false)
      setSessionEnded(false)
      setSessionEpoch((n) => n + 1)
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
        if (!meRef.current && cached) setExpectedAccount(cached.account_id)
        return cached
      }
      if (e instanceof ApiError && e.status === 401 && meRef.current) {
        // The session ended while Muni was open: ask to sign in again, don't pull the page away.
        setSessionEnded(true)
        return meRef.current
      }
      setExpectedAccount(null)
      setMe(null)
      return null
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    refresh()
    // A 401 can come from a request that left just before signing in again replaced the session:
    // only a 401 from who-am-I itself means the session really ended.
    let confirming = false
    const off = onUnauthorized(() => {
      if (confirming || !meRef.current) return
      confirming = true
      get<Me>('/api/auth/me')
        .then(
          () => {},
          (e) => e instanceof ApiError && e.status === 401 && setSessionEnded(true),
        )
        .finally(() => {
          confirming = false
        })
    })
    const offElsewhere = onAuthElsewhere((e) => {
      if (e.kind === 'out') {
        // Signed out in another tab: signed out here too.
        setExpectedAccount(null)
        meRef.current = null
        setMe(null)
        setSessionEnded(false)
      } else if (e.accountId !== meRef.current?.account_id) void refresh()
    })
    const offChanged = onAccountChanged(() => void refresh())
    const onOnline = () => refresh()
    window.addEventListener('online', onOnline)
    return () => {
      off()
      offElsewhere()
      offChanged()
      window.removeEventListener('online', onOnline)
    }
  }, [refresh])
  const value = useMemo(
    () => ({ me, loading, offline, sessionEnded, sessionEpoch, refresh, signOutLocal: () => { setExpectedAccount(null); meRef.current = null; setMe(null); setSessionEnded(false) } }),
    [me, loading, offline, sessionEnded, sessionEpoch, refresh],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
