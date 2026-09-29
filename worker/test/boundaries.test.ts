/**
 * Authorization boundaries found in the 2026-09 security and privacy review, tested through the
 * public API with two workspaces and several roles (owner, facilitator, participant, outsider).
 */
import { describe, expect, it } from 'vitest'
import { env, SELF } from 'cloudflare:test'
import { closeCollection, command, del, entry, get, go, inviteToken, patch, post, req, runJobs, signin, sprint, tag, team } from './harness'
import { config } from '../src/lib/config'
import { cookie, csrfCookie, sessionCookie } from '../src/lib/auth'

const ORIGIN = 'http://localhost:5173'

describe('sprint scope', () => {
  it('a facilitator of one sprint can’t add themselves to another sprint through an invitation', async () => {
    const { owner, members, ws } = await team(2)
    const [fac, other] = members
    // B: the owner's sprint, already revealed. `fac` isn't part of it.
    const b = await sprint(owner, [other], ws, 'collecting')
    await entry(other, b, 'improve', 'sprint B only')
    await closeCollection(owner, b)
    // Any member can create a sprint and facilitate it, which makes them able to invite.
    const a = await post(`/api/workspaces/${ws}/sprints`, fac, { name: 'Mine', timezone: 'UTC', starts_on: '2026-09-01', ends_on: '2026-09-10', retro_date: '2026-09-11', retro_time: '10:00', participant_ids: [fac.account_id], facilitator_id: fac.account_id })
    expect(a.status).toBe(200)
    const self = await post(`/api/workspaces/${ws}/invitations`, fac, { email: fac.email, sprint_id: b })
    expect(self.status).toBe(403)
    expect((await get(`/api/sprints/${b}/entries`, fac)).status).toBe(403)
    // Nor can they invite a newcomer straight into B.
    expect((await post(`/api/workspaces/${ws}/invitations`, fac, { email: `new-${tag()}@example.com`, sprint_id: b })).status).toBe(403)
    // B's facilitator still can, while B is unfinished.
    expect((await post(`/api/workspaces/${ws}/invitations`, owner, { email: fac.email, sprint_id: b })).status).toBe(200)
    expect((await get(`/api/sprints/${b}/entries`, fac)).status).toBe(200)
  })

  it('an owner who doesn’t facilitate a sprint can’t add people to it, and finished sprints take nobody', async () => {
    const { owner, members, ws } = await team(2)
    const [fac, late] = members
    const s = await post(`/api/workspaces/${ws}/sprints`, owner, { name: 'Theirs', timezone: 'UTC', starts_on: '2026-09-01', ends_on: '2026-09-10', retro_date: '2026-09-11', retro_time: '10:00', participant_ids: [fac.account_id], facilitator_id: fac.account_id })
    const id = s.body.id as string
    expect((await post(`/api/workspaces/${ws}/invitations`, owner, { email: owner.email, sprint_id: id })).status).toBe(403)
    // Not a participant: owner status alone doesn't open the sprint's content.
    await go(fac, id, 'collecting')
    await entry(fac, id, 'keep', 'owner should not read this')
    await go(fac, id, 'preparing')
    expect((await get(`/api/sprints/${id}/entries`, owner)).status).toBe(403)
    expect((await get(`/api/sprints/${id}/themes`, owner)).status).toBe(403)
    expect((await req('GET', `/api/sprints/${id}/export.md?scope=raw`, owner)).status).toBe(403)
    // Finished: the facilitator can't add anyone either.
    for (const to of ['ready', 'live', 'completed']) expect((await go(fac, id, to)).status).toBe(200)
    const finished = await post(`/api/workspaces/${ws}/invitations`, fac, { email: late.email, sprint_id: id })
    expect([403, 409]).toContain(finished.status)
    const joined = await env.DB.prepare('SELECT count(*) AS n FROM sprint_participants WHERE sprint_id = ? AND account_id = ?').bind(id, late.account_id).first<{ n: number }>()
    expect(joined!.n).toBe(0)
  })

  it('refuses a theme from another workspace in meeting commands', async () => {
    const a = await team(1)
    const b = await team(1)
    const sa = await sprint(a.owner, a.members, a.ws, 'collecting')
    const sb = await sprint(b.owner, b.members, b.ws, 'collecting')
    await entry(b.members[0], sb, 'improve', 'b entry')
    const eb = await closeCollection(b.owner, sb)
    const tb = (await post(`/api/sprints/${sb}/themes`, b.owner, { title: 'B theme', entry_ids: eb.map((e) => e.id) })).body.themes[0].id as string
    await go(a.owner, sa, 'preparing')
    await go(a.owner, sa, 'ready')
    await go(a.owner, sa, 'live')
    expect((await command(a.owner, sa, { type: 'mark_discussed', theme_id: tb, discussed: true })).status).toBe(404)
    const row = await env.DB.prepare('SELECT count(*) AS n FROM discussion_notes WHERE theme_id = ?').bind(tb).first<{ n: number }>()
    expect(row!.n).toBe(0)
    expect((await command(a.owner, sa, { type: 'set_topic', theme_id: tb })).status).toBe(404)
    expect((await req('PUT', `/api/sprints/${sa}/meeting/notes/${tb}`, a.owner, { takeaway: 'x' })).status).toBe(404)
  })

  it('changing IDs never reaches another workspace', async () => {
    const a = await team(1)
    const b = await team(1)
    const sa = await sprint(a.owner, a.members, a.ws, 'collecting')
    await entry(a.members[0], sa, 'improve', 'a secret')
    await closeCollection(a.owner, sa)
    const tA = (await post(`/api/sprints/${sa}/themes`, a.owner, { title: 'A' })).body.themes[0].id as string
    const outsider = b.owner
    for (const path of [`/api/sprints/${sa}`, `/api/sprints/${sa}/entries`, `/api/sprints/${sa}/entries/mine`, `/api/sprints/${sa}/themes`, `/api/sprints/${sa}/votes`, `/api/sprints/${sa}/experiments`, `/api/sprints/${sa}/recap`, `/api/sprints/${sa}/export.md?scope=raw`, `/api/sprints/${sa}/export.csv`])
      expect((await req('GET', path, outsider)).status, path).toBe(404)
    for (const path of [`/api/workspaces/${a.ws}`, `/api/workspaces/${a.ws}/sprints`, `/api/workspaces/${a.ws}/experiments`, `/api/workspaces/${a.ws}/audit`]) expect((await get(path, outsider)).status, path).toBe(403)
    expect((await patch(`/api/sprints/${sa}/themes/${tA}`, outsider, { title: 'pwned' })).status).toBe(404)
    expect((await del(`/api/workspaces/${a.ws}/members/${a.members[0].account_id}`, outsider)).status).toBe(403)
    expect((await patch(`/api/workspaces/${a.ws}/members/${outsider.account_id}`, outsider, { role: 'owner' })).status).toBe(403)
    expect((await post(`/api/workspaces/${a.ws}/invitations`, outsider, { email: outsider.email })).status).toBe(403)
    // B's owner stays exactly as privileged in A as a stranger.
    const title = await env.DB.prepare('SELECT title FROM themes WHERE id = ?').bind(tA).first<{ title: string }>()
    expect(title!.title).toBe('A')
  })

  it('names only this sprint’s participants as experiment owners', async () => {
    const a = await team(1)
    const b = await team(0)
    const s = await sprint(a.owner, a.members, a.ws, 'live')
    const created = await post(`/api/sprints/${s}/experiments`, a.owner, { change_to_try: 'Pair on every PR that touches billing next sprint', success_signal: 'Fewer billing reverts' })
    const id = created.body[0].id as string
    const r = await patch(`/api/sprints/${s}/experiments/${id}`, a.owner, { owner_account_id: b.owner.account_id })
    expect(r.status).toBe(400)
    const list = await get(`/api/sprints/${s}/experiments`, a.owner)
    expect(list.body[0].owner_name).toBeNull()
  })
})

