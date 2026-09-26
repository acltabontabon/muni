/**
 * The stage as the caller may see it. The room object owns live state; this
 * module composes it with D1 content the recipient is allowed to see. The
 * same sanitized shape serves participants, facilitator and presenter.
 */
import { Hono } from 'hono'
import type { HonoEnv } from '../env'
import { config } from '../lib/config'
import { checkSocketOrigin, requireFacilitator, requireParticipant, requireSprint, type SprintCtx } from '../lib/auth'
import { uuid } from '../lib/crypto'
import { all, audit, bool, count, one, run } from '../lib/db'
import { conflict, notFound } from '../lib/errors'
import { hint, room, roomCall, roomSocketHeaders } from '../lib/live'
import { nonempty, optional } from '../lib/util'
import type { RoomState } from '../room'
import { PHASES } from '../room'
import { ensureRoom } from './sprints'

export const meeting = new Hono<HonoEnv>()

const PROMPTS = ['Anything you’d add?', 'How did this show up in your work?', 'What would help here?', 'Have we missed another perspective?']

async function participants(db: D1Database, sprintId: string) {
  return all<{ account_id: string; display_name: string; is_facilitator: number }>(db, 'SELECT a.id AS account_id, a.display_name, sp.is_facilitator FROM sprint_participants sp JOIN accounts a ON a.id = sp.account_id WHERE sp.sprint_id = ? ORDER BY sp.is_facilitator DESC, a.display_name', sprintId)
}
const partList = (rows: { account_id: string; is_facilitator: number }[]) => rows.map((p) => ({ account_id: p.account_id, is_facilitator: bool(p.is_facilitator) }))

export async function snapshot(env: HonoEnv['Bindings'], ctx: SprintCtx) {
  const db = env.DB
  let { body: rs } = await roomCall<RoomState>(room(env, ctx.sprint.id), '/state')
  if ((!rs.meeting || rs.meeting.cancelled) && ctx.sprint.status === 'live') {
    // Recovery: D1 says live but the room has no session (e.g. a failed start). Idempotent re-init.
    await ensureRoom(env, ctx)
    rs = (await roomCall<RoomState>(room(env, ctx.sprint.id), '/state')).body
  }
  const m = rs.meeting
  if (!m) throw notFound('the retro hasn’t started yet')
  const me = ctx.auth.account.id
  const people = await participants(db, ctx.sprint.id)
  const now = Date.now()
  const timer = m.timer_ends_at
    ? { running: true, ends_at: new Date(m.timer_ends_at).toISOString(), remaining_secs: Math.max(0, Math.round((m.timer_ends_at - now) / 1000)), total_secs: m.timer_total_secs ?? 0 }
    : { running: false, ends_at: null, remaining_secs: m.timer_remaining_secs ?? 0, total_secs: m.timer_total_secs ?? 0 }
  const sp = rs.speaking && rs.speaking.status !== 'ended' ? rs.speaking : null
  const cur = sp?.current_account_id ? people.find((p) => p.account_id === sp.current_account_id) : null
  const notes = m.current_theme_id && m.current_theme_id !== 'ungrouped' ? await one<{ takeaway: string; what_happened: string; impact: string; could_try: string; notes: string; discussed: number }>(db, 'SELECT takeaway, what_happened, impact, could_try, notes, discussed FROM discussion_notes WHERE theme_id = ?', m.current_theme_id) : null
  const discussed = await all<{ theme_id: string }>(db, 'SELECT theme_id FROM discussion_notes WHERE sprint_id = ? AND discussed = 1', ctx.sprint.id)
  const unreleased = ctx.isFacilitator ? (await count(db, 'SELECT count(*) AS n FROM context_additions WHERE sprint_id = ? AND released_batch IS NULL', ctx.sprint.id)) > 0 : null
  const mine = await all<{ id: string; theme_id: string | null; body: string; released_batch: number | null }>(db, 'SELECT id, theme_id, body, released_batch FROM context_additions WHERE sprint_id = ? AND author_account_id = ? ORDER BY created_at LIMIT 100', ctx.sprint.id, me)
  const controller = m.controller_account_id ? people.find((p) => p.account_id === m.controller_account_id) : null
  return {
    session_id: `${ctx.sprint.id}:${m.started_at}`,
    version: m.version,
    phase: m.phase,
    phases: [...PHASES],
    plan: m.plan,
    current_theme_id: m.current_theme_id,
    agenda: m.agenda,
    timer,
    server_time: new Date(now).toISOString(),
    controller_name: controller?.display_name ?? null,
    you_control: m.controller_account_id === me,
    controller_stale: !m.controller_account_id || !rs.connected.includes(m.controller_account_id),
    quiet_reading: m.quiet_reading && !!m.timer_ends_at && m.timer_ends_at > now,
    opening_question: ctx.sprint.opening_question,
    attendance: people.map((p) => ({
      account_id: p.account_id,
      display_name: p.display_name,
      present: rs.attendance[p.account_id]?.present ?? false,
      ready: ctx.isFacilitator || p.account_id === me ? (rs.attendance[p.account_id]?.ready ?? true) : null,
      is_facilitator: bool(p.is_facilitator),
      is_you: p.account_id === me,
    })),
    speaking: sp
      ? { round_id: sp.id, status: sp.status, current: cur ? { account_id: cur.account_id, display_name: cur.display_name, is_you: cur.account_id === me } : null, remaining: Math.max(0, sp.ordering.length - sp.cursor - 1), prompt: PROMPTS[Math.max(0, sp.cursor) % PROMPTS.length] }
      : null,
    notes: notes ? { takeaway: notes.takeaway, what_happened: notes.what_happened, impact: notes.impact, could_try: notes.could_try, notes: notes.notes, discussed: bool(notes.discussed) } : { takeaway: '', what_happened: '', impact: '', could_try: '', notes: '', discussed: false },
    discussed_theme_ids: discussed.map((d) => d.theme_id),
    has_unreleased_context: unreleased,
    my_context: mine.map((x) => ({ id: x.id, theme_id: x.theme_id, body: x.body, released: x.released_batch !== null })),
    include_facilitator_in_rotation: bool(ctx.sprint.include_facilitator_in_rotation),
    retro_duration_min: ctx.sprint.retro_duration_min,
    started_at: new Date(m.started_at).toISOString(),
    ended_at: m.ended_at ? new Date(m.ended_at).toISOString() : null,
    cancelled: m.cancelled,
    is_facilitator: ctx.isFacilitator,
  }
}

