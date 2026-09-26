import { Hono } from 'hono'
import type { HonoEnv } from '../env'
import { config } from '../lib/config'
import { loadSprintCtx, requireAuth, requireFacilitator, requireMember, requireParticipant, requireSprint, type SprintCtx } from '../lib/auth'
import { uuid } from '../lib/crypto'
import { all, audit, batch, bool, count, one, run } from '../lib/db'
import { bad, conflict, forbidden, notFound } from '../lib/errors'
import { hint, revokeLive, room, roomCall } from '../lib/live'
import { addDays, daysBetween, localDate, localLabel, nonempty, optional, resolveLocal } from '../lib/util'
import { cancelReminders, scheduleReminders } from '../jobs'
import { defaultPlan } from '../room'

export const sprints = new Hono<HonoEnv>()

export const STATUSES = ['draft', 'collecting', 'preparing', 'ready', 'live', 'completed', 'archived']

export function allowedTransitions(status: string, isFacilitator: boolean): string[] {
  if (!isFacilitator) return []
  return (
    {
      draft: ['collecting'],
      collecting: ['preparing'],
      preparing: ['ready', 'collecting'],
      ready: ['live', 'preparing'],
      live: ['completed', 'ready'],
      completed: ['archived'],
    }[status] ?? []
  )
}

interface FullRow {
  id: string
  workspace_id: string
  name: string
  external_ref: string | null
  goal: string | null
  opening_question: string | null
  status: string
  timezone: string
  starts_on: string
  ends_on: string
  retro_at: number
  retro_local_date: string
  retro_local_time: string
  retro_duration_min: number
  ai_processing: number
  ai_locked: number
  reminders_enabled: number
  vote_budget: number
  include_facilitator_in_rotation: number
  grouping_revision: number
  collection_opened_at: number | null
  collection_closed_at: number | null
  reopened_count: number
  revealed_once: number
  completed_at: number | null
  content_purged_at: number | null
  session_started_at: number | null
  session_ended_at: number | null
  session_cancelled: number
}
const iso = (n: number | null | undefined) => (n === null || n === undefined ? null : new Date(n).toISOString())

async function summary(db: D1Database, r: FullRow, me: string) {
  const participant_count = await count(db, 'SELECT count(*) AS n FROM sprint_participants WHERE sprint_id = ?', r.id)
  const fac = await one<{ display_name: string }>(db, 'SELECT a.display_name FROM sprint_participants sp JOIN accounts a ON a.id = sp.account_id WHERE sp.sprint_id = ? AND sp.is_facilitator = 1 LIMIT 1', r.id)
  const mine = await one<{ is_facilitator: number }>(db, 'SELECT is_facilitator FROM sprint_participants WHERE sprint_id = ? AND account_id = ?', r.id, me)
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    name: r.name,
    external_ref: r.external_ref,
    goal: r.goal,
    status: r.status,
    timezone: r.timezone,
    starts_on: r.starts_on,
    ends_on: r.ends_on,
    retro_at: new Date(r.retro_at).toISOString(),
    retro_local: localLabel(r.timezone, r.retro_at),
    retro_local_date: r.retro_local_date,
    retro_local_time: r.retro_local_time,
    retro_duration_min: r.retro_duration_min,
    participant_count,
    facilitator_name: fac?.display_name ?? null,
    is_facilitator: !!mine && bool(mine.is_facilitator),
    is_participant: !!mine,
  }
}

