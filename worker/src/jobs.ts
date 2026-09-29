/**
 * Small, idempotent, bounded background work stored in D1. Jobs run from the
 * scheduled handler (cron) and, for immediacy, right after they are enqueued
 * via `ctx.waitUntil` — the job row makes the retry durable either way.
 */
import type { Context } from 'hono'
import type { AppEnv } from './env'
import { config } from './lib/config'
import { uuid } from './lib/crypto'
import { all, one, run, type Statement } from './lib/db'
import { sendMail, templates } from './lib/email'
import { AppError } from './lib/errors'
import { addDays, daysBetween, resolveLocal } from './lib/util'

export async function enqueue(db: D1Database, kind: string, payload: Record<string, unknown>, runAt: number, key: string | null): Promise<void> {
  await run(db, ...enqueueStatement(kind, payload, runAt, key))
}
/** `enqueue` as a statement, to queue a job in the same transaction as what it follows from. */
export const enqueueStatement = (kind: string, payload: Record<string, unknown>, runAt: number, key: string | null): Statement => [
  'INSERT OR IGNORE INTO jobs (id, kind, payload, idempotency_key, run_at, created_at) VALUES (?,?,?,?,?,?)',
  uuid(),
  kind,
  JSON.stringify(payload),
  key,
  runAt,
  Date.now(),
]

/** Runs due jobs after the response is sent; bounded so a request never does unbounded work. */
export function runSoon(c: Context, env: AppEnv, max = 5) {
  try {
    c.executionCtx.waitUntil(runDue(env, max))
  } catch {
    /* no execution context (tests) — the cron will pick it up */
  }
}

interface JobRow {
  id: string
  kind: string
  payload: string
  attempts: number
  max_attempts: number
}

export async function runDue(env: AppEnv, max = 20): Promise<number> {
  let ran = 0
  for (let i = 0; i < max; i++) {
    const job = await claim(env.DB)
    if (!job) break
    ran++
    await execute(env, job)
  }
  return ran
}

async function claim(db: D1Database): Promise<JobRow | null> {
  // Reclaim jobs stuck in 'running' for 10 minutes (an isolate died mid-job).
  const stale = Date.now() - 10 * 60_000
  const cand = await one<JobRow>(db, "SELECT id, kind, payload, attempts, max_attempts FROM jobs WHERE (status = 'queued' AND run_at <= ?) OR (status = 'running' AND locked_at < ?) ORDER BY run_at LIMIT 1", Date.now(), stale)
  if (!cand) return null
  const r = await run(db, "UPDATE jobs SET status='running', locked_at=?, attempts=attempts+1 WHERE id=? AND ((status='queued' AND run_at <= ?) OR (status='running' AND locked_at < ?))", Date.now(), cand.id, Date.now(), stale)
  if (!r.meta.changes) return null
  return { ...cand, attempts: cand.attempts + 1 }
}

async function execute(env: AppEnv, job: JobRow) {
  const payload = JSON.parse(job.payload || '{}') as Record<string, unknown>
  try {
    await Promise.race([dispatch(env, job.kind, payload), new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), 25_000))])
    // An email job's payload is the recipient's address and the message (an invitation's link is the
    // only copy of its token). Once it's sent or given up on, only the bookkeeping stays.
    await run(env.DB, "UPDATE jobs SET status='succeeded', finished_at=?, locked_at=NULL, payload=CASE WHEN kind='email' THEN '{}' ELSE payload END WHERE id=?", Date.now(), job.id)
  } catch (e) {
    // Never log payloads: they may contain an email address.
    const summary = String(e instanceof Error ? e.message : e).slice(0, 500)
    // Over the day's email limit, retrying in a few minutes changes nothing: it fails now, saying why.
    if (job.attempts >= job.max_attempts || (e instanceof AppError && e.code === 'quota')) {
      await run(env.DB, "UPDATE jobs SET status='failed', finished_at=?, locked_at=NULL, last_error=?, payload=CASE WHEN kind='email' THEN '{}' ELSE payload END WHERE id=?", Date.now(), summary, job.id)
    } else {
      const backoff = 15_000 * 2 ** Math.min(job.attempts, 6)
      await run(env.DB, "UPDATE jobs SET status='queued', run_at=?, locked_at=NULL, last_error=? WHERE id=?", Date.now() + backoff, summary, job.id)
    }
  }
}

