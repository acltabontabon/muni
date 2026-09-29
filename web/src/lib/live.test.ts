import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveConnection, type LiveStatus } from './live'

/** A WebSocket the test drives: it opens, answers, fails and closes when told to. */
class FakeSocket {
  static made: FakeSocket[] = []
  readyState = 0
  sent: string[] = []
  closes = 0
  onopen: ((e?: unknown) => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  onerror: ((e?: unknown) => void) | null = null
  constructor(public url: string) {
    FakeSocket.made.push(this)
  }
  send(d: string) {
    this.sent.push(d)
  }
  // Like a browser: closing only starts the close; the `close` event comes later (`closed`).
  close() {
    this.closes += 1
    if (this.readyState < 2) this.readyState = 2
  }
  opens() {
    this.readyState = 1
    this.onopen?.()
  }
  says(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) })
  }
  closed(code = 1006) {
    this.readyState = 3
    this.onclose?.({ code })
  }
}

function setup({ online = true } = {}) {
  FakeSocket.made = []
  const hints: string[] = []
  const statuses: LiveStatus[] = []
  const opens: boolean[] = []
  let revoked = 0
  const net = { online }
  const conn = new LiveConnection(
    'ws://muni.test/api/sprints/s1/ws',
    { hint: (r) => hints.push(r), status: (s) => statuses.push(s), revoked: () => (revoked += 1), open: (r) => opens.push(r) },
    { socket: (url) => new FakeSocket(url) as unknown as WebSocket, online: () => net.online },
  )
  conn.start()
  return { conn, hints, statuses, opens, net, revoked: () => revoked, sockets: FakeSocket.made, last: () => FakeSocket.made[FakeSocket.made.length - 1] }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('live connection', () => {
  it('opens one socket, and a phone unlocking (visible + online) while it connects opens no second', () => {
    const t = setup()
    t.conn.visible()
    t.conn.online()
    expect(t.sockets).toHaveLength(1)
    t.last().opens()
    t.conn.online()
    t.conn.visible()
    expect(t.sockets).toHaveLength(1)
    expect(t.statuses).toEqual(['live'])
  })

  it('after the socket dropped, an unlock reconnects once, and the pending backoff doesn’t add another', () => {
    const t = setup()
    t.sockets[0].opens()
    t.sockets[0].closed()
    expect(t.statuses.at(-1)).toBe('reconnecting')
    t.conn.visible()
    t.conn.online()
    expect(t.sockets).toHaveLength(2)
    vi.advanceTimersByTime(60_000)
    expect(t.sockets).toHaveLength(2)
    t.sockets[1].opens()
    expect(t.opens).toEqual([false, true])
  })

  it('a replaced socket is detached and closed; nothing it does later counts', () => {
    const t = setup()
    const first = t.sockets[0]
    first.opens()
    const { onclose, onerror, onmessage } = first
    t.conn.offline()
    t.conn.online()
    const second = t.last()
    expect(t.sockets).toHaveLength(2)
    expect(first.closes).toBe(1)
    expect(first.onclose).toBeNull()
    second.opens()
    // The browser delivering the old socket's events late (handlers it held on to):
    onerror?.()
    onclose?.({ code: 1006 })
    onmessage?.({ data: JSON.stringify({ type: 'hint', resource: 'votes' }) })
    expect(second.closes).toBe(0)
    expect(t.hints).toEqual([])
    vi.advanceTimersByTime(40_000)
    expect(t.sockets).toHaveLength(2)
    expect(t.statuses.at(-1)).toBe('live')
  })

  it('an error closes the socket that failed', () => {
    const t = setup()
    t.sockets[0].opens()
    t.sockets[0].onerror?.()
    expect(t.sockets[0].closes).toBe(1)
  })

  it('each hint is handled once', () => {
    const t = setup()
    t.sockets[0].opens()
    t.sockets[0].says({ type: 'hello', version: 3 })
    t.sockets[0].says({ type: 'hint', resource: 'votes', version: 3 })
    expect(t.hints).toEqual(['votes'])
  })

  it('keeps one keepalive per socket, and replaces a socket that stops answering', () => {
    const t = setup()
    const first = t.sockets[0]
    first.opens()
    vi.advanceTimersByTime(50_000)
    expect(first.sent).toEqual(['ping'])
    first.says('pong')
    vi.advanceTimersByTime(50_000)
    expect(first.sent).toEqual(['ping', 'ping'])
    // No pong this time: after 10 s the room counts as gone, and a new socket is tried.
    vi.advanceTimersByTime(10_000)
    expect(t.statuses.at(-1)).toBe('reconnecting')
    expect(first.closes).toBe(1)
    vi.advanceTimersByTime(3_000)
    expect(t.sockets).toHaveLength(2)
    const second = t.last()
    second.opens()
    vi.advanceTimersByTime(50_000)
    expect(first.sent).toHaveLength(2)
    expect(second.sent).toEqual(['ping'])
  })

  it('leaving closes the socket, and nothing reconnects or reads afterwards', () => {
    const t = setup()
    t.sockets[0].opens()
    t.conn.stop()
    expect(t.sockets[0].closes).toBe(1)
    t.conn.visible()
    t.conn.online()
    vi.advanceTimersByTime(120_000)
    expect(t.sockets).toHaveLength(1)
    expect(t.hints).toEqual([])
    expect(t.sockets[0].sent).toEqual([])
  })

  it('stopping while connecting leaves no socket behind', () => {
    const t = setup()
    t.conn.stop()
    expect(t.sockets[0].closes).toBe(1)
    t.sockets[0].opens()
    expect(t.statuses).toEqual([])
  })

  it('backs off between attempts, and the network coming back skips the wait', () => {
    const t = setup()
    t.sockets[0].closed()
    vi.advanceTimersByTime(499)
    expect(t.sockets).toHaveLength(1)
    vi.advanceTimersByTime(3_000)
    expect(t.sockets).toHaveLength(2)
    t.last().closed()
    t.conn.online()
    expect(t.sockets).toHaveLength(3)
  })

  it('offline: says so at once; back online: reconnects now, and the reopen reads everything', () => {
    const t = setup()
    t.sockets[0].opens()
    t.conn.offline()
    expect(t.statuses).toEqual(['live', 'reconnecting'])
    expect(t.sockets[0].closes).toBe(1)
    t.conn.online()
    t.last().opens()
    expect(t.opens).toEqual([false, true])
  })

  it('shown again after a glance reads nothing; after longer, it reads everything and checks the socket', () => {
    const t = setup()
    t.sockets[0].opens()
    t.conn.hidden()
    vi.advanceTimersByTime(2_000)
    t.conn.visible()
    expect(t.hints).toEqual([])
    expect(t.sockets[0].sent).toEqual(['ping'])
    t.sockets[0].says('pong')
    t.conn.hidden()
    vi.advanceTimersByTime(30_000)
    t.conn.visible()
    expect(t.hints).toEqual(['all'])
    expect(t.sockets[0].sent).toEqual(['ping', 'ping'])
    expect(t.sockets).toHaveLength(1)
  })

  it('shown again with no network: no read that can only fail, and no socket until it’s back', () => {
    const t = setup()
    t.sockets[0].opens()
    t.conn.offline()
    t.net.online = false
    t.conn.hidden()
    vi.advanceTimersByTime(30_000)
    const before = t.sockets.length
    t.conn.visible()
    expect(t.hints).toEqual([])
    expect(t.sockets).toHaveLength(before)
  })

  it('access ended: stops for good', () => {
    const t = setup()
    t.sockets[0].opens()
    t.sockets[0].says({ type: 'revoked' })
    expect(t.revoked()).toBe(1)
    vi.advanceTimersByTime(120_000)
    t.conn.online()
    expect(t.sockets).toHaveLength(1)
    const u = setup()
    u.sockets[0].opens()
    u.sockets[0].closed(4003)
    expect(u.revoked()).toBe(1)
    vi.advanceTimersByTime(120_000)
    expect(u.sockets).toHaveLength(1)
  })
})
