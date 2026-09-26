/**
 * Connects the keyring to the signed-in account and to the API client, and exposes the device's
 * encryption state to the UI in plain words.
 */
import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { api, setContentHooks } from '@/api/client'
import { useAuth } from '@/lib/auth'
import { keyring, type DeviceState, type KeyChange } from './keyring'

const fetcher = <T,>(method: string, path: string, body?: unknown) => api<T>(path, { method, json: body, plain: true })
const sprintOf = (path: string) => path.match(/^\/api\/sprints\/([^/?]+)/)?.[1] ?? null

setContentHooks({
  seal: (method, path, body) => keyring.sealRequest(method, path, body),
  open: (data, path) => (JSON.stringify(data ?? null).includes('"e1.') ? keyring.decryptDeep(data, sprintOf(path)) : Promise.resolve(data)),
})

export function E2eeProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth()
  const id = me?.account_id ?? null
  useEffect(() => {
    void keyring.use(id, fetcher)
  }, [id])
  return <>{children}</>
}

let snapshot: { state: DeviceState; changes: KeyChange[] } = { state: keyring.state(), changes: [] }
keyring.subscribe(() => {
  snapshot = { state: keyring.state(), changes: keyring.keyChanges() }
})

export function useDeviceKeys() {
  return useSyncExternalStore(keyring.subscribe, () => snapshot)
}
