import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { del, get, inviteToken, post, signin, sprint, tag, team } from './harness'

describe('sessions', () => {
  it('requires a session, CSRF for mutations, and an allowed origin', async () => {
    expect((await get('/api/auth/me')).status).toBe(401)
    const u = await signin(`csrf-${tag()}@example.com`)
    const noCsrf = await fetchRaw('POST', '/api/workspaces', { cookie: `muni_session=${u.session}`, origin: 'http://localhost:5173', 'content-type': 'application/json' }, { name: 'x' })
    expect(noCsrf).toBe(403)
    const evil = await fetchRaw('POST', '/api/workspaces', { cookie: `muni_session=${u.session}`, 'x-csrf-token': u.csrf, origin: 'https://evil.example', 'content-type': 'application/json' }, { name: 'x' })
    expect(evil).toBe(403)
    expect((await post('/api/workspaces', u, { name: 'ok' })).status).toBe(200)
  })

  it('logout revokes; other devices can be signed out', async () => {
    const email = `lo-${tag()}@example.com`
    const a = await signin(email)
    const b = await signin(email)
    expect(a.account_id).toBe(b.account_id)
    expect((await post('/api/auth/logout-others', a)).status).toBe(200)
    expect((await get('/api/auth/me', b)).status).toBe(401)
    expect((await post('/api/auth/logout', a)).status).toBe(200)
    expect((await get('/api/auth/me', a)).status).toBe(401)
  })

  it('refuses to email (invitations, reminders) with an explicit setup-required state when no provider is configured', async () => {
    // Exercised through the config layer: the console provider is the only one wired in tests,
    // so assert the adapter's contract directly.
    const { sendMail } = await import('../src/lib/email')
    const { config } = await import('../src/lib/config')
    const cfg = config({ APP_ENV: 'development', EMAIL_PROVIDER: 'none' })
    await expect(sendMail(cfg, env.DB, { to: 'x@example.com', subject: 's', body: 'b' })).rejects.toMatchObject({ code: 'setup_required' })
  })
})

async function fetchRaw(method: string, path: string, headers: Record<string, string>, json: unknown) {
  const { SELF } = await import('cloudflare:test')
  const r = await SELF.fetch(`https://muni.test${path}`, { method, headers, body: JSON.stringify(json) })
  return r.status
}

describe('invitations and membership', () => {
  it('an invitation link is single use, revocable and expirable, and needs a passkey session', async () => {
    const { owner, ws } = await team(0)
    const t = tag()
    const invited = `invitee-${t}@example.com`
    await post(`/api/workspaces/${ws}/invitations`, owner, { email: invited })
    const token = await inviteToken(invited)
    const preview = await post('/api/invitations/preview', null, { token: token })
    expect(preview.body.valid).toBe(true)
    expect(preview.body.email_hint).toContain('•••')
    expect((await post('/api/invitations/accept', null, { token: token })).status).toBe(401)
    const stranger = await signin(`stranger-${t}@example.com`)
    expect((await post('/api/invitations/accept', stranger, { token: 'not-the-token' })).status).toBe(404)
    expect((await get(`/api/workspaces/${ws}`, stranger)).status).toBe(403)
    const right = await signin(invited)
    expect((await post('/api/invitations/accept', right, { token: token })).status).toBe(200)
    expect((await post('/api/invitations/accept', right, { token: token })).status).not.toBe(200)
    expect((await post('/api/invitations/preview', null, { token: 'not-a-real-token' })).body.valid).toBe(false)
    const second = `second-${t}@example.com`
    const inv = await post(`/api/workspaces/${ws}/invitations`, owner, { email: second })
    const token2 = await inviteToken(second)
    await del(`/api/workspaces/${ws}/invitations/${inv.body.invitation_id}`, owner)
    expect((await post('/api/invitations/preview', null, { token: token2 })).body.valid).toBe(false)
    const third = `third-${t}@example.com`
    await post(`/api/workspaces/${ws}/invitations`, owner, { email: third })
    const token3 = await inviteToken(third)
    await env.DB.prepare('UPDATE invitations SET expires_at = ? WHERE email = ?').bind(Date.now() - 60_000, third).run()
    const u3 = await signin(third)
    expect((await post('/api/invitations/accept', u3, { token: token3 })).status).toBe(404)
  })

  it('redeems an invitation exactly once under concurrent accepts', async () => {
    const { owner, ws } = await team(0)
    const email = `race-${tag()}@example.com`
    await post(`/api/workspaces/${ws}/invitations`, owner, { email })
    const token = await inviteToken(email)
    const u = await signin(email)
    const results = await Promise.all([1, 2, 3, 4].map(() => post('/api/invitations/accept', u, { token: token })))
    expect(results.filter((r) => r.status === 200).length).toBe(1)
  })

  it('denies cross-workspace access without confirming existence', async () => {
    const a = await team(1)
    const b = await team(0)
    const sprintA = await sprint(a.owner, a.members, a.ws, 'collecting')
    expect((await get(`/api/sprints/${sprintA}`, b.owner)).status).toBe(404)
    expect((await post(`/api/sprints/${sprintA}/entries`, b.owner, { body: 'x' })).status).toBe(404)
    expect((await get(`/api/workspaces/${a.ws}`, b.owner)).status).toBe(403)
    const cTeam = await team(2)
    const sprintC = await sprint(cTeam.owner, cTeam.members.slice(0, 1), cTeam.ws, 'collecting')
    expect((await get(`/api/sprints/${sprintC}`, cTeam.members[1])).status).toBe(403)
  })

  it('revoked members lose API access and the room closes their sockets', async () => {
    const { owner, members, ws } = await team(1)
    const m = members[0]
    const sprintId = await sprint(owner, members, ws, 'live')
    expect((await get(`/api/sprints/${sprintId}`, m)).status).toBe(200)
    const { SELF } = await import('cloudflare:test')
    const wsRes = await SELF.fetch(`https://muni.test/api/sprints/${sprintId}/ws`, { headers: { upgrade: 'websocket', origin: 'http://localhost:5173', cookie: `muni_session=${m.session}; muni_csrf=${m.csrf}` } })
    expect(wsRes.status).toBe(101)
    const socket = wsRes.webSocket!
    socket.accept()
    const messages: string[] = []
    const closed = new Promise<void>((resolve) => {
      socket.addEventListener('message', (e) => messages.push(String(e.data)))
      socket.addEventListener('close', () => resolve())
    })
    expect((await del(`/api/workspaces/${ws}/members/${m.account_id}`, owner)).status).toBe(200)
    await Promise.race([closed, new Promise((r) => setTimeout(r, 3000))])
    expect(messages.some((x) => x.includes('"revoked"'))).toBe(true)
    expect((await get(`/api/sprints/${sprintId}`, m)).status).toBe(404)
    const again = await SELF.fetch(`https://muni.test/api/sprints/${sprintId}/ws`, { headers: { upgrade: 'websocket', origin: 'http://localhost:5173', cookie: `muni_session=${m.session}; muni_csrf=${m.csrf}` } })
    expect(again.status).not.toBe(101)
  })
})