describe('membership changes', () => {
  it('a removed owner who is invited back returns as a member', async () => {
    const { owner, members, ws } = await team(1)
    const second = members[0]
    expect((await patch(`/api/workspaces/${ws}/members/${second.account_id}`, owner, { role: 'owner' })).status).toBe(200)
    expect((await del(`/api/workspaces/${ws}/members/${second.account_id}`, owner)).status).toBe(200)
    expect((await get(`/api/workspaces/${ws}`, second)).status).toBe(403)
    await post(`/api/workspaces/${ws}/invitations`, owner, { email: second.email })
    const token = await inviteToken(second.email)
    expect((await post('/api/invitations/accept', second, { token })).status).toBe(200)
    const me = await get('/api/auth/me', second)
    expect(me.body.workspaces.find((w: { id: string }) => w.id === ws).role).toBe('member')
    expect((await get(`/api/workspaces/${ws}/audit`, second)).status).toBe(403)
  })

  it('keeps at least one owner when roles change', async () => {
    const { owner, ws } = await team(0)
    expect((await patch(`/api/workspaces/${ws}/members/${owner.account_id}`, owner, { role: 'member' })).status).toBe(409)
  })

  it('closes a live socket when someone is removed from the sprint, and re-checks on reconnect', async () => {
    const { owner, members, ws } = await team(2)
    const [m] = members
    const s = await sprint(owner, members, ws, 'live')
    const sock = await openSocketRaw(m, s)
    expect(sock.status).toBe(101)
    const socket = sock.webSocket!
    socket.accept()
    const messages: string[] = []
    const closed = new Promise<void>((resolve) => {
      socket.addEventListener('message', (e) => messages.push(String(e.data)))
      socket.addEventListener('close', () => resolve())
    })
    expect((await del(`/api/sprints/${s}/participants/${m.account_id}`, owner)).status).toBe(200)
    await Promise.race([closed, new Promise((r) => setTimeout(r, 3000))])
    expect(messages.some((x) => x.includes('"revoked"'))).toBe(true)
    expect((await openSocketRaw(m, s)).status).not.toBe(101)
    expect((await get(`/api/sprints/${s}/meeting`, m)).status).toBe(403)
  })
})

