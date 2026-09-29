/** Leaving a workspace and deleting an account: who may go, and what stays with the team. */
import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { ageSession, closeCollection, del, entry, get, go, patch, post, signin, sprint, tag, team } from './harness'
import { deleteAccount, revokeMembership } from '../src/lib/departure'

const n = async (sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).first<{ n: number }>())!.n

/** Every row, in every table, that still names this account. */
async function traces(accountId: string) {
  const cols: [string, string][] = [
    ['accounts', 'id'], ['memberships', 'account_id'], ['sessions', 'account_id'], ['sprint_participants', 'account_id'],
    ['entries', 'author_account_id'], ['context_additions', 'author_account_id'], ['votes', 'account_id'], ['checkin_responses', 'account_id'],
    ['experiments', 'owner_account_id'], ['sprints', 'created_by'], ['checkins', 'opened_by'], ['sprint_keys', 'created_by'],
    ['sprint_key_wraps', 'account_id'], ['sprint_key_wraps', 'created_by'], ['invitations', 'invited_by'], ['invitations', 'accepted_by'],
    ['join_links', 'created_by'], ['join_links', 'redeemed_by'], ['join_requests', 'account_id'], ['join_requests', 'decided_by'],
    ['audit_events', 'actor_id'], ['security_events', 'account_id'], ['webauthn_credentials', 'account_id'], ['webauthn_challenges', 'account_id'],
    ['account_keys', 'account_id'], ['account_emails', 'account_id'], ['passkey_key_wraps', 'account_id'], ['device_unlocks', 'account_id'],
  ]
  const found: string[] = []
  for (const [t, c] of cols) if (await n(`SELECT count(*) AS n FROM ${t} WHERE ${c} = ?`, accountId)) found.push(`${t}.${c}`)
  if (await n("SELECT count(*) AS n FROM audit_events WHERE meta LIKE '%' || ? || '%'", accountId)) found.push('audit_events.meta')
  return found
}

describe('leaving a workspace', () => {
  it('a member leaves: access ends, unfinished sprints lose them, what they submitted stays', async () => {
    const { owner, members, ws } = await team(2)
    const [leaver, stays] = members
    const s = await sprint(owner, members, ws, 'collecting')
    await entry(leaver, s, 'improve', 'written before leaving')
    const r = await post(`/api/workspaces/${ws}/leave`, leaver)
    expect(r.status).toBe(200)
    expect(r.body.deleted).toBe(false)
    expect((await get(`/api/workspaces/${ws}`, leaver)).status).toBe(403)
    expect((await get('/api/auth/me', leaver)).body.workspaces.map((w: { id: string }) => w.id)).not.toContain(ws)
    expect(await n('SELECT count(*) AS n FROM sprint_participants WHERE sprint_id = ? AND account_id = ?', s, leaver.account_id)).toBe(0)
    const shared = await closeCollection(owner, s)
    expect(shared.map((e) => e.body)).toContain('written before leaving')
    const audit = (await get(`/api/workspaces/${ws}/audit`, owner)).body as { action: string; actor_name: string | null }[]
    expect(audit.find((e) => e.action === 'membership.left')?.actor_name).toBe('Member 0')
    // The rest of the team carries on.
    expect((await get(`/api/workspaces/${ws}`, stays)).status).toBe(200)
  })

  it('the last owner makes someone else an owner first', async () => {
    const { owner, members, ws } = await team(1)
    const r = await post(`/api/workspaces/${ws}/leave`, owner)
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('last_owner')
    expect((await patch(`/api/workspaces/${ws}/members/${members[0].account_id}`, owner, { role: 'owner' })).status).toBe(200)
    expect((await post(`/api/workspaces/${ws}/leave`, owner)).status).toBe(200)
    expect((await get(`/api/workspaces/${ws}`, members[0])).status).toBe(200)
  })

  it('a facilitator hands on an unfinished sprint others are in first', async () => {
    const { owner, members, ws } = await team(2)
    const [fac, other] = members
    await patch(`/api/workspaces/${ws}/members/${other.account_id}`, owner, { role: 'owner' })
    const s = await sprint(fac, [fac, owner], ws, 'draft')
    const r = await post(`/api/workspaces/${ws}/leave`, fac)
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('facilitating')
    expect(r.body.sprints).toEqual([{ id: s, name: 'Sprint T' }])
    expect((await patch(`/api/sprints/${s}`, fac, { facilitator_id: owner.account_id })).status).toBe(200)
    expect((await post(`/api/workspaces/${ws}/leave`, fac)).status).toBe(200)
  })

  it('someone alone in a workspace leaves only by deleting it, and says so', async () => {
    const u = await signin(`solo-${tag()}@example.com`, 'Solo')
    const ws = (await post('/api/workspaces', u, { name: 'Just me' })).body.id as string
    const s = await sprint(u, [u], ws, 'collecting')
    await entry(u, s, 'keep', 'only mine')
    const r = await post(`/api/workspaces/${ws}/leave`, u)
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('sole_member')
    const ok = await post(`/api/workspaces/${ws}/leave`, u, { delete_workspace: true })
    expect(ok.status).toBe(200)
    expect(ok.body.deleted).toBe(true)
    expect(await n('SELECT count(*) AS n FROM workspaces WHERE id = ?', ws)).toBe(0)
    expect(await n('SELECT count(*) AS n FROM sprints WHERE id = ?', s)).toBe(0)
    expect(await n('SELECT count(*) AS n FROM entries WHERE sprint_id = ?', s)).toBe(0)
    expect(await n('SELECT count(*) AS n FROM audit_events WHERE workspace_id = ?', ws)).toBe(0)
  })

  it('an outsider can’t leave for someone', async () => {
    const a = await team(1)
    const b = await team(0)
    expect((await post(`/api/workspaces/${a.ws}/leave`, b.owner)).status).toBe(403)
  })
})