export async function detail(env: HonoEnv['Bindings'], ctx: SprintCtx) {
  const db = env.DB
  const r = (await one<FullRow>(db, 'SELECT * FROM sprints WHERE id = ?', ctx.sprint.id))!
  const s = await summary(db, r, ctx.auth.account.id)
  const prows = await all<{ id: string; display_name: string; is_facilitator: number }>(db, 'SELECT a.id, a.display_name, sp.is_facilitator FROM sprint_participants sp JOIN accounts a ON a.id = sp.account_id WHERE sp.sprint_id = ? ORDER BY sp.is_facilitator DESC, a.display_name', r.id)
  const sealed = r.status === 'draft' || r.status === 'collecting'
  const entry_count = sealed ? null : await count(db, 'SELECT count(*) AS n FROM entries WHERE sprint_id = ?', r.id)
  const theme_count = await count(db, 'SELECT count(*) AS n FROM themes WHERE sprint_id = ?', r.id)
  const opt = await one<{ reminders_opt_out: number }>(db, 'SELECT reminders_opt_out FROM sprint_participants WHERE sprint_id = ? AND account_id = ?', r.id, ctx.auth.account.id)
  const ws = await one<{ name: string }>(db, 'SELECT name FROM workspaces WHERE id = ?', r.workspace_id)
  const prev = await one<{ id: string }>(db, `SELECT id FROM sprints WHERE workspace_id = ? AND id <> ? AND status IN ('completed','archived') AND starts_on <= ? ORDER BY starts_on DESC, created_at DESC LIMIT 1`, r.workspace_id, r.id, r.starts_on)
  return {
    ...s,
    opening_question: r.opening_question,
    ai_processing: bool(r.ai_processing),
    ai_locked: bool(r.ai_locked),
    ai_provider: config(env).ai,
    reminders_enabled: bool(r.reminders_enabled),
    my_reminders_opt_out: !!opt && bool(opt.reminders_opt_out),
    vote_budget: r.vote_budget,
    include_facilitator_in_rotation: bool(r.include_facilitator_in_rotation),
    participants: prows.map((p) => ({ account_id: p.id, display_name: p.display_name, is_facilitator: bool(p.is_facilitator), is_you: p.id === ctx.auth.account.id })),
    entry_count,
    theme_count,
    grouping_revision: r.grouping_revision,
    collection_opened_at: iso(r.collection_opened_at),
    collection_closed_at: iso(r.collection_closed_at),
    reopened_count: r.reopened_count,
    revealed_once: bool(r.revealed_once),
    completed_at: iso(r.completed_at),
    content_purged_at: iso(r.content_purged_at),
    has_session: !!r.session_started_at,
    session_cancelled: bool(r.session_cancelled),
    allowed_transitions: allowedTransitions(r.status, ctx.isFacilitator),
    role: ctx.role,
    workspace_name: ws?.name ?? '',
    previous_sprint_id: prev?.id ?? null,
  }
}

interface ScheduleInput {
  timezone?: string
  starts_on?: string
  ends_on?: string
  retro_date?: string
  retro_time?: string
  retro_duration_min?: number
}
function validateSchedule(s: ScheduleInput) {
  const timezone = nonempty(s.timezone, 64, 'Timezone')
  const starts_on = nonempty(s.starts_on, 10, 'Start date')
  const ends_on = nonempty(s.ends_on, 10, 'End date')
  const retro_date = nonempty(s.retro_date, 10, 'Retro date')
  const retro_time = nonempty(s.retro_time, 5, 'Retro time')
  const dur = Number(s.retro_duration_min ?? 45)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(starts_on) || !/^\d{4}-\d{2}-\d{2}$/.test(ends_on) || !/^\d{4}-\d{2}-\d{2}$/.test(retro_date)) throw bad('dates must be YYYY-MM-DD')
  if (starts_on > ends_on) throw bad('the sprint can’t end before it starts')
  if (daysBetween(starts_on, ends_on) > 120) throw bad('sprints longer than 120 days aren’t supported')
  if (retro_date < starts_on) throw bad('the retro can’t happen before the sprint starts')
  if (!(dur >= 10 && dur <= 240)) throw bad('retro duration must be between 10 and 240 minutes')
  const retro_at = resolveLocal(timezone, retro_date, retro_time)
  return { timezone, starts_on, ends_on, retro_date, retro_time, retro_duration_min: Math.round(dur), retro_at }
}

async function activeMember(db: D1Database, workspaceId: string, accountId: string) {
  return (await count(db, 'SELECT count(*) AS n FROM memberships WHERE workspace_id = ? AND account_id = ? AND revoked_at IS NULL', workspaceId, accountId)) > 0
}

