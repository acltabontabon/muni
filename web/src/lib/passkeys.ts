/**
 * Passkeys in the browser, through @simplewebauthn/browser. The browser and the person's device or
 * password manager do the work — including signing in with a phone by scanning the browser's own
 * QR code — and Muni only exchanges standard WebAuthn options and responses with its server.
 *
 * Every ceremony also asks the passkey for its PRF output (WebAuthn's `prf` extension). Where the
 * passkey and browser support it, that output unlocks the account's encryption key in this browser
 * in the same step as signing in (lib/e2ee/wrap.ts). It is taken out of the response before
 * anything is sent: requests to Muni carry no extension results at all. General passkey support
 * says nothing about PRF — only an actual result does.
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
import { api, ApiError, setExpectedAccount } from '@/api/client'
import type { Me, PasskeyInfo } from '@/api/types'
import { readPrefs, writePrefs } from '@/lib/prefs'
import { keyring } from '@/lib/e2ee/keyring'
import { PRF_INPUT } from '@/lib/e2ee/wrap'

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

/** Ask for the passkey's PRF output (for unlocking encrypted content), on every ceremony. */
function withPrf<T extends object>(options: T): T {
  const o = options as T & { extensions?: Record<string, unknown> }
  return { ...o, extensions: { ...(o.extensions ?? {}), prf: { eval: { first: new Uint8Array(PRF_INPUT) } } } }
}

/**
 * The PRF output, copied out of the browser's response (the original is zeroed), and a response
 * that is safe to send: no extension results at all. Built fresh rather than edited in place, so
 * nothing a browser or password manager attached — some return the output as a Uint8Array, which
 * JSON would write out byte by byte — can reach the request.
 */
export function takePrf<R extends { clientExtensionResults?: unknown }>(response: R): { prf: Uint8Array | null; enabled: boolean | null; safe: R } {
  const ext = response.clientExtensionResults as { prf?: { enabled?: unknown; results?: { first?: unknown } } } | undefined
  const first = ext?.prf?.results?.first
  let prf: Uint8Array | null = null
  if (first instanceof ArrayBuffer) {
    prf = new Uint8Array(first.slice(0))
    new Uint8Array(first).fill(0)
  } else if (first && ArrayBuffer.isView(first)) {
    const view = new Uint8Array(first.buffer, first.byteOffset, first.byteLength)
    prf = new Uint8Array(view)
    view.fill(0)
  }
  if (prf && prf.length < 32) prf = null
  const enabled = typeof ext?.prf?.enabled === 'boolean' ? ext.prf.enabled : null
  return { prf, enabled, safe: { ...response, clientExtensionResults: {} } }
}

/** After a ceremony the person chose to do: ask the browser to keep this site's storage (Firefox may ask them). */
function keepStorage() {
  void navigator.storage?.persist?.().catch(() => false)
}

/** Hands the PRF output to the keyring for the account that just proved itself. Never throws. */
async function handOff(accountId: string, credentialId: string, prf: Uint8Array | null, rowId: string | null = null) {
  try {
    await keyring.acceptPasskeyUnlock(accountId, credentialId, prf, rowId)
  } catch {
    prf?.fill(0)
  }
}

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
  const optionsJSON = withPrf(await post<PublicKeyCredentialRequestOptionsJSON>('/api/auth/passkey/login/options', {}))
  lastRpId = optionsJSON.rpId ?? null
  const { prf, safe: response } = takePrf(await startAuthentication({ optionsJSON, useBrowserAutofill: !!opts.conditional }))
  try {
    const me = await post<Me>('/api/auth/passkey/login/verify', { response, installed: isInstalled() })
    setExpectedAccount(me.account_id)
    await handOff(me.account_id, response.id, prf)
    rememberPasskeyHint(true)
    keepStorage()
    return me
  } catch (e) {
    prf?.fill(0)
    if (e instanceof ApiError && e.code === 'passkey_unknown') void forgetUnknown(response.id)
    throw e
  }
}

/**
 * Create a new account whose first sign-in method is a passkey (no email). Only an explicit
 * choice calls this; the entrance asks existing users to continue with their passkey instead.
 */
