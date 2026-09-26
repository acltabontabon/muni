/**
 * MeetingRoom — one Durable Object per sprint.
 *
 * Authoritative for live meeting coordination only: phase, current topic,
 * timer deadline, controller, attendance, speaking round, version. Everything
 * with content (entries, themes, notes, votes, experiments) lives in D1 and is
 * composed into snapshots by the Worker. Sockets carry hints — a resource
 * name and a version — never content, so nothing a recipient may not see can
 * be broadcast. State is persisted before any hint is sent. Sockets use the
 * Hibernation API: the object sleeps between events and restores attachments.
 */
import { shuffle } from './lib/crypto'

export const PHASES = ['arrive', 'remember', 'discover', 'discuss', 'decide', 'leave'] as const
export type Phase = (typeof PHASES)[number]

export interface AgendaItem {
  theme_id: string
  reason: string | null
}
export interface MeetingState {
  sprint_id: string
  version: number
  phase: Phase
  current_theme_id: string | null
  agenda: AgendaItem[]
  plan: Record<string, number>
  timer_ends_at: number | null
  timer_remaining_secs: number | null
  timer_total_secs: number | null
  quiet_reading: boolean
  controller_account_id: string | null
  controller_seen_at: number | null
  started_at: number
  ended_at: number | null
  cancelled: boolean
}
export interface Attendance {
  present: boolean
  ready: boolean
  updated_at: number
}
export interface Speaking {
  id: string
  ordering: string[]
  cursor: number
  current_account_id: string | null
  status: 'active' | 'exhausted' | 'ended'
}
export interface Participant {
  account_id: string
  is_facilitator: boolean
}
export interface RoomState {
  meeting: MeetingState | null
  attendance: Record<string, Attendance>
  speaking: Speaking | null
  connected: string[]
}

export type Command =
  | { type: 'set_phase'; phase: string }
  | { type: 'set_topic'; theme_id: string | null }
  | { type: 'set_agenda'; items: AgendaItem[] }
  | { type: 'set_plan'; plan: Record<string, number> }
  | { type: 'timer_start'; secs: number }
  | { type: 'timer_pause' }
  | { type: 'timer_resume' }
  | { type: 'timer_adjust'; delta_secs: number }
  | { type: 'timer_clear' }
  | { type: 'take_control' }
  | { type: 'speaking_start' }
  | { type: 'speaking_next' }
  | { type: 'speaking_open_floor' }
  | { type: 'speaking_end' }
  | { type: 'quiet_reading'; secs: number }

interface Attachment {
  a: string // account id
  f: boolean // facilitator
}

export function defaultPlan(totalMin: number): Record<string, number> {
  const f = totalMin / 45
  const m = (x: number) => Math.max(1, Math.round(x * f))
  return { arrive: m(2), remember: m(7), discover: m(5), discuss: m(24), decide: m(5), leave: m(2) }
}

export class MeetingRoom implements DurableObject {
  constructor(
    private ctx: DurableObjectState,
    private env: unknown,
  ) {
    void this.env
    // Keepalive pings are answered without waking the object.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  // ---------- storage ----------
  private async meeting(): Promise<MeetingState | null> {
    return (await this.ctx.storage.get<MeetingState>('meeting')) ?? null
  }
  private async attendance(): Promise<Record<string, Attendance>> {
    return (await this.ctx.storage.get<Record<string, Attendance>>('attendance')) ?? {}
  }
  private async speaking(): Promise<Speaking | null> {
    return (await this.ctx.storage.get<Speaking>('speaking')) ?? null
  }

  private connectedAccounts(): string[] {
    const ids = new Set<string>()
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null
      if (att?.a) ids.add(att.a)
    }
    return [...ids]
  }

