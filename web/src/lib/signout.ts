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

/**
 * What other tabs on this device did: signed out, or signed in (as whom). Sent on a
 * BroadcastChannel, and also recorded as a counter in localStorage so a tab that was frozen or in
 * the back-forward cache (and missed the message) catches up the moment it's shown again.
 */
export type AuthElsewhere = { kind: 'out' } | { kind: 'in'; accountId: string }
const GEN = 'muni.auth-gen'
type Gen = { n: number; kind: 'in' | 'out'; account: string | null }
function readGen(): Gen | null {
  try {
    const v = JSON.parse(localStorage.getItem(GEN) ?? 'null')
    return v && typeof v.n === 'number' ? v : null
  } catch {
    return null
  }
}
/** The latest change this tab has already taken into account (its own, or one it was told about). */
let seen = (() => {
  try {
    return readGen()?.n ?? 0
  } catch {
    return 0
  }
})()
function bump(kind: 'in' | 'out', account: string | null) {
  const next = { n: Math.max(seen, readGen()?.n ?? 0) + 1, kind, account }
  seen = next.n
  try {
    localStorage.setItem(GEN, JSON.stringify(next))
  } catch {
    /* private mode: the channel still tells open tabs */
  }
}

/** Tells other open tabs this device signed out (they sign out too, and drop keys and decrypted content). */
export function announceSignOut() {
  bump('out', null)
  channel?.postMessage('signed-out')
}
/** Tells other open tabs who is signed in now (a tab showing a different account stops acting as it). */
export function announceSignIn(accountId: string) {
  bump('in', accountId)
  channel?.postMessage(`signed-in:${accountId}`)
}

const handlers = new Set<(e: AuthElsewhere) => void>()
const dispatch = (e: AuthElsewhere) => handlers.forEach((h) => h(e))
function fromGen(g: Gen): AuthElsewhere {
  return g.kind === 'in' && g.account ? { kind: 'in', accountId: g.account } : { kind: 'out' }
}
/** Catches up with anything another tab did since this one last looked (cheap; synchronous). */
export function checkElsewhere() {
  const g = readGen()
  if (!g || g.n <= seen) return
  seen = g.n
  dispatch(fromGen(g))
}

export function onAuthElsewhere(fn: (e: AuthElsewhere) => void): () => void {
  handlers.add(fn)
  const onMsg = (e: MessageEvent) => {
    if (e.data === 'signed-out') {
      seen = Math.max(seen, readGen()?.n ?? 0)
      fn({ kind: 'out' })
    } else if (typeof e.data === 'string' && e.data.startsWith('signed-in:')) {
      seen = Math.max(seen, readGen()?.n ?? 0)
      fn({ kind: 'in', accountId: e.data.slice('signed-in:'.length) })
    }
  }
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY && e.newValue !== null) fn({ kind: 'out' })
    else if (e.key === GEN) checkElsewhere()
  }
  const onShow = () => checkElsewhere()
  const onVisible = () => document.visibilityState === 'visible' && checkElsewhere()
  channel?.addEventListener('message', onMsg)
  window.addEventListener('storage', onStorage)
  window.addEventListener('pageshow', onShow)
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    handlers.delete(fn)
    channel?.removeEventListener('message', onMsg)
    window.removeEventListener('storage', onStorage)
    window.removeEventListener('pageshow', onShow)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
/** Kept for callers that only care about signing out. */
export function onSignOutElsewhere(fn: () => void): () => void {
  return onAuthElsewhere((e) => e.kind === 'out' && fn())
}

/** Sign-in endpoints whose success replaces any session this device had. */
export const SIGN_IN_PATHS = new Set(['/api/auth/verify', '/api/auth/passkey/login/verify', '/api/auth/passkey/signup/verify'])