meeting.get('/api/sprints/:sprintId/meeting', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireParticipant(ctx)
  return c.json(await snapshot(c.env, ctx))
})

/** Live hints over a WebSocket owned by the sprint's room. Membership is checked here, and again on every reconnect. */
meeting.get('/api/sprints/:sprintId/ws', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireParticipant(ctx)
  checkSocketOrigin(c.req.raw, config(c.env))
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') return c.json({ error: 'expected a websocket', code: 'bad_request' }, 426)
  return room(c.env, ctx.sprint.id).fetch('https://room/ws', { headers: roomSocketHeaders(c.req.raw.headers, ctx.auth.account.id, ctx.isFacilitator) })
})

/** Facilitator commands applied by the room only if `expected_version` matches. Content-side effects (context release, discussed flags) live here in D1. */
meeting.post('/api/sprints/:sprintId/meeting/command', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireFacilitator(ctx)
  if (ctx.sprint.status !== 'live') throw conflict('the retro isn’t live')
  const body = (await c.req.json().catch(() => ({}))) as { expected_version?: number; command?: { type?: string; theme_id?: string; discussed?: boolean; phase?: string; items?: unknown } }
  const cmd = body.command ?? {}
  const db = c.env.DB
  // 'ungrouped' is a pseudo-topic: the stage opens the ungrouped pool directly.
  if (cmd.type === 'set_topic' && cmd.theme_id && cmd.theme_id !== 'ungrouped') {
    if (!(await count(db, 'SELECT count(*) AS n FROM themes WHERE id = ? AND sprint_id = ?', cmd.theme_id, ctx.sprint.id))) throw notFound('theme not found')
    await run(db, 'INSERT OR IGNORE INTO discussion_notes (theme_id, sprint_id, updated_at) VALUES (?,?,?)', cmd.theme_id, ctx.sprint.id, Date.now())
  }
  if (cmd.type === 'set_agenda' && Array.isArray(cmd.items)) {
    const valid = new Set((await all<{ id: string }>(db, 'SELECT id FROM themes WHERE sprint_id = ?', ctx.sprint.id)).map((t) => t.id))
    cmd.items = (cmd.items as { theme_id: string; reason?: string }[]).filter((i) => valid.has(String(i.theme_id)))
  }
  if (cmd.type === 'release_context') {
    const b = await one<{ b: number }>(db, 'SELECT COALESCE(MAX(released_batch),0)+1 AS b FROM context_additions WHERE sprint_id=?', ctx.sprint.id)
    await run(db, 'UPDATE context_additions SET released_batch=?, reveal_order=abs(random()) % 2147483647 WHERE sprint_id=? AND released_batch IS NULL', Number(b?.b ?? 1), ctx.sprint.id)
    await audit(db, ctx.sprint.workspace_id, ctx.sprint.id, ctx.auth.account.id, 'meeting.context_released')
    await hint(c.env, ctx.sprint.id, 'themes')
    await hint(c.env, ctx.sprint.id, 'meeting')
    return c.json(await snapshot(c.env, ctx))
  }
  if (cmd.type === 'mark_discussed') {
    // The theme must belong to this sprint: discussion_notes is keyed by theme id alone.
    if (!(await count(db, 'SELECT count(*) AS n FROM themes WHERE id = ? AND sprint_id = ?', String(cmd.theme_id), ctx.sprint.id))) throw notFound('theme not found')
    await run(db, 'INSERT INTO discussion_notes (theme_id, sprint_id, discussed, updated_at) VALUES (?,?,?,?) ON CONFLICT(theme_id) DO UPDATE SET discussed=excluded.discussed, updated_at=excluded.updated_at', String(cmd.theme_id), ctx.sprint.id, cmd.discussed ? 1 : 0, Date.now())
    await hint(c.env, ctx.sprint.id, 'meeting')
    await hint(c.env, ctx.sprint.id, 'themes')
    return c.json(await snapshot(c.env, ctx))
  }
  const people = partList(await participants(db, ctx.sprint.id))
  const { status, body: out } = await roomCall<{ error?: string; code?: string; action?: string }>(room(c.env, ctx.sprint.id), '/command', {
    account: ctx.auth.account.id,
    expected_version: Number(body.expected_version),
    command: cmd,
    participants: people,
    include_facilitator: bool(ctx.sprint.include_facilitator_in_rotation),
  })
  if (status !== 200) return c.json({ error: out.error ?? 'command failed', code: out.code ?? 'conflict' }, status as 400 | 409)
  await audit(db, ctx.sprint.workspace_id, ctx.sprint.id, ctx.auth.account.id, out.action ?? 'meeting.command')
  return c.json(await snapshot(c.env, ctx))
})

