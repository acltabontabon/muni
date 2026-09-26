import { useEffect, useRef, useState } from 'react'

/** `reconnecting`: the room can't be reached right now. Nothing shown should look live. */
export type LiveStatus = 'connecting' | 'live' | 'reconnecting'

/**
 * Subscribes to a sprint's room over a WebSocket. The room sends hints —
 * a resource name and a version — never content; the caller refetches the
 * authorized snapshot. Reconnects with exponential backoff plus jitter, and
 * fires `all` on every (re)connect so nothing missed while offline is lost.
 * A single keepalive ping per 50s is answered by the platform without waking
 * the room object.
 */
export function useLive(sprintId: string | undefined, onHint: (resource: string, version?: number) => void, onRevoked?: () => void): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>('connecting')
  const cb = useRef(onHint)
  cb.current = onHint
  const rev = useRef(onRevoked)
  rev.current = onRevoked
  useEffect(() => {
    if (!sprintId) return
    let ws: WebSocket | null = null
    let attempt = 0
    let closed = false
    let timer: number | undefined
    let ping: number | undefined
    let watchdog: number | undefined
    const connect = () => {
      if (closed) return
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${proto}://${location.host}/api/sprints/${sprintId}/ws`)
      ws.onopen = () => {
        setStatus('live')
        if (attempt > 0 || document.visibilityState === 'visible') cb.current('all')
        attempt = 0
        ping = window.setInterval(() => {
          if (ws?.readyState !== WebSocket.OPEN) return
          ws.send('ping')
          // A silent network looks like an open socket; no pong in 10 s means the room is gone.
          window.clearTimeout(watchdog)
          watchdog = window.setTimeout(() => ws?.close(), 10_000)
        }, 50_000)
      }
      ws.onmessage = (e) => {
        if (e.data === 'pong') return window.clearTimeout(watchdog)
        try {
          const m = JSON.parse(e.data) as { type: string; resource?: string; version?: number }
          if (m.type === 'hint') cb.current(m.resource ?? 'all', m.version)
          else if (m.type === 'revoked') {
            closed = true
            ws?.close()
            rev.current?.()
          }
        } catch {
          cb.current('all')
        }
      }
      ws.onclose = (e) => {
        window.clearInterval(ping)
        window.clearTimeout(watchdog)
        if (closed) return
        setStatus('reconnecting')
        if (e.code === 4003) {
          closed = true
          rev.current?.()
          return
        }
        attempt += 1
        const base = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5))
        timer = window.setTimeout(connect, base / 2 + Math.random() * base)
      }
      ws.onerror = () => ws?.close()
    }
    connect()
    const onOnline = () => {
      if (ws?.readyState !== WebSocket.OPEN && !closed) {
        window.clearTimeout(timer)
        connect()
      }
    }
    window.addEventListener('online', onOnline)
    // The browser says the network is gone: stop presenting the room as live right away.
    const onOffline = () => {
      setStatus('reconnecting')
      ws?.close()
    }
    window.addEventListener('offline', onOffline)
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      cb.current('all')
      if (ws?.readyState !== WebSocket.OPEN && !closed) {
        window.clearTimeout(timer)
        connect()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      closed = true
      window.clearTimeout(timer)
      window.clearInterval(ping)
      ws?.close()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.clearTimeout(watchdog)
    }
  }, [sprintId])
  return status
}
