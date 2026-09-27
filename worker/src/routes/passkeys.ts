/**
 * Passkeys: standard WebAuthn through @simplewebauthn/server (docs/PASSKEYS.md).
 *
 * A passkey is the only way into an account. What it proves is control of the account, and
 * nothing more: it grants no membership. Separately, and only in the browser, a passkey that
 * supports the PRF extension can unlock the account's encryption key (routes/keys.ts); its PRF
 * output never reaches the server, which refuses any request that carries one. A passkey is added only by a
 * signed-in person who recently proved control of the account with another passkey.
 *
 * Every ceremony uses a random, expiring, single-use challenge from our own table. The challenge is
 * consumed atomically *before* the response is verified, so a replayed or concurrently reused
 * response can create at most one credential or session. Origins and the RP ID come only from
 * configuration (lib/config.ts), never from request headers.
 */
import { Hono, type Context } from 'hono'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server'
import { decodeClientDataJSON, isoBase64URL } from '@simplewebauthn/server/helpers'
import type { HonoEnv } from '../env'
import { config, type Config } from '../lib/config'
import {
  checkOrigin,
  clientLabel,
  cookie,
  createSession,
  loadSession,
  readCookie,
  requireAuth,
  requireRecentAuth,
  revokeSession,
  securityEvent,
  sessionCookie,
  setSessionCookies,
} from '../lib/auth'
import { randomToken, sha256Hex, uuid } from '../lib/crypto'
import { all, batch, one, run } from '../lib/db'
import { AppError, bad, notFound } from '../lib/errors'
import { clientClass, limit, underLimit } from '../lib/ratelimit'
import { nonempty } from '../lib/util'
import { newAccountStatement } from '../lib/accounts'
import { buildMe } from './auth'

export const passkeys = new Hono<HonoEnv>()

export const CHALLENGE_TTL_MS = 5 * 60_000
const MAX_PASSKEYS = 20
const MAX_BODY = 32 * 1024

/** The sign-in ceremony's browser binding. Host-only, HttpOnly, Strict, short-lived. */
const bindingCookie = (cfg: Config) => (cfg.cookieSecure ? '__Host-muni_wa' : 'muni_wa')

interface CredentialRow {
  id: string
  credential_id: string
  account_id: string
  public_key: string
  counter: number
  transports: string
  backup_eligible: number
  backed_up: number
  name: string
  created_at: number
  last_used_at: number | null
}

const failed = (code: string, message: string, status = 400) => new AppError(status, code, message)
/** One message for every verification failure: details go to nobody (they'd help only an attacker). */
const notVerified = () => failed('passkey_failed', 'that passkey couldn’t be verified — try again')

