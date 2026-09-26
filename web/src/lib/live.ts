import { useEffect, useRef } from 'react'

/**
 * Subscribes to a sprint's SSE hint stream. Hints name a resource that
 * changed; the caller refetches. Reconnects with backoff, and on
 * reconnect fires `all` so any missed change is picked up.
 */
export function useLive(sprintId: string | undefined, onHint: (resource: string) => void, onRevoked?: () => void) {
  const cb = useRef(onHint)
  cb.current = onHint
  const rev = useRef(onRevoked)
  rev.current = onRevoked
  useEffect(() => {
    if (!sprintId) return
    let es: EventSource | null = null
    let attempt = 0
    let closed = false
    let timer: number | undefined
    const connect = () => {
      if (closed) return
      es = new EventSource(`/api/sprints/${sprintId}/events`)
      es.addEventListener('hello', () => {
        if (attempt > 0) cb.current('all')
        attempt = 0
      })
      es.addEventListener('hint', (e) => {
        try {
          const h = JSON.parse((e as MessageEvent).data) as { resource: string }
          cb.current(h.resource)
        } catch {
          cb.current('all')
        }
      })
      es.addEventListener('revoked', () => {
        closed = true
        es?.close()
        rev.current?.()
      })
      es.onerror = () => {
        es?.close()
        if (closed) return
        attempt += 1
        const delay = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5))
        timer = window.setTimeout(connect, delay)
      }
    }
    connect()
    const onVisible = () => {
      if (document.visibilityState === 'visible') cb.current('all')
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      closed = true
      es?.close()
      if (timer) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [sprintId])
}
