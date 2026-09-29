/**
 * Who may bring people in (lib/grants.ts): into the workspace, only its owners; into a sprint, that
 * sprint's facilitator. And how much email one account — or the whole server — may send.
 */
import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { del, get, inviteToken, lastMailTo, patch, post, signin, sprint, tag, team, type User } from './harness'
import { INVITE_EMAILS_DAILY, WORKSPACES_DAILY } from '../src/routes/workspaces'
import { enqueue, runDue } from '../src/jobs'

const tokenOf = (url: string) => url.split('#')[1]

/** A member who set up a draft sprint and facilitates it — which any member can do. */
async function selfMadeFacilitator() {
  const { owner, members, ws } = await team(2)
  const [m, other] = members
  const draft = await sprint(m, [m], ws, 'draft')
  return { owner, m, other, ws, draft }
}

describe('bringing people into the workspace', () => {
  it('is for owners: facilitating a sprint lets nobody invite, approve, or see who was invited', async () => {
    const { owner, m, ws } = await selfMadeFacilitator()
    // Invitations and links for the workspace.
    expect((await post(`/api/workspaces/${ws}/invitations`, m, { email: `new-${tag()}@example.com` })).status).toBe(403)
    expect((await post(`/api/workspaces/${ws}/join-links`, m, {})).status).toBe(403)
    expect((await post(`/api/workspaces/${ws}/join-links`, m, { mode: 'direct' })).status).toBe(403)
    // Requests from the team QR: neither listed nor decided.
    const qr = await post(`/api/workspaces/${ws}/join-links`, owner, {})
    const asker = await signin(`asker-${tag()}@example.com`, 'Asker')
    const request = (await post('/api/join/request', asker, { token: tokenOf(qr.body.url) })).body.request_id as string
    expect((await get(`/api/workspaces/${ws}/join-requests`, m)).body).toEqual([])
    expect((await post(`/api/workspaces/${ws}/join-requests/${request}/approve`, m)).status).toBe(403)
    expect((await post(`/api/workspaces/${ws}/join-requests/${request}/decline`, m)).status).toBe(403)
    expect((await get(`/api/join-requests/${request}`, asker)).body.status).toBe('pending')
    // Pending invitations and their addresses; withdrawing them.
    const invited = `invited-${tag()}@example.com`
    const inv = await post(`/api/workspaces/${ws}/invitations`, owner, { email: invited })
    const seen = (await get(`/api/workspaces/${ws}`, m)).body
    expect(seen.can_invite).toBe(false)
    expect(seen.pending_invitations).toEqual([])
    expect(JSON.stringify(seen)).not.toContain(invited)
    expect((await del(`/api/workspaces/${ws}/invitations/${inv.body.invitation_id}`, m)).status).toBe(403)
    expect((await get(`/api/workspaces/${ws}/join-links`, m)).body).toEqual([])
    // The owner can do all of it.
    const mine = (await get(`/api/workspaces/${ws}`, owner)).body
    expect(mine.can_invite).toBe(true)
    expect(mine.pending_invitations.map((p: { email: string }) => p.email)).toEqual([invited])
    expect((await post(`/api/workspaces/${ws}/join-requests/${request}/approve`, owner)).body.status).toBe('approved')
  })

  it('into a sprint stays with its facilitator, owner or not', async () => {
    const { owner, m, other, ws, draft } = await selfMadeFacilitator()
    const r = await post(`/api/workspaces/${ws}/invitations`, m, { email: `sprint-${tag()}@example.com`, sprint_id: draft })
    expect(r.status).toBe(200)
    expect(r.body.link).toMatch(/\/invite#/)
    const link = await post(`/api/workspaces/${ws}/join-links`, m, { sprint_id: draft, mode: 'direct' })
    expect(link.status).toBe(200)
    // Another member can't, nor can an owner who doesn't facilitate it.
    expect((await post(`/api/workspaces/${ws}/invitations`, other, { email: `x-${tag()}@example.com`, sprint_id: draft })).status).toBe(403)
    expect((await post(`/api/workspaces/${ws}/join-links`, owner, { sprint_id: draft, replace: true })).status).toBe(403)
    // Owners see every live way in and may turn any of it off; the facilitator, their sprint's.
    expect((await get(`/api/workspaces/${ws}/join-links`, owner)).body.map((l: { id: string }) => l.id)).toContain(link.body.link.id)
    expect((await get(`/api/workspaces/${ws}/join-links`, m)).body.map((l: { id: string }) => l.id)).toEqual([link.body.link.id])
    expect((await del(`/api/workspaces/${ws}/invitations/${r.body.invitation_id}`, other)).status).toBe(403)
    expect((await del(`/api/workspaces/${ws}/invitations/${r.body.invitation_id}`, m)).status).toBe(200)
    expect((await del(`/api/workspaces/${ws}/join-links/${link.body.link.id}`, owner)).status).toBe(200)
    expect((await post('/api/join/preview', null, { token: tokenOf(link.body.url) })).body.valid).toBe(false)
  })

  it('tells nobody but owners whether an address is a member’s', async () => {
    const { owner, m, other, ws, draft } = await selfMadeFacilitator()
    const stranger = `stranger-${tag()}@example.com`
    const toMember = await post(`/api/workspaces/${ws}/invitations`, m, { email: other.email, sprint_id: draft })
    const toStranger = await post(`/api/workspaces/${ws}/invitations`, m, { email: stranger, sprint_id: draft })
    for (const r of [toMember, toStranger]) {
      expect(r.status).toBe(200)
      expect(Object.keys(r.body).sort()).toEqual(['already_member', 'email', 'invitation_id', 'link'])
      expect(r.body.already_member).toBe(false)
    }
    // Both were sent; the member joins the sprint by accepting, like anyone else.
    const token = await inviteToken(other.email)
    expect(await lastMailTo(stranger)).not.toBeNull()
    expect((await get(`/api/sprints/${draft}`, other)).status).toBe(403)
    expect((await post('/api/invitations/accept', other, { token })).status).toBe(200)
    expect((await get(`/api/sprints/${draft}`, other)).body.is_participant).toBe(true)
    expect((await get(`/api/workspaces/${ws}`, other)).body.workspace.role).toBe('member')
    // An owner sees members' addresses anyway, and is told.
    expect((await post(`/api/workspaces/${ws}/invitations`, owner, { email: m.email })).body.already_member).toBe(true)
  })

  it('stops an invitation working once its sender may no longer invite there', async () => {
    const { owner, members, ws } = await team(1)
    const [second] = members
    expect((await patch(`/api/workspaces/${ws}/members/${second.account_id}`, owner, { role: 'owner' })).status).toBe(200)
    const email = `late-${tag()}@example.com`
    await post(`/api/workspaces/${ws}/invitations`, owner, { email })
    const token = await inviteToken(email)
    expect((await post('/api/invitations/preview', null, { token })).body.valid).toBe(true)
    // The owner who sent it is no longer one.
    expect((await patch(`/api/workspaces/${ws}/members/${owner.account_id}`, second, { role: 'member' })).status).toBe(200)
    expect((await post('/api/invitations/preview', null, { token })).body.valid).toBe(false)
    const u = await signin(email, 'Late')
    expect((await post('/api/invitations/accept', u, { token })).status).toBe(404)
    expect((await get(`/api/workspaces/${ws}`, u)).status).toBe(403)
  })
})

describe('email', () => {
  it('one account sends at most a day’s worth of invitations, across its workspaces', async () => {
    const u = await signin(`inviter-${tag()}@example.com`, 'Inviter')
    const one = (await post('/api/workspaces', u, { name: 'One' })).body.id as string
    const two = (await post('/api/workspaces', u, { name: 'Two' })).body.id as string
    const send = (ws: string, i: number) => post(`/api/workspaces/${ws}/invitations`, u, { email: `to-${i}-${tag()}@example.com` })
    for (let i = 0; i < INVITE_EMAILS_DAILY; i++) expect((await send(i % 2 ? one : two, i)).status).toBe(200)
    const over = await send(two, INVITE_EMAILS_DAILY)
    expect(over.status).toBe(429)
    expect(over.body.code).toBe('rate_limited')
    expect(over.body.retry_after_seconds).toBeGreaterThan(0)
    // Nothing was made for the refused one.
    expect(Number((await env.DB.prepare('SELECT count(*) AS n FROM invitations WHERE invited_by = ?').bind(u.account_id).first<{ n: number }>())!.n)).toBe(INVITE_EMAILS_DAILY)
  })

  it('one account makes at most a day’s worth of workspaces', async () => {
    const u = await signin(`maker-${tag()}@example.com`, 'Maker')
    for (let i = 0; i < WORKSPACES_DAILY; i++) expect((await post('/api/workspaces', u, { name: `W${i}` })).status).toBe(200)
    const over = await post('/api/workspaces', u, { name: 'One too many' })
    expect(over.status).toBe(429)
    expect((await get('/api/auth/me', u)).body.workspaces).toHaveLength(WORKSPACES_DAILY)
  })

  it('stops at the server’s daily email limit, and the job says so', async () => {
    const sent = async () => Number((await env.DB.prepare("SELECT count(*) AS n FROM rate_events WHERE bucket = 'email-sent' AND at > ?").bind(Date.now() - 86_400_000).first<{ n: number }>())!.n)
    // Earlier tests' mail goes out first (some of it may be on its way already); then there's room
    // for exactly one more today.
    const busy = async () => Number((await env.DB.prepare("SELECT count(*) AS n FROM jobs WHERE status IN ('queued','running')").first<{ n: number }>())!.n)
    for (let i = 0; i < 100 && (await busy()); i++) {
      await runDue(env as unknown as Parameters<typeof runDue>[0], 500)
      await new Promise((r) => setTimeout(r, 25))
    }
    const limited = { ...env, EMAIL_DAILY_LIMIT: String((await sent()) + 1) } as unknown as Parameters<typeof runDue>[0]
    const a = `cap-a-${tag()}@example.com`
    const b = `cap-b-${tag()}@example.com`
    await enqueue(env.DB, 'email', { to: a, subject: 'first', body: 'x' }, Date.now(), `cap:${a}`)
    await runDue(limited, 50)
    await enqueue(env.DB, 'email', { to: b, subject: 'second', body: 'x' }, Date.now(), `cap:${b}`)
    await runDue(limited, 50)
    expect((await lastMailTo(a))?.subject).toBe('first')
    expect(await lastMailTo(b)).toBeNull()
    const job = (await env.DB.prepare('SELECT status, last_error, payload, attempts FROM jobs WHERE idempotency_key = ?').bind(`cap:${b}`).first<{ status: string; last_error: string; payload: string; attempts: number }>())!
    // Failed at once, with the reason, and without keeping the address.
    expect(job.status).toBe('failed')
    expect(job.attempts).toBe(1)
    expect(job.last_error).toMatch(/daily email limit \(\d+\) is reached/)
    expect(job.payload).toBe('{}')
  })
})

export type { User }
