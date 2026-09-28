/**
 * Passkeys are the only way in: creating an account with a passkey, an address that never signs
 * anyone in, the last-passkey guard, the address that emailed invitations leave behind (for mail
 * only), personal single-use invite links, and what accounts without an address are and aren't sent. Through the public HTTP API, with the software authenticator.
 */
import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { SoftAuthenticator } from './authenticator'
import { addPasskeyTo, del, get, inviteToken, lastMailTo, passkeySignup, post, rawReq, runJobs, setCookie, signin, sprint, tag, team } from './harness'

const count = async (sql: string, ...args: unknown[]) => Number((await env.DB.prepare(sql).bind(...args).first<{ n: number }>())?.n ?? 0)
const tokenOf = (url: string) => url.split('#')[1]
async function fresh(name = 'Pia Passkey') {
  const auth = new SoftAuthenticator()
  const r = await passkeySignup(auth, name)
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  return { user: r.user!, auth, me: r.body }
}
describe('creating an account with a passkey', () => {
  it('needs only a name, and signs in', async () => {
    const { user, me } = await fresh('Pia')
    expect(me).toMatchObject({ email: null, display_name: 'Pia', needs_name: false, passkeys: 1, created: true, auth_method: 'passkey' })
    const row = await env.DB.prepare('SELECT webauthn_user_id FROM accounts WHERE id = ?').bind(user.account_id).first<{ webauthn_user_id: string }>()
    expect(row!.webauthn_user_id).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await count('SELECT count(*) AS n FROM account_emails WHERE account_id = ?', user.account_id)).toBe(0)
    expect((await get('/api/auth/me', user)).body.account_id).toBe(user.account_id)
  })

  it('creates exactly one account per response: replays and concurrent submissions are refused', async () => {
    const auth = new SoftAuthenticator()
    const o = await rawReq('POST', '/api/auth/passkey/signup/options', { json: { display_name: 'Once' } })
    const binding = setCookie(o, 'muni_wa')!
    const response = await auth.register(o.body)
    const before = await count('SELECT count(*) AS n FROM accounts')
    const results = await Promise.all([1, 2, 3].map(() => rawReq('POST', '/api/auth/passkey/signup/verify', { cookie: `muni_wa=${binding}`, json: { response } })))
    expect(results.filter((r) => r.status === 200)).toHaveLength(1)
    expect(await count('SELECT count(*) AS n FROM accounts')).toBe(before + 1)
    const replay = await rawReq('POST', '/api/auth/passkey/signup/verify', { cookie: `muni_wa=${binding}`, json: { response } })
    expect(replay.body.code).toBe('challenge_used')
  })

  it('refuses a passkey that already belongs to an account, and checks the ceremony like any other', async () => {
    const { auth } = await fresh()
    const o = await rawReq('POST', '/api/auth/passkey/signup/options', { json: { display_name: 'Again' } })
    const reused = await auth.register(o.body, {}, [...auth.creds.values()][0])
    const r = await rawReq('POST', '/api/auth/passkey/signup/verify', { cookie: `muni_wa=${setCookie(o, 'muni_wa')}`, json: { response: reused } })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('passkey_taken')
    for (const over of [{ userVerified: false }, { origin: 'https://munimuni.app' }, { rpId: 'munimuni.app' }]) expect((await passkeySignup(new SoftAuthenticator(), 'X', { over })).status).toBe(400)
    // No browser binding: refused.
    const o2 = await rawReq('POST', '/api/auth/passkey/signup/options', { json: { display_name: 'Unbound' } })
    expect((await rawReq('POST', '/api/auth/passkey/signup/verify', { json: { response: await new SoftAuthenticator().register(o2.body) } })).status).toBe(400)
    // A name is required (chosen by the person, never inferred).
    expect((await rawReq('POST', '/api/auth/passkey/signup/options', { json: { display_name: '  ' } })).status).toBe(400)
    // From another site: refused.
    expect((await rawReq('POST', '/api/auth/passkey/signup/options', { json: { display_name: 'Evil' }, origin: 'https://evil.example' })).status).toBe(403)
  })

  it('caps new accounts per network and per day by default', async () => {
    const { config } = await import('../src/lib/config')
    const c = config({ APP_ENV: 'development' })
    expect([c.signupsPerNetworkDaily, c.signupsDailyLimit]).toEqual([10, 200])
  })

})

