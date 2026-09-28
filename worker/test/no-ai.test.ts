/**
 * Muni has no AI: no drafting endpoints, settings or fields, and migration 0009 removes the drafting
 * tables and switches without touching what people wrote — including themes that began as a draft.
 */
import { describe, expect, it } from 'vitest'
import { applyD1Migrations, env } from 'cloudflare:test'
import type { D1Migration } from '@cloudflare/vitest-pool-workers'
import { closeCollection, entry, get, patch, post, req, sprint, team } from './harness'

function keys(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keys(x, out))
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (out.add(k), keys(x, out))
  return out
}
const aiKeys = (v: unknown) => [...keys(v)].filter((k) => /^ai_|(^|_)ai$/.test(k))

describe('no AI', () => {
  it('has no drafting endpoints, and no AI setting in any response', async () => {
    const { owner, members, ws } = await team(1)
    const s = await sprint(owner, members, ws, 'collecting', { ai_processing: true })
    await entry(members[0], s, 'improve', 'Reviews took days')
    await closeCollection(owner, s)
    for (const [method, path] of [
      ['GET', `/api/sprints/${s}/ai`],
      ['POST', `/api/sprints/${s}/ai/grouping`],
      ['POST', `/api/sprints/${s}/ai/proposals/p/apply`],
      ['POST', `/api/sprints/${s}/ai/proposals/p/reject`],
    ]) expect((await req(method, path, owner, method === 'POST' ? {} : undefined)).status, path).toBe(404)
    // An old client's setting is ignored, not stored.
    expect((await patch(`/api/sprints/${s}`, owner, { ai_processing: true })).status).toBe(200)
    expect((await patch(`/api/workspaces/${ws}`, owner, { ai_enabled_default: true })).status).toBe(200)
    for (const path of ['/api/auth/me', `/api/workspaces/${ws}`, `/api/sprints/${s}`, `/api/sprints/${s}/themes`, '/healthz', '/readyz']) {
      const r = await get(path, owner)
      expect(r.status, path).toBe(200)
      expect(aiKeys(r.body), path).toEqual([])
    }
  })

  it('seeds the demo without AI settings', async () => {
    const { owner } = await team(0)
    const r = await post('/api/demo/seed', owner)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
  })

  it('leaves no drafting tables or columns in the schema', async () => {
    const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'ai\\_%' ESCAPE '\\'").all<{ name: string }>()
    expect(tables.results).toEqual([])
    for (const t of ['workspaces', 'sprints', 'themes']) {
      const cols = await env.DB.prepare(`SELECT name FROM pragma_table_info('${t}')`).all<{ name: string }>()
      expect(cols.results.map((c) => c.name).filter((c) => c.startsWith('ai_') || (t === 'themes' && c === 'source')), t).toEqual([])
    }
  })
})

