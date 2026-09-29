/**
 * The stage as the caller may see it. The room object owns live state; this
 * module composes it with D1 content the recipient is allowed to see. The
 * same sanitized shape serves participants, facilitator and presenter.
 */
import { Hono } from 'hono'
import { isAvatarId } from '../lib/avatars'
import { content, isEncrypted } from '../lib/sealed'
import type { HonoEnv } from '../env'
import { config } from '../lib/config'
import { checkSocketOrigin, requireFacilitator, requireParticipant, requireSprint, type SprintCtx } from '../lib/auth'
import { uuid } from '../lib/crypto'
import { all, audit, bool, count, one, run } from '../lib/db'
import { bad, conflict, notFound } from '../lib/errors'
import { hint, room, roomCall, roomSocketHeaders } from '../lib/live'
import { isObject, jsonBody } from '../lib/util'
import type { AgendaItem, RoomState } from '../room'
import { PHASES } from '../room'
import { ensureRoom } from './sprints'
import { closeRound, openRound } from './voting'

export const meeting = new Hono<HonoEnv>()

async function participants(db: D1Database, sprintId: string) {
  return all<{ account_id: string; display_name: string; avatar_id: string | null; is_facilitator: number }>(db, 'SELECT a.id AS account_id, a.display_name, a.avatar_id, sp.is_facilitator FROM sprint_participants sp JOIN accounts a ON a.id = sp.account_id WHERE sp.sprint_id = ? ORDER BY sp.is_facilitator DESC, a.display_name', sprintId)
}

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
  const notes = m.current_theme_id && m.current_theme_id !== 'ungrouped' ? await one<{ takeaway: string; what_happened: string; impact: string; could_try: string; notes: string; discussed: number }>(db, 'SELECT takeaway, what_happened, impact, could_try, notes, discussed FROM discussion_notes WHERE theme_id = ?', m.current_theme_id) : null
  const discussed = await all<{ theme_id: string }>(db, 'SELECT theme_id FROM discussion_notes WHERE sprint_id = ? AND discussed = 1', ctx.sprint.id)
  const unreleased = ctx.isFacilitator ? (await count(db, 'SELECT count(*) AS n FROM context_additions WHERE sprint_id = ? AND released_batch IS NULL', ctx.sprint.id)) > 0 : null
  const mine = await all<{ id: string; theme_id: string | null; body: string; kind: string | null; released_batch: number | null }>(db, 'SELECT id, theme_id, body, kind, released_batch FROM context_additions WHERE sprint_id = ? AND author_account_id = ? ORDER BY created_at LIMIT 100', ctx.sprint.id, me)
  const controller = m.controller_account_id ? people.find((p) => p.account_id === m.controller_account_id) : null
  // Choosing needs something to choose between: without themes the retro goes from looking back to talking.
  const themed = (await count(db, 'SELECT count(*) AS n FROM themes WHERE sprint_id = ? AND parked = 0', ctx.sprint.id)) > 0
  return {
    session_id: `${ctx.sprint.id}:${m.started_at}`,
    version: m.version,
    phase: m.phase,
    phases: PHASES.filter((p) => themed || p !== 'choose'),
    plan: m.plan,
    current_theme_id: m.current_theme_id,
    agenda: m.agenda,
    timer,
    server_time: new Date(now).toISOString(),
    controller_name: controller?.display_name ?? null,
    you_control: m.controller_account_id === me,
    controller_stale: !m.controller_account_id || !rs.connected.includes(m.controller_account_id),
    opening_question: ctx.sprint.opening_question,
    attendance: people.map((p) => ({
      account_id: p.account_id,
      display_name: p.display_name,
      // A character travels with its person's name, as a face in the room — never with anything anonymous.
      avatar_id: isAvatarId(p.avatar_id) ? p.avatar_id : null,
      present: rs.attendance[p.account_id]?.present ?? false,
      connected: rs.connected.includes(p.account_id),
      is_facilitator: bool(p.is_facilitator),
      is_you: p.account_id === me,
    })),
    notes: notes ? { takeaway: notes.takeaway, what_happened: notes.what_happened, impact: notes.impact, could_try: notes.could_try, notes: notes.notes, discussed: bool(notes.discussed) } : { takeaway: '', what_happened: '', impact: '', could_try: '', notes: '', discussed: false },
    discussed_theme_ids: discussed.map((d) => d.theme_id),
    has_unreleased_context: unreleased,
    my_context: mine.map((x) => ({ id: x.id, theme_id: x.theme_id, body: x.body, kind: x.kind, released: x.released_batch !== null })),
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

type CommandBody = { type?: string; theme_id?: string | null; discussed?: boolean; phase?: string; items?: unknown; agenda?: unknown; topic?: string | null; secs?: unknown; delta_secs?: unknown; plan?: unknown }
const seconds = (v: unknown) => typeof v === 'number' && Number.isFinite(v)

/**
 * A command as the room may receive it: an object whose fields have the types the room relies on.
 * Anything else is a 400 here, before the room or D1 sees it.
 */
function commandOf(raw: unknown, encrypted: boolean): CommandBody {
  if (!isObject(raw) || typeof raw.type !== 'string') throw bad('a command needs a type')
  const cmd = { ...raw } as CommandBody
  if (cmd.theme_id !== undefined && cmd.theme_id !== null && typeof cmd.theme_id !== 'string') throw bad('theme_id must be an id')
  if (cmd.type === 'set_phase' && !(PHASES as readonly string[]).includes(String(cmd.phase))) throw bad('unknown phase')
  if (cmd.type === 'timer_start' && !seconds(cmd.secs)) throw bad('secs must be a number of seconds')
  if (cmd.type === 'timer_adjust' && !seconds(cmd.delta_secs)) throw bad('delta_secs must be a number of seconds')
  if (cmd.type === 'set_agenda') {
    if (!Array.isArray(cmd.items) || !cmd.items.every((i) => isObject(i) && typeof i.theme_id === 'string')) throw bad('items must be a list of themes')
    // A reason is shown to everyone, so it's content: sealed in encrypted sprints.
    cmd.items = cmd.items.map((i: Record<string, unknown>) => ({ theme_id: i.theme_id as string, reason: content(encrypted, i.reason, 200, 'The reason', false) }))
  }
  return cmd
}

/** Facilitator commands applied by the room only if `expected_version` matches. Content-side effects (context release, discussed flags) live here in D1. */
meeting.post('/api/sprints/:sprintId/meeting/command', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireFacilitator(ctx)
  if (ctx.sprint.status !== 'live') throw conflict('the retro isn’t live')
  const body = await jsonBody<{ expected_version?: number; command?: unknown }>(c)
  const cmd = commandOf(body.command, isEncrypted(ctx.sprint))
  const db = c.env.DB
  // 'ungrouped' is a pseudo-topic: the stage opens the ungrouped pool directly.
  // A topic the room opens counts as discussed: there's no separate "mark as discussed" to remember.
  const opened = async (themeId: string) => {
    await run(db, 'INSERT INTO discussion_notes (theme_id, sprint_id, discussed, updated_at) VALUES (?,?,1,?) ON CONFLICT(theme_id) DO UPDATE SET discussed=1, updated_at=excluded.updated_at', themeId, ctx.sprint.id, Date.now())
    await hint(c.env, ctx.sprint.id, 'themes')
  }
  if (cmd.type === 'set_topic' && cmd.theme_id && cmd.theme_id !== 'ungrouped') {
    if (!(await count(db, 'SELECT count(*) AS n FROM themes WHERE id = ? AND sprint_id = ?', cmd.theme_id, ctx.sprint.id))) throw notFound('theme not found')
    await opened(cmd.theme_id)
  }
  // Steps carry their own housekeeping. Choosing opens the vote (once: coming back shows the result);
  // leaving it closes the vote, which orders the themes; talking follows that order, from the top.
  delete cmd.agenda
  delete cmd.topic
  if (cmd.type === 'set_phase') {
    const themed = await count(db, 'SELECT count(*) AS n FROM themes WHERE sprint_id = ? AND parked = 0', ctx.sprint.id)
    if (cmd.phase === 'choose' && themed && !(await count(db, "SELECT count(*) AS n FROM vote_rounds WHERE sprint_id = ? AND status IN ('open', 'closed')", ctx.sprint.id))) {
      if (await openRound(db, ctx.sprint.id, ctx.sprint.vote_budget)) {
        await audit(db, ctx.sprint.workspace_id, ctx.sprint.id, ctx.auth.account.id, 'votes.round_opened', { budget: ctx.sprint.vote_budget })
        await hint(c.env, ctx.sprint.id, 'votes')
      }
    }
    if (cmd.phase === 'talk' || cmd.phase === 'agree') {
      if (await closeRound(db, ctx.sprint.id, 'closed')) {
        await audit(db, ctx.sprint.workspace_id, ctx.sprint.id, ctx.auth.account.id, 'votes.round_closed', { status: 'closed' })
        await hint(c.env, ctx.sprint.id, 'votes')
        await hint(c.env, ctx.sprint.id, 'themes')
      }
    }
    if (cmd.phase === 'talk') {
      const order = await all<{ id: string }>(db, 'SELECT id FROM themes WHERE sprint_id = ? AND parked = 0 ORDER BY position, created_at', ctx.sprint.id)
      const loose = await count(db, 'SELECT count(*) AS n FROM entries e LEFT JOIN theme_entries te ON te.entry_id = e.id WHERE e.sprint_id = ? AND te.theme_id IS NULL', ctx.sprint.id)
      cmd.agenda = order.map((t) => ({ theme_id: t.id }))
      cmd.topic = order[0]?.id ?? (loose ? 'ungrouped' : null)
      if (order[0]) await opened(order[0].id)
    }
  }
  if (cmd.type === 'set_agenda') {
    const valid = new Set((await all<{ id: string }>(db, 'SELECT id FROM themes WHERE sprint_id = ?', ctx.sprint.id)).map((t) => t.id))
    cmd.items = (cmd.items as AgendaItem[]).filter((i) => valid.has(i.theme_id))
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
  const { status, body: out } = await roomCall<{ error?: string; code?: string; action?: string }>(room(c.env, ctx.sprint.id), '/command', {
    account: ctx.auth.account.id,
    expected_version: Number(body.expected_version),
    command: cmd,
  })
  if (status !== 200) return c.json({ error: out.error ?? 'command failed', code: out.code ?? 'conflict' }, status as 400 | 409)
  await audit(db, ctx.sprint.workspace_id, ctx.sprint.id, ctx.auth.account.id, out.action ?? 'meeting.command')
  return c.json(await snapshot(c.env, ctx))
})

async function attendance(env: HonoEnv['Bindings'], ctx: SprintCtx, target: string, present?: boolean) {
  const people = await participants(env.DB, ctx.sprint.id)
  if (!people.some((p) => p.account_id === target)) throw notFound('participant not found')
  const { status, body } = await roomCall<{ error?: string }>(room(env, ctx.sprint.id), '/attendance', { target, present })
  if (status !== 200) throw notFound(body.error ?? 'the retro hasn’t started yet')
}

meeting.post('/api/sprints/:sprintId/meeting/attendance', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireParticipant(ctx)
  const body = await jsonBody<{ present?: boolean }>(c)
  await attendance(c.env, ctx, ctx.auth.account.id, typeof body.present === 'boolean' ? body.present : undefined)
  return c.json(await snapshot(c.env, ctx))
})