  private broadcast(msg: Record<string, unknown>) {
    const data = JSON.stringify(msg)
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(data)
      } catch {
        /* closed */
      }
    }
  }

  private async state(): Promise<RoomState> {
    return { meeting: await this.meeting(), attendance: await this.attendance(), speaking: await this.speaking(), connected: this.connectedAccounts() }
  }

  // ---------- HTTP (internal, only reachable through the Worker binding) ----------
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname
    if (path === "/ws") return this.openSocket(req)
    const body = req.method === 'POST' ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : {}
    switch (path) {
      case '/state':
        return Response.json(await this.state())
      case '/start':
        return this.start(body)
      case '/end':
        return this.finish(false)
      case '/cancel':
        return this.finish(true)
      case '/command':
        return this.command(body)
      case '/attendance':
        return this.setAttendance(body)
      case '/pass':
        return this.pass(body)
      case '/hint': {
        const m = await this.meeting()
        this.broadcast({ type: 'hint', resource: String(body.resource ?? 'all'), version: m?.version ?? 0 })
        return Response.json({ ok: true })
      }
      case '/revoke': {
        const account = String(body.account_id ?? '')
        for (const ws of this.ctx.getWebSockets()) {
          const att = ws.deserializeAttachment() as Attachment | null
          if (att?.a === account) {
            try {
              ws.send(JSON.stringify({ type: 'revoked' }))
              ws.close(4003, 'revoked')
            } catch {
              /* already closed */
            }
          }
        }
        return Response.json({ ok: true })
      }
      default:
        return new Response('not found', { status: 404 })
    }
  }

  private async openSocket(req: Request): Promise<Response> {
    if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('expected websocket', { status: 426 })
    const account = req.headers.get('x-muni-account') ?? ''
    const fac = req.headers.get('x-muni-fac') === '1'
    if (!account) return new Response('unauthorized', { status: 401 })
    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ a: account, f: fac } satisfies Attachment)
    const m = await this.meeting()
    server.send(JSON.stringify({ type: 'hello', version: m?.version ?? 0, server_time: Date.now() }))
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string') return
    let msg: { type?: string } = {}
    try {
      msg = JSON.parse(message)
    } catch {
      return
    }
    if (msg.type === 'resync') {
      const m = await this.meeting()
      ws.send(JSON.stringify({ type: 'hello', version: m?.version ?? 0, server_time: Date.now() }))
    }
  }

  async webSocketClose(ws: WebSocket) {
    try {
      ws.close()
    } catch {
      /* already closed */
    }
  }
  async webSocketError(ws: WebSocket) {
    try {
      ws.close()
    } catch {
      /* already closed */
    }
  }

  // ---------- lifecycle ----------
  private async start(body: Record<string, unknown>): Promise<Response> {
    const existing = await this.meeting()
    if (existing && !existing.ended_at && !existing.cancelled) return Response.json({ ok: true, version: existing.version, existed: true })
    const m: MeetingState = {
      sprint_id: String(body.sprint_id),
      version: 1,
      phase: 'arrive',
      current_theme_id: null,
      agenda: Array.isArray(body.agenda) ? (body.agenda as AgendaItem[]) : [],
      plan: (body.plan as Record<string, number>) ?? defaultPlan(45),
      timer_ends_at: null,
      timer_remaining_secs: null,
      timer_total_secs: null,
      quiet_reading: false,
      controller_account_id: typeof body.controller === 'string' ? body.controller : null,
      controller_seen_at: Date.now(),
      started_at: Date.now(),
      ended_at: null,
      cancelled: false,
    }
    await this.ctx.storage.put({ meeting: m, attendance: {}, speaking: null })
    this.broadcast({ type: 'hint', resource: 'meeting', version: m.version })
    return Response.json({ ok: true, version: m.version, existed: false })
  }

  private async finish(cancelled: boolean): Promise<Response> {
    const m = await this.meeting()
    if (!m) return Response.json({ ok: true })
    m.ended_at = m.ended_at ?? Date.now()
    m.cancelled = cancelled
    m.phase = cancelled ? m.phase : 'leave'
    m.timer_ends_at = null
    m.version += 1
    const sp = await this.speaking()
    if (sp) sp.status = 'ended'
    await this.ctx.storage.put({ meeting: m, speaking: sp })
    this.broadcast({ type: 'hint', resource: 'meeting', version: m.version })
    return Response.json({ ok: true })
  }

  // ---------- commands ----------
  private async command(body: Record<string, unknown>): Promise<Response> {
    const account = String(body.account ?? '')
    const expected = Number(body.expected_version)
    const cmd = body.command as Command
    const participants = (body.participants as Participant[]) ?? []
    const includeFac = !!body.include_facilitator
    const m = await this.meeting()
    if (!m || m.ended_at) return Response.json({ error: 'the retro isn’t live', code: 'conflict' }, { status: 409 })
    if (m.version !== expected) return Response.json({ error: 'the stage changed since you last saw it — it’s been refreshed, try again', code: 'conflict' }, { status: 409 })
    const connected = this.connectedAccounts()
    const controllerPresent = m.controller_account_id ? connected.includes(m.controller_account_id) : false
    if (m.controller_account_id && m.controller_account_id !== account && controllerPresent && cmd.type !== 'take_control') {
      return Response.json({ error: 'another facilitator is controlling the stage — take control explicitly to continue', code: 'conflict' }, { status: 409 })
    }
    const now = Date.now()
    let speaking = await this.speaking()
    let action = 'meeting.command'
    const clearQuiet = () => {
      m.quiet_reading = false
    }
    switch (cmd.type) {
      case 'take_control':
        action = 'meeting.control_taken'
        break
      case 'set_phase': {
        if (!(PHASES as readonly string[]).includes(cmd.phase)) return Response.json({ error: 'unknown phase', code: 'bad_request' }, { status: 400 })
        m.phase = cmd.phase as Phase
        const mins = m.plan[cmd.phase] ?? 5
        m.timer_ends_at = null
        m.timer_remaining_secs = mins * 60
        m.timer_total_secs = mins * 60
        clearQuiet()
        action = 'meeting.phase_changed'
        break
      }
      case 'set_topic': {
        m.current_theme_id = cmd.theme_id ?? null
        const topics = Math.min(3, Math.max(1, m.agenda.length))
        const per = Math.floor(((m.plan.discuss ?? 24) * 60) / topics)
        m.timer_ends_at = null
        m.timer_remaining_secs = per
        m.timer_total_secs = per
        clearQuiet()
        action = 'meeting.topic_changed'
        break
      }
      case 'set_agenda':
        m.agenda = (cmd.items ?? []).slice(0, 40).map((i) => ({ theme_id: String(i.theme_id), reason: i.reason ? String(i.reason).slice(0, 200) : null }))
        action = 'meeting.agenda_changed'
        break
      case 'set_plan': {
        const clean: Record<string, number> = {}
        for (const p of PHASES) {
          const v = Number(cmd.plan?.[p] ?? m.plan[p] ?? 5)
          clean[p] = Math.min(180, Math.max(1, Number.isFinite(v) ? Math.round(v) : 5))
        }
        m.plan = clean
        break
      }
      case 'timer_start': {
        const secs = Math.min(7200, Math.max(10, Math.round(cmd.secs)))
        m.timer_ends_at = now + secs * 1000
        m.timer_remaining_secs = null
        m.timer_total_secs = secs
        clearQuiet()
        break
      }
      case 'timer_pause':
        if (m.timer_ends_at) {
          m.timer_remaining_secs = Math.max(0, Math.round((m.timer_ends_at - now) / 1000))
          m.timer_ends_at = null
        }
        break
      case 'timer_resume':
        if (!m.timer_ends_at && (m.timer_remaining_secs ?? 0) > 0) {
          m.timer_ends_at = now + (m.timer_remaining_secs ?? 0) * 1000
          m.timer_remaining_secs = null
        }
        break
      case 'timer_adjust': {
        const delta = Math.min(3600, Math.max(-3600, Math.round(cmd.delta_secs)))
        if (m.timer_ends_at) m.timer_ends_at = Math.max(now, m.timer_ends_at + delta * 1000)
        else m.timer_remaining_secs = Math.max(0, (m.timer_remaining_secs ?? 0) + delta)
        m.timer_total_secs = Math.max(0, (m.timer_total_secs ?? 0) + delta)
        break
      }
      case 'timer_clear':
        m.timer_ends_at = null
        m.timer_remaining_secs = null
        m.timer_total_secs = null
        clearQuiet()
        break
      case 'quiet_reading': {
        const secs = Math.min(600, Math.max(15, Math.round(cmd.secs)))
        m.quiet_reading = true
        m.timer_ends_at = now + secs * 1000
        m.timer_remaining_secs = null
        m.timer_total_secs = secs
        action = 'meeting.quiet_reading'
        break
      }
      case 'speaking_start': {
        const eligible = shuffle(this.eligible(participants, await this.attendance(), includeFac))
        speaking = { id: crypto.randomUUID(), ordering: eligible, cursor: 0, current_account_id: eligible[0] ?? null, status: eligible.length ? 'active' : 'exhausted' }
        action = 'meeting.speaking_started'
        break
      }
      case 'speaking_next':
        if (!speaking || speaking.status !== 'active') return Response.json({ error: 'no speaking round is active', code: 'conflict' }, { status: 409 })
        speaking = this.advance(speaking, this.eligible(participants, await this.attendance(), includeFac))
        break
      case 'speaking_open_floor':
        if (speaking && speaking.status === 'active') speaking.current_account_id = null
        break
      case 'speaking_end':
        if (speaking) speaking.status = 'ended'
        break
      default:
        return Response.json({ error: 'unknown command', code: 'bad_request' }, { status: 400 })
    }
    m.version += 1
    m.controller_account_id = account
    m.controller_seen_at = now
    await this.ctx.storage.put({ meeting: m, speaking })
    this.broadcast({ type: 'hint', resource: 'meeting', version: m.version })
    return Response.json({ ok: true, version: m.version, action })
  }

  private eligible(participants: Participant[], attendance: Record<string, Attendance>, includeFac: boolean): string[] {
    return participants.filter((p) => (includeFac || !p.is_facilitator) && attendance[p.account_id]?.present && attendance[p.account_id]?.ready !== false).map((p) => p.account_id)
  }

  /** Skips people who left or passed; late arrivals are appended so nobody else's place changes. */
  private advance(sp: Speaking, eligible: string[]): Speaking {
    const order = [...sp.ordering]
    for (const id of shuffle(eligible.filter((e) => !order.includes(e)))) order.push(id)
    let next = sp.cursor + 1
    while (next < order.length && !eligible.includes(order[next])) next++
    if (next < order.length) return { ...sp, ordering: order, cursor: next, current_account_id: order[next] }
    return { ...sp, ordering: order, cursor: order.length, current_account_id: null, status: 'exhausted' }
  }

  private async setAttendance(body: Record<string, unknown>): Promise<Response> {
    const target = String(body.target ?? '')
    const participants = (body.participants as Participant[]) ?? []
    const includeFac = !!body.include_facilitator
    const m = await this.meeting()
    if (!m) return Response.json({ error: 'the retro hasn’t started yet', code: 'not_found' }, { status: 404 })
    const att = await this.attendance()
    const cur = att[target] ?? { present: false, ready: true, updated_at: 0 }
    if (typeof body.present === 'boolean') cur.present = body.present
    if (typeof body.ready === 'boolean') cur.ready = body.ready
    cur.updated_at = Date.now()
    att[target] = cur
    let speaking = await this.speaking()
    // If the current speaker just passed or left, respect it immediately.
    if ((body.ready === false || body.present === false) && speaking?.status === 'active' && speaking.current_account_id === target) {
      speaking = this.advance(speaking, this.eligible(participants, att, includeFac))
    }
    m.version += 1
    await this.ctx.storage.put({ meeting: m, attendance: att, speaking })
    this.broadcast({ type: 'hint', resource: 'meeting', version: m.version })
    return Response.json({ ok: true })
  }

  /** Passing is "not now": step out of the rotation until you choose Ready again. */
  private async pass(body: Record<string, unknown>): Promise<Response> {
    const account = String(body.account ?? '')
    const participants = (body.participants as Participant[]) ?? []
    const includeFac = !!body.include_facilitator
    const m = await this.meeting()
    if (!m) return Response.json({ error: 'the retro hasn’t started yet', code: 'not_found' }, { status: 404 })
    const att = await this.attendance()
    att[account] = { present: att[account]?.present ?? true, ready: false, updated_at: Date.now() }
    let speaking = await this.speaking()
    if (speaking?.status === 'active' && speaking.current_account_id === account) speaking = this.advance(speaking, this.eligible(participants, att, includeFac))
    m.version += 1
    await this.ctx.storage.put({ meeting: m, attendance: att, speaking })
    this.broadcast({ type: 'hint', resource: 'meeting', version: m.version })
    return Response.json({ ok: true })
  }
}
