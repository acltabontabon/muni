/**
 * Passkeys and sessions through the public HTTP API, with a software authenticator
 * (test/authenticator.ts). Covers enrollment, sign-in, every ceremony binding the server enforces,
 * synced-passkey counters, recent authentication, removal, and session revocation — including
 * sessions that weren't made by a passkey, which no longer sign anyone in.
 */
import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { b64u, newKeyPair, newRecoveryKey, wrapForRecovery } from '../../web/src/lib/e2ee/crypto'
import { SoftAuthenticator } from './authenticator'
import { addPasskeyTo, ageSession, authenticatorOf, del, get, passkeyLogin, passkeyVerify, patch, post, rawReq, setCookie, signin, tag } from './harness'

const count = async (sql: string, ...args: unknown[]) => Number((await env.DB.prepare(sql).bind(...args).first<{ n: number }>())?.n ?? 0)

describe('adding a passkey', () => {
  it('attaches to the signed-in account: no second account, no duplicate credential', async () => {
    const email = `pk-add-${tag()}@example.com`
    const u = await signin(email, 'Ana')
    const auth = new SoftAuthenticator()
    const r = await addPasskeyTo(u, auth, { name: 'Laptop' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ name: 'Laptop', synced: false })
    expect(await count('SELECT count(*) AS n FROM account_emails WHERE email = ?', email)).toBe(1)
    expect(await count('SELECT count(*) AS n FROM webauthn_credentials WHERE account_id = ?', u.account_id)).toBe(2)
    expect((await get('/api/auth/me', u)).body.passkeys).toBe(2)
    // The user handle is opaque: not the account id, not the email.
    const acct = await env.DB.prepare('SELECT webauthn_user_id AS h FROM accounts WHERE id = ?').bind(u.account_id).first<{ h: string }>()
    expect(acct!.h).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(acct!.h).not.toContain(u.account_id)
    // Registering the same credential again is refused, not duplicated.
    const o = await post('/api/auth/passkey/register/options', u)
    expect(o.body.excludeCredentials.map((c: { id: string }) => c.id)).toContain(r.response.id)
    const again = await auth.register(o.body, {}, [...auth.creds.values()][0])
    const dup = await post('/api/auth/passkey/register/verify', u, { response: again, name: 'x' })
    expect(dup.status).toBe(409)
    expect(dup.body.code).toBe('passkey_exists')
    expect(await count('SELECT count(*) AS n FROM webauthn_credentials WHERE account_id = ?', u.account_id)).toBe(2)
  })

  it('never attaches because a request names an email: registration needs that account’s own session', async () => {
    const a = await signin(`pk-owner-${tag()}@example.com`)
    const b = await signin(`pk-other-${tag()}@example.com`)
    const auth = new SoftAuthenticator()
    // A's challenge, answered, then submitted with B's session: bound to A's session, so refused.
    const o = await post('/api/auth/passkey/register/options', a)
    const response = await auth.register(o.body)
    const r = await post('/api/auth/passkey/register/verify', b, { response, name: 'x', email: a.email, account_id: a.account_id })
    expect(r.status).toBe(400)
    expect(await count('SELECT count(*) AS n FROM webauthn_credentials WHERE account_id IN (?, ?)', a.account_id, b.account_id)).toBe(2) // their own first passkeys only
    // Without any session there's no way to register at all.
    expect((await post('/api/auth/passkey/register/options', null)).status).toBe(401)
    // A credential already on one account can't be moved to another.
    await addPasskeyTo(a, auth)
    const ob = await post('/api/auth/passkey/register/options', b)
    const moved = await post('/api/auth/passkey/register/verify', b, { response: await auth.register(ob.body, {}, [...auth.creds.values()].at(-1)), name: 'x' })
    expect(moved.status).toBe(409)
    expect(moved.body.code).toBe('passkey_taken')
  })

  it('needs a recent sign-in; confirming with one of the account’s own passkeys allows it', async () => {
    const email = `pk-recent-${tag()}@example.com`
    const u = await signin(email)
    await ageSession(u)
    const stale = await post('/api/auth/passkey/register/options', u)
    expect(stale.status).toBe(403)
    expect(stale.body.code).toBe('reauth_required')
    // Someone else's passkey can't confirm this account.
    const other = await signin(`pk-recent-other-${tag()}@example.com`)
    const o1 = await post('/api/auth/passkey/reauth/options', u)
    const theirs = await post('/api/auth/passkey/reauth/verify', u, { response: await authenticatorOf(other.email)!.assert(o1.body, [...authenticatorOf(other.email)!.creds.keys()][0]).catch(() => null) })
    expect(theirs.status).not.toBe(200)
    // Its own passkey does: a rotated, recent session for the same account.
    const mine = authenticatorOf(email)!
    const o = await post('/api/auth/passkey/reauth/options', u)
    expect(o.status).toBe(200)
    const conf = await post('/api/auth/passkey/reauth/verify', u, { response: await mine.assert(o.body) })
    expect(conf.status).toBe(200)
    const rotated = { ...u, session: setCookie(conf, 'muni_session')!, csrf: setCookie(conf, 'muni_csrf')! }
    expect((await get('/api/auth/me', u)).status).toBe(401) // the old session ended
    expect((await addPasskeyTo(rotated, new SoftAuthenticator())).status).toBe(200)
  })

  it('requires user verification and the right origin, RP ID and ceremony type', async () => {
    const u = await signin(`pk-reqs-${tag()}@example.com`)
    for (const over of [{ userVerified: false }, { userPresent: false }, { origin: 'https://munimuni.app' }, { origin: 'https://evil.example' }, { rpId: 'evil.example' }, { type: 'webauthn.get' }]) {
      const r = await addPasskeyTo(u, new SoftAuthenticator(), { over })
      expect(r.status, JSON.stringify(over)).toBe(400)
      expect(r.body.code).toBe('passkey_failed')
    }
    expect(await count('SELECT count(*) AS n FROM webauthn_credentials WHERE account_id = ?', u.account_id)).toBe(1) // only its first
  })

  it('a passkey added later signs in to the same account, with its teams', async () => {
    const u = await signin(`pk-later-${tag()}@example.com`, 'Lee Later')
    const ws = (await post('/api/workspaces', u, { name: 'Later team' })).body.id
    const auth = new SoftAuthenticator()
    expect((await addPasskeyTo(u, auth)).status).toBe(200)
    const back = await passkeyLogin(auth)
    expect(back.body).toMatchObject({ account_id: u.account_id, passkeys: 2 })
    expect(back.body.workspaces.map((w: { id: string }) => w.id)).toContain(ws)
  })
})