/** The facilitator can correct who's here. */
meeting.post('/api/sprints/:sprintId/meeting/attendance/:accountId', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireFacilitator(ctx)
  const body = await jsonBody<{ present?: boolean }>(c)
  await attendance(c.env, ctx, c.req.param('accountId'), typeof body.present === 'boolean' ? body.present : undefined)
  return c.json(await snapshot(c.env, ctx))
})

/**
 * Something added to the topic in hand, without a name: an example, another view, a question (the
 * kind is optional). It waits, unseen, until the facilitator shares what's waiting; the facilitator
 * learns only that something waits. Shared additions come out together, in a drawn order.
 */
meeting.post('/api/sprints/:sprintId/meeting/context', async (c) => {
  const cfg = config(c.env)
  const ctx = await requireSprint(c, cfg, c.env.DB, c.req.param('sprintId'))
  requireParticipant(ctx)
  if (ctx.sprint.status !== 'live') throw conflict('context can be added while the retro is live')
  const body = await jsonBody<{ theme_id?: string; body?: string; kind?: string; idempotency_key?: string }>(c)
  const kind = body.kind === undefined || body.kind === null || body.kind === '' ? null : ['example', 'view', 'question'].includes(String(body.kind)) ? String(body.kind) : null
  if (body.kind && !kind) throw bad('kind must be example, view or question')
  const text = content(isEncrypted(ctx.sprint), body.body, cfg.entryMaxChars, 'The note', true)!
  const themeId = String(body.theme_id ?? '')
  if (!(await count(c.env.DB, 'SELECT count(*) AS n FROM themes WHERE id = ? AND sprint_id = ?', themeId, ctx.sprint.id))) throw notFound('theme not found')
  const key = typeof body.idempotency_key === 'string' && body.idempotency_key.trim() && body.idempotency_key.length <= 64 ? body.idempotency_key.trim() : null
  await run(c.env.DB, 'INSERT OR IGNORE INTO context_additions (id, sprint_id, theme_id, author_account_id, body, kind, idempotency_key, created_at) VALUES (?,?,?,?,?,?,?,?)', uuid(), ctx.sprint.id, themeId, ctx.auth.account.id, text, kind, key, Date.now())
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
  const body = await jsonBody<Record<string, unknown>>(c)
  const f = (k: string) => content(isEncrypted(ctx.sprint), body[k], 4000, k, false)
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
