/** The live socket: the room is told who connects, and never receives the client's credentials. */
import { describe, expect, it, vi } from 'vitest'
import { MeetingRoom } from '../src/room'
import { roomSocketHeaders } from '../src/lib/live'
import { closeCollection, entry, get, go, openSocket, post, sleep, sprint, team } from './harness'

const CREDENTIALS = ['cookie', 'authorization', 'x-csrf-token']
/** RFC 6455's sample handshake nonce: base64 of "the sample nonce". */
const NONCE = btoa('the sample nonce')

describe('room socket headers', () => {
  it('keeps the handshake, sets the account, and drops everything else', () => {
    const client = new Headers({
      upgrade: 'websocket',
      connection: 'Upgrade',
      'sec-websocket-key': NONCE,
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
    expect(h.get('sec-websocket-key')).toBe(NONCE)
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

describe('who is connected', () => {
  it('shows the facilitator, live, who has the retro open — and tells them when it changes', async () => {
    const { owner, members, ws } = await team(2)
    const s = await sprint(owner, members, ws, 'collecting')
    await entry(members[0], s, 'improve', 'a thought')
    await closeCollection(owner, s)
    expect((await go(owner, s, 'ready')).status).toBe(200)
    expect((await go(owner, s, 'live')).status).toBe(200)
    const fac = await openSocket(owner, s)
    expect(await fac.waitFor((m) => m.includes('"hello"'))).toBe(true)
    /** A meeting hint to the facilitator, after the `from`-th message. */
    const hintAfter = async (from: number) => {
      for (let i = 0; i < 120; i++) {
        if (fac.messages.slice(from).some((m) => m.includes('"resource":"meeting"'))) return true
        await sleep(25)
      }
      return false
    }
    const connected = async () => ((await get(`/api/sprints/${s}/meeting`, owner)).body.attendance as { account_id: string; connected: boolean }[]).filter((a) => a.connected).map((a) => a.account_id)
    expect(await connected()).toEqual([owner.account_id])

    const before = fac.messages.length
    const phone = await openSocket(members[0], s)
    expect(await phone.waitFor((m) => m.includes('"hello"'))).toBe(true)
    expect(await hintAfter(before)).toBe(true)
    expect((await connected()).sort()).toEqual([owner.account_id, members[0].account_id].sort())
    // A participant only hears about it through the facilitator's screen, not their own phone.
    expect(phone.messages.some((m) => m.includes('"resource":"meeting"'))).toBe(false)

    const mark = fac.messages.length
    phone.socket.close()
    expect(await hintAfter(mark)).toBe(true)
    for (let i = 0; i < 20 && (await connected()).length > 1; i++) await sleep(50)
    expect(await connected()).toEqual([owner.account_id])
    fac.socket.close()
  })

  it('tells the facilitator how many have voted, never who — and nobody else', async () => {
    const { owner, members, ws } = await team(2)
    const s = await sprint(owner, members, ws, 'collecting')
    await entry(members[0], s, 'improve', 'a thought')
    const shared = await closeCollection(owner, s)
    const theme = (await post(`/api/sprints/${s}/themes`, owner, { title: 'T', entry_ids: shared.map((e) => e.id) })).body.themes[0].id as string
    expect((await go(owner, s, 'ready')).status).toBe(200)
    expect((await post(`/api/sprints/${s}/votes/rounds`, owner)).status).toBe(200)
    expect((await get(`/api/sprints/${s}/votes`, owner)).body.current.voters).toBe(0)
    const fac = await openSocket(owner, s)
    const other = await openSocket(members[1], s)
    await fac.waitFor((m) => m.includes('"hello"'))
    await other.waitFor((m) => m.includes('"hello"'))
    const [f0, o0] = [fac.messages.length, other.messages.length]
    await post(`/api/sprints/${s}/votes`, members[0], { theme_id: theme, cast: true })
    expect((await get(`/api/sprints/${s}/votes`, owner)).body.current.voters).toBe(1)
    // The facilitator's count moves live; nobody else hears that anyone voted.
    for (let i = 0; i < 80 && !fac.messages.slice(f0).some((m) => m.includes('"resource":"votes"')); i++) await sleep(25)
    expect(fac.messages.slice(f0).some((m) => m.includes('"resource":"votes"'))).toBe(true)
    expect(other.messages.slice(o0).some((m) => m.includes('"resource":"votes"'))).toBe(false)
    fac.socket.close()
    other.socket.close()
    expect((await get(`/api/sprints/${s}/votes`, members[1])).body.current.voters).toBeNull()
  })
})