describe('never without an owner, never without a facilitator', () => {
  const owners = (ws: string) => n("SELECT count(*) AS n FROM memberships WHERE workspace_id = ? AND role = 'owner' AND revoked_at IS NULL", ws)
  const run = (stmts: [string, ...unknown[]][]) => env.DB.batch(stmts.map(([sql, ...args]) => env.DB.prepare(sql).bind(...args)))

  it('two owners demoting each other at once leave one owner', async () => {
    const { owner, members, ws } = await team(1)
    const [second] = members
    expect((await patch(`/api/workspaces/${ws}/members/${second.account_id}`, owner, { role: 'owner' })).status).toBe(200)
    const both = await Promise.all([patch(`/api/workspaces/${ws}/members/${second.account_id}`, owner, { role: 'member' }), patch(`/api/workspaces/${ws}/members/${owner.account_id}`, second, { role: 'member' })])
    expect(both.map((r) => r.status)).toContain(200)
    expect(await owners(ws)).toBe(1)
  })

  it('an account deletion that a join lands in the middle of deletes nothing', async () => {
    const x = await signin(`sole-${tag()}@example.com`, 'Sole')
    const ws = (await post('/api/workspaces', x, { name: 'Mine' })).body.id as string
    // What deleting them would do was worked out while they were alone in it…
    const stmts = deleteAccount(x.account_id, x.email, [ws])
    // …and someone redeems their personal link before it runs.
    const joiner = await signin(`joiner-${tag()}@example.com`, 'Joiner')
    await env.DB.prepare("INSERT INTO memberships (workspace_id, account_id, role, created_at) VALUES (?,?,'member',?)").bind(ws, joiner.account_id, Date.now()).run()
    const res = await run(stmts)
    expect(res.at(-1)!.meta.changes).toBe(0)
    expect(await n('SELECT count(*) AS n FROM accounts WHERE id = ?', x.account_id)).toBe(1)
    expect(await n('SELECT count(*) AS n FROM workspaces WHERE id = ?', ws)).toBe(1)
    expect(await owners(ws)).toBe(1)
    // Asked now, they're told what needs handing on.
    const r = await del('/api/auth/me', x, { confirm: true })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('not_free')
    expect(r.body.workspaces).toEqual([expect.objectContaining({ workspace_id: ws, last_owner: true })])
  })

  it('an account deletion or a removal that a handover lands in the middle of does nothing', async () => {
    const { owner, members, ws } = await team(2)
    const [x, other] = members
    const s = await sprint(owner, [x, other], ws, 'collecting')
    await entry(x, s, 'improve', 'not seen yet')
    const deleting = deleteAccount(x.account_id, x.email, [])
    const removing = revokeMembership(ws, x.account_id, owner.account_id, 'membership.revoked')
    // The facilitator hands the sprint to them before either runs.
    expect((await patch(`/api/sprints/${s}`, owner, { facilitator_id: x.account_id })).status).toBe(200)
    expect((await run(deleting)).at(-1)!.meta.changes).toBe(0)
    expect((await run(removing))[0].meta.changes).toBe(0)
    expect(await n('SELECT count(*) AS n FROM entries WHERE sprint_id = ? AND author_account_id = ?', s, x.account_id)).toBe(1)
    expect(await n('SELECT count(*) AS n FROM memberships WHERE workspace_id = ? AND account_id = ? AND revoked_at IS NULL', ws, x.account_id)).toBe(1)
    expect(await n('SELECT count(*) AS n FROM sprint_participants WHERE sprint_id = ? AND account_id = ? AND is_facilitator = 1', s, x.account_id)).toBe(1)
  })
})