async function readJson(c: Context<HonoEnv>): Promise<Record<string, unknown>> {
  const len = Number(c.req.header('content-length') ?? 0)
  if (len > MAX_BODY) throw bad('request too large')
  const text = await c.req.text()
  if (text.length > MAX_BODY) throw bad('request too large')
  try {
    const v = JSON.parse(text || '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

const b64url = /^[A-Za-z0-9_-]+$/
const str = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max
/**
 * The passkey's PRF output unlocks the account key in the browser and must never reach Muni. The
 * client sends no extension results at all; a body carrying PRF results is refused, not stored.
 */
function noPrfResults(r: { clientExtensionResults?: unknown }) {
  const prf = (r.clientExtensionResults as { prf?: { results?: unknown } } | undefined)?.prf
  if (prf && typeof prf === 'object' && 'results' in prf) throw failed('prf_not_allowed', 'that request carried a passkey secret Muni must never receive — nothing was sent on. Reload and try again.')
}
/** Shape checks before the library parses anything: bounded, well-typed, base64url where it must be. */
function assertionShape(v: unknown): AuthenticationResponseJSON {
  const r = v as AuthenticationResponseJSON
  if (r && typeof r === 'object') noPrfResults(r)
  if (!r || typeof r !== 'object' || r.type !== 'public-key' || !str(r.id, 1400) || !b64url.test(r.id) || r.rawId !== r.id || !r.response) throw notVerified()
  const x = r.response
  if (!str(x.clientDataJSON, 4096) || !str(x.authenticatorData, 8192) || !str(x.signature, 2048)) throw notVerified()
  if (x.userHandle !== undefined && x.userHandle !== null && !str(x.userHandle, 128)) throw notVerified()
  return r
}
function attestationShape(v: unknown): RegistrationResponseJSON {
  const r = v as RegistrationResponseJSON
  if (r && typeof r === 'object') noPrfResults(r)
  if (!r || typeof r !== 'object' || r.type !== 'public-key' || !str(r.id, 1400) || !b64url.test(r.id) || r.rawId !== r.id || !r.response) throw notVerified()
  if (!str(r.response.clientDataJSON, 4096) || !str(r.response.attestationObject, 24_000)) throw notVerified()
  return r
}
function challengeOf(clientDataJSON: string): string {
  try {
    const c = decodeClientDataJSON(clientDataJSON).challenge
    if (typeof c === 'string' && c.length <= 128 && b64url.test(c)) return c
  } catch {
    /* fall through */
  }
  throw notVerified()
}

/**
 * Spends a challenge exactly once. The conditional UPDATE is the lock: of any number of concurrent
 * or replayed attempts carrying the same challenge, one sees `changes = 1`; the rest are refused.
 */
type Ceremony = 'register' | 'authenticate' | 'reauth' | 'signup'
async function consumeChallenge(db: D1Database, challenge: string, ceremony: Ceremony, bind: { bindingHash?: string; sessionId?: string; accountId?: string }): Promise<{ pending_handle: string | null; pending_name: string | null }> {
  const now = Date.now()
  const row = await one<{ id: string; binding_hash: string | null; session_id: string | null; account_id: string | null; expires_at: number; consumed_at: number | null; ceremony: string; pending_handle: string | null; pending_name: string | null }>(
    db,
    'SELECT id, binding_hash, session_id, account_id, expires_at, consumed_at, ceremony, pending_handle, pending_name FROM webauthn_challenges WHERE challenge = ?',
    challenge,
  )
  if (!row || row.ceremony !== ceremony) throw notVerified()
  if (row.consumed_at) throw failed('challenge_used', 'that passkey response was already used — try again')
  if (row.expires_at <= now) throw failed('challenge_expired', 'that took a little too long — try again')
  if (bind.bindingHash !== undefined && row.binding_hash !== bind.bindingHash) throw notVerified()
  if (bind.sessionId !== undefined && row.session_id !== bind.sessionId) throw notVerified()
  if (bind.accountId !== undefined && row.account_id !== bind.accountId) throw notVerified()
  const spent = await run(db, 'UPDATE webauthn_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND expires_at > ?', now, row.id, now)
  if (!spent.meta.changes) throw failed('challenge_used', 'that passkey response was already used — try again')
  return { pending_handle: row.pending_handle, pending_name: row.pending_name }
}

async function storeChallenge(db: D1Database, challenge: string, ceremony: Ceremony, bind: { bindingHash?: string; sessionId?: string; accountId?: string; pendingHandle?: string; pendingName?: string }) {
  const now = Date.now()
  await run(
    db,
    'INSERT INTO webauthn_challenges (id, challenge, ceremony, account_id, session_id, binding_hash, pending_handle, pending_name, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    uuid(), challenge, ceremony, bind.accountId ?? null, bind.sessionId ?? null, bind.bindingHash ?? null, bind.pendingHandle ?? null, bind.pendingName ?? null, now + CHALLENGE_TTL_MS, now,
  )
}

/** One binding value per browser, reused while valid, so two open tabs don't invalidate each other. */
function browserBinding(c: Context<HonoEnv>, cfg: Config): string {
  const existing = readCookie(c.req.raw, bindingCookie(cfg))
  const binding = existing && /^[A-Za-z0-9_-]{43}$/.test(existing) ? existing : randomToken(32)
  c.header('set-cookie', cookie(bindingCookie(cfg), binding, cfg.cookieSecure, 10 * 60, true).replace('SameSite=Lax', 'SameSite=Strict'), { append: true })
  return binding
}

const transportsOf = (json: string): AuthenticatorTransport[] => {
  try {
    const t = JSON.parse(json)
    return Array.isArray(t) ? t.filter((x): x is AuthenticatorTransport => typeof x === 'string').slice(0, 8) : []
  } catch {
    return []
  }
}

/** Minted once per account, the first time it adds a passkey: 32 random bytes, opaque. */
async function userHandle(db: D1Database, accountId: string): Promise<string> {
  const existing = await one<{ h: string | null }>(db, 'SELECT webauthn_user_id AS h FROM accounts WHERE id = ?', accountId)
  if (existing?.h) return existing.h
  const h = isoBase64URL.fromBuffer(crypto.getRandomValues(new Uint8Array(32)))
  await run(db, 'UPDATE accounts SET webauthn_user_id = ? WHERE id = ? AND webauthn_user_id IS NULL', h, accountId)
  return (await one<{ h: string }>(db, 'SELECT webauthn_user_id AS h FROM accounts WHERE id = ?', accountId))!.h
}

const view = (r: CredentialRow) => ({
  id: r.id,
  name: r.name,
  created_at: new Date(r.created_at).toISOString(),
  last_used_at: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
  /** A multi-device credential: it may sync to other devices through a password manager. */
  synced: r.backup_eligible === 1,
})

function cleanName(v: unknown): string {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''
  if (!t) return 'Passkey'
  if ([...t].length > 60) throw bad('keep the name under 60 characters')
  return t
}

// ------------------------------------------------------------------ sign-in

/**
 * Options for signing in. No `allowCredentials`: discoverable credentials let the browser offer
 * the person's passkeys itself, and nothing here reveals whether any account or passkey exists.
 */
passkeys.post('/api/auth/passkey/login/options', async (c) => {
  const cfg = config(c.env)
  checkOrigin(c.req.raw, cfg)
  await limit(c.env.DB, `pk-opt:${await sha256Hex(clientClass(c.req.raw))}`, 120, 10 * 60_000)
  const binding = browserBinding(c, cfg)
  const options = await generateAuthenticationOptions({ rpID: cfg.webauthn.rpId, userVerification: 'required', timeout: CHALLENGE_TTL_MS })
  await storeChallenge(c.env.DB, options.challenge, 'authenticate', { bindingHash: await sha256Hex(binding) })
  return c.json(options)
})

/** Verifies an assertion and starts a new session (rotating any presented one). */
passkeys.post('/api/auth/passkey/login/verify', async (c) => {
  const cfg = config(c.env)
  checkOrigin(c.req.raw, cfg)
  const net = await sha256Hex(clientClass(c.req.raw))
  await limit(c.env.DB, `pk-verify:${net}`, 60, 10 * 60_000)
  const body = await readJson(c)
  const response = assertionShape(body.response)
  const binding = readCookie(c.req.raw, bindingCookie(cfg))
  if (!binding) throw failed('challenge_expired', 'that took a little too long — try again')
  await consumeChallenge(c.env.DB, challengeOf(response.response.clientDataJSON), 'authenticate', { bindingHash: await sha256Hex(binding) })
  const { cred, account } = await verifyAssertion(c.env.DB, cfg, response)
  const old = await loadSession(c.env.DB, readCookie(c.req.raw, sessionCookie(cfg)))
  if (old) await revokeSession(c.env.DB, old.auth.sessionId)
  const session = await createSession(c.env.DB, account, cfg.sessionTtlDays, { method: 'passkey', credentialRef: cred.id, clientLabel: clientLabel(c.req.raw, body.installed === true) })
  setSessionCookies(c, cfg, session)
  c.header('set-cookie', cookie(bindingCookie(cfg), '', cfg.cookieSecure, 0, true), { append: true })
  await securityEvent(c.env.DB, account, 'signin.passkey', { passkey: cred.id })
  return c.json(await buildMe(c.env, account, { authMethod: 'passkey', authenticatedAt: Date.now() }))
})

/**
 * Checks a response against the stored credential: signature, origin, RP ID, type, user presence
 * and verification (all enforced by the library with the options below), plus the user handle.
 */
async function verifyAssertion(db: D1Database, cfg: Config, response: AuthenticationResponseJSON, expectAccount?: string): Promise<{ cred: CredentialRow; account: string }> {
  const cred = await one<CredentialRow>(db, 'SELECT * FROM webauthn_credentials WHERE credential_id = ?', response.id)
  // The browser still offers a passkey Muni no longer has (it was removed): say so plainly.
  if (!cred) throw failed('passkey_unknown', 'this passkey isn’t linked to a Muni account any more — it may have been removed. Choose another passkey, or create an account.')
  if (expectAccount && cred.account_id !== expectAccount) throw failed('account_mismatch', 'that passkey belongs to a different account', 403)
  const handle = response.response.userHandle
  if (handle) {
    const owner = await one<{ h: string | null }>(db, 'SELECT webauthn_user_id AS h FROM accounts WHERE id = ?', cred.account_id)
    if (!owner?.h || owner.h !== handle) throw notVerified()
  }
  const synced = cred.backup_eligible === 1
  let result
  try {
    result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challengeOf(response.response.clientDataJSON), // already bound and spent above
      expectedOrigin: cfg.webauthn.origins,
      expectedRPID: cfg.webauthn.rpId,
      expectedType: 'webauthn.get',
      requireUserVerification: true,
      credential: {
        id: cred.credential_id,
        publicKey: isoBase64URL.toBuffer(cred.public_key),
        // Synced (backup-eligible) passkeys are copies by design, and most report 0 or counters that
        // don't increase across devices. Counter regressions are enforced only for single-device
        // credentials (security keys), where one really can signal a clone (WebAuthn L3 §6.1.1).
        counter: synced ? 0 : cred.counter,
        transports: transportsOf(cred.transports),
      },
    })
  } catch {
    throw notVerified()
  }
  if (!result.verified) throw notVerified()
  const info = result.authenticationInfo
  if (synced && info.newCounter !== 0 && info.newCounter <= cred.counter) await securityEvent(db, cred.account_id, 'passkey.counter_anomaly', { passkey: cred.id })
  // Backup eligibility is permanent for a credential; the backup state may change and is recorded.
  await run(db, 'UPDATE webauthn_credentials SET counter = MAX(counter, ?), backed_up = ?, last_used_at = ? WHERE id = ?', info.newCounter, info.credentialBackedUp ? 1 : 0, Date.now(), cred.id)
  return { cred, account: cred.account_id }
}

// ------------------------------------------------------------------ confirm it's you (step-up)

/**
 * Options to re-confirm the signed-in account with one of its own passkeys. `credential` (our id)
 * asks for one particular passkey — to let a just-added passkey unlock the account key.
 */
passkeys.post('/api/auth/passkey/reauth/options', async (c) => {
  const cfg = config(c.env)
  const a = await requireAuth(c, cfg, c.env.DB)
  await limit(c.env.DB, `pk-reauth:${a.account.id}`, 30, 10 * 60_000)
  const body = await readJson(c)
  const owned = await all<CredentialRow>(c.env.DB, 'SELECT * FROM webauthn_credentials WHERE account_id = ?', a.account.id)
  const creds = typeof body.credential === 'string' ? owned.filter((k) => k.id === body.credential) : owned
  if (typeof body.credential === 'string' && !creds.length) throw notFound('passkey not found')
  if (!creds.length) throw failed('no_passkeys', 'this account has no passkey', 409)
  const options = await generateAuthenticationOptions({
    rpID: cfg.webauthn.rpId,
    userVerification: 'required',
    timeout: CHALLENGE_TTL_MS,
    allowCredentials: creds.map((k) => ({ id: k.credential_id, transports: transportsOf(k.transports) })),
  })
  await storeChallenge(c.env.DB, options.challenge, 'reauth', { sessionId: a.sessionId, accountId: a.account.id })
  return c.json(options)
})

/** A fresh session for the same account (rotated, recently authenticated). */
passkeys.post('/api/auth/passkey/reauth/verify', async (c) => {
  const cfg = config(c.env)
  const a = await requireAuth(c, cfg, c.env.DB)
  const body = await readJson(c)
  const response = assertionShape(body.response)
  await consumeChallenge(c.env.DB, challengeOf(response.response.clientDataJSON), 'reauth', { sessionId: a.sessionId, accountId: a.account.id })
  const { cred } = await verifyAssertion(c.env.DB, cfg, response, a.account.id)
  await revokeSession(c.env.DB, a.sessionId)
  const session = await createSession(c.env.DB, a.account.id, cfg.sessionTtlDays, { method: 'passkey', credentialRef: cred.id, clientLabel: clientLabel(c.req.raw, body.installed === true) })
  setSessionCookies(c, cfg, session)
  await securityEvent(c.env.DB, a.account.id, 'reauth.passkey', { passkey: cred.id })
  return c.json(await buildMe(c.env, a.account.id, { authMethod: 'passkey', authenticatedAt: Date.now() }))
})

// ------------------------------------------------------------------ adding a passkey

/**
 * Options to add a passkey to the signed-in account. Requires a recent sign-in on this session;
 * the challenge is bound to this session and account, so a response can only land here.
 */
passkeys.post('/api/auth/passkey/register/options', async (c) => {
  const cfg = config(c.env)
  const a = await requireAuth(c, cfg, c.env.DB)
  requireRecentAuth(a)
  await limit(c.env.DB, `pk-reg:${a.account.id}`, 20, 60 * 60_000)
  const creds = await all<CredentialRow>(c.env.DB, 'SELECT * FROM webauthn_credentials WHERE account_id = ?', a.account.id)
  if (creds.length >= MAX_PASSKEYS) throw failed('too_many_passkeys', `an account can have up to ${MAX_PASSKEYS} passkeys — remove one first`, 409)
  const acct = (await one<{ display_name: string }>(c.env.DB, 'SELECT display_name FROM accounts WHERE id = ?', a.account.id))!
  // What the person's password manager shows to tell accounts apart: the address if the account
  // has one, otherwise the name they chose. Never used to find the account.
  const label = acct.display_name || 'Muni account'
  const options = await generateRegistrationOptions({
    rpName: cfg.webauthn.rpName,
    rpID: cfg.webauthn.rpId,
    // The handle is opaque and random. `userName` is only what the person's own password manager
    // shows to tell accounts apart; it is not a handle and isn't used to find the account.
    userID: isoBase64URL.toBuffer(await userHandle(c.env.DB, a.account.id)),
    userName: label,
    userDisplayName: acct.display_name || label,
    timeout: CHALLENGE_TTL_MS,
    // No attestation: nothing about the device or its maker is requested or kept.
    attestationType: 'none',
    excludeCredentials: creds.map((k) => ({ id: k.credential_id, transports: transportsOf(k.transports) })),
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
    // Ed25519, ES256, RS256 — what current platform authenticators and security keys use.
    supportedAlgorithmIDs: [-8, -7, -257],
  })
  await storeChallenge(c.env.DB, options.challenge, 'register', { sessionId: a.sessionId, accountId: a.account.id })
  return c.json(options)
})

passkeys.post('/api/auth/passkey/register/verify', async (c) => {
  const cfg = config(c.env)
  const a = await requireAuth(c, cfg, c.env.DB)
  requireRecentAuth(a)
  const body = await readJson(c)
  const response = attestationShape(body.response)
  const name = cleanName(body.name)
  await consumeChallenge(c.env.DB, challengeOf(response.response.clientDataJSON), 'register', { sessionId: a.sessionId, accountId: a.account.id })
  let result
  try {
    result = await verifyRegistrationResponse({
      response,
      expectedChallenge: challengeOf(response.response.clientDataJSON),
      expectedOrigin: cfg.webauthn.origins,
      expectedRPID: cfg.webauthn.rpId,
      expectedType: 'webauthn.create',
      requireUserPresence: true,
      requireUserVerification: true,
      supportedAlgorithmIDs: [-8, -7, -257],
    })
  } catch {
    throw notVerified()
  }
  if (!result.verified) throw notVerified()
  const info = result.registrationInfo
  const id = uuid()
  const now = Date.now()
  // A credential id belongs to one account, ever: a duplicate insert is a no-op, checked below.
  const inserted = await run(
    c.env.DB,
    `INSERT INTO webauthn_credentials (id, credential_id, account_id, public_key, counter, transports, backup_eligible, backed_up, name, created_at)
     SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM webauthn_credentials WHERE account_id = ?) < ?
     ON CONFLICT(credential_id) DO NOTHING`,
    id, info.credential.id, a.account.id, isoBase64URL.fromBuffer(info.credential.publicKey), info.credential.counter,
    JSON.stringify((info.credential.transports ?? []).slice(0, 8)), info.credentialDeviceType === 'multiDevice' ? 1 : 0, info.credentialBackedUp ? 1 : 0, name, now,
    a.account.id, MAX_PASSKEYS,
  )
  if (!inserted.meta.changes) {
    const owner = await one<{ account_id: string }>(c.env.DB, 'SELECT account_id FROM webauthn_credentials WHERE credential_id = ?', info.credential.id)
    if (owner && owner.account_id !== a.account.id) throw failed('passkey_taken', 'that passkey is already linked to another account', 409)
    if (owner) throw failed('passkey_exists', 'that passkey is already on your account', 409)
    throw failed('too_many_passkeys', `an account can have up to ${MAX_PASSKEYS} passkeys — remove one first`, 409)
  }
  await securityEvent(c.env.DB, a.account.id, 'passkey.added', { passkey: id })
  const row = (await one<CredentialRow>(c.env.DB, 'SELECT * FROM webauthn_credentials WHERE id = ?', id))!
  return c.json(view(row))
})

// ------------------------------------------------------------------ a new account

/**
 * Options to create a new account whose first sign-in method is this passkey. Nothing is created
 * until the registration is verified. No email address is needed. Account creation is limited
 * per network and per day, because nothing else slows abuse down.
 */
passkeys.post('/api/auth/passkey/signup/options', async (c) => {
  const cfg = config(c.env)
  checkOrigin(c.req.raw, cfg)
  const body = await readJson(c)
  const name = nonempty(body.display_name, 80, 'Name')
  const net = await sha256Hex(clientClass(c.req.raw))
  await limit(c.env.DB, `signup-opt:${net}`, 30, 10 * 60_000)
  // Refuse before the device makes a passkey the server would then reject.
  if (!(await underLimit(c.env.DB, `signup-net:${net}`, cfg.signupsPerNetworkDaily, 86_400_000))) throw new AppError(429, 'rate_limited', 'too many new accounts from this network today — try again tomorrow')
  if (!(await underLimit(c.env.DB, 'signup-all', cfg.signupsDailyLimit, 86_400_000))) throw new AppError(503, 'quota', 'Muni can’t create more accounts today. Please try again tomorrow.')
  const binding = browserBinding(c, cfg)
  const handle = isoBase64URL.fromBuffer(crypto.getRandomValues(new Uint8Array(32)))
  const options = await generateRegistrationOptions({
    rpName: cfg.webauthn.rpName,
    rpID: cfg.webauthn.rpId,
    userID: isoBase64URL.toBuffer(handle),
    userName: name,
    userDisplayName: name,
    timeout: CHALLENGE_TTL_MS,
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
    supportedAlgorithmIDs: [-8, -7, -257],
  })
  await storeChallenge(c.env.DB, options.challenge, 'signup', { bindingHash: await sha256Hex(binding), pendingHandle: handle, pendingName: name })
  return c.json(options)
})

passkeys.post('/api/auth/passkey/signup/verify', async (c) => {
  const cfg = config(c.env)
  checkOrigin(c.req.raw, cfg)
  const body = await readJson(c)
  const response = attestationShape(body.response)
  const binding = readCookie(c.req.raw, bindingCookie(cfg))
  if (!binding) throw failed('challenge_expired', 'that took a little too long — try again')
  const pending = await consumeChallenge(c.env.DB, challengeOf(response.response.clientDataJSON), 'signup', { bindingHash: await sha256Hex(binding) })
  if (!pending.pending_handle || !pending.pending_name) throw notVerified()
  let result
  try {
    result = await verifyRegistrationResponse({
      response,
      expectedChallenge: challengeOf(response.response.clientDataJSON),
      expectedOrigin: cfg.webauthn.origins,
      expectedRPID: cfg.webauthn.rpId,
      expectedType: 'webauthn.create',
      requireUserPresence: true,
      requireUserVerification: true,
      supportedAlgorithmIDs: [-8, -7, -257],
    })
  } catch {
    throw notVerified()
  }
  if (!result.verified) throw notVerified()
  // Counted only for accounts actually created, so failed or cancelled attempts don't use it up.
  const net = await sha256Hex(clientClass(c.req.raw))
  await limit(c.env.DB, `signup-net:${net}`, cfg.signupsPerNetworkDaily, 86_400_000)
  await limit(c.env.DB, 'signup-all', cfg.signupsDailyLimit, 86_400_000, () => new AppError(503, 'quota', 'Muni can’t create more accounts today. Please try again tomorrow.'))
  const info = result.registrationInfo
  if (await one(c.env.DB, 'SELECT 1 AS x FROM webauthn_credentials WHERE credential_id = ?', info.credential.id)) throw failed('passkey_taken', 'that passkey is already linked to an account — continue with it to sign in', 409)
  const accountId = uuid()
  const credRef = uuid()
  const now = Date.now()
  await batch(c.env.DB, [
    newAccountStatement(accountId, pending.pending_name, pending.pending_handle),
    [
      'INSERT INTO webauthn_credentials (id, credential_id, account_id, public_key, counter, transports, backup_eligible, backed_up, name, created_at, last_used_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      credRef, info.credential.id, accountId, isoBase64URL.fromBuffer(info.credential.publicKey), info.credential.counter,
      JSON.stringify((info.credential.transports ?? []).slice(0, 8)), info.credentialDeviceType === 'multiDevice' ? 1 : 0, info.credentialBackedUp ? 1 : 0, cleanName(body.name), now, now,
    ],
  ])
  const old = await loadSession(c.env.DB, readCookie(c.req.raw, sessionCookie(cfg)))
  if (old) await revokeSession(c.env.DB, old.auth.sessionId)
  const session = await createSession(c.env.DB, accountId, cfg.sessionTtlDays, { method: 'passkey', credentialRef: credRef, clientLabel: clientLabel(c.req.raw, body.installed === true) })
  setSessionCookies(c, cfg, session)
  c.header('set-cookie', cookie(bindingCookie(cfg), '', cfg.cookieSecure, 0, true), { append: true })
  await securityEvent(c.env.DB, accountId, 'account.created', { passkey: credRef })
  return c.json(await buildMe(c.env, accountId, { authMethod: 'passkey', authenticatedAt: now }, { created: true }))
})

// ------------------------------------------------------------------ managing passkeys

passkeys.get('/api/auth/passkeys', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  const rows = await all<CredentialRow>(c.env.DB, 'SELECT * FROM webauthn_credentials WHERE account_id = ? ORDER BY created_at', a.account.id)
  return c.json(rows.map(view))
})

