/**
 * MeetingRoom — one Durable Object per sprint.
 *
 * Authoritative for live meeting coordination only: step, current topic,
 * timer deadline, controller, attendance, version. Everything
 * with content (entries, themes, notes, votes, experiments) lives in D1 and is
 * composed into snapshots by the Worker. Sockets carry hints — a resource
 * name and a version — never content, so nothing a recipient may not see can
 * be broadcast. State is persisted before any hint is sent. Sockets use the
 * Hibernation API: the object sleeps between events and restores attachments.
 */
/** The retro's four steps: did last time's experiments help, what matters most, talk it through, agree what to try. */
export const PHASES = ['look_back', 'choose', 'talk', 'agree'] as const
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
  controller_account_id: string | null
  controller_seen_at: number | null
  started_at: number
  ended_at: number | null
  cancelled: boolean
}
export interface Attendance {
  present: boolean
  updated_at: number
}
export interface RoomState {
  meeting: MeetingState | null
  attendance: Record<string, Attendance>
  connected: string[]
}

export type Command =
  | { type: 'set_phase'; phase: string; agenda?: AgendaItem[]; topic?: string | null }
  | { type: 'set_topic'; theme_id: string | null }
  | { type: 'set_agenda'; items: AgendaItem[] }
  | { type: 'set_plan'; plan: Record<string, number> }
  | { type: 'timer_start'; secs: number }
  | { type: 'timer_pause' }
  | { type: 'timer_resume' }
  | { type: 'timer_adjust'; delta_secs: number }
  | { type: 'timer_clear' }
  | { type: 'take_control' }

interface Attachment {
  a: string // account id
  f: boolean // facilitator
}