async function openSocketRaw(u: { session: string; csrf: string }, sprintId: string, origin: string | null = ORIGIN) {
  const headers: Record<string, string> = { upgrade: 'websocket', cookie: `muni_session=${u.session}; muni_csrf=${u.csrf}` }
  if (origin) headers.origin = origin
  return SELF.fetch(`https://muni.test/api/sprints/${sprintId}/ws`, { headers })
}

describe('live socket origin', () => {
  it('accepts the app’s origin only', async () => {
    const { owner, members, ws } = await team(1)
    const s = await sprint(owner, members, ws, 'live')
    expect((await openSocketRaw(members[0], s, null)).status).toBe(403)
    expect((await openSocketRaw(members[0], s, 'https://munimuni.app')).status).toBe(403)
    expect((await openSocketRaw(members[0], s, 'https://evil.example')).status).toBe(403)
    expect((await openSocketRaw(members[0], s)).status).toBe(101)
  })
})

describe('tokens and addresses at rest', () => {
  it('keeps invitation tokens out of URLs and out of stored job payloads', async () => {
    const { owner, ws } = await team(0)
    const email = `tok-${tag()}@example.com`
    await post(`/api/workspaces/${ws}/invitations`, owner, { email })
    const token = await inviteToken(email) // runs the email job
    const mail = await env.DB.prepare('SELECT body FROM dev_mail WHERE to_addr = ? ORDER BY created_at DESC LIMIT 1').bind(email).first<{ body: string }>()
    expect(mail!.body).toContain(`/invite#${token}`)
    expect(mail!.body).not.toContain(`/invite/${token}`)
    const jobs = await env.DB.prepare("SELECT payload FROM jobs WHERE kind = 'email'").all<{ payload: string }>()
    for (const j of jobs.results) {
      expect(j.payload).not.toContain(token)
      expect(j.payload).not.toContain(email)
    }
    // The old path-style routes are gone.
    expect((await get(`/api/invitations/${token}`)).status).toBe(404)
    expect((await post(`/api/invitations/${token}/accept`, owner)).status).toBe(404)
    expect((await post('/api/invitations/preview', null, { token })).body.valid).toBe(true)
    // The stored invitation holds only a hash.
    const inv = await env.DB.prepare('SELECT token_hash FROM invitations WHERE email = ?').bind(email).first<{ token_hash: string }>()
    expect(inv!.token_hash).not.toContain(token)
  })

  it('keeps a queued email until it’s sent, then drops the address and message', async () => {
    const { owner, ws } = await team(0)
    const email = `queued-${tag()}@example.com`
    await post(`/api/workspaces/${ws}/invitations`, owner, { email })
    const inv = await env.DB.prepare('SELECT id FROM invitations WHERE email = ?').bind(email).first<{ id: string }>()
    const job = () => env.DB.prepare('SELECT payload, status FROM jobs WHERE idempotency_key = ?').bind(`invite:${inv!.id}`).first<{ payload: string; status: string }>()
    // Until it's sent, the job holds what it must send.
    const before = await job()
    if (before!.status !== 'succeeded') expect(before!.payload).toContain(email)
    await runJobs()
    for (let i = 0; i < 40 && (await job())!.status !== 'succeeded'; i++) await new Promise((r) => setTimeout(r, 50))
    const after = await job()
    expect(after!.status).toBe('succeeded')
    expect(after!.payload).toBe('{}')
  })

  it('stores no plaintext address or network in rate-limit counters', async () => {
    const email = `rl-${tag()}@example.com`
    await signin(email)
    const rows = await env.DB.prepare('SELECT bucket FROM rate_events').all<{ bucket: string }>()
    for (const r of rows.results) {
      expect(r.bucket).not.toContain('@')
      expect(r.bucket).not.toMatch(/\d+\.\d+\.\d+\.\d+/)
    }
  })

  it('names production cookies with the __Host- prefix, host-only and Secure', () => {
    const prod = config({ APP_ENV: 'production', PUBLIC_ORIGIN: 'https://act.munimuni.app', EMAIL_PROVIDER: 'resend' })
    expect(sessionCookie(prod)).toBe('__Host-muni_session')
    expect(csrfCookie(prod)).toBe('__Host-muni_csrf')
    const c = cookie(sessionCookie(prod), 'v', prod.cookieSecure, 60, true)
    expect(c).toContain('; Secure')
    expect(c).toContain('Path=/')
    expect(c).toContain('HttpOnly')
    expect(c).not.toMatch(/domain=/i)
  })
})

describe('participant-triggered room recovery', () => {
  it('doesn’t make a participant the stage controller', async () => {
    const { owner, members, ws } = await team(1)
    const s = await sprint(owner, members, ws, 'live')
    const { roomWipe, roomState } = await import('./harness')
    await roomWipe(s)
    const snap = await get(`/api/sprints/${s}/meeting`, members[0])
    expect(snap.status).toBe(200)
    expect(snap.body.you_control).toBe(false)
    expect((await roomState(s)).meeting.controller_account_id).toBeNull()
    expect((await command(owner, s, { type: 'set_phase', phase: 'choose' })).status).toBe(200)
  })
})