export async function signUpWithPasskey(displayName: string): Promise<Me> {
  const optionsJSON = withPrf(await post<PublicKeyCredentialCreationOptionsJSON>('/api/auth/passkey/signup/options', { display_name: displayName }))
  const { prf, safe: response } = takePrf(await startRegistration({ optionsJSON }))
  try {
    const me = await post<Me>('/api/auth/passkey/signup/verify', { response, name: suggestedPasskeyName(), installed: isInstalled() })
    setExpectedAccount(me.account_id)
    // Some passkeys answer PRF only when used, not when made: the key is still set up now, and this
    // passkey learns to unlock it the next time it's used here.
    await handOff(me.account_id, response.id, prf)
    rememberPasskeyHint(true)
    keepStorage()
    return me
  } catch (e) {
    prf?.fill(0)
    throw e
  }
}

/** Stop any passkey request this page started (leaving the page, or switching to the button). */
export const cancelPasskey = () => WebAuthnAbortService.cancelCeremony()

/**
 * Whether a passkey can unlock encrypted writing once added. `confirm`: it supports it but only
 * answers when used — one confirmation with it finishes the job. `unsupported`: sign-in only.
 * `later`: this device can't read the writing right now, so nothing could be shared with it (a new
 * passkey never gets access on its own — only from a device that's already unlocked).
 */
export type PasskeyUnlock = 'ready' | 'confirm' | 'unsupported' | 'later'

/** Add a passkey to the signed-in account (needs a recent sign-in; the server checks). */
export async function addPasskey(name: string): Promise<PasskeyInfo & { unlock: PasskeyUnlock }> {
  const optionsJSON = withPrf(await post<PublicKeyCredentialCreationOptionsJSON>('/api/auth/passkey/register/options', {}))
  const { prf, enabled, safe: response } = takePrf(await startRegistration({ optionsJSON }))
  let info: PasskeyInfo
  try {
    info = await post<PasskeyInfo>('/api/auth/passkey/register/verify', { response, name })
  } catch (e) {
    prf?.fill(0)
    throw e
  }
  rememberPasskeyHint(true)
  const id = keyring.accountId()
  const open = keyring.state().kind === 'ready'
  if (prf && id) await handOff(id, response.id, prf, info.id)
  else prf?.fill(0)
  return { ...info, unlock: unlockOf(response.id, !!prf, enabled, open) }
}

function unlockOf(webauthnId: string, gotPrf: boolean, enabled: boolean | null, open: boolean): PasskeyUnlock {
  if (!open) return 'later'
  if (gotPrf) return keyring.canUnlockWith(webauthnId) ? 'ready' : 'confirm'
  return enabled === false ? 'unsupported' : 'confirm'
}

/**
 * One confirmation with a particular passkey (`credential`: our id), so it can unlock: its PRF
 * output wraps the key this device already has open.
 */
export async function enablePasskeyUnlock(credential: string): Promise<PasskeyUnlock> {
  const optionsJSON = withPrf(await post<PublicKeyCredentialRequestOptionsJSON>('/api/auth/passkey/reauth/options', { credential }))
  const { prf, safe: response } = takePrf(await startAuthentication({ optionsJSON }))
  try {
    const me = await post<Me>('/api/auth/passkey/reauth/verify', { response, installed: isInstalled() })
    await handOff(me.account_id, response.id, prf, credential)
  } catch (e) {
    prf?.fill(0)
    throw e
  }
  if (keyring.state().kind !== 'ready') return 'later'
  return keyring.canUnlockWith(response.id) ? 'ready' : prf ? 'confirm' : 'unsupported'
}

/**
 * Confirm it's you with one of this account's passkeys (a fresh, recently authenticated session).
 * A passkey that can unlock also unlocks this device, in the same step.
 */
export async function confirmWithPasskey(): Promise<Me> {
  const optionsJSON = withPrf(await post<PublicKeyCredentialRequestOptionsJSON>('/api/auth/passkey/reauth/options', {}))
  const { prf, safe: response } = takePrf(await startAuthentication({ optionsJSON }))
  try {
    const me = await post<Me>('/api/auth/passkey/reauth/verify', { response, installed: isInstalled() })
    await handOff(me.account_id, response.id, prf)
    keepStorage()
    return me
  } catch (e) {
    prf?.fill(0)
    throw e
  }
}

/** "Unlock with your passkey": the same confirmation, asked for because this device needs it. */
export const unlockWithPasskey = () => confirmWithPasskey()

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