/** Minutes per step for a retro of `totalMin`. Only the talk is timed (per topic); the rest is a guide. */
export function defaultPlan(totalMin: number): Record<string, number> {
  const f = totalMin / 45
  const m = (x: number) => Math.max(1, Math.round(x * f))
  return { look_back: m(5), choose: m(5), talk: m(28), agree: m(7) }
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
    const m = (await this.ctx.storage.get<MeetingState>('meeting')) ?? null
    // A step this build doesn't know (it never should) starts the retro from the beginning.
    if (m && !(PHASES as readonly string[]).includes(m.phase)) m.phase = 'look_back'
    return m
  }
  private async attendance(): Promise<Record<string, Attendance>> {
    return (await this.ctx.storage.get<Record<string, Attendance>>('attendance')) ?? {}
  }

  private connectedAccounts(): string[] {
    const ids = new Set<string>()
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null
      if (att?.a) ids.add(att.a)
    }
    return [...ids]
  }

  /** To everyone connected, or only to the facilitator's sockets and/or some accounts' own. */
  private broadcast(msg: Record<string, unknown>, to?: { facilitators?: boolean; accounts?: string[] } | null) {
    const data = JSON.stringify(msg)
    for (const ws of this.ctx.getWebSockets()) {
      if (to) {
        const att = ws.deserializeAttachment() as Attachment | null
        if (!att || !((to.facilitators && att.f) || to.accounts?.includes(att.a))) continue
      }
      try {
        ws.send(data)
      } catch {
        /* closed */
      }
    }
  }

  private async state(): Promise<RoomState> {
    return { meeting: await this.meeting(), attendance: await this.attendance(), connected: this.connectedAccounts() }
  }

  // ---------- HTTP (internal, only reachable through the Worker binding) ----------
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname
    if (path === "/ws") return this.openSocket(req)
    const raw = req.method === 'POST' ? await req.json().catch(() => null) : null
    const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
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
      case '/hint': {
        const m = await this.meeting()
        this.broadcast({ type: 'hint', resource: String(body.resource ?? 'all'), version: m?.version ?? 0 }, body.to as { facilitators?: boolean; accounts?: string[] } | undefined)
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
    const arriving = !this.connectedAccounts().includes(account)
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ a: account, f: fac } satisfies Attachment)
    const m = await this.meeting()
    server.send(JSON.stringify({ type: 'hello', version: m?.version ?? 0, server_time: Date.now() }))
    // The facilitator sees who's connected right now; only a first connection changes that.
    if (arriving && m) this.broadcast({ type: 'hint', resource: 'meeting', version: m.version }, { facilitators: true })
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
    await this.leaving(ws)
  }

  /** Someone's last connection closed: the facilitator's list of who's connected changes. */
  private async leaving(ws: WebSocket) {
    const att = ws.deserializeAttachment() as Attachment | null
    if (!att?.a) return
    const still = this.ctx.getWebSockets().some((o) => o !== ws && (o.deserializeAttachment() as Attachment | null)?.a === att.a)
    const m = await this.meeting()
    if (!still && m) this.broadcast({ type: 'hint', resource: 'meeting', version: m.version }, { facilitators: true })
  }
  async webSocketError(ws: WebSocket) {
    try {
      ws.close()
    } catch {
      /* already closed */
    }
    await this.leaving(ws)
  }

  // ---------- lifecycle ----------
  private async start(body: Record<string, unknown>): Promise<Response> {
    const existing = await this.meeting()
    if (existing && !existing.ended_at && !existing.cancelled) return Response.json({ ok: true, version: existing.version, existed: true })
    const m: MeetingState = {
      sprint_id: String(body.sprint_id),
      version: 1,
      phase: 'look_back',
      current_theme_id: null,
      agenda: Array.isArray(body.agenda) ? (body.agenda as AgendaItem[]) : [],
      plan: (body.plan as Record<string, number>) ?? defaultPlan(45),
      timer_ends_at: null,
      timer_remaining_secs: null,
      timer_total_secs: null,
      controller_account_id: typeof body.controller === 'string' ? body.controller : null,
      controller_seen_at: Date.now(),
      started_at: Date.now(),
      ended_at: null,
      cancelled: false,
    }
    await this.ctx.storage.put({ meeting: m, attendance: {} })
    this.broadcast({ type: 'hint', resource: 'meeting', version: m.version })
    return Response.json({ ok: true, version: m.version, existed: false })
  }

  private async finish(cancelled: boolean): Promise<Response> {
    const m = await this.meeting()
    if (!m) return Response.json({ ok: true })
    m.ended_at = m.ended_at ?? Date.now()
    m.cancelled = cancelled
    m.phase = cancelled ? m.phase : 'agree'
    m.timer_ends_at = null
    m.version += 1
    await this.ctx.storage.put({ meeting: m })
    this.broadcast({ type: 'hint', resource: 'meeting', version: m.version })
    return Response.json({ ok: true })
  }

  // ---------- commands ----------
  private async command(body: Record<string, unknown>): Promise<Response> {
    const account = String(body.account ?? '')
    const expected = Number(body.expected_version)
    const cmd = (body.command && typeof body.command === 'object' ? body.command : {}) as Command
    const m = await this.meeting()
    if (!m || m.ended_at) return Response.json({ error: 'the retro isn’t live', code: 'conflict' }, { status: 409 })
    if (m.version !== expected) return Response.json({ error: 'the stage changed since you last saw it — it’s been refreshed, try again', code: 'conflict' }, { status: 409 })
    const connected = this.connectedAccounts()
    const controllerPresent = m.controller_account_id ? connected.includes(m.controller_account_id) : false
    if (m.controller_account_id && m.controller_account_id !== account && controllerPresent && cmd.type !== 'take_control') {
      return Response.json({ error: 'another facilitator is controlling the stage — take control explicitly to continue', code: 'conflict' }, { status: 409 })
    }
    // The Worker validates commands; this keeps a malformed one from ever reaching the stored state.
    const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
    if ((cmd.type === 'set_agenda' && !Array.isArray(cmd.items)) || (cmd.type === 'timer_start' && !finite(cmd.secs)) || (cmd.type === 'timer_adjust' && !finite(cmd.delta_secs)))
      return Response.json({ error: 'that command is malformed', code: 'bad_request' }, { status: 400 })
    const now = Date.now()
    let action = 'meeting.command'
    /** A topic's timebox: the talk's minutes shared across the first three topics, running from the moment it opens. Guidance, not a cut-off. */
    const openTopic = (id: string | null) => {
      m.current_theme_id = id
      const per = Math.floor(((m.plan.talk ?? 28) * 60) / Math.min(3, Math.max(1, m.agenda.length)))
      m.timer_ends_at = id ? now + per * 1000 : null
      m.timer_remaining_secs = null
      m.timer_total_secs = id ? per : null
    }
    switch (cmd.type) {
      case 'take_control':
        action = 'meeting.control_taken'
        break
      case 'set_phase': {
        if (!(PHASES as readonly string[]).includes(cmd.phase)) return Response.json({ error: 'unknown phase', code: 'bad_request' }, { status: 400 })
        m.phase = cmd.phase as Phase
        if (Array.isArray(cmd.agenda)) m.agenda = cmd.agenda.slice(0, 40).map((i) => ({ theme_id: String(i.theme_id), reason: null }))
        // Only the talk keeps a clock: arriving there opens its first topic (when one is given), anywhere else the clock stops.
        if (m.phase === 'talk' && cmd.topic !== undefined && !m.current_theme_id) openTopic(cmd.topic)
        else if (m.phase !== 'talk') {
          m.timer_ends_at = null
          m.timer_remaining_secs = null
          m.timer_total_secs = null
        }
        action = 'meeting.phase_changed'
        break
      }
      case 'set_topic': {
        openTopic(cmd.theme_id ?? null)
        action = 'meeting.topic_changed'
        break
      }
      case 'set_agenda':
        m.agenda = cmd.items.slice(0, 40).map((i) => ({ theme_id: String(i?.theme_id), reason: typeof i?.reason === 'string' && i.reason ? i.reason.slice(0, 12_000) : null /* opaque: an envelope in encrypted sprints */ }))
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
        break
      default:
        return Response.json({ error: 'unknown command', code: 'bad_request' }, { status: 400 })
    }
    m.version += 1
    m.controller_account_id = account
    m.controller_seen_at = now
    await this.ctx.storage.put({ meeting: m })
    this.broadcast({ type: 'hint', resource: 'meeting', version: m.version })
    return Response.json({ ok: true, version: m.version, action })
  }

  private async setAttendance(body: Record<string, unknown>): Promise<Response> {
    const target = String(body.target ?? '')
    const m = await this.meeting()
    if (!m) return Response.json({ error: 'the retro hasn’t started yet', code: 'not_found' }, { status: 404 })
    const att = await this.attendance()
    const cur = att[target] ?? { present: false, updated_at: 0 }
    if (typeof body.present === 'boolean') cur.present = body.present
    cur.updated_at = Date.now()
    att[target] = { present: cur.present, updated_at: cur.updated_at }
    // Presence isn't a command: someone arriving mustn't make the facilitator's next click a conflict.
    // Everyone still hears about it; the version that guards commands stays as it was.
    await this.ctx.storage.put({ attendance: att })
    this.broadcast({ type: 'hint', resource: 'meeting', version: m.version })
    return Response.json({ ok: true })
  }
}
