/** Retention: content is purged after the workspace window; outcomes live under their own, longer window. */
import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { closeCollection, command, entry, get, go, ids, patch, post, put, roomState, sprint, team, type User } from './harness'
import { retention } from '../src/jobs'

const DAY = 86_400_000
const n = async (sql: string, ...args: unknown[]) => Number((await env.DB.prepare(sql).bind(...args).first<{ n: number }>())!.n)

/** A completed sprint with every kind of content attached. */
async function completedSprint(owner: User, members: User[], ws: string, publishRecap: boolean) {
  const s = await sprint(owner, members, ws, 'collecting')
  await entry(members[0], s, 'improve', 'purge-needle body')
  await entry(members[1], s, 'keep', 'another body')
  const entries = await closeCollection(owner, s)
  const g = await post(`/api/sprints/${s}/themes`, owner, { title: 'Theme', entry_ids: ids(entries) })
  const theme = g.body.themes[0].id as string
  await go(owner, s, 'ready')
  await post(`/api/sprints/${s}/votes/rounds`, owner)
  await post(`/api/sprints/${s}/votes`, members[0], { theme_id: theme, cast: true })
  await post(`/api/sprints/${s}/votes/rounds/close`, owner, { action: 'close' })
  await go(owner, s, 'live')
  expect((await post(`/api/sprints/${s}/meeting/context`, members[1], { theme_id: theme, body: 'context-needle' })).status).toBe(200)
  await command(owner, s, { type: 'set_topic', theme_id: theme })
  expect((await put(`/api/sprints/${s}/meeting/notes/${theme}`, owner, { takeaway: 'takeaway-needle' })).status).toBe(200)
  const exp = await post(`/api/sprints/${s}/experiments`, owner, { change_to_try: 'For the next sprint, reserve a daily 15-minute review window', success_signal: 'PRs wait less than a day', theme_id: theme, owner_account_id: members[0].account_id })
  expect(exp.status).toBe(200)
  const experimentId = exp.body[0].id as string
  expect((await put(`/api/sprints/${s}/recap`, owner, { body: '# Sprint T — retro recap\n\nWe agreed a review window.', publish: publishRecap })).status).toBe(200)
  expect((await go(owner, s, 'completed')).status).toBe(200)
  return { s, theme, experimentId }
}