passkeys.patch('/api/auth/passkeys/:id', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  const body = await readJson(c)
  const r = await run(c.env.DB, 'UPDATE webauthn_credentials SET name = ? WHERE id = ? AND account_id = ?', cleanName(body.name), c.req.param('id'), a.account.id)
  if (!r.meta.changes) throw notFound('passkey not found')
  await securityEvent(c.env.DB, a.account.id, 'passkey.renamed', { passkey: c.req.param('id') })
  const row = (await one<CredentialRow>(c.env.DB, 'SELECT * FROM webauthn_credentials WHERE id = ?', c.req.param('id')))!
  return c.json(view(row))
})

/**
 * Removing a passkey stops it signing in. It doesn't end sessions unless `revoke_sessions` asks
 * for that (other sessions started with this passkey; never the one making the request). An
 * account's last passkey can't be removed: it's the only way in.
 */
passkeys.delete('/api/auth/passkeys/:id', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  requireRecentAuth(a)
  const body = await readJson(c)
  const id = c.req.param('id')
  // The last passkey is the only way in: it can't be removed.
  const r = await run(
    c.env.DB,
    'DELETE FROM webauthn_credentials WHERE id = ? AND account_id = ? AND (SELECT count(*) FROM webauthn_credentials WHERE account_id = ?) > 1',
    id, a.account.id, a.account.id,
  )
  if (!r.meta.changes) {
    if (await one(c.env.DB, 'SELECT 1 AS x FROM webauthn_credentials WHERE id = ? AND account_id = ?', id, a.account.id))
      throw failed('last_method', 'this is your only passkey, and so your only way in — add another one first', 409)
    throw notFound('passkey not found')
  }
  // Its wrap of the account key goes with it (also by the foreign key), so it can't unlock anything.
  await run(c.env.DB, 'DELETE FROM passkey_key_wraps WHERE credential_id = ? AND account_id = ?', id, a.account.id)
  let ended = 0
  if (body.revoke_sessions === true) {
    const s = await run(c.env.DB, 'UPDATE sessions SET revoked_at = ? WHERE account_id = ? AND credential_ref = ? AND id <> ? AND revoked_at IS NULL', Date.now(), a.account.id, id, a.sessionId)
    ended = s.meta.changes ?? 0
  }
  await securityEvent(c.env.DB, a.account.id, 'passkey.removed', { passkey: id, sessions_ended: ended })
  return c.json({ ok: true, sessions_ended: ended })
})
