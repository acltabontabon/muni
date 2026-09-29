import { useEffect, useRef, useState } from 'react'

/** `reconnecting`: the room can't be reached right now. Nothing shown should look live. */
export type LiveStatus = 'connecting' | 'live' | 'reconnecting'

// WebSocket.readyState, spelled out so the connection runs where there's no WebSocket (tests).
const CONNECTING = 0
const OPEN = 1

/** A keepalive every 50 s is answered by the platform without waking the room object. */
const PING_MS = 50_000
/** A silent network looks like an open socket: no pong within this means the room is gone. */
const PONG_MS = 10_000
/** Hidden for less than this with the socket open throughout, nothing can have been missed. */
const GLANCE_MS = 5_000

export interface LiveHandlers {
  hint: (resource: string, version?: number) => void
  status: (s: LiveStatus) => void
  revoked: () => void
  /** A socket opened; `reconnected` when an earlier one had been open (hints may have been missed). */
  open: (reconnected: boolean) => void
  /** The room's greeting on a socket: the version it's at. */
  hello?: (version: number) => void
}

export interface LiveEnv {
  socket: (url: string) => WebSocket
  /** False only when the browser knows it has no network. */
  online: () => boolean
}

/**
 * A sprint's room, over one WebSocket at a time. The room sends hints — a resource name and a
 * version — never content; the caller reads the authorized snapshot again. Reconnects with
 * exponential backoff plus jitter. A socket that's been replaced is detached and closed, and
 * nothing it does afterwards counts: it can't schedule a reconnect, close its successor or deliver
 * a hint twice. Coming back to the page or the network reconnects only when there's no socket
 * already open or opening.
 */
export class LiveConnection {
  private ws: WebSocket | null = null
  private attempt = 0
  private opened = false
  private stopped = false
  private hiddenAt: number | null = null
  private retry: ReturnType<typeof setTimeout> | undefined
  private ping: ReturnType<typeof setInterval> | undefined
  private watchdog: ReturnType<typeof setTimeout> | undefined

  constructor(
    private url: string,
    private on: LiveHandlers,
    private env: LiveEnv,
  ) {}

  start() {
    this.connect()
  }

  /** Leaving the retro: the socket closes, and nothing reconnects or reads again. */
  stop() {
    this.stopped = true
    clearTimeout(this.retry)
    this.drop()
  }

  /** The network is back: reconnect now rather than at the next backoff. */
  online() {
    if (this.stopped) return
    if (this.ws?.readyState === OPEN) return this.probe()
    if (this.ws?.readyState !== CONNECTING) this.connect()
  }

  /** The browser says the network is gone: stop presenting the room as live right away. */
  offline() {
    if (!this.stopped) this.lost()
  }

  hidden() {
    this.hiddenAt = Date.now()
  }

  /**
   * The page is shown again. A socket that looks open may have missed hints while the page slept:
   * after more than a glance, everything is read again, and the socket is checked. Without one,
   * it reconnects now (opening reads everything). With no network at all, the `online` event will.
   */
  visible() {
    const away = this.hiddenAt === null ? 0 : Date.now() - this.hiddenAt
    this.hiddenAt = null
    if (this.stopped || !this.env.online()) return
    if (this.ws?.readyState === OPEN) {
      if (away >= GLANCE_MS) this.on.hint('all')
      return this.probe()
    }
    if (this.ws?.readyState !== CONNECTING) this.connect()
  }

  private connect() {
    if (this.stopped) return
    clearTimeout(this.retry)
    this.drop()
    const ws = this.env.socket(this.url)
    this.ws = ws
    ws.onopen = () => {
      if (ws !== this.ws) return
      const reconnected = this.opened
      this.opened = true
      this.attempt = 0
      this.on.status('live')
      this.on.open(reconnected)
      clearInterval(this.ping)
      this.ping = setInterval(() => this.probe(), PING_MS)
    }
    ws.onmessage = (e) => {
      if (ws !== this.ws) return
      if (e.data === 'pong') return clearTimeout(this.watchdog)
      let m: { type?: string; resource?: string; version?: number }
      try {
        m = JSON.parse(e.data)
      } catch {
        return this.on.hint('all')
      }
      if (m.type === 'hint') this.on.hint(m.resource ?? 'all', m.version)
      else if (m.type === 'hello' && typeof m.version === 'number') this.on.hello?.(m.version)
      else if (m.type === 'revoked') this.revoke()
    }
    ws.onclose = (e) => {
      if (ws !== this.ws) return
      if (e.code === 4003) this.revoke()
      else this.lost()
    }
    // The socket that failed is the one closed.
    ws.onerror = () => {
      if (ws === this.ws) ws.close()
    }
  }

  /** Detach the socket (nothing it does counts any more) and close it if it isn't already. */
  private drop() {
    const ws = this.ws
    this.ws = null
    clearInterval(this.ping)
    clearTimeout(this.watchdog)
    if (!ws) return
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null
    if (ws.readyState === CONNECTING || ws.readyState === OPEN) ws.close()
  }

  /** The room can't be reached on this socket: say so, and try again after a backoff. */
  private lost() {
    this.drop()
    if (this.stopped) return
    this.on.status('reconnecting')
    this.attempt += 1
    const base = Math.min(30_000, 1000 * 2 ** Math.min(this.attempt, 5))
    clearTimeout(this.retry)
    this.retry = setTimeout(() => {
      if (!this.ws) this.connect()
    }, base / 2 + Math.random() * base)
  }

  private revoke() {
    this.stopped = true
    clearTimeout(this.retry)
    this.drop()
    this.on.revoked()
  }

  /** Is this socket still there? A ping unanswered within 10 s means it isn't. */
  private probe() {
    const ws = this.ws
    if (!ws || ws.readyState !== OPEN) return
    try {
      ws.send('ping')
    } catch {
      return this.lost()
    }
    clearTimeout(this.watchdog)
    this.watchdog = setTimeout(() => {
      if (ws === this.ws) this.lost()
    }, PONG_MS)
  }
}

/**
 * Subscribes to a sprint's room while mounted. With `onOpen`, the caller decides what an opened
 * socket reads; without it, `all` is sent on every reconnect (and on the first open while the page
 * is visible) so nothing missed while offline is lost.
 */
export function useLive(sprintId: string | undefined, onHint: (resource: string, version?: number) => void, onRevoked?: () => void, opts?: { onOpen?: (reconnected: boolean) => void; onHello?: (version: number) => void }): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>('connecting')
  const cb = useRef({ onHint, onRevoked, onOpen: opts?.onOpen, onHello: opts?.onHello })
  cb.current = { onHint, onRevoked, onOpen: opts?.onOpen, onHello: opts?.onHello }
  useEffect(() => {
    if (!sprintId) return
    setStatus('connecting')
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const conn = new LiveConnection(
      `${proto}://${location.host}/api/sprints/${sprintId}/ws`,
      {
        hint: (r, v) => cb.current.onHint(r, v),
        status: setStatus,
        revoked: () => cb.current.onRevoked?.(),
        hello: (v) => cb.current.onHello?.(v),
        open: (reconnected) => {
          const { onOpen } = cb.current
          if (onOpen) onOpen(reconnected)
          else if (reconnected || document.visibilityState === 'visible') cb.current.onHint('all')
        },
      },
      { socket: (url) => new WebSocket(url), online: () => navigator.onLine !== false },
    )
    const onVisibility = () => (document.visibilityState === 'visible' ? conn.visible() : conn.hidden())
    const onOnline = () => conn.online()
    const onOffline = () => conn.offline()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    conn.start()
    return () => {
      conn.stop()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [sprintId])
  return status
}
