import { Hono } from 'hono'
import type { HonoEnv } from '../env'
import { config } from '../lib/config'
import { loadSprintCtx, requireAuth, requireFacilitator, requireMember, requireParticipant, requireSprint, type SprintCtx } from '../lib/auth'
import { uuid } from '../lib/crypto'
import { all, assignments, audit, auditStmt, batch, bool, count, one, run, type Statement } from '../lib/db'
import { bad, conflict, forbidden, notFound } from '../lib/errors'
import { handOver, hint, revokeLive, room, roomCall } from '../lib/live'
import { addDays, daysBetween, idList, isDate, jsonBody, localDate, localLabel, nonempty, optional, resolveLocal } from '../lib/util'
import { cancelReminders, cancelRemindersStatement, scheduleReminders } from '../jobs'
import { defaultPlan } from '../room'
import { content, ENCRYPTION, isEncrypted, publicKey } from '../lib/sealed'
import { sealedVersion, wrapStatements } from './keys'
import { HAS_SEAT, MAX_PARTICIPANTS } from '../lib/limits'

export const sprints = new Hono<HonoEnv>()

export const STATUSES = ['draft', 'collecting', 'preparing', 'ready', 'live', 'completed', 'archived']

/**
 * What the facilitator may do next. People see four stages — collecting, closed, the retro, done —
 * so a closed sprint (preparing, or the older "ready") starts the retro directly, and collection can
 * be reopened until the retro has started once: after that, the conversation has used what was
 * revealed, and reopening would pretend otherwise. preparing ⇄ ready stay for older clients.
 */