describe('an address', () => {
  it('an address never signs in, and removing it only stops the mail', async () => {
    const email = `pk-addr-${tag()}@example.com`
    const u = await signin(email, 'Mail only')
    expect((await get('/api/auth/me', u)).body.email).toBe(email)
    expect((await del('/api/me/email', u)).status).toBe(200)
    expect((await get('/api/auth/me', u)).body.email).toBeNull()
    expect((await get('/api/auth/me', u)).status).toBe(200) // still signed in: the passkey is the way in
  })
})

describe('the last way in', () => {
  it('an account’s only passkey can’t be removed — an address doesn’t change that', async () => {
    const u = await signin(`pk-last-${tag()}@example.com`, 'Has an address')
    const only = (await get('/api/auth/passkeys', u)).body[0].id
    const refused = await del(`/api/auth/passkeys/${only}`, u)
    expect(refused.status).toBe(409)
    expect(refused.body.code).toBe('last_method')
    await addPasskeyTo(u, new SoftAuthenticator())
    expect((await del(`/api/auth/passkeys/${only}`, u)).status).toBe(200)
    const remaining = (await get('/api/auth/passkeys', u)).body[0].id
    expect((await del(`/api/auth/passkeys/${remaining}`, u)).body.code).toBe('last_method')
  })
})

describe('emailed invitations', () => {
  it('an account without an address keeps the invited one, for mail only', async () => {
    const { owner, ws } = await team(0)
    const email = `pf-inv-${tag()}@example.com`
    await post(`/api/workspaces/${ws}/invitations`, owner, { email })
    const token = await inviteToken(email)
    const { user } = await fresh('Invitee')
    expect((await post('/api/invitations/preview', user, { token })).body).toMatchObject({ valid: true, signed_in: true })
    expect((await post('/api/invitations/accept', user, { token })).status).toBe(200)
    expect((await get('/api/auth/me', user)).body.email).toBe(email)
    expect((await get(`/api/workspaces/${ws}`, user)).status).toBe(200)
  })

  it('an address another account already has stays with that account', async () => {
    const { owner, ws } = await team(0)
    const email = `pf-inv-taken-${tag()}@example.com`
    const existing = await signin(email, 'Existing')
    await post(`/api/workspaces/${ws}/invitations`, owner, { email })
    const token = await inviteToken(email)
    const { user } = await fresh('Newcomer')
    expect((await post('/api/invitations/accept', user, { token })).status).toBe(200)
    expect((await get('/api/auth/me', user)).body.email).toBeNull()
    expect((await get('/api/auth/me', existing)).body.email).toBe(email)
  })
})

