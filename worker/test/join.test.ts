/**
 * Shared invite QR / links (join requests with approval) and individual email invitations,
 * through the public HTTP API. The invariant: a link lets a signed-in person ask; only an
 * authorized person's approval adds them, as a member, never an owner.
 */
import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { b64u, newKeyPair, newRecoveryKey, newSprintSecret, sprintKeys, wrapForRecovery, wrapSprintSecret } from '../../web/src/lib/e2ee/crypto'
import { codeFor, del, get, inviteToken, post, put, rawReq, signin, sprint, tag, team, verify, legacyAccount } from './harness'

const tokenOf = (url: string) => url.split('#')[1]
const count = async (sql: string, ...args: unknown[]) => Number((await env.DB.prepare(sql).bind(...args).first<{ n: number }>())?.n ?? 0)

async function setup() {
  const { owner, members, ws } = await team(1)
  const link = await post(`/api/workspaces/${ws}/join-links`, owner, {})
  expect(link.status).toBe(200)
  return { owner, member: members[0], ws, link: link.body, token: tokenOf(link.body.url) }
}

describe('invite links', () => {
  it('are made by owners and facilitators only, hold a 256-bit token in the fragment, and store only its hash', async () => {
    const { owner, member, ws, link, token } = await setup()
    expect(link.url).toMatch(/^http:\/\/localhost:5173\/join#[A-Za-z0-9_-]{43}$/)
    expect(link.link).toMatchObject({ role: 'member', max_requests: 30, request_count: 0 })
    expect((await post(`/api/workspaces/${ws}/join-links`, member, {})).status).toBe(403)
    // The token appears nowhere in the database, audit log included.
    const tables = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'").all<{ name: string }>()).results
    for (const { name } of tables) {
      const rows = (await env.DB.prepare(`SELECT * FROM ${name}`).all()).results
      expect(JSON.stringify(rows).includes(token), name).toBe(false)
    }
    // One active code per scope unless replaced; replacing turns the old one off.
    const again = await post(`/api/workspaces/${ws}/join-links`, owner, {})
    expect(again.status).toBe(409)
    expect(again.body.code).toBe('link_exists')
    const replaced = await post(`/api/workspaces/${ws}/join-links`, owner, { replace: true })
    expect(replaced.status).toBe(200)
    expect((await post('/api/join/preview', null, { token })).body.valid).toBe(false)
    expect((await post('/api/join/preview', null, { token: tokenOf(replaced.body.url) })).body.valid).toBe(true)
    // Only the documented expiry and cap choices; a role in the body changes nothing.
    expect((await post(`/api/workspaces/${ws}/join-links`, owner, { expires_in_hours: 100000, replace: true })).status).toBe(400)
    const withRole = await post(`/api/workspaces/${ws}/join-links`, owner, { role: 'owner', replace: true })
    expect(withRole.body.link.role).toBe('member')
  })

  it('show nothing about the team before sign-in, and only its name after', async () => {
    const { token } = await setup()
    const anon = await post('/api/join/preview', null, { token })
    expect(anon.body).toEqual({ valid: true, signed_in: false, includes_sprint: false, mode: 'approval' })
    const someone = await signin(`join-prev-${tag()}@example.com`, 'Someone')
    const seen = await post('/api/join/preview', someone, { token })
    expect(Object.keys(seen.body).sort()).toEqual(['includes_sprint', 'mode', 'signed_in', 'state', 'valid', 'workspace_name'])
    expect(seen.body.state).toBe('none')
    expect((await post('/api/join/preview', null, { token: 'x'.repeat(43) })).body.valid).toBe(false)
  })
})

describe('asking to join', () => {
  it('needs a session and a chosen name, and admits nobody until approved', async () => {
    const { owner, ws, token } = await setup()
    expect((await post('/api/join/request', null, { token })).status).toBe(401)
    const email = `join-unnamed-${tag()}@example.com`
    await legacyAccount(email)
    await post('/api/auth/request-code', null, { email })
    const unnamed = (await verify(email, await codeFor(email), null)).user!
    expect((await post('/api/join/request', unnamed, { token })).body.code).toBe('name_required')
    // Someone with a screenshot of the QR: a pending request, and no access.
    const stranger = await signin(`join-screenshot-${tag()}@example.com`, 'Screenshot')
    const r = await post('/api/join/request', stranger, { token })
    expect(r.body.state).toBe('pending')
    expect((await get(`/api/workspaces/${ws}`, stranger)).status).toBe(403)
    expect((await get('/api/auth/me', stranger)).body.pending_join_requests).toHaveLength(1)
    const listed = await get(`/api/workspaces/${ws}/join-requests`, owner)
    expect(listed.body[0]).toMatchObject({ display_name: 'Screenshot', email: stranger.email, previously_member: false, matches_email_invitation: false })
  })

  it('is idempotent across repeats and concurrent tabs', async () => {
    const { ws, token } = await setup()
    const u = await signin(`join-idem-${tag()}@example.com`, 'Idem')
    const all = await Promise.all([1, 2, 3].map(() => post('/api/join/request', u, { token })))
    const ids = new Set(all.map((x) => x.body.request_id))
    expect(ids.size).toBe(1)
    expect(await count("SELECT count(*) AS n FROM join_requests WHERE workspace_id = ? AND account_id = ? AND status = 'pending'", ws, u.account_id)).toBe(1)
    expect((await post('/api/join/request', u, { token })).body.request_id).toBe([...ids][0])
  })

  it('stops at the request limit, at expiry and when turned off', async () => {
    const { owner, ws } = await setup()
    const capped = await post(`/api/workspaces/${ws}/join-links`, owner, { max_requests: 10, replace: true })
    const token = tokenOf(capped.body.url)
    for (let i = 0; i < 10; i++) expect((await post('/api/join/request', await signin(`join-cap${i}-${tag()}@example.com`, `P${i}`), { token })).body.state).toBe('pending')
    const late = await signin(`join-cap-late-${tag()}@example.com`, 'Late')
    expect((await post('/api/join/preview', late, { token })).body.state).toBe('full')
    expect((await post('/api/join/request', late, { token })).body.code).toBe('link_full')
    // Expired.
    const fresh = await post(`/api/workspaces/${ws}/join-links`, owner, { replace: true })
    await env.DB.prepare('UPDATE join_links SET expires_at = ? WHERE id = ?').bind(Date.now() - 1, fresh.body.link.id).run()
    expect((await post('/api/join/request', late, { token: tokenOf(fresh.body.url) })).status).toBe(410)
    // Turned off.
    const third = await post(`/api/workspaces/${ws}/join-links`, owner, {})
    expect((await del(`/api/workspaces/${ws}/join-links/${third.body.link.id}`, owner)).status).toBe(200)
    expect((await post('/api/join/request', late, { token: tokenOf(third.body.url) })).status).toBe(410)
  })
})

describe('approving', () => {
  it('adds a member (never an owner) and the sprint participant; repeats and other tabs agree', async () => {
    const { owner, members, ws } = await team(0 + 1)
    const sp = await sprint(owner, members, ws, 'collecting')
    const link = await post(`/api/workspaces/${ws}/join-links`, owner, { sprint_id: sp })
    expect(link.body.link.sprint_id).toBe(sp)
    const u = await signin(`join-approve-${tag()}@example.com`, 'Joiner')
    const req = (await post('/api/join/request', u, { token: tokenOf(link.body.url) })).body.request_id
    const decisions = await Promise.all([post(`/api/workspaces/${ws}/join-requests/${req}/approve`, owner, { role: 'owner' }), post(`/api/workspaces/${ws}/join-requests/${req}/approve`, owner)])
    expect(decisions.map((d) => d.body.status)).toEqual(['approved', 'approved'])
    expect(await count('SELECT count(*) AS n FROM memberships WHERE workspace_id = ? AND account_id = ? AND role = ? AND revoked_at IS NULL', ws, u.account_id, 'member')).toBe(1)
    expect(await count('SELECT count(*) AS n FROM sprint_participants WHERE sprint_id = ? AND account_id = ? AND is_facilitator = 0', sp, u.account_id)).toBe(1)
    expect(await count("SELECT count(*) AS n FROM audit_events WHERE workspace_id = ? AND action = 'join_request.approved'", ws)).toBe(1)
    const mine = await get(`/api/join-requests/${req}`, u)
    expect(mine.body).toMatchObject({ status: 'approved', workspace_id: ws, sprint_id: sp })
    // Decline after approval: refused, state unchanged.
    const late = await post(`/api/workspaces/${ws}/join-requests/${req}/decline`, owner)
    expect(late.status).toBe(409)
    expect(late.body.status).toBe('approved')
  })

  it('an approval racing a decline has exactly one outcome', async () => {
    const { owner, ws, token } = await setup()
    const u = await signin(`join-race-${tag()}@example.com`, 'Race')
    const req = (await post('/api/join/request', u, { token })).body.request_id
    const [a, d] = await Promise.all([post(`/api/workspaces/${ws}/join-requests/${req}/approve`, owner), post(`/api/workspaces/${ws}/join-requests/${req}/decline`, owner)])
    expect([a.status, d.status].sort()).toEqual([200, 409])
    const final = (await get(`/api/join-requests/${req}`, u)).body.status
    expect(await count('SELECT count(*) AS n FROM memberships WHERE workspace_id = ? AND account_id = ? AND revoked_at IS NULL', ws, u.account_id)).toBe(final === 'approved' ? 1 : 0)
  })

  it('refuses people who can’t manage the invite, the requester themself, and closed requests', async () => {
    const { owner, member, ws, token } = await setup()
    const u = await signin(`join-unauth-${tag()}@example.com`, 'Asker')
    const req = (await post('/api/join/request', u, { token })).body.request_id
    expect((await post(`/api/workspaces/${ws}/join-requests/${req}/approve`, member)).status).toBe(403)
    expect((await post(`/api/workspaces/${ws}/join-requests/${req}/approve`, u)).status).toBe(403)
    const outsider = await signin(`join-outsider-${tag()}@example.com`)
    expect((await post(`/api/workspaces/${ws}/join-requests/${req}/approve`, outsider)).status).toBe(403)
    expect((await get(`/api/workspaces/${ws}/join-requests`, member)).body).toEqual([])
    // A request from another workspace can't be decided through this one.
    const { owner: o2, ws: ws2 } = await team(0)
    expect((await post(`/api/workspaces/${ws2}/join-requests/${req}/approve`, o2)).status).toBe(404)
    // Withdrawn, then approval attempted.
    expect((await post(`/api/join-requests/${req}/withdraw`, u)).body.status).toBe('withdrawn')
    const closed = await post(`/api/workspaces/${ws}/join-requests/${req}/approve`, owner)
    expect(closed.status).toBe(409)
    expect(closed.body.status).toBe('withdrawn')
    // Too old to approve.
    const u2 = await signin(`join-stale-${tag()}@example.com`, 'Stale')
    const req2 = (await post('/api/join/request', u2, { token })).body.request_id
    await env.DB.prepare('UPDATE join_requests SET created_at = ? WHERE id = ?').bind(Date.now() - 15 * 86_400_000, req2).run()
    expect((await post(`/api/workspaces/${ws}/join-requests/${req2}/approve`, owner)).body.status).toBe('expired')
    expect(await count('SELECT count(*) AS n FROM memberships WHERE workspace_id = ? AND account_id = ?', ws, u2.account_id)).toBe(0)
  })

  it('a sprint invite is decided by that sprint’s facilitator, not by facilitators of other sprints', async () => {
    const { owner, members, ws } = await team(2)
    const [fac, other] = members
    const sp = await sprint(owner, members, ws, 'draft', { facilitator_id: fac.account_id, participant_ids: members.map((m) => m.account_id) })
    const link = await post(`/api/workspaces/${ws}/join-links`, fac, { sprint_id: sp })
    expect(link.status).toBe(200)
    expect((await post(`/api/workspaces/${ws}/join-links`, other, { sprint_id: sp, replace: true })).status).toBe(403)
    const u = await signin(`join-fac-${tag()}@example.com`, 'Fac guest')
    const req = (await post('/api/join/request', u, { token: tokenOf(link.body.url) })).body.request_id
    expect((await post(`/api/workspaces/${ws}/join-requests/${req}/approve`, other)).status).toBe(403)
    expect((await post(`/api/workspaces/${ws}/join-requests/${req}/approve`, fac)).body.status).toBe('approved')
  })

  it('removal still works afterwards, and a returning owner comes back as a member', async () => {
    const { owner, ws, token } = await setup()
    const u = await signin(`join-return-${tag()}@example.com`, 'Returner')
    const req = (await post('/api/join/request', u, { token })).body.request_id
    await post(`/api/workspaces/${ws}/join-requests/${req}/approve`, owner)
    await rawReq('PATCH', `/api/workspaces/${ws}/members/${u.account_id}`, { cookie: `muni_session=${owner.session}; muni_csrf=${owner.csrf}`, csrf: owner.csrf, json: { role: 'owner' } })
    expect((await del(`/api/workspaces/${ws}/members/${u.account_id}`, owner)).status).toBe(200)
    expect((await get(`/api/workspaces/${ws}`, u)).status).toBe(403) // the live session loses access at once
    expect((await get(`/api/join-requests/${req}`, u)).body.workspace_id).toBeNull()
    const again = (await post('/api/join/request', u, { token })).body.request_id
    expect((await get(`/api/workspaces/${ws}/join-requests`, owner)).body.find((r: { id: string }) => r.id === again).previously_member).toBe(true)
    await post(`/api/workspaces/${ws}/join-requests/${again}/approve`, owner)
    expect((await env.DB.prepare('SELECT role FROM memberships WHERE workspace_id = ? AND account_id = ?').bind(ws, u.account_id).first<{ role: string }>())!.role).toBe('member')
  })

  it('pending requests survive turning the code off, flagged for the approver', async () => {
    const { owner, ws, link, token } = await setup()
    const u = await signin(`join-off-${tag()}@example.com`, 'Before')
    const req = (await post('/api/join/request', u, { token })).body.request_id
    await del(`/api/workspaces/${ws}/join-links/${link.link.id}`, owner)
    const listed = (await get(`/api/workspaces/${ws}/join-requests`, owner)).body.find((r: { id: string }) => r.id === req)
    expect(listed.link_turned_off).toBe(true)
    expect((await post(`/api/workspaces/${ws}/join-requests/${req}/decline`, owner)).body.status).toBe('declined')
    expect((await get(`/api/join-requests/${req}`, u)).body.status).toBe('declined')
  })

  it('grants no encryption keys: approval into an encrypted sprint adds a participant, not a key', async () => {
    const { owner, ws } = await setup()
    const fk = newKeyPair()
    expect((await put('/api/me/keys', owner, { public_key: b64u(fk.pk), recovery_blob: wrapForRecovery(fk.sk, newRecoveryKey(), owner.account_id) })).status).toBe(200)
    const secret = newSprintSecret()
    const id = crypto.randomUUID()
    const s = await post(`/api/workspaces/${ws}/sprints`, owner, {
      id, name: 'Encrypted', timezone: 'UTC', starts_on: '2026-09-14', ends_on: '2026-09-27', retro_date: '2026-09-28', retro_time: '10:00', participant_ids: [], facilitator_id: owner.account_id, reminders_enabled: false,
      encryption: 'e1', sprint_key: { public_key: b64u(sprintKeys(secret, 1).pk) },
      key_wraps: [{ account_id: owner.account_id, version: 1, recipient_public_key: b64u(fk.pk), wrapped: wrapSprintSecret(fk.pk, secret, { sprintId: id, version: 1, recipientId: owner.account_id }) }],
    })
    expect(s.status, JSON.stringify(s.body)).toBe(200)
    expect(s.body.encryption).toBe('e1')
    const link = await post(`/api/workspaces/${ws}/join-links`, owner, { sprint_id: id })
    const u = await signin(`join-e2ee-${tag()}@example.com`, 'Enc')
    const req = (await post('/api/join/request', u, { token: tokenOf(link.body.url) })).body.request_id
    expect((await post(`/api/workspaces/${ws}/join-requests/${req}/approve`, owner)).body.status).toBe('approved')
    // A participant now — and holding nothing. Keys reach them only through the existing,
    // reviewed sharing flow (teammates' devices, after reveal), never through approval.
    expect(await count('SELECT count(*) AS n FROM sprint_participants WHERE sprint_id = ? AND account_id = ?', id, u.account_id)).toBe(1)
    expect(await count('SELECT count(*) AS n FROM sprint_key_wraps WHERE account_id = ?', u.account_id)).toBe(0)
    const view = await get(`/api/sprints/${id}/keys`, u)
    expect(view.body).toMatchObject({ encryption: 'e1', sealed_version: 1, my_wraps: [] })
  })
})

describe('individual email invitations', () => {
  it('are single-use, for one address, with an explicit member role and a copyable link', async () => {
    const t = tag()
    const owner = await signin(`inv-owner-${t}@example.com`, 'Owner')
    const ws = (await post('/api/workspaces', owner, { name: 'T' })).body.id
    const email = `inv-to-${t}@example.com`
    const made = await post(`/api/workspaces/${ws}/invitations`, owner, { email })
    expect(made.body.link).toMatch(/\/invite#/)
    expect((await env.DB.prepare('SELECT role FROM invitations WHERE id = ?').bind(made.body.invitation_id).first<{ role: string }>())!.role).toBe('member')
    const token = await inviteToken(email)
    expect(tokenOf(made.body.link)).toBe(token)
    const wrong = await signin(`inv-wrong-${t}@example.com`, 'Wrong')
    const mismatch = await post('/api/invitations/accept', wrong, { token })
    expect(mismatch.status).toBe(403)
    expect(mismatch.body.error).not.toContain(email) // masked
    const preview = await post('/api/invitations/preview', wrong, { token })
    expect(preview.body).toMatchObject({ valid: true, matches_session: false, workspace_name: null })
    const right = await signin(email, 'Right')
    expect((await post('/api/invitations/accept', right, { token })).status).toBe(200)
    expect((await post('/api/invitations/accept', right, { token })).status).toBe(404) // replay
    expect((await post('/api/invitations/accept', wrong, { token })).status).toBe(404)
  })
})