sprints.post('/api/workspaces/:workspaceId/sprints', async (c) => {
  const cfg = config(c.env)
  const m = await requireMember(c, cfg, c.env.DB, c.req.param('workspaceId'))
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown> & ScheduleInput
  const name = nonempty(body.name, 120, 'Sprint name')
  const external_ref = optional(body.external_ref, 60, 'External id')
  const goal = optional(body.goal, 300, 'Sprint goal')
  const opening_question = optional(body.opening_question, 200, 'Opening question')
  const sch = validateSchedule(body)
  const budget = Number(body.vote_budget ?? 3)
  if (!(budget >= 1 && budget <= 10)) throw bad('votes per person must be between 1 and 10')
  const facilitator = String(body.facilitator_id ?? '')
  const ids = new Set<string>([...((body.participant_ids as string[]) ?? []).map(String), facilitator])
  if (ids.size > 60) throw bad('a sprint can have at most 60 participants')
  for (const id of ids) if (!(await activeMember(c.env.DB, m.workspaceId, id))) throw bad('every participant must be a member of this workspace')
  const id = uuid()
  const now = Date.now()
  const stmts: [string, ...unknown[]][] = [
    [
      `INSERT INTO sprints (id, workspace_id, name, external_ref, goal, opening_question, timezone, starts_on, ends_on, retro_at, retro_local_date, retro_local_time, retro_duration_min,
        ai_processing, reminders_enabled, vote_budget, include_facilitator_in_rotation, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, m.workspaceId, name, external_ref, goal, opening_question, sch.timezone, sch.starts_on, sch.ends_on, sch.retro_at, sch.retro_date, sch.retro_time, sch.retro_duration_min,
      body.ai_processing && cfg.ai !== 'none' ? 1 : 0, body.reminders_enabled === false ? 0 : 1, budget, body.include_facilitator_in_rotation ? 1 : 0, m.auth.account.id, now, now,
    ],
  ]
  for (const pid of ids) stmts.push(['INSERT INTO sprint_participants (sprint_id, account_id, is_facilitator, created_at) VALUES (?,?,?,?)', id, pid, pid === facilitator ? 1 : 0, now])
  stmts.push(['INSERT INTO audit_events (workspace_id, sprint_id, actor_id, action, meta, created_at) VALUES (?,?,?,?,?,?)', m.workspaceId, id, m.auth.account.id, 'sprint.created', '{}', now])
  await batch(c.env.DB, stmts)
  return c.json(await detail(c.env, await loadSprintCtx(c.env.DB, m.auth, id)))
})

sprints.get('/api/workspaces/:workspaceId/sprints', async (c) => {
  const m = await requireMember(c, config(c.env), c.env.DB, c.req.param('workspaceId'))
  const rows = await all<FullRow>(c.env.DB, 'SELECT * FROM sprints WHERE workspace_id = ? ORDER BY starts_on DESC, created_at DESC LIMIT 200', m.workspaceId)
  const out = []
  for (const r of rows) out.push(await summary(c.env.DB, r, m.auth.account.id))
  return c.json(out)
})

/** Where should a new thought go? Powers the bookmarkable /capture route. */
sprints.get('/api/me/capture-target', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  const rows = await all<FullRow>(
    c.env.DB,
    `SELECT s.* FROM sprints s WHERE s.status IN ('collecting','preparing','ready','live')
     AND EXISTS (SELECT 1 FROM sprint_participants sp WHERE sp.sprint_id = s.id AND sp.account_id = ?)
     AND EXISTS (SELECT 1 FROM memberships m WHERE m.workspace_id = s.workspace_id AND m.account_id = ? AND m.revoked_at IS NULL)
     ORDER BY s.collection_opened_at DESC, s.retro_at LIMIT 50`,
    a.account.id,
    a.account.id,
  )
  const collecting = []
  const upcoming = []
  for (const r of rows) {
    const s = await summary(c.env.DB, r, a.account.id)
    if (r.status === 'collecting') collecting.push(s)
    else upcoming.push(s)
  }
  return c.json({ collecting, upcoming })
})

sprints.get('/api/sprints/:sprintId', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  return c.json(await detail(c.env, ctx))
})

sprints.patch('/api/sprints/:sprintId', async (c) => {
  const cfg = config(c.env)
  const ctx = await requireSprint(c, cfg, c.env.DB, c.req.param('sprintId'))
  requireFacilitator(ctx)
  if (['completed', 'archived'].includes(ctx.sprint.status)) throw conflict('this sprint is finished and can’t be edited')
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const db = c.env.DB
  const sid = ctx.sprint.id
  if (body.name !== undefined) await run(db, 'UPDATE sprints SET name = ?, updated_at = ? WHERE id = ?', nonempty(body.name, 120, 'Sprint name'), Date.now(), sid)
  if (body.external_ref !== undefined) await run(db, 'UPDATE sprints SET external_ref = ? WHERE id = ?', optional(body.external_ref, 60, 'External id'), sid)
  if (body.goal !== undefined) await run(db, 'UPDATE sprints SET goal = ? WHERE id = ?', optional(body.goal, 300, 'Sprint goal'), sid)
  if (body.opening_question !== undefined) await run(db, 'UPDATE sprints SET opening_question = ? WHERE id = ?', optional(body.opening_question, 200, 'Opening question'), sid)
  if (body.schedule) {
    const sch = validateSchedule(body.schedule as ScheduleInput)
    await run(db, 'UPDATE sprints SET timezone=?, starts_on=?, ends_on=?, retro_at=?, retro_local_date=?, retro_local_time=?, retro_duration_min=?, updated_at=? WHERE id=?', sch.timezone, sch.starts_on, sch.ends_on, sch.retro_at, sch.retro_date, sch.retro_time, sch.retro_duration_min, Date.now(), sid)
    await cancelReminders(db, sid)
    if (ctx.sprint.status === 'collecting') await scheduleReminders(db, sid)
  }
  if (body.ai_processing !== undefined) {
    // Never widen processing after people have submitted.
    if (ctx.sprint.status !== 'draft' && body.ai_processing && !bool(ctx.sprint.ai_processing)) throw conflict('AI processing can’t be turned on after collection has started — it applies to the next sprint')
    await run(db, 'UPDATE sprints SET ai_processing = ? WHERE id = ?', body.ai_processing && cfg.ai !== 'none' ? 1 : 0, sid)
  }
  if (body.reminders_enabled !== undefined) {
    await run(db, 'UPDATE sprints SET reminders_enabled = ? WHERE id = ?', body.reminders_enabled ? 1 : 0, sid)
    await cancelReminders(db, sid)
    if (body.reminders_enabled && ctx.sprint.status === 'collecting') await scheduleReminders(db, sid)
  }
  if (body.vote_budget !== undefined) {
    const b = Number(body.vote_budget)
    if (!(b >= 1 && b <= 10)) throw bad('votes per person must be between 1 and 10')
    if (await count(db, "SELECT count(*) AS n FROM vote_rounds WHERE sprint_id = ? AND status = 'open'", sid)) throw conflict('close the open voting round before changing the budget')
    await run(db, 'UPDATE sprints SET vote_budget = ? WHERE id = ?', b, sid)
  }
  if (body.include_facilitator_in_rotation !== undefined) await run(db, 'UPDATE sprints SET include_facilitator_in_rotation = ? WHERE id = ?', body.include_facilitator_in_rotation ? 1 : 0, sid)
  if (body.facilitator_id !== undefined) {
    const fid = String(body.facilitator_id)
    if (!(await count(db, 'SELECT count(*) AS n FROM sprint_participants WHERE sprint_id = ? AND account_id = ?', sid, fid))) throw bad('the facilitator must be a participant')
    await run(db, 'UPDATE sprint_participants SET is_facilitator = (account_id = ?) WHERE sprint_id = ?', fid, sid)
  }
  await audit(db, ctx.sprint.workspace_id, sid, ctx.auth.account.id, 'sprint.updated')
  await hint(c.env, sid, 'sprint')
  return c.json(await detail(c.env, await loadSprintCtx(db, ctx.auth, sid)))
})

sprints.post('/api/sprints/:sprintId/participants', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireFacilitator(ctx)
  if (['completed', 'archived'].includes(ctx.sprint.status)) throw conflict('this sprint is finished')
  const body = (await c.req.json().catch(() => ({}))) as { account_id?: string }
  const id = String(body.account_id ?? '')
  if (!(await activeMember(c.env.DB, ctx.sprint.workspace_id, id))) throw bad('that person isn’t a member of this workspace')
  await run(c.env.DB, 'INSERT OR IGNORE INTO sprint_participants (sprint_id, account_id, is_facilitator, created_at) VALUES (?,?,0,?)', ctx.sprint.id, id, Date.now())
  await hint(c.env, ctx.sprint.id, 'sprint')
  return c.json({ ok: true })
})

sprints.delete('/api/sprints/:sprintId/participants/:accountId', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireFacilitator(ctx)
  const target = c.req.param('accountId')
  if (target === ctx.auth.account.id) throw conflict('hand facilitation to someone else before leaving')
  await run(c.env.DB, 'DELETE FROM sprint_participants WHERE sprint_id = ? AND account_id = ? AND is_facilitator = 0', ctx.sprint.id, target)
  await revokeLive(c.env, ctx.sprint.id, target)
  await hint(c.env, ctx.sprint.id, 'sprint')
  return c.json({ ok: true })
})

sprints.patch('/api/sprints/:sprintId/me', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireParticipant(ctx)
  const body = (await c.req.json().catch(() => ({}))) as { reminders_opt_out?: boolean }
  await run(c.env.DB, 'UPDATE sprint_participants SET reminders_opt_out = ? WHERE sprint_id = ? AND account_id = ?', body.reminders_opt_out ? 1 : 0, ctx.sprint.id, ctx.auth.account.id)
  return c.json({ ok: true })
})

/** Ensures the room object holds a session for a live sprint (idempotent; also used for recovery on read). */
export async function ensureRoom(env: HonoEnv['Bindings'], ctx: SprintCtx) {
  const themes = await all<{ id: string; order_reason: string | null }>(env.DB, 'SELECT id, order_reason FROM themes WHERE sprint_id = ? AND parked = 0 ORDER BY position, created_at', ctx.sprint.id)
  await roomCall(room(env, ctx.sprint.id), '/start', {
    sprint_id: ctx.sprint.id,
    plan: defaultPlan(ctx.sprint.retro_duration_min),
    agenda: themes.map((t) => ({ theme_id: t.id, reason: t.order_reason })),
    // Only a facilitator becomes the controller; a participant's read that re-initialises the room leaves it open.
    controller: ctx.isFacilitator ? ctx.auth.account.id : null,
  })
}

/** Move the sprint through its lifecycle. Every transition is checked server-side. */
sprints.post('/api/sprints/:sprintId/transition', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireFacilitator(ctx)
  const body = (await c.req.json().catch(() => ({}))) as { to?: string; confirm?: boolean }
  const to = String(body.to ?? '')
  if (!STATUSES.includes(to)) throw bad('unknown status')
  const db = c.env.DB
  const sid = ctx.sprint.id
  const row = (await one<{ status: string; reminders_enabled: number; workspace_id: string }>(db, 'SELECT status, reminders_enabled, workspace_id FROM sprints WHERE id = ?', sid))!
  const from = row.status
  if (!allowedTransitions(from, true).includes(to)) throw conflict(`can’t move from ${from} to ${to}`)
  const now = Date.now()
  // Every transition is a conditional UPDATE on the previous status: two concurrent transitions can't both win.
  const guard = async (sql: string, ...args: unknown[]) => {
    const r = await run(db, sql, ...args)
    if (!r.meta.changes) throw conflict('the sprint changed while you were working — reload and try again')
  }
  switch (`${from}>${to}`) {
    case 'draft>collecting': {
      if (!(await count(db, 'SELECT count(*) AS n FROM sprint_participants WHERE sprint_id = ?', sid))) throw conflict('add at least one participant before opening collection')
      await guard("UPDATE sprints SET status='collecting', ai_locked=1, collection_opened_at=COALESCE(collection_opened_at, ?), updated_at=? WHERE id=? AND status='draft'", now, now, sid)
      if (bool(row.reminders_enabled)) await scheduleReminders(db, sid)
      break
    }
    case 'collecting>preparing': {
      if (body.confirm !== true) throw conflict('closing collection reveals everyone’s entries to the sprint’s participants — confirm to continue')
      // One transaction: flip the status and assign random reveal order. Submissions check the status in
      // their own single statement, so an entry is either fully in before this batch or refused after it.
      const res = await batch(db, [
        ["UPDATE sprints SET status='preparing', collection_closed_at=?, revealed_once=1, updated_at=? WHERE id=? AND status='collecting'", now, now, sid],
        ['UPDATE entries SET reveal_order = abs(random()) % 2147483647 WHERE sprint_id = ?', sid],
      ])
      if (!res[0].meta.changes) throw conflict('the sprint changed while you were working — reload and try again')
      await cancelReminders(db, sid)
      break
    }
    case 'preparing>collecting': {
      if (body.confirm !== true) throw conflict('reopening keeps what participants have already seen visible in their history — confirm to continue')
      const res = await batch(db, [
        ["UPDATE vote_rounds SET status='cancelled', cancel_reason='collection reopened', closed_at=? WHERE sprint_id=? AND status='open'", now, sid],
        ["UPDATE sprints SET status='collecting', reopened_count=reopened_count+1, grouping_revision=grouping_revision+1, updated_at=? WHERE id=? AND status='preparing'", now, sid],
      ])
      if (!res[1].meta.changes) throw conflict('the sprint changed while you were working — reload and try again')
      break
    }
    case 'preparing>ready':
      await guard("UPDATE sprints SET status='ready', updated_at=? WHERE id=? AND status='preparing'", now, sid)
      break
    case 'ready>preparing':
      await guard("UPDATE sprints SET status='preparing', updated_at=? WHERE id=? AND status='ready'", now, sid)
      break
    case 'ready>live': {
      await guard("UPDATE sprints SET status='live', session_started_at=?, session_ended_at=NULL, session_cancelled=0, updated_at=? WHERE id=? AND status='ready'", now, now, sid)
      // A fresh room session; a stale one from an earlier cancelled run is replaced.
      await roomCall(room(c.env, sid), '/cancel')
      await ensureRoom(c.env, ctx)
      break
    }
    case 'live>ready': {
      const res = await batch(db, [
        ["UPDATE sprints SET status='ready', session_cancelled=1, session_ended_at=?, updated_at=? WHERE id=? AND status='live'", now, now, sid],
        ["UPDATE vote_rounds SET status='cancelled', cancel_reason='session cancelled', closed_at=? WHERE sprint_id=? AND status='open'", now, sid],
      ])
      if (!res[0].meta.changes) throw conflict('the sprint changed while you were working — reload and try again')
      await roomCall(room(c.env, sid), '/cancel')
      break
    }
    case 'live>completed': {
      const res = await batch(db, [
        ["UPDATE sprints SET status='completed', completed_at=?, session_ended_at=?, updated_at=? WHERE id=? AND status='live'", now, now, now, sid],
        ["UPDATE vote_rounds SET status='closed', closed_at=? WHERE sprint_id=? AND status='open'", now, sid],
      ])
      if (!res[0].meta.changes) throw conflict('the sprint changed while you were working — reload and try again')
      await roomCall(room(c.env, sid), '/end')
      break
    }
    case 'completed>archived':
      await guard("UPDATE sprints SET status='archived', archived_at=?, updated_at=? WHERE id=? AND status='completed'", now, now, sid)
      break
    default:
      throw conflict(`can’t move from ${from} to ${to}`)
  }
  await audit(db, row.workspace_id, sid, ctx.auth.account.id, 'sprint.transition', { from, to })
  await hint(c.env, sid, 'sprint')
  await hint(c.env, sid, 'meeting')
  return c.json(await detail(c.env, await loadSprintCtx(db, ctx.auth, sid)))
})

sprints.delete('/api/sprints/:sprintId', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  if (!(ctx.isFacilitator || ctx.role === 'owner')) throw forbidden('only the facilitator or an owner can delete a draft')
  if (ctx.sprint.status !== 'draft') throw conflict('only draft sprints can be deleted; finished sprints follow the retention policy')
  await run(c.env.DB, "DELETE FROM sprints WHERE id = ? AND status = 'draft'", ctx.sprint.id)
  return c.json({ ok: true })
})

export { addDays, localDate, notFound }