describe('signing in with a passkey', () => {
  it('starts a new session, ends the presented one, and records it', async () => {
    const u = await signin(`pk-in-${tag()}@example.com`)
    const auth = new SoftAuthenticator()
    await addPasskeyTo(u, auth)
    const r = await passkeyLogin(auth, { presented: u })
    expect(r.status).toBe(200)
    expect(r.user!.session).not.toBe(u.session)
    expect((await get('/api/auth/me', u)).status).toBe(401)
    const me = await get('/api/auth/me', r.user)
    expect(me.body).toMatchObject({ account_id: u.account_id, auth_method: 'passkey' })
    const events = await get('/api/auth/security-events', r.user)
    expect(events.body.map((e: { kind: string }) => e.kind)).toContain('signin.passkey')
    // The binding cookie is cleared, and the response carries nothing from the ceremony.
    expect(setCookie(r, 'muni_wa')).toBe('')
    const sessions = await get('/api/auth/sessions', r.user)
    expect(sessions.body.find((s: { current: boolean }) => s.current)).toMatchObject({ method: 'passkey', passkey_name: 'Test passkey' })
  })

  it('refuses replays, concurrent reuse and expired challenges; one response, one session', async () => {
    const u = await signin(`pk-replay-${tag()}@example.com`)
    const auth = new SoftAuthenticator()
    await addPasskeyTo(u, auth)
    const before = await count('SELECT count(*) AS n FROM sessions WHERE account_id = ?', u.account_id)
    const first = await passkeyLogin(auth)
    expect(first.status).toBe(200)
    const replay = await passkeyVerify(first.response, first.binding!)
    expect(replay.status).toBe(400)
    expect(replay.body.code).toBe('challenge_used')
    // Concurrent: the same fresh response submitted twice at once.
    const o = await rawReq('POST', '/api/auth/passkey/login/options', { json: {} })
    const binding = setCookie(o, 'muni_wa')!
    const response = await auth.assert(o.body)
    const results = await Promise.all([passkeyVerify(response, binding), passkeyVerify(response, binding), passkeyVerify(response, binding)])
    expect(results.filter((x) => x.status === 200)).toHaveLength(1)
    expect(await count('SELECT count(*) AS n FROM sessions WHERE account_id = ?', u.account_id)).toBe(before + 2)
    // Expired.
    const o2 = await rawReq('POST', '/api/auth/passkey/login/options', { json: {} })
    await env.DB.prepare('UPDATE webauthn_challenges SET expires_at = ? WHERE challenge = ?').bind(Date.now() - 1, o2.body.challenge).run()
    const late = await passkeyVerify(await auth.assert(o2.body), setCookie(o2, 'muni_wa')!)
    expect(late.status).toBe(400)
    expect(late.body.code).toBe('challenge_expired')
  })

  it('binds the challenge to the browser that asked for it', async () => {
    const u = await signin(`pk-bind-${tag()}@example.com`)
    const auth = new SoftAuthenticator()
    await addPasskeyTo(u, auth)
    const o = await rawReq('POST', '/api/auth/passkey/login/options', { json: {} })
    const response = await auth.assert(o.body)
    expect((await rawReq('POST', '/api/auth/passkey/login/verify', { json: { response } })).status).toBe(400) // no cookie
    expect((await passkeyVerify(response, 'A'.repeat(43))).status).toBe(400) // someone else's binding
    // A registration challenge can't be used to sign in, either.
    const reg = await post('/api/auth/passkey/register/options', u)
    const cross = await auth.assert({ ...o.body, challenge: reg.body.challenge })
    expect((await passkeyVerify(cross, setCookie(o, 'muni_wa')!)).status).toBe(400)
  })

  it('checks user verification, origin, RP ID, type, signature and user handle', async () => {
    const u = await signin(`pk-checks-${tag()}@example.com`)
    const auth = new SoftAuthenticator()
    await addPasskeyTo(u, auth)
    for (const over of [{ userVerified: false }, { userPresent: false }, { origin: 'https://munimuni.app' }, { origin: 'https://preview.munimuni.app' }, { rpId: 'munimuni.app' }, { type: 'webauthn.create' }]) {
      const r = await passkeyLogin(auth, { over })
      expect(r.status, JSON.stringify(over)).toBe(400)
      expect(r.body.code).toBe('passkey_failed')
    }
    const badSig = await passkeyLogin(auth, { tamper: (x) => { x.response.signature = x.response.signature.slice(0, -4) + 'AAAA' } })
    expect(badSig.status).toBe(400)
    const other = await signin(`pk-checks-other-${tag()}@example.com`)
    await addPasskeyTo(other, new SoftAuthenticator())
    const otherHandle = (await env.DB.prepare('SELECT webauthn_user_id AS h FROM accounts WHERE id = ?').bind(other.account_id).first<{ h: string }>())!.h
    const handle = await passkeyLogin(auth, { tamper: (x) => { x.response.userHandle = otherHandle } })
    expect(handle.status).toBe(400)
    // Malformed bodies are refused before the library sees them.
    for (const response of [null, {}, { type: 'public-key', id: 'x', rawId: 'y', response: {} }, { type: 'public-key', id: 'a'.repeat(5000), rawId: 'a'.repeat(5000), response: {} }]) {
      const o = await rawReq('POST', '/api/auth/passkey/login/options', { json: {} })
      expect((await passkeyVerify(response, setCookie(o, 'muni_wa')!)).status).toBe(400)
    }
  })

  it('accepts synced passkeys whose counter stays 0 or moves backwards; enforces it for single-device keys', async () => {
    const u = await signin(`pk-sync-${tag()}@example.com`)
    const synced = new SoftAuthenticator({ synced: true, counter: 'zero' })
    const add = await addPasskeyTo(u, synced)
    expect(add.body.synced).toBe(true)
    for (let i = 0; i < 3; i++) expect((await passkeyLogin(synced)).status).toBe(200)
    // Another device in the same sync fabric reports a lower counter: still the person's passkey.
    expect((await passkeyLogin(synced, { over: { counter: 7 } })).status).toBe(200)
    expect((await passkeyLogin(synced, { over: { counter: 3 } })).status).toBe(200)
    const events = (await get('/api/auth/security-events', u)).body.map((e: { kind: string }) => e.kind)
    expect(events).toContain('passkey.counter_anomaly')
    // A single-device security key whose counter goes backwards looks cloned: refused.
    const key = new SoftAuthenticator({ counter: 'increment' })
    await addPasskeyTo(u, key)
    expect((await passkeyLogin(key, { over: { counter: 5 } })).status).toBe(200)
    expect((await passkeyLogin(key, { over: { counter: 4 } })).status).toBe(400)
    expect((await passkeyLogin(key, { over: { counter: 6 } })).status).toBe(200)
  })

  it('says plainly when a passkey was removed, and the account’s other passkey still works', async () => {
    const email = `pk-removed-${tag()}@example.com`
    const u = await signin(email)
    const auth = new SoftAuthenticator()
    const add = await addPasskeyTo(u, auth)
    expect((await del(`/api/auth/passkeys/${add.body.id}`, u)).status).toBe(200)
    const r = await passkeyLogin(auth)
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('passkey_unknown')
    // Its first passkey still signs in.
    expect((await get('/api/auth/me', await signin(email))).status).toBe(200)
  })

  it('reveals nothing about accounts from the sign-in options', async () => {
    const o = await rawReq('POST', '/api/auth/passkey/login/options', { json: { email: 'someone@example.com' } })
    expect(o.status).toBe(200)
    expect(o.body.allowCredentials ?? []).toEqual([])
    expect(o.body.userVerification).toBe('required')
    expect(o.body.rpId).toBe('localhost')
    const cross = await rawReq('POST', '/api/auth/passkey/login/options', { json: {}, origin: 'https://evil.example' })
    expect(cross.status).toBe(403)
  })
})