describe('migration 0009', () => {
  it('keeps every thought, theme, note, experiment and recap, and drops only the drafting records', async () => {
    const db = (env as unknown as { MIGRATION_DB: D1Database }).MIGRATION_DB
    const all = (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS
    const before = all.filter((m) => m.name < '0009')
    expect(all.some((m) => m.name.startsWith('0009'))).toBe(true)
    await applyD1Migrations(db, before)
    // A sprint from the AI era: drafting on, a draft applied and then edited by the facilitator.
    await db.batch(
      [
        "INSERT INTO accounts (id, legacy_key, display_name, created_at) VALUES ('a1','a1','Ana',1)",
        "INSERT INTO workspaces (id, name, ai_enabled_default, created_at) VALUES ('w1','Team',1,1)",
        "INSERT INTO memberships (workspace_id, account_id, role, created_at) VALUES ('w1','a1','owner',1)",
        "INSERT INTO sprints (id, workspace_id, name, timezone, starts_on, ends_on, retro_at, retro_local_date, retro_local_time, status, ai_processing, ai_locked, created_by, created_at, updated_at) VALUES ('s1','w1','Sprint','UTC','2026-09-01','2026-09-10',1,'2026-09-11','10:00','live',1,1,'a1',1,1)",
        "INSERT INTO entries (id, sprint_id, author_account_id, category, body, created_at, updated_at) VALUES ('e1','s1','a1','improve','Reviews took days',1,1)",
        "INSERT INTO themes (id, sprint_id, title, summary, question, draft_experiment, position, source, created_at) VALUES ('t1','s1','Review turnaround (edited)','People waited on reviews','What slowed reviews?','A daily review window',1,'ai',1)",
        "INSERT INTO themes (id, sprint_id, title, position, created_at) VALUES ('t2','s1','Named by hand',2,1)",
        "INSERT INTO theme_entries (entry_id, theme_id) VALUES ('e1','t1')",
        "INSERT INTO discussion_notes (theme_id, sprint_id, takeaway, discussed, updated_at) VALUES ('t1','s1','Pair on reviews',1,1)",
        "INSERT INTO experiments (id, workspace_id, sprint_id, theme_id, theme_title, change_to_try, success_signal, review_on, created_at, updated_at) VALUES ('x1','w1','s1','t1','Review turnaround','A review window','PRs wait under a day','2026-09-20',1,1)",
        "INSERT INTO recaps (sprint_id, body, draft_source, updated_at) VALUES ('s1','# Recap','generated',1)",
        "INSERT INTO ai_jobs (id, sprint_id, workspace_id, input_hash, input_snapshot, provider, requested_by, created_at) VALUES ('j1','s1','w1','h','[{\"body\":\"Reviews took days\"}]','anthropic','a1',1)",
        "INSERT INTO ai_proposals (id, job_id, sprint_id, proposal, created_at) VALUES ('p1','j1','s1','{}',1)",
        "INSERT INTO ai_usage (workspace_id, at) VALUES ('w1',1)",
        "INSERT INTO jobs (id, kind, payload, run_at, created_at) VALUES ('q1','ai_grouping','{\"ai_job_id\":\"j1\"}',1,1)",
        "INSERT INTO jobs (id, kind, payload, run_at, created_at) VALUES ('q2','reminder','{\"sprint_id\":\"s1\"}',1,1)",
        "INSERT INTO audit_events (workspace_id, sprint_id, actor_id, action, created_at) VALUES ('w1','s1','a1','ai.proposal_applied',1)",
      ].map((q) => db.prepare(q)),
    )

    await applyD1Migrations(db, all)

    const rows = async (q: string) => (await db.prepare(q).all()).results
    expect(await rows('SELECT id, title, summary, question, draft_experiment, position FROM themes ORDER BY position')).toEqual([
      { id: 't1', title: 'Review turnaround (edited)', summary: 'People waited on reviews', question: 'What slowed reviews?', draft_experiment: 'A daily review window', position: 1 },
      { id: 't2', title: 'Named by hand', summary: '', question: '', draft_experiment: null, position: 2 },
    ])
    expect(await rows('SELECT entry_id, theme_id FROM theme_entries')).toEqual([{ entry_id: 'e1', theme_id: 't1' }])
    expect(await rows('SELECT id, body FROM entries')).toEqual([{ id: 'e1', body: 'Reviews took days' }])
    expect(await rows('SELECT takeaway FROM discussion_notes')).toEqual([{ takeaway: 'Pair on reviews' }])
    expect(await rows('SELECT theme_id, change_to_try FROM experiments')).toEqual([{ theme_id: 't1', change_to_try: 'A review window' }])
    expect(await rows('SELECT body FROM recaps')).toEqual([{ body: '# Recap' }])
    expect(await rows('SELECT id, name, status FROM sprints')).toEqual([{ id: 's1', name: 'Sprint', status: 'live' }])
    expect(await rows('SELECT action FROM audit_events')).toEqual([{ action: 'ai.proposal_applied' }])
    // Only the drafting job is gone; other work stays queued.
    expect(await rows('SELECT id FROM jobs')).toEqual([{ id: 'q2' }])
    expect(await rows("SELECT name FROM sqlite_master WHERE name LIKE 'ai\\_%' ESCAPE '\\'")).toEqual([])
    expect(await rows('PRAGMA foreign_key_check')).toEqual([])
  })
})
