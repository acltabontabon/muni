/**
 * Signing out when Muni can't be reached. The session cookie is HttpOnly, so this device can't
 * delete it; instead it remembers that it signed out and treats itself as signed out — on refresh
 * and in other tabs — until the server has ended the session (retried on every start) or someone
 * signs in again (which rotates, and so ends, the old session anyway). Holds no credential.
 */
const KEY = 'muni.signout-pending'
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('muni-auth') : null

export function hasPendingSignOut(): boolean {
  try {
    return localStorage.getItem(KEY) !== null
  } catch {
    return false
  }
}
export function markSignedOutLocally() {
  try {
    localStorage.setItem(KEY, String(Date.now()))
  } catch {
    /* private mode: this tab still signs out; a refresh may not stay signed out */
  }
}
export function clearPendingSignOut() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* private mode */
  }
}

/** Tells other open tabs this device signed out (they stop acting as the account, keeping unsent text). */
export function announceSignOut() {
  channel?.postMessage('signed-out')
}
export function onSignOutElsewhere(fn: () => void): () => void {
  const onMsg = (e: MessageEvent) => e.data === 'signed-out' && fn()
  const onStorage = (e: StorageEvent) => e.key === KEY && e.newValue !== null && fn()
  channel?.addEventListener('message', onMsg)
  window.addEventListener('storage', onStorage)
  return () => {
    channel?.removeEventListener('message', onMsg)
    window.removeEventListener('storage', onStorage)
  }
}

/** Sign-in endpoints whose success replaces any session this device had. */
export const SIGN_IN_PATHS = new Set(['/api/auth/verify', '/api/auth/passkey/login/verify', '/api/auth/passkey/signup/verify'])