describe('managing passkeys', () => {
  it('renames freely; removing needs a recent sign-in and can end that passkey’s other sessions', async () => {
    const u = await signin(`pk-manage-${tag()}@example.com`)
    const auth = new SoftAuthenticator()
    const add = await addPasskeyTo(u, auth)
    const other = (await passkeyLogin(auth)).user!
    const current = (await passkeyLogin(auth)).user!
    expect((await patch(`/api/auth/passkeys/${add.body.id}`, current, { name: 'Phone' })).body.name).toBe('Phone')
    await ageSession(current)
    const stale = await del(`/api/auth/passkeys/${add.body.id}`, current, { revoke_sessions: true })
    expect(stale.status).toBe(403)
    expect(stale.body.code).toBe('reauth_required')
    await env.DB.prepare('UPDATE sessions SET authenticated_at = ? WHERE account_id = ?').bind(Date.now(), u.account_id).run()
    const r = await del(`/api/auth/passkeys/${add.body.id}`, current, { revoke_sessions: true })
    expect(r.body).toEqual({ ok: true, sessions_ended: 1 })
    expect((await get('/api/auth/me', other)).status).toBe(401) // ended
    expect((await get('/api/auth/me', current)).status).toBe(200) // the one asking stays
    expect((await get('/api/auth/me', u)).status).toBe(200) // an email session is untouched
    // Someone else's passkey can't be renamed or removed.
    const stranger = await signin(`pk-stranger-${tag()}@example.com`)
    const theirs = await addPasskeyTo(stranger, new SoftAuthenticator())
    expect((await patch(`/api/auth/passkeys/${theirs.body.id}`, u, { name: 'mine now' })).status).toBe(404)
    expect((await del(`/api/auth/passkeys/${theirs.body.id}`, u)).status).toBe(404)
  })
})

