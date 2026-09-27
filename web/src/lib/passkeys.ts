/**
 * Passkeys in the browser, through @simplewebauthn/browser. The browser and the person's device or
 * password manager do the work — including signing in with a phone by scanning the browser's own
 * QR code — and Muni only exchanges standard WebAuthn options and responses with its server.
 *
 * Nothing here stores a credential: the only thing kept on the device is a hint that a passkey was
 * used here before (to put the passkey button first), and it's never taken as proof of anything.
 */
import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  platformAuthenticatorIsAvailable,
  sendSignal,
  startAuthentication,
  startRegistration,
  WebAuthnAbortService,
  WebAuthnError,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'
import { api, ApiError } from '@/api/client'
import type { Me, PasskeyInfo } from '@/api/types'
import { readPrefs, writePrefs } from '@/lib/prefs'

export const supportsPasskeys = () => typeof window !== 'undefined' && browserSupportsWebAuthn()
export const supportsAutofill = () => (supportsPasskeys() ? browserSupportsWebAuthnAutofill().catch(() => false) : Promise.resolve(false))
/** A built-in authenticator (Touch ID, Windows Hello, a phone's screen lock). Not proof a passkey exists. */
export const hasPlatformAuthenticator = () => (supportsPasskeys() ? platformAuthenticatorIsAvailable().catch(() => false) : Promise.resolve(false))

/** Installed app window (sessions are labelled "Muni app" on the account page). */
export const isInstalled = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)

export const hasPasskeyHint = () => !!readPrefs().passkeyHint
export const rememberPasskeyHint = (on: boolean) => writePrefs({ passkeyHint: on || undefined })

const post = <T,>(path: string, json: unknown) => api<T>(path, { method: 'POST', json, plain: true })

/** Why a ceremony didn't finish, in words for people. Cancelling is ordinary, never an alarm. */
export type PasskeyProblem = { kind: 'cancelled' | 'unsupported' | 'exists' | 'expired' | 'unknown' | 'offline' | 'reauth' | 'failed'; message: string }

