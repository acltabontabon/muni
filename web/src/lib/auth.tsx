import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { get, onUnauthorized } from '@/api/client'
import type { Me } from '@/api/types'

type AuthState = { me: Me | null; loading: boolean; refresh: () => Promise<Me | null>; signOutLocal: () => void }
const Ctx = createContext<AuthState>({ me: null, loading: true, refresh: async () => null, signOutLocal: () => {} })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(async () => {
    try {
      const m = await get<Me>('/api/auth/me')
      setMe(m)
      return m
    } catch {
      setMe(null)
      return null
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    refresh()
    const off = onUnauthorized(() => setMe(null))
    return () => { off() }
  }, [refresh])
  const value = useMemo(() => ({ me, loading, refresh, signOutLocal: () => setMe(null) }), [me, loading, refresh])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
