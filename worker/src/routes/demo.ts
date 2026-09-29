/** An isolated demo workspace with a realistic fictional sprint. Never available in production. */
import { Hono } from 'hono'
import type { HonoEnv } from '../env'
import { config } from '../lib/config'
import { createSession, requireAuth, setSessionCookies } from '../lib/auth'
import { buildMe } from './auth'
import { uuid } from '../lib/crypto'
import { all, batch, one, run } from '../lib/db'
import { notFound } from '../lib/errors'
import { addDays, jsonBody, localDate } from '../lib/util'
import { INTRO } from '../lib/avatars'
import { newAccountStatement } from '../lib/accounts'

const isoHandle = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export const demo = new Hono<HonoEnv>()

const PEOPLE: [string, string][] = [
  ['Maya Reyes', 'maya@demo.muni.invalid'],
  ['Jonas Weber', 'jonas@demo.muni.invalid'],
  ['Priya Nair', 'priya@demo.muni.invalid'],
  ['Tomás Ibarra', 'tomas@demo.muni.invalid'],
  ['Aiko Tanaka', 'aiko@demo.muni.invalid'],
  ['Sam O’Neill', 'sam@demo.muni.invalid'],
  ['Lena Novak', 'lena@demo.muni.invalid'],
]

// [author index, category, body, impact, might_help, period, theme key]
type E = [number, string | null, string, string | null, string | null, string | null, string | null]
const ENTRIES: E[] = [
  [0, 'proud', 'We shipped the billing export two days early and nothing broke in production.', 'First release in months with zero hotfixes.', null, 'late', null],
  [1, 'keep', 'Pairing on the migration script caught the timezone bug before it reached staging.', null, 'Keep pairing on anything that touches dates.', 'middle', null],
  [2, 'improve', 'PRs sat waiting for review for two or three days. I stopped opening small PRs because it wasn’t worth the wait.', 'Work piled up into one big PR at the end.', 'A daily 15-minute review window?', 'middle', 'review'],
  [3, 'improve', 'Review turnaround was slow again this sprint. Mine averaged about two days.', null, null, 'late', 'review'],
  [4, 'keep', 'The Thursday demo to support was genuinely useful — they found two edge cases we missed.', 'Fewer surprise tickets after release.', null, 'late', null],
  [5, 'stop', 'Please stop scheduling planning at 4pm on Fridays. Half the room is already checked out and decisions get redone on Monday.', 'We re-planned the same tickets twice.', 'Move it to Tuesday morning.', 'early', 'planning'],
  [6, 'improve', 'The staging environment was down for most of Wednesday and nobody knew who owned fixing it.', 'Lost roughly a day across the team.', 'An on-call rota for staging, even informal.', 'middle', 'staging'],
  [0, 'try', 'Could we try writing the acceptance criteria before the ticket is estimated? Estimates felt like guesses this time.', null, null, 'early', 'planning'],
  [1, 'improve', 'Estimates were way off on the search work. We thought three days; it took eight.', 'Sprint goal slipped.', null, 'late', 'planning'],
  [2, 'proud', 'Aiko’s onboarding doc meant the new contractor was committing on day two.', null, null, 'early', null],
  [3, 'keep', 'Standups stayed under ten minutes all sprint. Let’s keep it that way.', null, null, null, null],
  [4, 'stop', 'Stop merging without a green pipeline. It happened twice and both times we had to revert.', 'Broken main for an afternoon each time.', null, 'middle', 'pipeline'],
  [5, 'improve', 'Reviews: I actually liked that reviews were slower this sprint — the comments were more thoughtful than the usual rubber stamp.', null, null, 'middle', 'review'],
  [6, 'try', 'Try a ‘review buddy’ pairing for the sprint so every PR has a named first reviewer.', null, 'Reduces the ‘someone will get to it’ problem.', null, 'review'],
  [0, 'improve', 'The staging outage on Wednesday cost me most of the day — I couldn’t test the export end to end.', null, null, 'middle', 'staging'],
  [1, null, 'Interruptions from the support channel are constant. I counted eleven pings on Tuesday alone.', 'Hard to get into anything deep.', 'A rotating ‘support hat’ so one person fields questions each day?', 'early', null],
  [2, 'keep', 'Splitting the search epic into vertical slices meant we could demo something every week.', null, null, null, null],
  [3, 'try', 'Let’s try a short written summary at the end of each pairing session so the rest of the team knows what changed.', null, null, null, null],
  [4, 'improve', 'Planning ran over by 40 minutes and we still didn’t agree on the sprint goal.', null, 'Time-box it and finish with a written goal.', 'early', 'planning'],
  [5, 'proud', 'Nobody worked the weekend before release. That’s new for us.', null, null, 'late', null],
  [6, 'improve', 'I don’t think the sprint goal was ever clear to me. I only understood it at the demo.', null, null, null, 'planning'],
  [0, 'stop', 'Stop assigning tickets during standup — it turns a sync into a negotiation.', null, null, 'early', null],
  [1, 'keep', 'The retro experiment (daily review window) helped: my two PRs were reviewed the same day.', null, null, 'late', 'review'],
  [2, 'improve', 'The daily review window didn’t change much for me — reviews still waited until someone had slack.', null, null, 'late', 'review'],
  [3, null, 'One thing I want to raise carefully: a comment in a PR review last week read as dismissive, and I noticed a couple of people went quiet afterwards. I don’t think it was intended, but it changed the tone of that thread.', 'Less back-and-forth on that PR than it needed.', 'Maybe we agree on how we phrase review comments.', 'middle', 'tone'],
]