describe('sessions and sign-out', () => {
  it('signs out one session or all the others; revoked sessions are refused for reads and changes', async () => {
    const email = `ses-${tag()}@example.com`
    const a = await signin(email)
    const b = await signin(email)
    const c = await signin(email)
    const list = await get('/api/auth/sessions', a)
    expect(list.body).toHaveLength(3)
    const bId = list.body.find((s: { current: boolean; id: string }) => !s.current && s.id).id
    expect((await del(`/api/auth/sessions/${bId}`, a)).status).toBe(200)
    expect((await get('/api/auth/sessions', a)).body).toHaveLength(2)
    expect((await post('/api/auth/logout-others', a)).status).toBe(200)
    const after = await get('/api/auth/sessions', a)
    expect(after.body).toHaveLength(1)
    expect(after.body[0].current).toBe(true)
    for (const s of [b, c]) {
      expect((await get('/api/auth/me', s)).status).toBe(401)
      expect((await post('/api/workspaces', s, { name: 'x' })).status).toBe(401)
    }
    // Your own current session isn't ended through the per-session route (that's sign-out).
    expect((await del(`/api/auth/sessions/${after.body[0].id}`, a)).status).toBe(400)
    // Another account's session can't be touched.
    const stranger = await signin(`ses-stranger-${tag()}@example.com`)
    const theirs = (await get('/api/auth/sessions', stranger)).body[0].id
    await del(`/api/auth/sessions/${theirs}`, a)
    expect((await get('/api/auth/me', stranger)).status).toBe(200)
  })

  it('a session that wasn’t made by a passkey never signs anyone in', async () => {
    const a = await signin(`ses-other-${tag()}@example.com`)
    const { sha256Hex } = await import('../src/lib/crypto')
    const token = crypto.randomUUID().replace(/-/g, '') + 'other'
    await env.DB.prepare("INSERT INTO sessions (id, account_id, token_hash, csrf_token, created_at, last_seen_at, expires_at, auth_method) VALUES (?,?,?,?,?,?,?, 'other')")
      .bind(crypto.randomUUID(), a.account_id, await sha256Hex(token), 'othercsrf', Date.now() - 3_600_000, Date.now() - 3_600_000, Date.now() + 86_400_000).run()
    const other = { ...a, session: token, csrf: 'othercsrf' }
    expect((await get('/api/auth/me', other)).status).toBe(401)
    expect((await post('/api/auth/passkey/register/options', other)).status).toBe(401)
  })

  it('logout is idempotent: an ended session still gets its cookies cleared', async () => {
    const u = await signin(`lo-idem-${tag()}@example.com`)
    const first = await post('/api/auth/logout', u)
    expect(first.body).toEqual({ ok: true, ended: true })
    const again = await post('/api/auth/logout', u)
    expect(again.status).toBe(200)
    expect(again.body.ended).toBe(false)
    expect(setCookie(again, 'muni_session')).toBe('')
    expect((await post('/api/auth/logout', null)).status).toBe(200)
    // A live session still needs its CSRF token to be ended.
    const v = await signin(`lo-csrf-${tag()}@example.com`)
    const forged = await rawReq('POST', '/api/auth/logout', { cookie: `muni_session=${v.session}`, csrf: 'wrong' })
    expect(forged.status).toBe(403)
    expect((await get('/api/auth/me', v)).status).toBe(200)
  })
})

