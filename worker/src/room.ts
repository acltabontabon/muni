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
  /**
   * The topic's clock as it was when the room left the talk: coming back to the same topic brings it
   * back, paused, instead of leaving the topic with no clock to pause or extend.
   */
  parked_clock?: { theme_id: string; remaining_secs: number; total_secs: number } | null
  controller_account_id: string | null
  controller_seen_at: number | null
  started_at: number
  ended_at: number | null
  cancelled: boolean
  /** The retro this is in D1 (sprints.session_started_at). Once ended or cancelled, it stays so. */
  session?: number | null
  /** A command holding the stage while the Worker makes its changes in D1 (see `claim`). */
  claim?: { token: string; until: number } | null
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
  f: boolean // facilitator (rewritten in place when facilitation is handed over)
}
type Audience = { facilitators?: boolean; accounts?: string[] }

/** How long a claimed command may hold the stage while its D1 changes are made. */
const CLAIM_MS = 15_000

/** Minutes per step for a retro of `totalMin`. Only the talk is timed (per topic); the rest is a guide. */
export function defaultPlan(totalMin: number): Record<string, number> {
  const f = totalMin / 45
  const m = (x: number) => Math.max(1, Math.round(x * f))
  return { look_back: m(5), choose: m(5), talk: m(28), agree: m(7) }
}

const refused = (status: number, code: string, error: string) => Response.json({ error, code }, { status })

/** The latest handover heard of, for a socket whose request read who facilitates before it. */
interface Handover {
  account: string
  at: number
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

  /** Kept in storage, not memory: a room evicted between a handover and a late reconnect still knows of it. */
  private async lastHandover(): Promise<Handover | null> {
    return (await this.ctx.storage.get<Handover>('handover')) ?? null
  }