/** Themes as a facilitator would write them: recognisable topics, summaries that add information. */
const THEMES: { key: string; title: string; summary: string; question: string }[] = [
  { key: 'review', title: 'PR review turnaround', summary: 'Most observations describe multi-day waits for a first review; two note the daily review window helped, one that it didn’t. One observation valued slower, more thoughtful reviews.', question: 'What would make a first review arrive within a day without making reviews shallower?' },
  { key: 'tone', title: 'Review comment tone', summary: 'A single observation, raised carefully, about a review comment that read as dismissive and quietened the thread.', question: 'How do we want review comments to sound when we disagree?' },
  { key: 'planning', title: 'Planning and sprint goal clarity', summary: 'Planning overran, estimates missed badly on search, and the sprint goal only became clear at the demo. One proposal: acceptance criteria before estimates.', question: 'What would need to be true at the end of planning for everyone to say the goal from memory?' },
  { key: 'staging', title: 'Staging environment ownership', summary: 'A Wednesday outage cost roughly a day, and nobody knew who was responsible for fixing it.', question: 'Who picks up staging when it breaks, and how would we know it’s broken?' },
  { key: 'pipeline', title: 'Merging on a red pipeline', summary: 'Two merges without a green pipeline, two reverts.', question: 'What makes merging on red feel acceptable in the moment?' },
]

demo.post('/api/demo/seed', async (c) => {
  const cfg = config(c.env)
  if (!cfg.allowDemoSeed) throw notFound()
  const a = await requireAuth(c, cfg, c.env.DB)
  const db = c.env.DB
  const now = Date.now()
  const old = await all<{ id: string }>(db, "SELECT w.id FROM workspaces w JOIN memberships m ON m.workspace_id = w.id WHERE w.is_demo = 1 AND m.account_id = ? AND m.role = 'owner'", a.account.id)
  for (const o of old) await run(db, 'DELETE FROM workspaces WHERE id = ?', o.id)
  const ws = uuid()
  const people = [a.account.id]
  const stmts: [string, ...unknown[]][] = [
    ['INSERT INTO workspaces (id, name, is_demo, created_at) VALUES (?,?,1,?)', ws, 'Demo team (fictional)', now],
    ['INSERT INTO memberships (workspace_id, account_id, role, created_at) VALUES (?,?,?,?)', ws, a.account.id, 'owner', now],
  ]
  for (const [name, email] of PEOPLE) {
    let acct = await one<{ id: string }>(db, 'SELECT account_id AS id FROM account_emails WHERE email = ?', email)
    if (!acct) {
      const id = uuid()
      await batch(db, [newAccountStatement(id, name, isoHandle()), ['INSERT INTO account_emails (account_id, email, verified_at) VALUES (?,?,?)', id, email, now]])
      acct = { id }
    }
    stmts.push(['INSERT OR IGNORE INTO memberships (workspace_id, account_id, role, created_at) VALUES (?,?,?,?)', ws, acct.id, 'member', now])
    people.push(acct.id)
  }
  const today = new Date().toISOString().slice(0, 10)
  const tz = 'Asia/Manila'
  const prev = uuid()
  const prevRetro = now - 21 * 86_400_000
  stmts.push([
    `INSERT INTO sprints (id, workspace_id, name, goal, timezone, starts_on, ends_on, retro_at, retro_local_date, retro_local_time, status, collection_opened_at, collection_closed_at, revealed_once, completed_at, session_started_at, session_ended_at, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,'completed',?,?,1,?,?,?,?,?,?)`,
    prev, ws, 'Sprint 41 — Search foundations', 'Ship the first vertical slice of search', tz, addDays(today, -35), addDays(today, -22), prevRetro, localDate(tz, prevRetro), '14:00', prevRetro - 13 * 86_400_000, prevRetro - 3_600_000, prevRetro, prevRetro - 3_600_000, prevRetro, a.account.id, prevRetro, prevRetro,
  ])
  people.forEach((p, i) => stmts.push(['INSERT INTO sprint_participants (sprint_id, account_id, is_facilitator, created_at) VALUES (?,?,?,?)', prev, p, i === 0 ? 1 : 0, now]))
  stmts.push(
    ["INSERT INTO experiments (id, workspace_id, sprint_id, theme_title, change_to_try, success_signal, owner_account_id, owner_accepted_at, review_on, status, outcome_note, reviewed_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,'helped',?,?,?,?)", uuid(), ws, prev, 'PR review turnaround', 'For the next sprint, reserve a 15-minute daily review window right after standup.', 'PRs wait less than one working day for a first review.', people[1], now, addDays(today, -8), 'Most PRs got a same-day first pass. Bigger PRs still waited.', now, prevRetro, now],
    ["INSERT INTO experiments (id, workspace_id, sprint_id, theme_title, change_to_try, success_signal, owner_account_id, owner_accepted_at, review_on, status, outcome_note, reviewed_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,'did_not_help',?,?,?,?)", uuid(), ws, prev, 'Sprint goal clarity', 'Write the sprint goal as one sentence at the end of planning and pin it in the channel.', 'Everyone can say the goal from memory at the mid-sprint check.', people[2], now, addDays(today, -8), 'We wrote it, but planning overran and nobody looked at it again.', now, prevRetro + 1, now],
    ["INSERT INTO recaps (sprint_id, body, draft_source, approved_at, published_at, updated_at) VALUES (?,?,'manual',?,?,?)", prev, '# Sprint 41 — retro recap\n\nWe discussed review turnaround and the sprint goal, and agreed two experiments: a daily review window (owner Jonas) and a one-sentence sprint goal (owner Priya).\n', prevRetro, prevRetro, prevRetro],
  )
  const cur = uuid()
  const retroAt = now + 3 * 3_600_000
  stmts.push([
    `INSERT INTO sprints (id, workspace_id, name, external_ref, goal, opening_question, timezone, starts_on, ends_on, retro_at, retro_local_date, retro_local_time, status, collection_opened_at, collection_closed_at, revealed_once, grouping_revision, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'preparing',?,?,1,1,?,?,?)`,
    cur, ws, 'Sprint 42 — Billing export', 'PROJ-42', 'Ship the billing export and stabilise search', 'What’s one thing from this sprint you’d want a new teammate to know?', tz, addDays(today, -13), addDays(today, 1), retroAt, localDate(tz, retroAt), '14:00', now - 13 * 86_400_000, now, a.account.id, now - 13 * 86_400_000, now,
  ])
  people.forEach((p, i) => stmts.push(['INSERT INTO sprint_participants (sprint_id, account_id, is_facilitator, created_at) VALUES (?,?,?,?)', cur, p, i === 0 ? 1 : 0, now]))
  const themeIds: Record<string, string> = {}
  THEMES.forEach((t, i) => {
    themeIds[t.key] = uuid()
    stmts.push(['INSERT INTO themes (id, sprint_id, title, summary, question, position, created_at) VALUES (?,?,?,?,?,?,?)', themeIds[t.key], cur, t.title, t.summary, t.question, i, now])
  })
  for (const [author, cat, body, impact, help, period, key] of ENTRIES) {
    const id = uuid()
    stmts.push(['INSERT INTO entries (id, sprint_id, author_account_id, category, body, impact, might_help, period, reveal_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,abs(random()) % 2147483647,?,?)', id, cur, people[author + 1], cat, body, impact, help, period, now, now])
    if (key) stmts.push(['INSERT INTO theme_entries (entry_id, theme_id) VALUES (?,?)', id, themeIds[key]])
  }
  stmts.push(['INSERT INTO audit_events (workspace_id, sprint_id, actor_id, action, meta, created_at) VALUES (?,?,?,?,?,?)', ws, cur, a.account.id, 'demo.seeded', '{}', now])
  await batch(db, stmts)
  return c.json({ workspace_id: ws, sprint_id: cur, previous_sprint_id: prev })
})

