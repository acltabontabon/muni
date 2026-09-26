/** The live socket: the room is told who connects, and never receives the client's credentials. */
import { describe, expect, it, vi } from 'vitest'
import { MeetingRoom } from '../src/room'
import { roomSocketHeaders } from '../src/lib/live'
import { closeCollection, entry, openSocket, post, sprint, team } from './harness'

const CREDENTIALS = ['cookie', 'authorization', 'x-csrf-token']

describe('room socket headers', () => {
  it('keeps the handshake, sets the account, and drops everything else', () => {
    const client = new Headers({
      upgrade: 'websocket',
      connection: 'Upgrade',
      'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
      'sec-websocket-version': '13',
      cookie: '__Host-muni_session=secret; __Host-muni_csrf=csrf',
      authorization: 'Bearer secret',
      'x-csrf-token': 'csrf',
      origin: 'https://act.munimuni.app',
      // A client can't choose who the room thinks it is.
      'x-muni-account': 'someone-else',
      'x-muni-fac': '1',
    })
    const h = roomSocketHeaders(client, 'acct-1', false)
    expect(h.get('upgrade')).toBe('websocket')
    expect(h.get('sec-websocket-key')).toBe('dGhlIHNhbXBsZSBub25jZQ==')
    expect(h.get('sec-websocket-version')).toBe('13')
    expect(h.get('x-muni-account')).toBe('acct-1')
    expect(h.get('x-muni-fac')).toBe('0')
    for (const name of [...CREDENTIALS, 'origin']) expect(h.has(name), name).toBe(false)
  })

  it('connects and delivers hints without passing the session cookie to the room', async () => {
    const seen: Headers[] = []
    const real = MeetingRoom.prototype.fetch
    const spy = vi.spyOn(MeetingRoom.prototype, 'fetch').mockImplementation(function (this: MeetingRoom, req: Request) {
      if (new URL(req.url).pathname === '/ws') seen.push(new Headers(req.headers))
      return real.call(this, req)
    })
    try {
      const { owner, members, ws } = await team(1)
      const s = await sprint(owner, members, ws, 'collecting')
      await entry(members[0], s, 'improve', 'a thought')
      await closeCollection(owner, s)
      const { socket, waitFor } = await openSocket(members[0], s)
      expect(await waitFor((m) => m.includes('"hello"'))).toBe(true)
      expect((await post(`/api/sprints/${s}/themes`, owner, { title: 'Hinted' })).status).toBe(200)
      expect(await waitFor((m) => m.includes('"resource":"themes"'))).toBe(true)
      socket.close()
      expect(seen.length, 'the spy sees the room’s /ws request').toBe(1)
      expect(seen[0].get('x-muni-account')).toBe(members[0].account_id)
      expect(seen[0].get('upgrade')).toBe('websocket')
      for (const name of CREDENTIALS) expect(seen[0].has(name), name).toBe(false)
    } finally {
      spy.mockRestore()
    }
  })
})