describe('passkey configuration', () => {
  it('uses exactly the app host in production and refuses anything broader', async () => {
    const { config } = await import('../src/lib/config')
    const base = { APP_ENV: 'production', PUBLIC_ORIGIN: 'https://act.munimuni.app', EMAIL_PROVIDER: 'resend', ALLOW_DEMO_SEED: 'false' }
    expect(config(base).webauthn).toEqual({ rpId: 'act.munimuni.app', rpName: 'Muni', origins: ['https://act.munimuni.app'] })
    expect(() => config({ ...base, WEBAUTHN_RP_ID: 'munimuni.app' })).toThrow(/must equal/)
    expect(() => config({ ...base, WEBAUTHN_EXTRA_ORIGINS: 'https://preview.munimuni.app' })).toThrow(/development only/)
    const dev = config({ APP_ENV: 'development', PUBLIC_ORIGIN: 'http://localhost:8787', WEBAUTHN_EXTRA_ORIGINS: 'http://localhost:5173' })
    expect(dev.webauthn).toEqual({ rpId: 'localhost', rpName: 'Muni', origins: ['http://localhost:8787', 'http://localhost:5173'] })
    expect(() => config({ APP_ENV: 'development', PUBLIC_ORIGIN: 'http://localhost:8787', WEBAUTHN_EXTRA_ORIGINS: 'http://evil.example' })).toThrow()
  })
})