  private connectedAccounts(): string[] {
    const ids = new Set<string>()
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null
      if (att?.a) ids.add(att.a)
    }
    return [...ids]
  }

  /** Whether `account` is connected as a facilitator (a handover rewrites this on open sockets). */
  private facilitatorConnected(account: string): boolean {
    return this.ctx.getWebSockets().some((ws) => {
      const att = ws.deserializeAttachment() as Attachment | null
      return att?.a === account && att.f
    })
  }

  /** To everyone connected, or only to the facilitator's sockets and/or some accounts' own. */
  private broadcast(msg: Record<string, unknown>, to?: Audience | null) {
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
        return this.finish(false, body)
      case '/cancel':
        return this.finish(true, body)
      case '/claim':
        return this.claim(body)
      case '/release':
        return this.release(body)
      case '/command':
        return this.command(body)
      case '/attendance':
        return this.setAttendance(body)
      case '/facilitator':
        return this.setFacilitator(body)
      case '/hint': {
        const m = await this.meeting()
        const resources = Array.isArray(body.resources) ? body.resources.map(String) : [String(body.resource ?? 'all')]
        for (const resource of resources) this.broadcast({ type: 'hint', resource, version: m?.version ?? 0 }, body.to as Audience | undefined)
        return Response.json({ ok: true })
      }
      case '/revoke':
        return this.revoke(String(body.account_id ?? ''))
      case '/forget':
        // The sprint's content was purged, or the sprint deleted: nothing about its retro stays here,
        // and nobody stays connected to it. 4003 tells a client its access to the room has ended.
        await this.ctx.storage.deleteAll()
        for (const ws of this.ctx.getWebSockets()) {
          try {
            ws.close(4003, 'ended')
          } catch {
            /* already closed */
          }
        }
        return Response.json({ ok: true })
      default:
        return new Response('not found', { status: 404 })
    }
  }

  private async openSocket(req: Request): Promise<Response> {
    if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('expected websocket', { status: 426 })
    const account = req.headers.get('x-muni-account') ?? ''
    let fac = req.headers.get('x-muni-fac') === '1'
    // The Worker read who facilitates before a handover this object has since been told of.
    const readAt = Number(req.headers.get('x-muni-at')) || 0
    const handover = await this.lastHandover()
    if (handover && readAt < handover.at) fac = account === handover.account
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

  /**
   * Facilitation was handed over (and saved in D1 at `at`): the new facilitator's open sockets get
   * what only the facilitator hears, and the previous one's stop getting it, without reconnecting.
   * The stage stops being the previous facilitator's to control: they're usually still connected,
   * as a participant now, and mustn't make the new facilitator take control from them.
   */
  private async setFacilitator(body: Record<string, unknown>): Promise<Response> {
    const account = String(body.account_id ?? '')
    await this.ctx.storage.put('handover', { account, at: Number(body.at) || Date.now() } satisfies Handover)
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null
      if (att?.a) ws.serializeAttachment({ a: att.a, f: att.a === account } satisfies Attachment)
    }
    const m = await this.meeting()
    if (m && m.controller_account_id && m.controller_account_id !== account) await this.ctx.storage.put({ meeting: { ...m, controller_account_id: null } })
    return Response.json({ ok: true })
  }

  /**
   * Someone left the sprint (or deleted their account): their connections close, and the room keeps
   * nothing that names them — their attendance, or them as the stage's controller.
   */
  private async revoke(account: string): Promise<Response> {
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
    const [m, att] = [await this.meeting(), await this.attendance()]
    if (account in att) {
      delete att[account]
      await this.ctx.storage.put({ attendance: att })
    }
    if (m && m.controller_account_id === account) await this.ctx.storage.put({ meeting: { ...m, controller_account_id: null } })
    if ((await this.lastHandover())?.account === account) await this.ctx.storage.delete('handover')
    return Response.json({ ok: true })
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
  /**
   * Holds a session for the sprint's retro. `session` names the retro in D1: a read that finds the
   * room without one starts it again, but never one that was ended or cancelled (a read racing the
   * cancellation mustn't bring it back). `replace` starts afresh whatever is there (going live).
   */
  private async start(body: Record<string, unknown>): Promise<Response> {
    const existing = await this.meeting()
    const session = typeof body.session === 'number' ? body.session : null
    if (existing && body.replace !== true) {
      const same = session === null || existing.session == null || existing.session === session
      if (!existing.ended_at && !existing.cancelled && same) return Response.json({ ok: true, version: existing.version, existed: true })
      if ((existing.ended_at || existing.cancelled) && session !== null && existing.session === session) return refused(409, 'conflict', 'this retro has ended')
    }
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
      session,
      claim: null,
    }
    await this.ctx.storage.put({ meeting: m, attendance: {} })
    this.broadcast({ type: 'hint', resource: 'meeting', version: m.version })
    return Response.json({ ok: true, version: m.version, existed: false })
  }

  /** Ends or cancels the retro — only the session named in `body.session`, when one is named. */
  private async finish(cancelled: boolean, body: Record<string, unknown>): Promise<Response> {
    const m = await this.meeting()
    if (!m) return Response.json({ ok: true })
    if (typeof body.session === 'number' && typeof m.session === 'number' && body.session !== m.session) return Response.json({ ok: true })
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
  /** Why `account` can't command the stage at `expected` now — or null when it can. */
  private refusal(m: MeetingState | null, account: string, expected: number, type: unknown, claim: unknown): Response | null {
    if (!m || m.ended_at) return refused(409, 'conflict', 'the retro isn’t live')
    if (m.claim && m.claim.until > Date.now() && m.claim.token !== claim) return refused(409, 'conflict', 'the stage is changing right now — try again in a moment')
    if (m.version !== expected) return refused(409, 'conflict', 'the stage changed since you last saw it — it’s been refreshed, try again')
    // A controller counts only while connected as a facilitator: someone who has handed facilitation
    // on, and is still here as a participant, holds nothing.
    const controllerPresent = m.controller_account_id ? this.facilitatorConnected(m.controller_account_id) : false
    if (m.controller_account_id && m.controller_account_id !== account && controllerPresent && type !== 'take_control')
      return refused(409, 'conflict', 'another facilitator is controlling the stage — take control explicitly to continue')
    return null
  }

  /**
   * A command that also changes D1 (a step's vote, a topic marked discussed) asks here first. If it
   * may go ahead, the stage is held for it — every other command is refused — until it's applied
   * (`/command` with the claim) or released, so D1 changes only for a command the stage takes.
   */
  private async claim(body: Record<string, unknown>): Promise<Response> {
    const m = await this.meeting()
    const no = this.refusal(m, String(body.account ?? ''), Number(body.expected_version), body.type, null)
    if (no) return no
    const claim = { token: crypto.randomUUID(), until: Date.now() + CLAIM_MS }
    await this.ctx.storage.put({ meeting: { ...m!, claim } })
    // The topic in hand, which can't change while the claim holds: whether the talk has begun.
    return Response.json({ ok: true, claim: claim.token, current_theme_id: m!.current_theme_id })
  }

  private async release(body: Record<string, unknown>): Promise<Response> {
    const m = await this.meeting()
    if (m?.claim && m.claim.token === body.claim) await this.ctx.storage.put({ meeting: { ...m, claim: null } })
    return Response.json({ ok: true })
  }

  private async command(body: Record<string, unknown>): Promise<Response> {
    const account = String(body.account ?? '')
    const cmd = (body.command && typeof body.command === 'object' ? body.command : {}) as Command
    const m = await this.meeting()
    const no = this.refusal(m, account, Number(body.expected_version), cmd.type, body.claim)
    if (no || !m) return no!
    // The Worker validates commands; this keeps a malformed one from ever reaching the stored state.
    const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
    if ((cmd.type === 'set_agenda' && !Array.isArray(cmd.items)) || (cmd.type === 'timer_start' && !finite(cmd.secs)) || (cmd.type === 'timer_adjust' && !finite(cmd.delta_secs)))
      return refused(400, 'bad_request', 'that command is malformed')
    const now = Date.now()
    let action = 'meeting.command'
    /** A topic's timebox: the talk's minutes shared across the first three topics. Guidance, not a cut-off. */
    const perTopic = () => Math.floor(((m.plan.talk ?? 28) * 60) / Math.min(3, Math.max(1, m.agenda.length)))
    /** Opens a topic with its timebox, running from the moment it opens. */
    const openTopic = (id: string | null) => {
      m.current_theme_id = id
      const per = perTopic()
      m.timer_ends_at = id ? now + per * 1000 : null
      m.timer_remaining_secs = null
      m.timer_total_secs = id ? per : null
      m.parked_clock = null
    }
    switch (cmd.type) {
      case 'take_control':
        action = 'meeting.control_taken'
        break
      case 'set_phase': {
        if (!(PHASES as readonly string[]).includes(cmd.phase)) return refused(400, 'bad_request', 'unknown phase')
        const was = m.phase
        m.phase = cmd.phase as Phase
        // Only the talk keeps a clock. The first arrival there sets the agenda and opens its first
        // topic (when one is given); coming back to a topic in hand brings back its clock, paused.
        if (m.phase === 'talk' && !m.current_theme_id) {
          if (Array.isArray(cmd.agenda)) m.agenda = cmd.agenda.slice(0, 40).map((i) => ({ theme_id: String(i.theme_id), reason: null }))
          if (cmd.topic !== undefined) openTopic(cmd.topic)
        } else if (m.phase === 'talk' && was !== 'talk') {
          const parked = m.parked_clock
          if (parked && parked.theme_id === m.current_theme_id) {
            m.timer_ends_at = null
            m.timer_remaining_secs = parked.remaining_secs
            m.timer_total_secs = parked.total_secs
          }
          m.parked_clock = null
        } else if (m.phase !== 'talk') {
          // Leaving the talk keeps what the topic's clock had, for coming back to it.
          if (was === 'talk' && m.current_theme_id && m.timer_total_secs !== null)
            m.parked_clock = { theme_id: m.current_theme_id, remaining_secs: m.timer_ends_at ? Math.max(0, Math.round((m.timer_ends_at - now) / 1000)) : (m.timer_remaining_secs ?? 0), total_secs: m.timer_total_secs }
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
        if (!m.timer_ends_at) {
          // A clock that ran out starts again with a full timebox: the topic's (or, with no topic, the
          // clock's own), as resuming at zero would otherwise do nothing.
          let left = m.timer_remaining_secs ?? 0
          if (left <= 0) {
            left = m.current_theme_id ? perTopic() : (m.timer_total_secs ?? 0)
            if (left > 0) m.timer_total_secs = left
          }
          if (left > 0) {
            m.timer_ends_at = now + left * 1000
            m.timer_remaining_secs = null
          }
        }
        break
      case 'timer_adjust': {
        const delta = Math.min(3600, Math.max(-3600, Math.round(cmd.delta_secs)))
        // Added to what's left — from now, once the time is up — never to a deadline long passed.
        if (m.timer_ends_at) m.timer_ends_at = Math.max(now, Math.max(now, m.timer_ends_at) + delta * 1000)
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
        return refused(400, 'bad_request', 'unknown command')
    }
    m.version += 1
    m.controller_account_id = account
    m.controller_seen_at = now
    m.claim = null
    await this.ctx.storage.put({ meeting: m })
    this.broadcast({ type: 'hint', resource: 'meeting', version: m.version })
    // What the command changed in D1 (made before it was sent here), announced once the stage has moved.
    for (const resource of Array.isArray(body.hints) ? body.hints.map(String) : []) this.broadcast({ type: 'hint', resource, version: m.version })
    return Response.json({ ok: true, version: m.version, action, state: await this.state() })
  }

  private async setAttendance(body: Record<string, unknown>): Promise<Response> {
    const target = String(body.target ?? '')
    const m = await this.meeting()
    if (!m) return refused(404, 'not_found', 'the retro hasn’t started yet')
    const att = await this.attendance()
    const cur = att[target] ?? { present: false, updated_at: 0 }
    if (typeof body.present === 'boolean') cur.present = body.present
    cur.updated_at = Date.now()
    att[target] = { present: cur.present, updated_at: cur.updated_at }
    // Presence isn't a command: someone arriving mustn't make the facilitator's next click a conflict,
    // so the version that guards commands stays as it was. Only the facilitator's screen lists who's
    // here live, and the person's own other tabs follow; everyone else sees it on their next read.
    await this.ctx.storage.put({ attendance: att })
    this.broadcast({ type: 'hint', resource: 'meeting', version: m.version }, { facilitators: true, accounts: [target] })
    return Response.json({ ok: true, state: await this.state() })
  }
}