/**
 * Development and tests only: a new account, signed in, without a passkey ceremony, so scripts can
 * set up people quickly. Passkeys themselves are tested with a virtual authenticator
 * (e2e/passkeys.mjs, worker/test/passkeys.test.ts). Refused in production and wherever demo data is
 * off; it's the same boundary the demo seed has.
 */
demo.post('/api/dev/session', async (c) => {
  const cfg = config(c.env)
  if (cfg.env === 'production' || !cfg.allowDemoSeed) throw notFound()
  const body = await jsonBody<{ name?: string; intro?: 'choose' | 'done' }>(c)
  // Scripts and tests aren't interrupted by the character chooser unless they ask to see it.
  const intro = INTRO[body.intro === 'choose' ? 'choose' : 'done']
  const id = uuid()
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : ''
  const [sql, ...args] = newAccountStatement(id, name, isoHandle())
  await batch(c.env.DB, [
    [sql, ...args],
    ['UPDATE accounts SET avatar_intro = ?, name_set_at = ? WHERE id = ?', intro, name ? Date.now() : null, id],
  ])
  const session = await createSession(c.env.DB, id, cfg.sessionTtlDays, { method: 'passkey', clientLabel: 'Development' })
  setSessionCookies(c, cfg, session)
  return c.json(await buildMe(c.env, id))
})

/** Development inbox for the console email provider. Never available in production. */
demo.get('/api/dev/inbox', async (c) => {
  const cfg = config(c.env)
  if (cfg.email !== 'console' || cfg.env === 'production') throw notFound()
  const rows = await all<{ to_addr: string; subject: string; body: string }>(c.env.DB, 'SELECT to_addr, subject, body FROM dev_mail ORDER BY created_at DESC LIMIT 100')
  return c.json(rows.map((r) => ({ to: r.to_addr, subject: r.subject, body: r.body })))
})