describe('removing a member', () => {
  it('waits while they facilitate an unfinished sprint others are in, and says which', async () => {
    const { owner, members, ws } = await team(2)
    const [fac, other] = members
    const s = await sprint(fac, [fac, other], ws, 'collecting')
    // Owners are told before they try; members aren't told at all.
    const seen = (await get(`/api/workspaces/${ws}`, owner)).body.members.find((m: { account_id: string }) => m.account_id === fac.account_id)
    expect(seen.facilitating).toEqual([{ id: s, name: 'Sprint T' }])
    const asMember = (await get(`/api/workspaces/${ws}`, other)).body.members.find((m: { account_id: string }) => m.account_id === fac.account_id)
    expect(asMember.facilitating).toEqual([])

    const r = await del(`/api/workspaces/${ws}/members/${fac.account_id}`, owner)
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('facilitating')
    expect(r.body.sprints).toEqual([{ id: s, name: 'Sprint T' }])
    // Nothing changed: still a member, still facilitating.
    expect((await get(`/api/workspaces/${ws}`, fac)).status).toBe(200)
    expect(await n('SELECT count(*) AS n FROM sprint_participants WHERE sprint_id = ? AND account_id = ? AND is_facilitator = 1', s, fac.account_id)).toBe(1)

    // Once they hand it on, they can be removed.
    expect((await patch(`/api/sprints/${s}`, fac, { facilitator_id: other.account_id })).status).toBe(200)
    expect((await get(`/api/workspaces/${ws}`, owner)).body.members.find((m: { account_id: string }) => m.account_id === fac.account_id).facilitating).toEqual([])
    expect((await del(`/api/workspaces/${ws}/members/${fac.account_id}`, owner)).status).toBe(200)
    expect((await get(`/api/workspaces/${ws}`, fac)).status).toBe(403)
  })

  it('doesn’t wait for finished sprints, or ones only they are in', async () => {
    const { owner, members, ws } = await team(2)
    const [fac, other] = members
    await sprint(fac, [fac], ws, 'collecting')
    const done = await sprint(fac, [fac, other], ws, 'collecting')
    for (const to of ['preparing', 'ready', 'live', 'completed']) expect((await go(fac, done, to)).status).toBe(200)
    expect((await del(`/api/workspaces/${ws}/members/${fac.account_id}`, owner)).status).toBe(200)
  })
})

