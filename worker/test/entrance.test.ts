/**
 * The email path ("Used Muni before?"): existing accounts only, a name only when there is none, no
 * account enumeration. New accounts are made with a passkey (passkeys.test.ts, signup).
 */
import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { codeFor, get, inviteToken, legacyAccount, patch, post, skipCooldown, tag, team, verify } from './harness'

const request = (email: string) => post('/api/auth/request-code', null, { email })

describe('entrance', () => {
  it('answers a code request the same way whether or not the address has an account', async () => {
    const known = `known-${tag()}@example.com`
    await legacyAccount(known)
    await request(known)
    await verify(known, await codeFor(known), 'Known')
    await skipCooldown(known)
    const a = await request(known)
    const b = await request(`unknown-${tag()}@example.com`)
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(a.body).toEqual(b.body)
    expect(a.body).toEqual({ sent: true, expires_in_minutes: 10, resend_after_seconds: 30 })
  })

  it('never creates an account from a code, and says there is none only after the code is verified', async () => {
    const email = `newcomer-${tag()}@example.com`
    await request(email)
    const v = await verify(email, await codeFor(email), null)
    expect(v.status).toBe(404)
    expect(v.body.code).toBe('no_account')
    expect(v.headers.getSetCookie?.().some((c) => c.startsWith('muni_session=') && !c.startsWith('muni_session=;'))).toBe(false)
    const n = await env.DB.prepare('SELECT count(*) AS n FROM account_emails WHERE email = ?').bind(email).first<{ n: number }>()
    expect(n!.n).toBe(0)
    // Without the code, nothing distinguishes the address from one that has an account.
    await skipCooldown(email)
    await request(email)
    expect((await verify(email, '000000', null)).body.code).toMatch(/code_mismatch|code_locked/)
  })

  it('asks an existing account without a chosen name for one, and never infers it', async () => {
    const email = `unnamed-${tag()}@example.com`
    await legacyAccount(email)
    await request(email)
    const v = await verify(email, await codeFor(email), null)
    expect(v.status).toBe(200)
    expect(v.body.needs_name).toBe(true)
    expect(v.body.display_name).toBe('')
    expect((await get('/api/auth/me', v.user)).body.needs_name).toBe(true)
    const named = await patch('/api/auth/me', v.user!, { display_name: 'Nadia' })
    expect(named.body.needs_name).toBe(false)
  })

  it('lets a returning person straight through and never overwrites their name', async () => {
    const email = `returning-${tag()}@example.com`
    await legacyAccount(email)
    await request(email)
    await verify(email, await codeFor(email), 'Rosa')
    await skipCooldown(email)
    await request(email)
    // An old client might still send a name with the code; it is ignored.
    const r = await post('/api/auth/verify', null, { email, code: await codeFor(email), display_name: 'Someone else' })
    expect(r.status).toBe(200)
    expect(r.body.needs_name).toBe(false)
    expect(r.body.display_name).toBe('Rosa')
  })

  it('treats a name that was once inferred from the address as not chosen', async () => {
    const email = `legacy-${tag()}@example.com`
    const id = await legacyAccount(email)
    await request(email)
    const v = await verify(email, await codeFor(email), 'Leg')
    await env.DB.prepare('UPDATE accounts SET display_name = ?, name_set_at = NULL WHERE id = ?').bind(email.split('@')[0], id).run()
    expect((await get('/api/auth/me', v.user)).body.needs_name).toBe(true)
  })

  it('enforces a resend cooldown and says how long to wait', async () => {
    const email = `cool-${tag()}@example.com`
    expect((await request(email)).status).toBe(200)
    const again = await request(email)
    expect(again.status).toBe(429)
    expect(again.body.code).toBe('resend_cooldown')
    expect(again.body.retry_after_seconds).toBeGreaterThan(0)
    expect(again.body.retry_after_seconds).toBeLessThanOrEqual(30)
    await skipCooldown(email)
    expect((await request(email)).status).toBe(200)
  })

  it('tells wrong, locked, expired, used and malformed codes apart', async () => {
    const email = `codes-${tag()}@example.com`
    await legacyAccount(email)
    await request(email)
    const code = await codeFor(email)
    const wrong = code === '000000' ? '111111' : '000000'
    const first = await verify(email, wrong, null)
    expect(first.body.code).toBe('code_mismatch')
    expect(first.body.attempts_left).toBe(4)
    for (let i = 0; i < 3; i++) await verify(email, wrong, null)
    expect((await verify(email, wrong, null)).body.code).toBe('code_locked')
    expect((await verify(email, code, null)).body.code).toBe('code_locked')
    expect((await verify(email, '12345', null)).body.code).toBe('code_format')

    await skipCooldown(email)
    await request(email)
    const fresh = await codeFor(email)
    // Pasted with spaces or a trailing newline still works.
    expect((await verify(email, ` ${fresh.slice(0, 3)} ${fresh.slice(3)}\n`, null)).status).toBe(200)
    expect((await verify(email, fresh, null)).body.code).toBe('code_used')

    await skipCooldown(email)
    await request(email)
    const late = await codeFor(email)
    await env.DB.prepare('UPDATE verification_challenges SET expires_at = ? WHERE email = ?').bind(Date.now() - 1000, email).run()
    expect((await verify(email, late, null)).body.code).toBe('code_expired')
  })

  it('starts exactly one session when the same code is submitted twice at once', async () => {
    const email = `double-${tag()}@example.com`
    const id = await legacyAccount(email)
    await request(email)
    const code = await codeFor(email)
    const results = await Promise.all([verify(email, code, null), verify(email, code, null)])
    expect(results.filter((r) => r.status === 200)).toHaveLength(1)
    expect(results.find((r) => r.status !== 200)!.body.code).toBe('code_used')
    const n = await env.DB.prepare('SELECT count(*) AS n FROM sessions WHERE account_id = ?').bind(id).first<{ n: number }>()
    expect(n!.n).toBe(1)
  })

  it('asks for a name before joining through an invitation, and keeps the invitation meanwhile', async () => {
    const { owner, ws } = await team(0)
    const email = `joiner-${tag()}@example.com`
    await post(`/api/workspaces/${ws}/invitations`, owner, { email })
    const token = await inviteToken(email)
    await legacyAccount(email)
    await request(email)
    const v = await verify(email, await codeFor(email), null)
    const early = await post('/api/invitations/accept', v.user!, { token })
    expect(early.status).toBe(409)
    expect(early.body.code).toBe('name_required')
    expect((await post('/api/invitations/preview', v.user!, { token })).body.valid).toBe(true)
    await patch('/api/auth/me', v.user!, { display_name: 'Jo' })
    expect((await post('/api/invitations/accept', v.user!, { token })).status).toBe(200)
    expect((await get(`/api/workspaces/${ws}`, v.user!)).status).toBe(200)
  })
})