async function attendance(env: HonoEnv['Bindings'], ctx: SprintCtx, target: string, present?: boolean, ready?: boolean) {
  const people = await participants(env.DB, ctx.sprint.id)
  if (!people.some((p) => p.account_id === target)) throw notFound('participant not found')
  const { status, body } = await roomCall<{ error?: string }>(room(env, ctx.sprint.id), '/attendance', { target, present, ready, participants: partList(people), include_facilitator: bool(ctx.sprint.include_facilitator_in_rotation) })
  if (status !== 200) throw notFound(body.error ?? 'the retro hasn’t started yet')
}

meeting.post('/api/sprints/:sprintId/meeting/attendance', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireParticipant(ctx)
  const body = (await c.req.json().catch(() => ({}))) as { present?: boolean; ready?: boolean }
  await attendance(c.env, ctx, ctx.auth.account.id, typeof body.present === 'boolean' ? body.present : undefined, typeof body.ready === 'boolean' ? body.ready : undefined)
  return c.json(await snapshot(c.env, ctx))
})

/** The facilitator sets presence, never someone's readiness. */
meeting.post('/api/sprints/:sprintId/meeting/attendance/:accountId', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireFacilitator(ctx)
  const body = (await c.req.json().catch(() => ({}))) as { present?: boolean }
  await attendance(c.env, ctx, c.req.param('accountId'), typeof body.present === 'boolean' ? body.present : undefined, undefined)
  return c.json(await snapshot(c.env, ctx))
})