describe('personal single-use invite links', () => {
  async function direct(sprintId?: string) {
    const { owner, ws } = await team(0)
    const r = await post(`/api/workspaces/${ws}/join-links`, owner, { mode: 'direct', sprint_id: sprintId })
    return { owner, ws, r }
  }

  it('join the first signed-in person to use them, once, as a member — without an email address', async () => {
    const { owner, ws, r } = await direct()
    expect(r.body.link).toMatchObject({ mode: 'direct', max_requests: 1, role: 'member' })
    const token = tokenOf(r.body.url)
    expect((await post('/api/join/preview', null, { token })).body).toEqual({ valid: true, signed_in: false, includes_sprint: false, mode: 'direct' })
    expect((await post('/api/join/request', null, { token })).status).toBe(401) // the link is not a sign-in
    const a = await fresh('First')
    const joined = await post('/api/join/request', a.user, { token })
    expect(joined.body).toMatchObject({ state: 'member', workspace_id: ws })
    expect((await env.DB.prepare('SELECT role FROM memberships WHERE workspace_id = ? AND account_id = ?').bind(ws, a.user.account_id).first<{ role: string }>())!.role).toBe('member')
    const b = await fresh('Second')
    const late = await post('/api/join/request', b.user, { token })
    expect(late.status).toBe(410)
    expect((await get(`/api/workspaces/${ws}`, b.user)).status).toBe(403)
    // A personal link never blocks the team QR (one of those per scope), and many can exist.
    expect((await post(`/api/workspaces/${ws}/join-links`, owner, {})).status).toBe(200)
    expect((await post(`/api/workspaces/${ws}/join-links`, owner, { mode: 'direct' })).status).toBe(200)
    expect((await post(`/api/workspaces/${ws}/join-links`, owner, { mode: 'direct', expires_in_hours: 720 })).status).toBe(400)
  })

  it('two people racing for the same link: exactly one gets in', async () => {
    const { ws, r } = await direct()
    const token = tokenOf(r.body.url)
    const people = await Promise.all([1, 2, 3].map((i) => fresh(`Racer ${i}`)))
    const results = await Promise.all(people.map((p) => post('/api/join/request', p.user, { token })))
    expect(results.filter((x) => x.status === 200)).toHaveLength(1)
    expect(await count('SELECT count(*) AS n FROM memberships WHERE workspace_id = ? AND revoked_at IS NULL', ws)).toBe(2)
    expect(await count("SELECT count(*) AS n FROM audit_events WHERE workspace_id = ? AND action = 'join_link.redeemed'", ws)).toBe(1)
  })

  it('stop working if their creator can no longer invite', async () => {
    const { owner, members, ws } = await team(1)
    const fac = members[0]
    const sp = await sprint(owner, members, ws, 'draft', { facilitator_id: fac.account_id, participant_ids: [fac.account_id] })
    const r = await post(`/api/workspaces/${ws}/join-links`, fac, { mode: 'direct', sprint_id: sp })
    expect(r.status).toBe(200)
    await del(`/api/workspaces/${ws}/members/${fac.account_id}`, owner)
    const p = await fresh('Too late')
    expect((await post('/api/join/request', p.user, { token: tokenOf(r.body.url) })).status).toBe(410)
  })
})

describe('what accounts without an address see and are sent', () => {
  it('approvers see no email for them (and are told a name proves nothing); reminders skip them', async () => {
    const { owner, members, ws } = await team(1)
    const link = await post(`/api/workspaces/${ws}/join-links`, owner, {})
    const { user } = await fresh('No Address')
    await post('/api/join/request', user, { token: tokenOf(link.body.url) })
    const listed = (await get(`/api/workspaces/${ws}/join-requests`, owner)).body[0]
    expect(listed).toMatchObject({ display_name: 'No Address', email: null, has_passkey: true })
    // Approve, then a reminder for a sprint with one emailed member and this passkey-only person.
    await post(`/api/workspaces/${ws}/join-requests/${listed.id}/approve`, owner)
    const sp = await sprint(owner, [...members, { ...user, email: '' }], ws, 'collecting', { reminders_enabled: true })
    await env.DB.prepare('UPDATE sprints SET reminders_enabled = 1 WHERE id = ?').bind(sp).run()
    const { enqueue } = await import('../src/jobs')
    await enqueue(env.DB, 'reminder', { sprint_id: sp, kind: 'midpoint' }, Date.now(), `test-reminder:${sp}`)
    await runJobs()
    expect((await lastMailTo(members[0].email))?.subject).toMatch(/retro/)
    const toPlaceholder = await count("SELECT count(*) AS n FROM dev_mail WHERE to_addr LIKE '@%'")
    expect(toPlaceholder).toBe(0)
    // The owner's member list shows no address for them either.
    const people = (await get(`/api/workspaces/${ws}`, owner)).body.members
    expect(people.find((m: { account_id: string }) => m.account_id === user.account_id).email).toBeNull()
  })
})
