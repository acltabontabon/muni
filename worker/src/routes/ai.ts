import { Hono } from 'hono'
import { isEncrypted } from '../lib/sealed'
import type { HonoEnv } from '../env'
import { config } from '../lib/config'
import { requireFacilitator, requireSprint } from '../lib/auth'
import { sha256Hex, uuid } from '../lib/crypto'
import { all, audit, batch, bool, count, one, run } from '../lib/db'
import { bad, conflict, notFound, quota } from '../lib/errors'
import { explanation, snapshotHash, type InputEntry, type Proposal, MAX_ENTRY_CHARS, MAX_INPUT_ENTRIES } from '../lib/ai'
import { clip } from '../lib/util'
import { hint } from '../lib/live'
import { enqueue, runSoon } from '../jobs'
import { grouping, structuralChange } from './themes'
import { sealed } from './entries'

export const ai = new Hono<HonoEnv>()

async function status(env: HonoEnv['Bindings'], sprintId: string, aiEnabled: boolean, encrypted = false) {
  const cfg = config(env)
  const jobs = await all<{ id: string; status: string; error_summary: string | null; provider: string; model: string | null; created_at: number; finished_at: number | null }>(env.DB, 'SELECT id, status, error_summary, provider, model, created_at, finished_at FROM ai_jobs WHERE sprint_id = ? ORDER BY created_at DESC LIMIT 10', sprintId)
  const props = await all<{ id: string; job_id: string; proposal: string; applied_at: number | null; rejected_at: number | null; created_at: number }>(env.DB, 'SELECT id, job_id, proposal, applied_at, rejected_at, created_at FROM ai_proposals WHERE sprint_id = ? ORDER BY created_at DESC LIMIT 10', sprintId)
  const iso = (n: number | null) => (n ? new Date(n).toISOString() : null)
  return {
    // No external AI for encrypted content: there is no accurately disclosed processing model for it yet.
    available: cfg.ai !== 'none' && !encrypted,
    enabled: aiEnabled,
    provider: cfg.ai,
    jobs: jobs.map((j) => ({ ...j, created_at: iso(j.created_at), finished_at: iso(j.finished_at) })),
    proposals: props.map((p) => ({ id: p.id, job_id: p.job_id, proposal: JSON.parse(p.proposal) as Proposal, applied_at: iso(p.applied_at), rejected_at: iso(p.rejected_at), created_at: iso(p.created_at) })),
    explanation: encrypted ? 'This sprint is encrypted, so its thoughts are never sent to an AI provider. Group them by hand — it works just as well.' : explanation(cfg),
  }
}

ai.get('/api/sprints/:sprintId/ai', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireFacilitator(ctx)
  return c.json(await status(c.env, ctx.sprint.id, bool(ctx.sprint.ai_processing) && !isEncrypted(ctx.sprint), isEncrypted(ctx.sprint)))
})

/** Ask for a grouping draft. Cached per input revision; bounded per workspace and globally per day. */
ai.post('/api/sprints/:sprintId/ai/grouping', async (c) => {
  const cfg = config(c.env)
  const ctx = await requireSprint(c, cfg, c.env.DB, c.req.param('sprintId'))
  requireFacilitator(ctx)
  if (isEncrypted(ctx.sprint)) throw conflict('this sprint is encrypted — its thoughts are never sent to an AI provider')
  if (cfg.ai === 'none') throw conflict('no AI provider is configured on this server — grouping stays manual')
  if (!bool(ctx.sprint.ai_processing)) throw conflict('AI processing wasn’t enabled for this sprint before collection started')
  if (sealed(ctx.sprint.status)) throw conflict('close collection first')
  const db = c.env.DB
  const rows = await all<{ id: string; category: string | null; body: string; impact: string | null; might_help: string | null }>(db, 'SELECT id, category, body, impact, might_help FROM entries WHERE sprint_id = ? ORDER BY reveal_order, id LIMIT ?', ctx.sprint.id, MAX_INPUT_ENTRIES)
  if (!rows.length) throw conflict('there are no entries to group')
  const input: InputEntry[] = rows.map((r) => ({ id: r.id, category: r.category, body: clip(r.body, MAX_ENTRY_CHARS), impact: r.impact ? clip(r.impact, MAX_ENTRY_CHARS) : null, might_help: r.might_help ? clip(r.might_help, MAX_ENTRY_CHARS) : null }))
  const hash = await snapshotHash(input)
  const existing = await one<{ id: string; status: string }>(db, "SELECT id, status FROM ai_jobs WHERE sprint_id = ? AND kind = 'grouping' AND input_hash = ?", ctx.sprint.id, hash)
  let jobId: string
  if (existing && existing.status === 'succeeded') return c.json(await status(c.env, ctx.sprint.id, true)) // cached: same input, same proposal
  if (existing) {
    jobId = existing.id
    if (existing.status === 'failed' || existing.status === 'skipped') await run(db, "UPDATE ai_jobs SET status='queued', error_summary=NULL, finished_at=NULL WHERE id=?", jobId)
  } else {
    // Usage limits: per workspace and global, rolling 24h. Only real provider calls count.
    const day = Date.now() - 86_400_000
    if ((await count(db, 'SELECT count(*) AS n FROM ai_usage WHERE workspace_id = ? AND at > ?', ctx.sprint.workspace_id, day)) >= cfg.aiWorkspaceDailyLimit) throw quota('this workspace has used its AI drafts for today — manual grouping still works')
    if ((await count(db, 'SELECT count(*) AS n FROM ai_usage WHERE at > ?', day)) >= cfg.aiGlobalDailyLimit) throw quota('the AI assistant is at its daily limit — manual grouping still works')
    jobId = uuid()
    await batch(db, [
      ['INSERT INTO ai_jobs (id, sprint_id, workspace_id, input_hash, input_snapshot, provider, requested_by, created_at) VALUES (?,?,?,?,?,?,?,?)', jobId, ctx.sprint.id, ctx.sprint.workspace_id, hash, JSON.stringify(input), cfg.ai, ctx.auth.account.id, Date.now()],
      ['INSERT INTO ai_usage (workspace_id, at) VALUES (?,?)', ctx.sprint.workspace_id, Date.now()],
    ])
  }
  await enqueue(db, 'ai_grouping', { ai_job_id: jobId }, Date.now(), `ai:${jobId}:${await sha256Hex(String(Date.now()))}`)
  await audit(db, ctx.sprint.workspace_id, ctx.sprint.id, ctx.auth.account.id, 'ai.grouping_requested', { job_id: jobId })
  runSoon(c, c.env, 2)
  return c.json(await status(c.env, ctx.sprint.id, true))
})