describe('retention', () => {
  it('purges content after the workspace window and keeps outcomes and published recaps', async () => {
    const { owner, members, ws } = await team(2)
    const { s, experimentId } = await completedSprint(owner, members, ws, true)
    const fresh = await completedSprint(owner, members, ws, true)
    // Everything is there before the window closes.
    expect(await n('SELECT count(*) AS n FROM entries WHERE sprint_id = ?', s)).toBe(2)
    expect(await n('SELECT count(*) AS n FROM votes WHERE round_id IN (SELECT id FROM vote_rounds WHERE sprint_id = ?)', s)).toBe(1)
    await retention(env as any)
    expect(await n('SELECT count(*) AS n FROM entries WHERE sprint_id = ?', s)).toBe(2)
    expect((await get(`/api/sprints/${s}`, owner)).body.content_purged_at).toBeNull()
    // Age the sprint past the workspace retention window (default 90 days).
    await env.DB.prepare('UPDATE sprints SET completed_at = ? WHERE id = ?').bind(Date.now() - 100 * DAY, s).run()
    await retention(env as any)
    for (const [table, sql] of [
      ['entries', 'SELECT count(*) AS n FROM entries WHERE sprint_id = ?'],
      ['themes', 'SELECT count(*) AS n FROM themes WHERE sprint_id = ?'],
      ['discussion_notes', 'SELECT count(*) AS n FROM discussion_notes WHERE sprint_id = ?'],
      ['context_additions', 'SELECT count(*) AS n FROM context_additions WHERE sprint_id = ?'],
      ['vote_rounds', 'SELECT count(*) AS n FROM vote_rounds WHERE sprint_id = ?'],
      ['votes', 'SELECT count(*) AS n FROM votes WHERE round_id IN (SELECT id FROM vote_rounds WHERE sprint_id = ?)'],
      ['theme_entries', 'SELECT count(*) AS n FROM theme_entries WHERE theme_id IN (SELECT id FROM themes WHERE sprint_id = ?)'],
    ]) expect(await n(sql, s), table).toBe(0)
    // Experiments and the published recap remain; the experiment loses its theme link but keeps the title.
    const exps = await get(`/api/sprints/${s}/experiments`, owner)
    expect(exps.body).toHaveLength(1)
    expect(exps.body[0]).toMatchObject({ id: experimentId, theme_id: null, theme_title: 'Theme', owner_name: 'Member 0' })
    const recap = await get(`/api/sprints/${s}/recap`, members[1])
    expect(recap.body.exists).toBe(true)
    expect(recap.body.published_at).not.toBeNull()
    expect(recap.body.body).toContain('retro recap')
    // The sprint is archived and marked as purged; the audit trail records it.
    const d = await get(`/api/sprints/${s}`, owner)
    expect(d.body.status).toBe('archived')
    expect(d.body.content_purged_at).not.toBeNull()
    expect(d.body.entry_count).toBe(0)
    expect(d.body.theme_count).toBe(0)
    expect(await n("SELECT count(*) AS n FROM audit_events WHERE sprint_id = ? AND action = 'retention.purged'", s)).toBe(1)
    // Nothing that could name a person or quote an entry survives in the purged sprint's exports.
    const md = await get(`/api/sprints/${s}/export.md?scope=raw`, owner)
    expect(md.status).toBe(200)
    expect(md.body).not.toContain('purge-needle')
    expect(md.body).not.toContain('context-needle')
    // A younger sprint in the same workspace is untouched, and a second sweep is a no-op.
    expect(await n('SELECT count(*) AS n FROM entries WHERE sprint_id = ?', fresh.s)).toBe(2)
    expect((await get(`/api/sprints/${fresh.s}`, owner)).body.status).toBe('completed')
    await retention(env as any)
    expect(await n("SELECT count(*) AS n FROM audit_events WHERE sprint_id = ? AND action = 'retention.purged'", s)).toBe(1)
  })

  it('deletes an unpublished recap draft with the content', async () => {
    const { owner, members, ws } = await team(2)
    const { s } = await completedSprint(owner, members, ws, false)
    expect((await get(`/api/sprints/${s}/recap`, owner)).body.exists).toBe(true)
    expect((await get(`/api/sprints/${s}/recap`, members[0])).body.exists).toBe(false)
    await env.DB.prepare('UPDATE sprints SET completed_at = ? WHERE id = ?').bind(Date.now() - 100 * DAY, s).run()
    await retention(env as any)
    expect(await n('SELECT count(*) AS n FROM recaps WHERE sprint_id = ?', s)).toBe(0)
    expect((await get(`/api/sprints/${s}/recap`, owner)).body.exists).toBe(false)
    expect(await n('SELECT count(*) AS n FROM experiments WHERE sprint_id = ?', s)).toBe(1)
  })

  it('never deletes the outcomes of a sprint that isn’t finished, however old', async () => {
    const { owner, members, ws } = await team(1)
    expect((await patch(`/api/workspaces/${ws}`, owner, { retention_days: 30, outcome_retention_days: 30 })).status).toBe(200)
    const s = await sprint(owner, members, ws, 'live')
    expect((await post(`/api/sprints/${s}/experiments`, owner, { change_to_try: 'For the next sprint, reserve a daily 15-minute review window', success_signal: 'PRs wait less than a day' })).status).toBe(200)
    expect((await put(`/api/sprints/${s}/recap`, owner, { body: 'We talked; this is what we kept.' })).status).toBe(200)
    await env.DB.prepare('UPDATE sprints SET updated_at = ? WHERE id = ?').bind(Date.now() - 31 * DAY, s).run()
    await retention(env as any)
    expect(await n('SELECT count(*) AS n FROM experiments WHERE sprint_id = ?', s)).toBe(1)
    expect(await n('SELECT count(*) AS n FROM recaps WHERE sprint_id = ?', s)).toBe(1)
  })

  it('keeps outcomes at least as long as the content they come from', async () => {
    const { owner, ws } = await team(0)
    const settings = async () => {
      const w = (await get(`/api/workspaces/${ws}`, owner)).body.workspace
      return [w.name, w.retention_days, w.outcome_retention_days]
    }
    const before = await settings()
    expect(before.slice(1)).toEqual([90, 730])
    for (const change of [{ outcome_retention_days: 60 }, { retention_days: 100, outcome_retention_days: 60 }, { name: 'Renamed', retention_days: 800 }]) {
      const r = await patch(`/api/workspaces/${ws}`, owner, change)
      expect(r.status, JSON.stringify(change)).toBe(400)
    }
    expect(await settings()).toEqual(before)
    expect((await patch(`/api/workspaces/${ws}`, owner, { retention_days: 60, outcome_retention_days: 60 })).status).toBe(200)
    expect((await patch(`/api/workspaces/${ws}`, owner, { name: 'Renamed' })).body.name).toBe('Renamed')
  })

  it('takes the room’s record of the retro with the content', async () => {
    const { owner, members, ws } = await team(2)
    const { s } = await completedSprint(owner, members, ws, true)
    expect((await post(`/api/sprints/${s}/meeting/attendance`, members[1], { present: true })).status).toBe(200)
    expect(JSON.stringify(await roomState(s))).toContain(members[1].account_id) // who came
    await env.DB.prepare('UPDATE sprints SET completed_at = ? WHERE id = ?').bind(Date.now() - 100 * DAY, s).run()
    await retention(env as any)
    expect(await roomState(s)).toEqual({ meeting: null, attendance: {}, connected: [] })
  })

  it('keeps an invitation’s address for 30 days after it was used, withdrawn or expired', async () => {
    const { owner, ws } = await team(0)
    const at = (email: string) => env.DB.prepare('SELECT count(*) AS n FROM invitations WHERE email = ?').bind(email).first<{ n: number }>().then((r) => r!.n)
    const addr = (k: string) => `${k}-${ws.slice(0, 8)}@example.com`
    for (const k of ['live', 'used', 'withdrawn', 'expired', 'recent']) expect((await post(`/api/workspaces/${ws}/invitations`, owner, { email: addr(k) })).status).toBe(200)
    const old = Date.now() - 31 * DAY
    await env.DB.prepare('UPDATE invitations SET accepted_at = ? WHERE email = ?').bind(old, addr('used')).run()
    await env.DB.prepare('UPDATE invitations SET revoked_at = ? WHERE email = ?').bind(old, addr('withdrawn')).run()
    await env.DB.prepare('UPDATE invitations SET expires_at = ? WHERE email = ?').bind(old, addr('expired')).run()
    await env.DB.prepare('UPDATE invitations SET expires_at = ? WHERE email = ?').bind(Date.now() - DAY, addr('recent')).run()
    await retention(env as any)
    expect(await Promise.all(['live', 'used', 'withdrawn', 'expired', 'recent'].map((k) => at(addr(k))))).toEqual([1, 0, 0, 0, 1])
  })

  it('honours a shorter workspace window and deletes outcomes only beyond the outcome window', async () => {
    const { owner, members, ws } = await team(2)
    expect((await patch(`/api/workspaces/${ws}`, owner, { retention_days: 3 })).status).toBe(400)
    expect((await patch(`/api/workspaces/${ws}`, owner, { retention_days: 7, outcome_retention_days: 30 })).status).toBe(200)
    const { s, experimentId } = await completedSprint(owner, members, ws, true)
    await env.DB.prepare('UPDATE sprints SET completed_at = ? WHERE id = ?').bind(Date.now() - 10 * DAY, s).run()
    await retention(env as any)
    expect(await n('SELECT count(*) AS n FROM entries WHERE sprint_id = ?', s)).toBe(0)
    expect(await n('SELECT count(*) AS n FROM experiments WHERE id = ?', experimentId)).toBe(1)
    expect(await n('SELECT count(*) AS n FROM recaps WHERE sprint_id = ?', s)).toBe(1)
    expect((await get(`/api/workspaces/${ws}/experiments`, members[0])).body).toHaveLength(1)
    // Past the outcome window, experiments and the recap go too.
    await env.DB.prepare('UPDATE sprints SET completed_at = ? WHERE id = ?').bind(Date.now() - 31 * DAY, s).run()
    await retention(env as any)
    expect(await n('SELECT count(*) AS n FROM experiments WHERE id = ?', experimentId)).toBe(0)
    expect(await n('SELECT count(*) AS n FROM recaps WHERE sprint_id = ?', s)).toBe(0)
    expect((await get(`/api/workspaces/${ws}/experiments`, members[0])).body).toHaveLength(0)
    expect((await get(`/api/sprints/${s}`, owner)).status).toBe(200)
  })

  it('works through a backlog of more than fifty sprints in one sweep, within its time budget', async () => {
    const { owner, members, ws } = await team(1)
    const s = await sprint(owner, members, ws, 'draft')
    await env.DB.prepare(
      `INSERT INTO sprints (id, workspace_id, name, timezone, starts_on, ends_on, retro_at, retro_local_date, retro_local_time, created_by, created_at, updated_at, status, completed_at)
       SELECT lower(hex(randomblob(16))), workspace_id, name || ' ' || k.n, timezone, starts_on, ends_on, retro_at, retro_local_date, retro_local_time, created_by, created_at, updated_at, 'completed', ?
         FROM sprints, (WITH RECURSIVE k(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM k WHERE n < 120) SELECT n FROM k) k WHERE sprints.id = ?`,
    ).bind(Date.now() - 100 * DAY, s).run()
    const waiting = () => n('SELECT count(*) AS n FROM sprints WHERE workspace_id = ? AND content_purged_at IS NULL AND status IN (?, ?)', ws, 'completed', 'archived')
    expect(await waiting()).toBe(120)
    await retention(env as any)
    expect(await waiting()).toBe(0)
    // Out of time, a sweep stops where it is; the next one carries on.
    await env.DB.prepare("UPDATE sprints SET content_purged_at = NULL, status = 'completed' WHERE workspace_id = ? AND id <> ?").bind(ws, s).run()
    await retention(env as any, 0)
    expect(await waiting()).toBe(120)
  })

  it('finds what the daily sweep deletes by an index, not by reading whole tables', async () => {
    const now = Date.now()
    const sweeps: [string, ...unknown[]][] = [
      ['DELETE FROM rate_events WHERE at < ?', now],
      ['DELETE FROM sessions WHERE expires_at < ? OR revoked_at < ?', now, now],
      ['DELETE FROM security_events WHERE created_at < ?', now],
      ['DELETE FROM invitations WHERE COALESCE(accepted_at, revoked_at, expires_at) < ?', now],
      ["UPDATE join_requests SET status = 'expired' WHERE status = 'pending' AND created_at < ?", now],
      ["DELETE FROM join_requests WHERE status <> 'pending' AND COALESCE(decided_at, created_at) < ?", now],
      ['DELETE FROM join_links WHERE COALESCE(revoked_at, expires_at) < ? AND NOT EXISTS (SELECT 1 FROM join_requests r WHERE r.link_id = join_links.id)', now],
    ]
    for (const [sql, ...args] of sweeps) {
      const plan = (await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...args).all<{ detail: string }>()).results.map((r) => r.detail)
      expect(plan.filter((d) => /^SCAN /.test(d)), `${sql}\n${plan.join('\n')}`).toEqual([])
    }
  })
})
