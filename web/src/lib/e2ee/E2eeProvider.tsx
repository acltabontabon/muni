/**
 * Connects the keyring to the signed-in account and to the API client, and exposes the device's
 * encryption state to the UI in plain words.
 */
import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { api, setContentHooks } from '@/api/client'
import { useAuth } from '@/lib/auth'
import { checkElsewhere, onAuthElsewhere } from '@/lib/signout'
import { containsEnvelope, keyring, type DeviceState, type KeyChange } from './keyring'

const fetcher = <T,>(method: string, path: string, body?: unknown) => api<T>(path, { method, json: body, plain: true })
const sprintOf = (path: string) => path.match(/^\/api\/sprints\/([^/?]+)/)?.[1] ?? null

setContentHooks({
  seal: (method, path, body) => keyring.sealRequest(method, path, body),
  // Most responses carry nothing encrypted: looked through once, stopping at the first envelope.
  open: (data, path) => (containsEnvelope(data) ? keyring.decryptDeep(data, sprintOf(path)) : Promise.resolve(data)),
})

if (typeof window !== 'undefined') {
  // Another tab signed out, or signed in as someone else: the key leaves this tab at once, before
  // anything else is sealed or opened (auth follows, and the views holding decrypted text unmount).
  onAuthElsewhere((e) => {
    if (e.kind === 'out' || e.accountId !== keyring.accountId()) keyring.lock()
  })
  // A tab that was frozen or cached may have missed the message: it checks before using the key.
  keyring.setStaleCheck(checkElsewhere)
  // Leaving the page aborts storage writes: a new key isn't published while that's happening.
  window.addEventListener('pagehide', () => keyring.pageLeaving(true))
  window.addEventListener('pageshow', () => keyring.pageLeaving(false))
}

export function E2eeProvider({ children }: { children: ReactNode }) {
  const { me, sessionEnded, sessionEpoch } = useAuth()
  const id = me?.account_id ?? null
  // Reopened after every successful sign-in or check (sessionEpoch); locked while the session has
  // ended (what the person was writing stays; the key doesn't).
  useEffect(() => {
    void keyring.use(sessionEnded ? null : id, fetcher)
  }, [id, sessionEnded, sessionEpoch])
  return <>{children}</>
}

let snapshot: { state: DeviceState; changes: KeyChange[]; keysEpoch: number } = { state: keyring.state(), changes: [], keysEpoch: keyring.keysEpoch() }
keyring.subscribe(() => {
  snapshot = { state: keyring.state(), changes: keyring.keyChanges(), keysEpoch: keyring.keysEpoch() }
})

export function useDeviceKeys() {
  return useSyncExternalStore(keyring.subscribe, () => snapshot)
}
/** Changes each time the key becomes usable here: a dependency for loaders of encrypted content. */
export function useKeysEpoch() {
  return useDeviceKeys().keysEpoch
}