describe('deleting an account', () => {
  it('needs a recent sign-in and a confirmation', async () => {
    const u = await signin(`del-${tag()}@example.com`, 'Deleter')
    expect((await del('/api/auth/me', u, {})).status).toBe(400)
    await ageSession(u)
    const stale = await del('/api/auth/me', u, { confirm: true })
    expect(stale.status).toBe(403)
    expect(stale.body.code).toBe('reauth_required')
    expect(await n('SELECT count(*) AS n FROM accounts WHERE id = ?', u.account_id)).toBe(1)
  })

  it('waits until what others depend on is handed on, and says what that is', async () => {
    const { owner, members, ws } = await team(1)
    const preview = await get('/api/auth/me/deletion', owner)
    expect(preview.body.can_delete).toBe(false)
    expect(preview.body.workspaces).toEqual([expect.objectContaining({ workspace_id: ws, last_owner: true, sole: false })])
    const r = await del('/api/auth/me', owner, { confirm: true })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('not_free')
    await patch(`/api/workspaces/${ws}/members/${members[0].account_id}`, owner, { role: 'owner' })
    expect((await get('/api/auth/me/deletion', owner)).body.can_delete).toBe(true)
  })

  it('removes what nobody has seen, keeps what the team saw tied to no one, and leaves no trace of the account', async () => {
    const { owner, members, ws } = await team(2)
    const [gone, stays] = members
    // A sprint whose thoughts were revealed, and one still collecting.
    const seen = await sprint(owner, members, ws, 'collecting')
    await entry(gone, seen, 'improve', 'the team saw this')
    await entry(stays, seen, 'keep', 'someone else’s')
    await closeCollection(owner, seen)
    const unseen = await sprint(owner, members, ws, 'collecting')
    await entry(gone, unseen, 'improve', 'nobody saw this')
    await entry(stays, unseen, 'keep', 'still here')
    // A workspace only they are in goes with them.
    const solo = (await post('/api/workspaces', gone, { name: 'Mine alone' })).body.id as string
    const preview = (await get('/api/auth/me/deletion', gone)).body
    expect(preview.can_delete).toBe(true)
    expect(preview.workspaces.find((w: { workspace_id: string }) => w.workspace_id === solo).sole).toBe(true)

    const r = await del('/api/auth/me', gone, { confirm: true })
    expect(r.status).toBe(200)
    expect(r.body.credential_ids).toHaveLength(1)
    expect(r.body.rp_id).toBeTruthy()

    expect((await get('/api/auth/me', gone)).status).toBe(401)
    expect(await traces(gone.account_id)).toEqual([])
    expect(await n('SELECT count(*) AS n FROM workspaces WHERE id = ?', solo)).toBe(0)
    // Seen: still in the sprint, under a stand-in that names no one.
    const kept = await env.DB.prepare('SELECT author_account_id AS a FROM entries WHERE sprint_id = ? AND author_account_id LIKE ?').bind(seen, 'gone:%').all<{ a: string }>()
    expect(kept.results).toHaveLength(1)
    expect((await get(`/api/sprints/${seen}/entries`, owner)).body.map((e: { body: string }) => e.body).sort()).toEqual(['someone else’s', 'the team saw this'])
    // Unseen: gone; everyone else's stays.
    const left = (await closeCollection(owner, unseen)).map((e) => e.body)
    expect(left).toEqual(['still here'])
    // The team is intact, and its history says someone deleted their account.
    const people = (await get(`/api/workspaces/${ws}`, owner)).body.members.map((m: { account_id: string }) => m.account_id)
    expect(people).toEqual(expect.arrayContaining([owner.account_id, stays.account_id]))
    expect(people).not.toContain(gone.account_id)
    const audit = (await get(`/api/workspaces/${ws}/audit`, owner)).body as { action: string; actor_name: string | null; actor_gone: boolean }[]
    expect(audit.some((e) => e.action === 'account.deleted' && e.actor_gone)).toBe(true)
    expect(audit.find((e) => e.action === 'invitation.accepted' && e.actor_gone)).toBeTruthy()
    expect(audit.filter((e) => e.actor_name === null).every((e) => e.actor_gone)).toBe(true)
  })

  it('keeps votes from a closed round in the totals, tied to no one', async () => {
    const { owner, members, ws } = await team(1)
    const [gone] = members
    const s = await sprint(owner, members, ws, 'collecting')
    await entry(gone, s, 'improve', 'a thought')
    const shared = await closeCollection(owner, s)
    const theme = (await post(`/api/sprints/${s}/themes`, owner, { title: 'T', entry_ids: shared.map((e) => e.id) })).body.themes[0].id as string
    expect((await go(owner, s, 'ready')).status).toBe(200)
    expect((await post(`/api/sprints/${s}/votes/rounds`, owner)).status).toBe(200)
    expect((await post(`/api/sprints/${s}/votes`, gone, { theme_id: theme, cast: true })).status).toBe(200)
    expect((await post(`/api/sprints/${s}/votes/rounds/close`, owner, { action: 'close' })).status).toBe(200)
    const before = await n('SELECT count(*) AS n FROM votes WHERE theme_id = ?', theme)
    expect((await del('/api/auth/me', gone, { confirm: true })).status).toBe(200)
    expect(before).toBe(1)
    expect(await n('SELECT count(*) AS n FROM votes WHERE theme_id = ?', theme)).toBe(1)
    expect(await traces(gone.account_id)).toEqual([])
  })
})
