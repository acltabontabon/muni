/**
 * Caps are enforced where data is written, and whatever exists is read back whole: no list quietly
 * stops at some number (lib/limits.ts).
 */
import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { MAX_NOTES_EACH, MAX_PARTICIPANTS, MAX_THEMES } from '../src/lib/limits'
import { closeCollection, entry, get, go, inviteToken, post, signin, sprint, tag, team } from './harness'

const n = async (sql: string, ...args: unknown[]) => Number((await env.DB.prepare(sql).bind(...args).first<{ n: number }>())!.n)
/** Runs many rows' statements in batches. */
async function insert(sql: string, rows: unknown[][]) {
  for (let i = 0; i < rows.length; i += 100) await env.DB.batch(rows.slice(i, i + 100).map((r) => env.DB.prepare(sql).bind(...r)))
}

describe('limits', () => {
  it('show every thought once revealed, however many there are', async () => {
    const { owner, members, ws } = await team(1)
    const s = await sprint(owner, members, ws, 'collecting')
    const now = Date.now()
    // Many people's worth (some since gone: an author is only an id here).
    await insert('INSERT INTO entries (id, sprint_id, author_account_id, category, body, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', Array.from({ length: 2100 }, (_, i) => [crypto.randomUUID(), s, `gone:${i % 40}`, 'keep', `thought ${i}`, now, now]))
    await entry(members[0], s, 'improve', 'the last one')
    const shared = await closeCollection(owner, s)
    expect(shared).toHaveLength(2101)
    const g = (await get(`/api/sprints/${s}/themes`, members[0])).body
    expect(g.total_entries).toBe(2101)
    expect(g.ungrouped).toHaveLength(2101)
  })

  it('keep themes to their cap when splitting too, and show every theme there is with its thoughts', async () => {
    const { owner, members, ws } = await team(1)
    const s = await sprint(owner, members, ws, 'collecting')
    await entry(members[0], s, 'improve', 'in the last theme')
    const [e] = await closeCollection(owner, s)
    const ids = Array.from({ length: MAX_THEMES }, () => crypto.randomUUID())
    await insert('INSERT INTO themes (id, sprint_id, title, position, created_at) VALUES (?,?,?,?,?)', ids.map((id, i) => [id, s, `Theme ${i}`, i, Date.now()]))
    expect((await post(`/api/sprints/${s}/themes`, owner, { title: 'One more' })).status).toBe(409)
    const split = await post(`/api/sprints/${s}/themes/${ids[0]}/split`, owner, { title: 'Split off' })
    expect(split.status).toBe(409)
    expect(split.body.error).toContain(`${MAX_THEMES} themes`)
    // A theme beyond the cap (made before it was enforced everywhere) is still shown, with its thoughts.
    const extra = crypto.randomUUID()
    await env.DB.prepare('INSERT INTO themes (id, sprint_id, title, position, created_at) VALUES (?,?,?,?,?)').bind(extra, s, 'Beyond', 999, Date.now()).run()
    await env.DB.prepare('INSERT INTO theme_entries (entry_id, theme_id) VALUES (?,?)').bind(e.id, extra).run()
    const g = (await get(`/api/sprints/${s}/themes`, owner)).body
    expect(g.themes).toHaveLength(MAX_THEMES + 1)
    expect(g.themes.at(-1).entries.map((x: { id: string }) => x.id)).toEqual([e.id])
    expect(g.ungrouped).toEqual([])
  })

  it('seat at most the cap of people in a sprint, however they come in', async () => {
    const { owner, members, ws } = await team(1)
    const s = await sprint(owner, [], ws, 'collecting')
    // Everyone else in it is someone the test made up.
    const fake = Array.from({ length: MAX_PARTICIPANTS - 1 }, () => crypto.randomUUID())
    await insert('INSERT INTO accounts (id, account_ref, display_name, created_at) VALUES (?,?,?,?)', fake.map((id) => [id, id, 'Made up', Date.now()]))
    await insert('INSERT INTO sprint_participants (sprint_id, account_id, is_facilitator, created_at) VALUES (?,?,0,?)', fake.map((id) => [s, id, Date.now()]))
    const full = await post(`/api/sprints/${s}/participants`, owner, { account_id: members[0].account_id })
    expect(full.status).toBe(409)
    expect(full.body.error).toContain(`${MAX_PARTICIPANTS} participants`)
    expect((await post(`/api/workspaces/${ws}/invitations`, owner, { email: members[0].email, sprint_id: s })).status).toBe(409)
    // Someone invited into it joins the team, and is told they're not in the sprint.
    const email = `late-${tag()}@example.com`
    expect((await post(`/api/workspaces/${ws}/invitations`, owner, { email, sprint_id: s })).status).toBe(200)
    const token = await inviteToken(email)
    const late = await signin(email, 'Late')
    expect((await post('/api/invitations/accept', late, { token })).body).toEqual({ workspace_id: ws, sprint_id: null })
    expect(await n('SELECT count(*) AS n FROM sprint_participants WHERE sprint_id = ?', s)).toBe(MAX_PARTICIPANTS)
  })

  it('let one person add at most the cap of notes in a retro, and answer a retry of one kept', async () => {
    const { owner, members, ws } = await team(1)
    const s = await sprint(owner, members, ws, 'collecting')
    await entry(members[0], s, 'improve', 'x')
    const shared = await closeCollection(owner, s)
    const theme = (await post(`/api/sprints/${s}/themes`, owner, { title: 'T', entry_ids: [shared[0].id] })).body.themes[0].id as string
    expect((await go(owner, s, 'live')).status).toBe(200)
    await insert('INSERT INTO context_additions (id, sprint_id, theme_id, author_account_id, body, idempotency_key, created_at) VALUES (?,?,?,?,?,?,?)', Array.from({ length: MAX_NOTES_EACH }, (_, i) => [crypto.randomUUID(), s, theme, members[0].account_id, `note ${i}`, `key-${i}`, Date.now()]))
    const over = await post(`/api/sprints/${s}/meeting/context`, members[0], { theme_id: theme, body: 'one more' })
    expect(over.status).toBe(409)
    const retry = await post(`/api/sprints/${s}/meeting/context`, members[0], { theme_id: theme, body: 'note 5', idempotency_key: 'key-5' })
    expect(retry.status).toBe(200)
    expect(retry.body.my_context).toHaveLength(MAX_NOTES_EACH)
    expect((await post(`/api/sprints/${s}/meeting/context`, owner, { theme_id: theme, body: 'the facilitator’s own' })).status).toBe(200)
  })

  it('list every sprint and every experiment a workspace keeps', async () => {
    const { owner, ws } = await team(0)
    const first = await sprint(owner, [], ws, 'draft')
    await env.DB.prepare(
      `INSERT INTO sprints (id, workspace_id, name, timezone, starts_on, ends_on, retro_at, retro_local_date, retro_local_time, created_by, created_at, updated_at)
       SELECT lower(hex(randomblob(16))), workspace_id, name || ' ' || k.n, timezone, starts_on, ends_on, retro_at, retro_local_date, retro_local_time, created_by, created_at, updated_at
         FROM sprints, (WITH RECURSIVE k(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM k WHERE n < 250) SELECT n FROM k) k WHERE sprints.id = ?`,
    ).bind(first).run()
    expect((await get(`/api/workspaces/${ws}/sprints`, owner)).body).toHaveLength(251)
    await env.DB.prepare(
      `INSERT INTO experiments (id, workspace_id, sprint_id, change_to_try, success_signal, review_on, created_at, updated_at)
       SELECT lower(hex(randomblob(16))), ?, ?, 'Try ' || k.n, 'It helps', '2026-10-01', ?, ?
         FROM (WITH RECURSIVE k(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM k WHERE n < 250) SELECT n FROM k) k`,
    ).bind(ws, first, Date.now(), Date.now()).run()
    expect((await get(`/api/workspaces/${ws}/experiments`, owner)).body).toHaveLength(250)
  })
})