meeting.post('/api/sprints/:sprintId/meeting/pass', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireParticipant(ctx)
  const people = await participants(c.env.DB, ctx.sprint.id)
  const { status, body } = await roomCall<{ error?: string }>(room(c.env, ctx.sprint.id), '/pass', { account: ctx.auth.account.id, participants: partList(people), include_facilitator: bool(ctx.sprint.include_facilitator_in_rotation) })
  if (status !== 200) throw notFound(body.error ?? 'the retro hasn’t started yet')
  return c.json(await snapshot(c.env, ctx))
})

/** Anonymous context during the meeting; released in batches by the facilitator. */
meeting.post('/api/sprints/:sprintId/meeting/context', async (c) => {
  const cfg = config(c.env)
  const ctx = await requireSprint(c, cfg, c.env.DB, c.req.param('sprintId'))
  requireParticipant(ctx)
  if (ctx.sprint.status !== 'live') throw conflict('context can be added while the retro is live')
  const body = (await c.req.json().catch(() => ({}))) as { theme_id?: string; body?: string; idempotency_key?: string }
  const text = nonempty(body.body, cfg.entryMaxChars, 'The note')
  const themeId = String(body.theme_id ?? '')
  if (!(await count(c.env.DB, 'SELECT count(*) AS n FROM themes WHERE id = ? AND sprint_id = ?', themeId, ctx.sprint.id))) throw notFound('theme not found')
  const key = typeof body.idempotency_key === 'string' && body.idempotency_key.trim() && body.idempotency_key.length <= 64 ? body.idempotency_key.trim() : null
  await run(c.env.DB, 'INSERT OR IGNORE INTO context_additions (id, sprint_id, theme_id, author_account_id, body, idempotency_key, created_at) VALUES (?,?,?,?,?,?,?)', uuid(), ctx.sprint.id, themeId, ctx.auth.account.id, text, key, Date.now())
  // A bare "meeting changed" hint: only the facilitator's snapshot carries "something is waiting".
  await hint(c.env, ctx.sprint.id, 'meeting')
  return c.json(await snapshot(c.env, ctx))
})

/** The facilitator's shared takeaway and notes for a theme. */
meeting.put('/api/sprints/:sprintId/meeting/notes/:themeId', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireFacilitator(ctx)
  const tid = c.req.param('themeId')
  if (!(await count(c.env.DB, 'SELECT count(*) AS n FROM themes WHERE id = ? AND sprint_id = ?', tid, ctx.sprint.id))) throw notFound('theme not found')
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const f = (k: string) => optional(body[k], 4000, k)
  await run(
    c.env.DB,
    `INSERT INTO discussion_notes (theme_id, sprint_id, takeaway, what_happened, impact, could_try, notes, updated_at) VALUES (?,?,COALESCE(?,''),COALESCE(?,''),COALESCE(?,''),COALESCE(?,''),COALESCE(?,''),?)
     ON CONFLICT(theme_id) DO UPDATE SET takeaway=COALESCE(?, takeaway), what_happened=COALESCE(?, what_happened), impact=COALESCE(?, impact), could_try=COALESCE(?, could_try), notes=COALESCE(?, notes), updated_at=?`,
    tid, ctx.sprint.id, f('takeaway'), f('what_happened'), f('impact'), f('could_try'), f('notes'), Date.now(),
    body.takeaway === undefined ? null : f('takeaway') ?? '', body.what_happened === undefined ? null : f('what_happened') ?? '', body.impact === undefined ? null : f('impact') ?? '', body.could_try === undefined ? null : f('could_try') ?? '', body.notes === undefined ? null : f('notes') ?? '', Date.now(),
  )
  await hint(c.env, ctx.sprint.id, 'meeting')
  await hint(c.env, ctx.sprint.id, 'themes')
  return c.json(await snapshot(c.env, ctx))
})