describe('passkeys and encryption stay separate', () => {
  it('stores no key material from ceremonies and unlocks nothing on a new device', async () => {
    const u = await signin(`pk-e2ee-${tag()}@example.com`)
    // Publish an account key the way a device does (public key + an opaque recovery blob).
    const kp = newKeyPair()
    const put = await rawReq('PUT', '/api/me/keys', { cookie: `muni_session=${u.session}; muni_csrf=${u.csrf}`, csrf: u.csrf, json: { public_key: b64u(kp.pk), recovery_blob: wrapForRecovery(kp.sk, newRecoveryKey(), u.account_id) } })
    expect(put.status).toBe(200)
    const auth = new SoftAuthenticator()
    await addPasskeyTo(u, auth)
    const back = await passkeyLogin(auth)
    const keys = await get('/api/me/keys', back.user)
    // What a new device gets after a passkey sign-in: the public key, the blob only the recovery key
    // opens, and wraps only a passkey's PRF output opens (in the browser — none here, since this
    // passkey was never enrolled for unlocking). Never a private or content key.
    expect(Object.keys(keys.body).sort()).toEqual(['created_at', 'key_version', 'passkeys', 'public_key', 'recovery_blob', 'recovery_confirmed_at', 'session_passkey'])
    expect(keys.body.passkeys).toEqual([])
    expect(keys.body.public_key).toBe(b64u(kp.pk))
    // The private key appears nowhere on the server, in any form we can recognise.
    const all = JSON.stringify((await env.DB.prepare('SELECT * FROM account_keys WHERE account_id = ?').bind(u.account_id).all()).results)
    expect(all.includes(b64u(kp.sk))).toBe(false)
    // Replacing keys (destructive for content access) also needs a recent sign-in.
    const { ageSession } = await import('./harness')
    await ageSession(back.user!)
    const nk = newKeyPair()
    const replace = await rawReq('PUT', '/api/me/keys', { cookie: `muni_session=${back.user!.session}; muni_csrf=${back.user!.csrf}`, csrf: back.user!.csrf, json: { public_key: b64u(nk.pk), replace: true } })
    expect(replace.body.code).toBe('reauth_required')
    const rec = await rawReq('POST', '/api/me/keys/recovery', { cookie: `muni_session=${back.user!.session}; muni_csrf=${back.user!.csrf}`, csrf: back.user!.csrf, json: { recovery_blob: wrapForRecovery(kp.sk, newRecoveryKey(), u.account_id) } })
    expect(rec.body.code).toBe('reauth_required')
    const cred = await env.DB.prepare('SELECT * FROM webauthn_credentials WHERE account_id = ?').bind(u.account_id).first<Record<string, unknown>>()
    expect(Object.keys(cred!).sort()).toEqual(['account_id', 'backed_up', 'backup_eligible', 'counter', 'created_at', 'credential_id', 'id', 'last_used_at', 'name', 'public_key', 'transports'])
  })
})