export function allowedTransitions(status: string, isFacilitator: boolean, sessionStarted = false): string[] {
  if (!isFacilitator) return []
  const reopen = sessionStarted ? [] : ['collecting']
  return (
    {
      draft: ['collecting'],
      collecting: ['preparing'],
      preparing: ['live', ...reopen, 'ready'],
      ready: ['live', ...reopen, 'preparing'],
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
  reminders_enabled: number
  vote_budget: number
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
  encryption: string | null
}
const iso = (n: number | null | undefined) => (n === null || n === undefined ? null : new Date(n).toISOString())

/**
 * A sprint row with the fields a summary adds for the person asking, computed in the same query:
 * a list of sprints is one round trip to the database, not three per sprint. The first bound
 * value is the person's account id; `s` is the sprint. Use as `SELECT ${WITH_SUMMARY} FROM sprints s ${MINE} WHERE …`.
 */
const WITH_SUMMARY = `s.*,
  (SELECT count(*) FROM sprint_participants p WHERE p.sprint_id = s.id) AS participant_count,
  (SELECT a.display_name FROM sprint_participants p JOIN accounts a ON a.id = p.account_id WHERE p.sprint_id = s.id AND p.is_facilitator = 1 LIMIT 1) AS facilitator_name,
  mine.account_id AS mine_id, mine.is_facilitator AS mine_facilitator, mine.reminders_opt_out AS mine_opt_out`
const MINE = 'LEFT JOIN sprint_participants mine ON mine.sprint_id = s.id AND mine.account_id = ?'
type SummaryRow = FullRow & { participant_count: number; facilitator_name: string | null; mine_id: string | null; mine_facilitator: number | null; mine_opt_out: number | null }

function summary(r: SummaryRow) {
  const mine = r.mine_id ? { is_facilitator: r.mine_facilitator, reminders_opt_out: r.mine_opt_out } : null
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
    participant_count: Number(r.participant_count),
    facilitator_name: r.facilitator_name ?? null,
    is_facilitator: !!mine && bool(mine.is_facilitator),
    is_participant: !!mine,
    reminders_enabled: bool(r.reminders_enabled),
    my_reminders_opt_out: !!mine && bool(mine.reminders_opt_out),
    encryption: isEncrypted(r) ? ENCRYPTION : null,
    allowed_transitions: allowedTransitions(r.status, !!mine && bool(mine.is_facilitator), !!r.session_started_at),
  }
}

export async function detail(env: HonoEnv['Bindings'], ctx: SprintCtx) {
  const db = env.DB
  const r = (await one<SummaryRow>(db, `SELECT ${WITH_SUMMARY} FROM sprints s ${MINE} WHERE s.id = ?`, ctx.auth.account.id, ctx.sprint.id))!
  const s = summary(r)
  const sealed = r.status === 'draft' || r.status === 'collecting'
  // Independent reads, so they travel to the database together rather than one after another.
  const [prows, entry_count, theme_count, ws, prev] = await Promise.all([
    all<{ id: string; display_name: string; is_facilitator: number }>(db, 'SELECT a.id, a.display_name, sp.is_facilitator FROM sprint_participants sp JOIN accounts a ON a.id = sp.account_id WHERE sp.sprint_id = ? ORDER BY sp.is_facilitator DESC, a.display_name', r.id),
    sealed ? null : count(db, 'SELECT count(*) AS n FROM entries WHERE sprint_id = ?', r.id),
    count(db, 'SELECT count(*) AS n FROM themes WHERE sprint_id = ?', r.id),
    one<{ name: string }>(db, 'SELECT name FROM workspaces WHERE id = ?', r.workspace_id),
    one<{ id: string }>(db, `SELECT id FROM sprints WHERE workspace_id = ? AND id <> ? AND status IN ('completed','archived') AND starts_on <= ? ORDER BY starts_on DESC, created_at DESC LIMIT 1`, r.workspace_id, r.id, r.starts_on),
  ])
  return {
    ...s,
    opening_question: r.opening_question,
    vote_budget: r.vote_budget,
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
    allowed_transitions: allowedTransitions(r.status, ctx.isFacilitator, !!r.session_started_at),
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
  if (!isDate(starts_on) || !isDate(ends_on) || !isDate(retro_date)) throw bad('dates must be real dates, as YYYY-MM-DD')
  if (starts_on > ends_on) throw bad('the sprint can’t end before it starts')
  if (daysBetween(starts_on, ends_on) > 120) throw bad('sprints longer than 120 days aren’t supported')
  if (retro_date < starts_on) throw bad('the retro can’t happen before the sprint starts')
  if (!(dur >= 10 && dur <= 240)) throw bad('retro duration must be between 10 and 240 minutes')
  const retro_at = resolveLocal(timezone, retro_date, retro_time)
  return { timezone, starts_on, ends_on, retro_date, retro_time, retro_duration_min: Math.round(dur), retro_at }
}

/** Adds someone to a sprint while it has room (the check and the insert are one statement). */
export async function seat(db: D1Database, sprintId: string, accountId: string) {
  const r = await run(db, `INSERT OR IGNORE INTO sprint_participants (sprint_id, account_id, is_facilitator, created_at) SELECT id, ?, 0, ? FROM sprints WHERE id = ? AND ${HAS_SEAT}`, accountId, Date.now(), sprintId)
  if (!r.meta.changes && !(await count(db, 'SELECT count(*) AS n FROM sprint_participants WHERE sprint_id = ? AND account_id = ?', sprintId, accountId)))
    throw conflict(`a sprint can have at most ${MAX_PARTICIPANTS} participants`)
}

async function activeMember(db: D1Database, workspaceId: string, accountId: string) {
  return (await count(db, 'SELECT count(*) AS n FROM memberships WHERE workspace_id = ? AND account_id = ? AND revoked_at IS NULL', workspaceId, accountId)) > 0
}

sprints.post('/api/workspaces/:workspaceId/sprints', async (c) => {
  const cfg = config(c.env)
  const m = await requireMember(c, cfg, c.env.DB, c.req.param('workspaceId'))
  const body = await jsonBody<Record<string, unknown> & ScheduleInput>(c)
  const name = nonempty(body.name, 120, 'Sprint name')
  const external_ref = optional(body.external_ref, 60, 'External id')
  const goal = optional(body.goal, 300, 'Sprint goal')
  // New sprints can be encrypted: their content is sealed on participants' devices. Name, goal,
  // dates, people and categories stay readable metadata (docs/ENCRYPTION.md).
  const encrypted = body.encryption === ENCRYPTION
  if (body.encryption !== undefined && body.encryption !== null && !encrypted) throw bad('unknown encryption format')
  const opening_question = content(encrypted, body.opening_question, 200, 'Opening question', false)
  const sch = validateSchedule(body)
  const budget = Number(body.vote_budget ?? 3)
  if (!(budget >= 1 && budget <= 10)) throw bad('votes per person must be between 1 and 10')
  const facilitator = String(body.facilitator_id ?? '')
  const ids = new Set<string>([...idList(body.participant_ids, 'participant_ids'), facilitator])
  if (ids.size > MAX_PARTICIPANTS) throw bad(`a sprint can have at most ${MAX_PARTICIPANTS} participants`)
  for (const id of ids) if (!(await activeMember(c.env.DB, m.workspaceId, id))) throw bad('every participant must be a member of this workspace')
  // An encrypted sprint's keys are bound to its id before it exists, so the client chooses it.
  if (encrypted && (typeof body.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(body.id))) throw bad('an encrypted sprint needs its id from your device')
  if (encrypted && (await count(c.env.DB, 'SELECT count(*) AS n FROM sprints WHERE id = ?', body.id))) throw conflict('that sprint id is taken')
  const id = encrypted ? (body.id as string) : uuid()
  const now = Date.now()
  const stmts: [string, ...unknown[]][] = [
    [
      `INSERT INTO sprints (id, workspace_id, name, external_ref, goal, opening_question, timezone, starts_on, ends_on, retro_at, retro_local_date, retro_local_time, retro_duration_min,
        reminders_enabled, vote_budget, created_by, created_at, updated_at, encryption) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, m.workspaceId, name, external_ref, goal, opening_question, sch.timezone, sch.starts_on, sch.ends_on, sch.retro_at, sch.retro_date, sch.retro_time, sch.retro_duration_min,
      body.reminders_enabled === false ? 0 : 1, budget, m.auth.account.id, now, now, encrypted ? ENCRYPTION : null,
    ],
  ]
  if (encrypted) {
    const key = (body.sprint_key ?? {}) as { public_key?: unknown }
    stmts.push(['INSERT INTO sprint_keys (sprint_id, version, public_key, created_by, created_at) VALUES (?,1,?,?,?)', id, publicKey(key.public_key), m.auth.account.id, now])
  }
  for (const pid of ids) stmts.push(['INSERT INTO sprint_participants (sprint_id, account_id, is_facilitator, created_at) VALUES (?,?,?,?)', id, pid, pid === facilitator ? 1 : 0, now])
  stmts.push(['INSERT INTO audit_events (workspace_id, sprint_id, actor_id, action, meta, created_at) VALUES (?,?,?,?,?,?)', m.workspaceId, id, m.auth.account.id, 'sprint.created', '{}', now])
  await batch(c.env.DB, stmts)
  if (encrypted) {
    // The facilitator must be able to hold the key: their wrap is required, and nobody else's is allowed.
    const wraps = Array.isArray(body.key_wraps) ? body.key_wraps : []
    try {
      if (!wraps.some((w: { account_id?: unknown }) => w?.account_id === facilitator)) throw bad('an encrypted sprint needs its key sealed to the facilitator')
      const ws = await wrapStatements(c.env.DB, id, m.auth.account.id, wraps, { sealedVersion: 1 })
      await batch(c.env.DB, ws)
    } catch (e) {
      await run(c.env.DB, 'DELETE FROM sprints WHERE id = ?', id)
      throw e
    }
  }
  return c.json(await detail(c.env, await loadSprintCtx(c.env.DB, m.auth, id)))
})

sprints.get('/api/workspaces/:workspaceId/sprints', async (c) => {
  const m = await requireMember(c, config(c.env), c.env.DB, c.req.param('workspaceId'))
  // Every sprint the workspace has: a list that stopped at some number would lose the oldest quietly.
  const rows = await all<SummaryRow>(c.env.DB, `SELECT ${WITH_SUMMARY} FROM sprints s ${MINE} WHERE s.workspace_id = ? ORDER BY s.starts_on DESC, s.created_at DESC`, m.auth.account.id, m.workspaceId)
  return c.json(rows.map(summary))
})

/** Where should a new thought go? Powers the bookmarkable /capture route. */
sprints.get('/api/me/capture-target', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  // Starts from this person's own sprints (by the participants' account index), never from every
  // active sprint of every workspace. CROSS JOIN keeps that order in SQLite's planner.
  const rows = await all<SummaryRow>(
    c.env.DB,
    `SELECT ${WITH_SUMMARY} FROM sprint_participants mine CROSS JOIN sprints s ON s.id = mine.sprint_id
      WHERE mine.account_id = ? AND s.status IN ('collecting','preparing','ready','live')
        AND EXISTS (SELECT 1 FROM memberships m WHERE m.workspace_id = s.workspace_id AND m.account_id = mine.account_id AND m.revoked_at IS NULL)
      ORDER BY s.collection_opened_at DESC, s.retro_at LIMIT 50`,
    a.account.id,
  )
  const collecting = []
  const upcoming = []
  for (const r of rows) {
    const s = summary(r)
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
  const body = await jsonBody<Record<string, unknown>>(c)
  const db = c.env.DB
  const sid = ctx.sprint.id
  const encrypted = isEncrypted(ctx.sprint)
  // Every field is checked before anything is written, and then it's all written in one
  // transaction: a change that's refused saves none of the others.
  const { sets, args, set } = assignments()
  if (body.name !== undefined) set('name = ?', nonempty(body.name, 120, 'Sprint name'))
  if (body.external_ref !== undefined) set('external_ref = ?', optional(body.external_ref, 60, 'External id'))
  if (body.goal !== undefined) set('goal = ?', optional(body.goal, 300, 'Sprint goal'))
  if (body.opening_question !== undefined) set('opening_question = ?', content(encrypted, body.opening_question, 200, 'Opening question', false))
  const sch = body.schedule ? validateSchedule(body.schedule as ScheduleInput) : null
  if (sch) set('timezone = ?, starts_on = ?, ends_on = ?, retro_at = ?, retro_local_date = ?, retro_local_time = ?, retro_duration_min = ?', sch.timezone, sch.starts_on, sch.ends_on, sch.retro_at, sch.retro_date, sch.retro_time, sch.retro_duration_min)
  if (body.reminders_enabled !== undefined) set('reminders_enabled = ?', body.reminders_enabled ? 1 : 0)
  if (body.vote_budget !== undefined) {
    const b = Number(body.vote_budget)
    if (!(b >= 1 && b <= 10)) throw bad('votes per person must be between 1 and 10')
    if (await count(db, "SELECT count(*) AS n FROM vote_rounds WHERE sprint_id = ? AND status = 'open'", sid)) throw conflict('close the open voting round before changing the budget')
    set('vote_budget = ?', b)
  }
  const stmts: Statement[] = []
  if (sets.length) stmts.push([`UPDATE sprints SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...args, Date.now(), sid])
  let handover: string | null = null
  if (body.facilitator_id !== undefined) {
    const fid = String(body.facilitator_id)
    const [inSprint, before] = await Promise.all([
      count(db, 'SELECT count(*) AS n FROM sprint_participants WHERE sprint_id = ? AND account_id = ?', sid, fid),
      one<{ account_id: string }>(db, 'SELECT account_id FROM sprint_participants WHERE sprint_id = ? AND is_facilitator = 1', sid),
    ])
    if (!inSprint) throw bad('the facilitator must be a participant')
    if (before?.account_id !== fid) {
      handover = fid
      stmts.push(['UPDATE sprint_participants SET is_facilitator = (account_id = ?) WHERE sprint_id = ?', fid, sid])
      if (encrypted) {
        // The key moves with the role. While collecting, the new facilitator must hold the version
        // sealed now — already, or through a wrap for exactly that version in this request — and
        // then nobody else keeps it: the role, the wraps and the removal are one transaction.
        const sealedV = await sealedVersion(db, sid, ctx.sprint.status)
        const wraps = Array.isArray(body.key_wraps) ? body.key_wraps : []
        const has = sealedV === null || (await count(db, 'SELECT count(*) AS n FROM sprint_key_wraps WHERE sprint_id = ? AND version = ? AND account_id = ?', sid, sealedV, fid)) > 0
        if (!has && !wraps.some((w: { account_id?: unknown; version?: unknown }) => w?.account_id === fid && Number(w?.version) === sealedV)) throw conflict('the new facilitator needs the sprint’s key — open the setup from a device that has it')
        stmts.push(...(await wrapStatements(db, sid, ctx.auth.account.id, wraps, { sealedVersion: sealedV, facilitator: fid })))
        if (sealedV !== null) stmts.push(['DELETE FROM sprint_key_wraps WHERE sprint_id = ? AND version = ? AND account_id <> ?', sid, sealedV, fid])
      }
    }
  }
  // Reminders follow the schedule and the switch: queued ones go with the change, and any still
  // ahead are queued again once it's saved (the jobs are idempotent by their keys).
  const reminders = !!sch || body.reminders_enabled !== undefined
  if (reminders) stmts.push(cancelRemindersStatement(sid))
  stmts.push(auditStmt(ctx.sprint.workspace_id, sid, ctx.auth.account.id, 'sprint.updated'))
  await batch(db, stmts)
  if (reminders && ctx.sprint.status === 'collecting' && body.reminders_enabled !== false) await scheduleReminders(db, sid)
  // Open sockets follow the handover: what only the facilitator hears goes to the new one now.
  if (handover) await handOver(c.env, sid, handover, Date.now())
  await hint(c.env, sid, 'sprint')
  return c.json(await detail(c.env, await loadSprintCtx(db, ctx.auth, sid)))
})

sprints.post('/api/sprints/:sprintId/participants', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireFacilitator(ctx)
  if (['completed', 'archived'].includes(ctx.sprint.status)) throw conflict('this sprint is finished')
  const body = await jsonBody<{ account_id?: string }>(c)
  const id = String(body.account_id ?? '')
  if (!(await activeMember(c.env.DB, ctx.sprint.workspace_id, id))) throw bad('that person isn’t a member of this workspace')
  await seat(c.env.DB, ctx.sprint.id, id)
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
  const body = await jsonBody<{ reminders_opt_out?: boolean }>(c)
  await run(c.env.DB, 'UPDATE sprint_participants SET reminders_opt_out = ? WHERE sprint_id = ? AND account_id = ?', body.reminders_opt_out ? 1 : 0, ctx.sprint.id, ctx.auth.account.id)
  return c.json({ ok: true })
})

/**
 * Ensures the room object holds a session for a live sprint (idempotent; also used for recovery on
 * read). `session` is the retro's sprints.session_started_at: the room won't bring back one it has
 * seen end or be cancelled. `replace` starts afresh whatever the room holds (going live).
 */
export async function ensureRoom(env: HonoEnv['Bindings'], ctx: SprintCtx, opts: { session: number | null; replace?: boolean }) {
  const themes = await all<{ id: string; order_reason: string | null }>(env.DB, 'SELECT id, order_reason FROM themes WHERE sprint_id = ? AND parked = 0 ORDER BY position, created_at', ctx.sprint.id)
  await roomCall(room(env, ctx.sprint.id), '/start', {
    sprint_id: ctx.sprint.id,
    plan: defaultPlan(ctx.sprint.retro_duration_min),
    agenda: themes.map((t) => ({ theme_id: t.id, reason: t.order_reason })),
    // Only a facilitator becomes the controller; a participant's read that re-initialises the room leaves it open.
    controller: ctx.isFacilitator ? ctx.auth.account.id : null,
    session: opts.session,
    replace: opts.replace === true,
  })
}

/** Move the sprint through its lifecycle. Every transition is checked server-side. */
sprints.post('/api/sprints/:sprintId/transition', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireFacilitator(ctx)
  const body = await jsonBody<{ to?: string; confirm?: boolean; key_wraps?: unknown; sprint_key?: { version?: unknown; public_key?: unknown } }>(c)
  const to = String(body.to ?? '')
  if (!STATUSES.includes(to)) throw bad('unknown status')
  const db = c.env.DB
  const sid = ctx.sprint.id
  const row = (await one<{ status: string; reminders_enabled: number; workspace_id: string; session_started_at: number | null }>(db, 'SELECT status, reminders_enabled, workspace_id, session_started_at FROM sprints WHERE id = ?', sid))!
  const from = row.status
  // Already there (a second click, another tab, a retry after a lost response): nothing to do, and
  // nothing is done twice.
  if (from === to) return c.json(await detail(c.env, ctx))
  if (to === 'collecting' && (from === 'preparing' || from === 'ready') && row.session_started_at) throw conflict('the retro has already started, so collection can’t be reopened')
  if (!allowedTransitions(from, true, !!row.session_started_at).includes(to)) throw conflict(`can’t move from ${from} to ${to}`)
  const now = Date.now()
  const encrypted = isEncrypted(ctx.sprint)
  // Every transition is a conditional UPDATE on the previous status: two concurrent transitions can't both win.
  const guard = async (sql: string, ...args: unknown[]) => {
    const r = await run(db, sql, ...args)
    if (!r.meta.changes) throw conflict('the sprint changed while you were working — reload and try again')
  }
  // A closed sprint is one stage to people, whichever of its two stored states it's in.
  const step = from === 'ready' && (to === 'collecting' || to === 'live') ? `preparing>${to}` : `${from}>${to}`
  switch (step) {
    case 'draft>collecting': {
      if (!(await count(db, 'SELECT count(*) AS n FROM sprint_participants WHERE sprint_id = ?', sid))) throw conflict('add at least one participant before opening collection')
      await guard("UPDATE sprints SET status='collecting', collection_opened_at=COALESCE(collection_opened_at, ?), updated_at=? WHERE id=? AND status='draft'", now, now, sid)
      if (bool(row.reminders_enabled)) await scheduleReminders(db, sid)
      break
    }
    case 'collecting>preparing': {
      if (body.confirm !== true) throw conflict('closing collection reveals everyone’s entries to the sprint’s participants — confirm to continue')
      // One transaction: flip the status and assign random reveal order. Submissions check the status in
      // their own single statement, so an entry is either fully in before this batch or refused after it.
      // Encrypted: the reveal is the facilitator's client sealing the sprint secret to each
      // participant, stored in the same batch as the status change.
      const wraps = encrypted ? await wrapStatements(db, sid, ctx.auth.account.id, body.key_wraps, { sealedVersion: null }) : []
      const res = await batch(db, [
        ["UPDATE sprints SET status='preparing', collection_closed_at=?, revealed_once=1, updated_at=? WHERE id=? AND status='collecting'", now, now, sid],
        ['UPDATE entries SET reveal_order = abs(random()) % 2147483647 WHERE sprint_id = ?', sid],
        ...wraps,
      ])
      if (!res[0].meta.changes) throw conflict('the sprint changed while you were working — reload and try again')
      await cancelReminders(db, sid)
      break
    }
    case 'preparing>collecting': {
      if (body.confirm !== true) throw conflict('reopening keeps what participants have already seen visible in their history — confirm to continue')
      // Encrypted: thoughts written after reopening go to a fresh key version that, again, only the
      // facilitator holds until collection closes.
      const next: [string, ...unknown[]][] = []
      if (encrypted) {
        const latest = (await one<{ v: number }>(db, 'SELECT MAX(version) AS v FROM sprint_keys WHERE sprint_id = ?', sid))?.v ?? 0
        if (Number(body.sprint_key?.version) !== latest + 1) throw conflict('reopening an encrypted sprint needs a new key from your device — reload and try again')
        const pk = publicKey(body.sprint_key?.public_key)
        const wraps = Array.isArray(body.key_wraps) ? body.key_wraps : []
        if (!wraps.some((w: { account_id?: unknown; version?: unknown }) => w?.account_id === ctx.auth.account.id && Number(w?.version) === latest + 1)) throw bad('the new key must be sealed to you')
        await run(db, 'INSERT INTO sprint_keys (sprint_id, version, public_key, created_by, created_at) VALUES (?,?,?,?,?)', sid, latest + 1, pk, ctx.auth.account.id, now)
        try {
          next.push(...(await wrapStatements(db, sid, ctx.auth.account.id, wraps, { sealedVersion: latest + 1 })))
        } catch (e) {
          await run(db, 'DELETE FROM sprint_keys WHERE sprint_id = ? AND version = ?', sid, latest + 1)
          throw e
        }
      }
      const res = await batch(db, [
        ["UPDATE vote_rounds SET status='cancelled', cancel_reason='collection reopened', closed_at=? WHERE sprint_id=? AND status='open'", now, sid],
        ["UPDATE sprints SET status='collecting', reopened_count=reopened_count+1, grouping_revision=grouping_revision+1, updated_at=? WHERE id=? AND status=? AND session_started_at IS NULL", now, sid, from],
        ...next,
      ])
      if (!res[1].meta.changes) {
        if (encrypted) await run(db, "DELETE FROM sprint_keys WHERE sprint_id = ? AND version = (SELECT MAX(version) FROM sprint_keys WHERE sprint_id = ?) AND (SELECT status FROM sprints WHERE id = ?) <> 'collecting'", sid, sid, sid)
        throw conflict('the sprint changed while you were working — reload and try again')
      }
      // Reminders follow collection: closing cancelled them, reopening brings back any still ahead.
      if (bool(row.reminders_enabled)) await scheduleReminders(db, sid)
      break
    }
    case 'preparing>ready':
      await guard("UPDATE sprints SET status='ready', updated_at=? WHERE id=? AND status='preparing'", now, sid)
      break
    case 'ready>preparing':
      await guard("UPDATE sprints SET status='preparing', updated_at=? WHERE id=? AND status='ready'", now, sid)
      break
    case 'preparing>live': {
      await guard("UPDATE sprints SET status='live', session_started_at=?, session_ended_at=NULL, session_cancelled=0, updated_at=? WHERE id=? AND status=?", now, now, sid, from)
      // A fresh room session; a stale one from an earlier cancelled run is replaced.
      await ensureRoom(c.env, ctx, { session: now, replace: true })
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
  await hint(c.env, sid, ['sprint', 'meeting'])
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