/** Turn a proposal into editable themes. Explicit; never automatic. */
ai.post('/api/sprints/:sprintId/ai/proposals/:proposalId/apply', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireFacilitator(ctx)
  if (!['preparing', 'ready'].includes(ctx.sprint.status)) throw conflict('apply drafts while preparing')
  const body = (await c.req.json().catch(() => ({}))) as { mode?: string; reset_voting_reason?: string }
  if (body.mode !== 'replace' && body.mode !== 'add') throw bad('mode must be replace or add')
  const row = await one<{ proposal: string }>(c.env.DB, 'SELECT proposal FROM ai_proposals WHERE id = ? AND sprint_id = ?', c.req.param('proposalId'), ctx.sprint.id)
  if (!row) throw notFound('proposal not found')
  const proposal = JSON.parse(row.proposal) as Proposal
  const stmts = await structuralChange(c.env.DB, ctx, body.reset_voting_reason)
  if (body.mode === 'replace') stmts.push(['DELETE FROM themes WHERE sprint_id = ?', ctx.sprint.id])
  const base = body.mode === 'replace' ? 0 : await count(c.env.DB, 'SELECT COALESCE(MAX(position),0) AS n FROM themes WHERE sprint_id = ?', ctx.sprint.id)
  proposal.themes.forEach((t, i) => {
    const tid = uuid()
    stmts.push(["INSERT INTO themes (id, sprint_id, title, summary, question, draft_experiment, position, source, created_at) VALUES (?,?,?,?,?,?,?,'ai',?)", tid, ctx.sprint.id, t.title, t.summary, t.question, t.draft_experiment, base + i + 1, Date.now()])
    // Entries already placed by the facilitator (mode=add) stay where they are.
    for (const eid of t.entry_ids) stmts.push(['INSERT OR IGNORE INTO theme_entries (entry_id, theme_id) SELECT id, ? FROM entries WHERE id = ? AND sprint_id = ?', tid, eid, ctx.sprint.id])
  })
  stmts.push(['UPDATE ai_proposals SET applied_at = ? WHERE id = ?', Date.now(), c.req.param('proposalId')])
  stmts.push(['INSERT INTO audit_events (workspace_id, sprint_id, actor_id, action, meta, created_at) VALUES (?,?,?,?,?,?)', ctx.sprint.workspace_id, ctx.sprint.id, ctx.auth.account.id, 'ai.proposal_applied', JSON.stringify({ proposal_id: c.req.param('proposalId'), mode: body.mode }), Date.now()])
  await batch(c.env.DB, stmts)
  await hint(c.env, ctx.sprint.id, 'themes')
  return c.json(await grouping(c.env, ctx))
})

ai.post('/api/sprints/:sprintId/ai/proposals/:proposalId/reject', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireFacilitator(ctx)
  await run(c.env.DB, 'UPDATE ai_proposals SET rejected_at = ? WHERE id = ? AND sprint_id = ?', Date.now(), c.req.param('proposalId'), ctx.sprint.id)
  return c.json(await status(c.env, ctx.sprint.id, bool(ctx.sprint.ai_processing) && !isEncrypted(ctx.sprint), isEncrypted(ctx.sprint)))
})