async function dispatch(env: AppEnv, kind: string, payload: Record<string, unknown>) {
  const cfg = config(env)
  switch (kind) {
    case 'email':
      return sendMail(cfg, env.DB, { to: String(payload.to), subject: String(payload.subject ?? 'Muni'), body: String(payload.body ?? '') })
    case 'reminder':
      return reminders(env, String(payload.sprint_id), String(payload.kind ?? 'day_before'))
    case 'retention':
      return retention(env)
    default:
      throw new Error(`unknown job kind ${kind}`)
  }
}

/** Reminder jobs are per sprint, resolve recipients when they run, and never look at who has written. */
export async function scheduleReminders(db: D1Database, sprintId: string) {
  const s = await one<{ starts_on: string; ends_on: string; retro_at: number; timezone: string; reopened_count: number }>(db, 'SELECT starts_on, ends_on, retro_at, timezone, reopened_count FROM sprints WHERE id = ?', sprintId)
  if (!s) return
  const mid = addDays(s.starts_on, Math.floor(daysBetween(s.starts_on, s.ends_on) / 2))
  let midpoint: number
  try {
    midpoint = resolveLocal(s.timezone, mid, '10:00')
  } catch {
    midpoint = 0
  }
  const dayBefore = s.retro_at - 86_400_000
  for (const [kind, at] of [['midpoint', midpoint], ['day_before', dayBefore]] as const) {
    if (at > Date.now() && at < s.retro_at) await enqueue(db, 'reminder', { sprint_id: sprintId, kind }, at, `reminder:${sprintId}:${kind}:${s.reopened_count}`)
  }
}
export async function cancelReminders(db: D1Database, sprintId: string) {
  await run(db, "UPDATE jobs SET status='cancelled', idempotency_key = idempotency_key || ':cancelled:' || id WHERE kind='reminder' AND status='queued' AND json_extract(payload, '$.sprint_id') = ?", sprintId)
}

/** Reminder emails go only to participants who added an address (passkey-only accounts get none). */
async function reminders(env: AppEnv, sprintId: string, kind: string) {
  const s = await one<{ name: string; status: string; reminders_enabled: number }>(env.DB, 'SELECT name, status, reminders_enabled FROM sprints WHERE id = ?', sprintId)
  if (!s || s.status !== 'collecting' || !s.reminders_enabled) return
  const recipients = await all<{ email: string }>(
    env.DB,
    `SELECT ae.email FROM sprint_participants sp JOIN account_emails ae ON ae.account_id = sp.account_id JOIN sprints s ON s.id = sp.sprint_id
     JOIN memberships m ON m.workspace_id = s.workspace_id AND m.account_id = sp.account_id AND m.revoked_at IS NULL WHERE sp.sprint_id = ? AND sp.reminders_opt_out = 0 LIMIT 100`,
    sprintId,
  )
  const link = `${config(env).publicOrigin}/sprints/${sprintId}`
  for (const r of recipients) {
    const mail = templates.reminder(r.email, s.name, kind, link)
    await enqueue(env.DB, 'email', { to: mail.to, subject: mail.subject, body: mail.body }, Date.now(), `reminder-mail:${sprintId}:${kind}:${await (await import('./lib/crypto')).sha256Hex(r.email)}`)
  }
}