export function describePasskeyError(e: unknown, during: 'signin' | 'add' | 'confirm' | 'create' = 'signin'): PasskeyProblem {
  if (e instanceof ApiError) {
    if (e.status === 0) return { kind: 'offline', message: 'You’re offline. Passkeys need a connection to Muni — try again when you’re back online.' }
    if (e.code === 'passkey_unknown') return { kind: 'unknown', message: 'That passkey isn’t linked to a Muni account any more — it may have been removed. Try another passkey, or use a recovery email if your account has one.' }
    if (e.code === 'passkey_taken') return { kind: 'exists', message: 'That passkey already belongs to a Muni account. Go back and continue with it to sign in.' }
    if (e.code === 'quota') return { kind: 'failed', message: sentence(e.message) }
    if (e.code === 'challenge_expired' || e.code === 'challenge_used') return { kind: 'expired', message: 'That took a little long. Try again.' }
    if (e.code === 'passkey_exists') return { kind: 'exists', message: 'That passkey is already on your account.' }
    if (e.code === 'reauth_required') return { kind: 'reauth', message: 'Confirm it’s you first, then try again.' }
    if (e.code === 'rate_limited') return { kind: 'failed', message: during === 'create' ? 'Too many new accounts from this network today. Try again tomorrow.' : 'Too many attempts. Wait a little and try again.' }
    return { kind: 'failed', message: during === 'signin' ? 'That passkey couldn’t be verified. Try again, or use email instead.' : `${sentence(e.message)}` }
  }
  if (e instanceof WebAuthnError) {
    if (e.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') return { kind: 'exists', message: 'This device or password manager already has a passkey for your account.' }
    if (e.code === 'ERROR_CEREMONY_ABORTED') return { kind: 'cancelled', message: '' }
    if (e.code === 'ERROR_INVALID_DOMAIN' || e.code === 'ERROR_INVALID_RP_ID') return { kind: 'unsupported', message: 'Passkeys can’t be used on this address. Use email instead.' }
    if (e.code === 'ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT' || e.code === 'ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT')
      return { kind: 'unsupported', message: 'This authenticator can’t make a passkey Muni can use (it needs a screen lock, PIN or biometric). Try another device or password manager.' }
  }
  const name = (e as { name?: string })?.name ?? (e as { cause?: { name?: string } })?.cause?.name
  // NotAllowedError covers cancelling, timing out, and "no passkey for this site here" — the browser
  // doesn't say which, on purpose. None of them is a problem; offer the way forward.
  if (name === 'NotAllowedError' || name === 'AbortError')
    return {
      kind: 'cancelled',
      message:
        during === 'signin'
          ? 'No passkey was used. If it’s on your phone, try again and choose the option to use a phone or tablet. New to Muni? Create an account below.'
          : during === 'create'
            ? 'No passkey was saved, so no account was created. Try again whenever you’re ready.'
            : during === 'add'
            ? 'No passkey was added. You can try again whenever you like.'
            : 'Not confirmed. Try again, or use an email code.',
    }
  if (name === 'NotSupportedError' || name === 'SecurityError') return { kind: 'unsupported', message: 'Passkeys aren’t available in this browser. Use email instead.' }
  return { kind: 'failed', message: during === 'signin' ? 'Something went wrong with the passkey. Try again, or use email instead.' : 'Something went wrong with the passkey. Try again.' }
}

let lastRpId: string | null = null
/** When the server no longer knows a passkey, ask the password manager to stop offering it (WebAuthn L3 signals, where supported). */
async function forgetUnknown(credentialID: string) {
  if (!lastRpId) return
  try {
    await sendSignal({ signalName: 'unknownCredential', rpID: lastRpId, credentialID })
  } catch {
    /* not supported here; harmless */
  }
}

/**
 * Sign in with a passkey. `conditional` waits quietly in the email field's autofill (the browser
 * shows saved passkeys there); otherwise the browser's own passkey sheet opens now.
 */
export async function signInWithPasskey(opts: { conditional?: boolean } = {}): Promise<Me> {
  const optionsJSON = await post<PublicKeyCredentialRequestOptionsJSON>('/api/auth/passkey/login/options', {})
  lastRpId = optionsJSON.rpId ?? null
  const response = await startAuthentication({ optionsJSON, useBrowserAutofill: !!opts.conditional })
  try {
    const me = await post<Me>('/api/auth/passkey/login/verify', { response, installed: isInstalled() })
    rememberPasskeyHint(true)
    return me
  } catch (e) {
    if (e instanceof ApiError && e.code === 'passkey_unknown') void forgetUnknown(response.id)
    throw e
  }
}

/**
 * Create a new account whose first sign-in method is a passkey (no email). Only an explicit
 * choice calls this; the entrance asks existing users to continue with their passkey instead.
 */
export async function signUpWithPasskey(displayName: string): Promise<Me> {
  const optionsJSON = await post<PublicKeyCredentialCreationOptionsJSON>('/api/auth/passkey/signup/options', { display_name: displayName })
  const response = await startRegistration({ optionsJSON })
  const me = await post<Me>('/api/auth/passkey/signup/verify', { response, name: suggestedPasskeyName(), installed: isInstalled() })
  rememberPasskeyHint(true)
  return me
}

/** Stop any passkey request this page started (leaving the page, or switching to the button). */
export const cancelPasskey = () => WebAuthnAbortService.cancelCeremony()

/** Add a passkey to the signed-in account (needs a recent sign-in; the server checks). */
export async function addPasskey(name: string): Promise<PasskeyInfo> {
  const optionsJSON = await post<PublicKeyCredentialCreationOptionsJSON>('/api/auth/passkey/register/options', {})
  const response = await startRegistration({ optionsJSON })
  const info = await post<PasskeyInfo>('/api/auth/passkey/register/verify', { response, name })
  rememberPasskeyHint(true)
  return info
}

/** Confirm it's you with one of this account's passkeys (a fresh, recently authenticated session). */
export async function confirmWithPasskey(): Promise<Me> {
  const optionsJSON = await post<PublicKeyCredentialRequestOptionsJSON>('/api/auth/passkey/reauth/options', {})
  const response = await startAuthentication({ optionsJSON })
  return post<Me>('/api/auth/passkey/reauth/verify', { response, installed: isInstalled() })
}

/** A starting label the person can change. Coarse on purpose: a passkey may sync to other devices. */
export function suggestedPasskeyName(): string {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'Apple passkey'
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac passkey'
  if (/Android/.test(ua)) return 'Android passkey'
  if (/Windows/.test(ua)) return 'Windows passkey'
  return 'Passkey'
}

function sentence(m: string) {
  const t = m.trim()
  return t ? t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.') : t
}
