import { useEffect, useRef } from 'react'

/**
 * Subscribes to a sprint's room over a WebSocket. The room sends hints —
 * a resource name and a version — never content; the caller refetches the
 * authorized snapshot. Reconnects with exponential backoff plus jitter, and
 * fires `all` on every (re)connect so nothing missed while offline is lost.
 * A single keepalive ping per 50s is answered by the platform without waking
 * the room object.
 */
export function useLive(sprintId: string | undefined, onHint: (resource: string, version?: number) => void, onRevoked?: () => void) {
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
    const connect = () => {
      if (closed) return
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${proto}://${location.host}/api/sprints/${sprintId}/ws`)
      ws.onopen = () => {
        if (attempt > 0 || document.visibilityState === 'visible') cb.current('all')
        attempt = 0
        ping = window.setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('ping'), 50_000)
      }
      ws.onmessage = (e) => {
        if (e.data === 'pong') return
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
        if (closed) return
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
    }
  }, [sprintId])
}