/** Retention: content-derived records are deleted after the workspace window; outcomes under the separate, disclosed window. */
export async function retention(env: AppEnv) {
  const db = env.DB
  const now = Date.now()
  const due = await all<{ id: string; workspace_id: string }>(
    db,
    `SELECT s.id, s.workspace_id FROM sprints s JOIN workspaces w ON w.id = s.workspace_id WHERE s.content_purged_at IS NULL AND s.status IN ('completed','archived')
     AND COALESCE(s.completed_at, s.updated_at) < ? - w.retention_days * 86400000 LIMIT 50`,
    now,
  )
  for (const s of due) await purgeSprintContent(db, s.id, s.workspace_id)
  await db.batch([
    db.prepare('DELETE FROM experiments WHERE sprint_id IN (SELECT s.id FROM sprints s JOIN workspaces w ON w.id = s.workspace_id WHERE COALESCE(s.completed_at, s.updated_at) < ? - w.outcome_retention_days * 86400000)').bind(now),
    db.prepare('DELETE FROM recaps WHERE sprint_id IN (SELECT s.id FROM sprints s JOIN workspaces w ON w.id = s.workspace_id WHERE COALESCE(s.completed_at, s.updated_at) < ? - w.outcome_retention_days * 86400000)').bind(now),
    db.prepare('DELETE FROM sessions WHERE expires_at < ? OR revoked_at < ?').bind(now - 7 * 86_400_000, now - 7 * 86_400_000),
    db.prepare("DELETE FROM jobs WHERE status IN ('succeeded','cancelled') AND finished_at < ?").bind(now - 30 * 86_400_000),
    db.prepare("DELETE FROM jobs WHERE status = 'failed' AND finished_at < ?").bind(now - 90 * 86_400_000),
    db.prepare('DELETE FROM rate_events WHERE at < ?').bind(now - 86_400_000),
    // Passkey challenges are single-use and live five minutes; keep a day for diagnosis at most.
    db.prepare('DELETE FROM webauthn_challenges WHERE expires_at < ?').bind(now - 86_400_000),
    db.prepare('DELETE FROM security_events WHERE created_at < ?').bind(now - 365 * 86_400_000),
    // Open requests nobody decided become expired; decided ones and dead invite codes go after 180 days.
    db.prepare("UPDATE join_requests SET status = 'expired' WHERE status = 'pending' AND created_at < ?").bind(now - 14 * 86_400_000),
    db.prepare("DELETE FROM join_requests WHERE status <> 'pending' AND COALESCE(decided_at, created_at) < ?").bind(now - 180 * 86_400_000),
    db.prepare('DELETE FROM join_links WHERE COALESCE(revoked_at, expires_at) < ? AND NOT EXISTS (SELECT 1 FROM join_requests r WHERE r.link_id = join_links.id)').bind(now - 180 * 86_400_000),
    db.prepare('DELETE FROM dev_mail WHERE created_at < ?').bind(now - 86_400_000),
  ])
}

export async function purgeSprintContent(db: D1Database, sprintId: string, workspaceId: string) {
  await db.batch([
    db.prepare('DELETE FROM context_additions WHERE sprint_id = ?').bind(sprintId),
    db.prepare('DELETE FROM checkin_responses WHERE checkin_id IN (SELECT id FROM checkins WHERE sprint_id = ?)').bind(sprintId),
    db.prepare('DELETE FROM checkins WHERE sprint_id = ?').bind(sprintId),
    db.prepare('DELETE FROM discussion_notes WHERE sprint_id = ?').bind(sprintId),
    db.prepare('DELETE FROM votes WHERE round_id IN (SELECT id FROM vote_rounds WHERE sprint_id = ?)').bind(sprintId),
    db.prepare('DELETE FROM vote_rounds WHERE sprint_id = ?').bind(sprintId),
    db.prepare('UPDATE experiments SET theme_id = NULL WHERE sprint_id = ?').bind(sprintId),
    db.prepare('DELETE FROM theme_entries WHERE theme_id IN (SELECT id FROM themes WHERE sprint_id = ?)').bind(sprintId),
    db.prepare('DELETE FROM themes WHERE sprint_id = ?').bind(sprintId),
    db.prepare('DELETE FROM entries WHERE sprint_id = ?').bind(sprintId),
    db.prepare('DELETE FROM recaps WHERE sprint_id = ? AND published_at IS NULL').bind(sprintId),
    db.prepare("UPDATE sprints SET content_purged_at = ?, status = 'archived', archived_at = COALESCE(archived_at, ?) WHERE id = ?").bind(Date.now(), Date.now(), sprintId),
    db.prepare('INSERT INTO audit_events (workspace_id, sprint_id, action, meta, created_at) VALUES (?,?,?,?,?)').bind(workspaceId, sprintId, 'retention.purged', '{}', Date.now()),
  ])
}

/** The cron entry point: due jobs, plus one retention sweep per day (idempotent by date). */
export async function scheduled(env: AppEnv) {
  await enqueue(env.DB, 'retention', {}, Date.now(), `retention:${new Date().toISOString().slice(0, 10)}`)
  await runDue(env, 25)
}
