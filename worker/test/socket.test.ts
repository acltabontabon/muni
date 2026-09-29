/** The live socket: the room is told who connects, and never receives the client's credentials. */
import { describe, expect, it, vi } from 'vitest'
import { env } from 'cloudflare:test'
import { MeetingRoom } from '../src/room'
import { roomSocketHeaders } from '../src/lib/live'
import { closeCollection, entry, get, go, openSocket, patch, post, sleep, sprint, team } from './harness'

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
      'x-muni-at': '9999999999999',
    })
    const h = roomSocketHeaders(client, 'acct-1', false, 1234)
    expect(h.get('upgrade')).toBe('websocket')
    expect(h.get('sec-websocket-key')).toBe(NONCE)
    expect(h.get('sec-websocket-version')).toBe('13')
    expect(h.get('x-muni-account')).toBe('acct-1')
    expect(h.get('x-muni-fac')).toBe('0')
    expect(h.get('x-muni-at')).toBe('1234')
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

  it('adding to a topic tells only the facilitator and the author — and only the facilitator sees who’s connected', async () => {
    const { owner, members, ws } = await team(2)
    const [author, other] = members
    const s = await sprint(owner, members, ws, 'collecting')
    await entry(author, s, 'improve', 'a thought')
    const shared = await closeCollection(owner, s)
    const theme = (await post(`/api/sprints/${s}/themes`, owner, { title: 'T', entry_ids: shared.map((e) => e.id) })).body.themes[0].id as string
    expect((await go(owner, s, 'live')).status).toBe(200)
    const [fac, mine, theirs] = await Promise.all([openSocket(owner, s), openSocket(author, s), openSocket(other, s)])
    await Promise.all([fac, mine, theirs].map((x) => x.waitFor((m) => m.includes('"hello"'))))
    await sleep(200) // arrivals settle
    const marks = [fac, mine, theirs].map((x) => x.messages.length)
    expect((await post(`/api/sprints/${s}/meeting/context`, author, { theme_id: theme, body: 'more context' })).status).toBe(200)
    const heard = (i: number) => [fac, mine, theirs][i].messages.slice(marks[i]).some((m) => m.includes('"resource":"meeting"'))
    for (let i = 0; i < 80 && !(heard(0) && heard(1)); i++) await sleep(25)
    await sleep(200)
    expect([heard(0), heard(1), heard(2)]).toEqual([true, true, false])
    // Who has the retro open: the facilitator sees it; a participant sees no one as connected.
    const byFac = (await get(`/api/sprints/${s}/meeting`, owner)).body.attendance as { account_id: string; connected: boolean }[]
    expect(byFac.filter((a) => a.connected).map((a) => a.account_id).sort()).toEqual([owner, author, other].map((u) => u.account_id).sort())
    const byOther = (await get(`/api/sprints/${s}/meeting`, other)).body.attendance as { connected: boolean; is_you: boolean; present: boolean }[]
    expect(byOther.map((a) => a.connected)).toEqual([false, false, false])
    // Their own entry is still there, as the phone needs it.
    expect(byOther.filter((a) => a.is_you)).toHaveLength(1)
    // Saying you're here tells the facilitator and your own screens; nobody else refetches.
    const again = [fac, mine, theirs].map((x) => x.messages.length)
    expect((await post(`/api/sprints/${s}/meeting/attendance`, other, { present: true })).body.attendance.find((a: { is_you: boolean }) => a.is_you).present).toBe(true)
    const since = (i: number) => [fac, mine, theirs][i].messages.slice(again[i]).some((m) => m.includes('"resource":"meeting"'))
    for (let i = 0; i < 80 && !(since(0) && since(2)); i++) await sleep(25)
    await sleep(200)
    expect([since(0), since(1), since(2)]).toEqual([true, false, true])
    for (const x of [fac, mine, theirs]) x.socket.close()
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

  it('tells the voter’s own other tabs about every vote they change, and nobody else', async () => {
    const { owner, members, ws } = await team(2)
    const [voter, other] = members
    const s = await sprint(owner, members, ws, 'collecting')
    await entry(voter, s, 'improve', 'one thought')
    await entry(other, s, 'improve', 'another thought')
    const shared = await closeCollection(owner, s)
    const themes: string[] = []
    for (const e of shared) themes.push((await post(`/api/sprints/${s}/themes`, owner, { title: `T ${e.id.slice(0, 4)}`, entry_ids: [e.id] })).body.themes.at(-1).id)
    expect((await go(owner, s, 'ready')).status).toBe(200)
    expect((await post(`/api/sprints/${s}/votes/rounds`, owner)).status).toBe(200)
    expect((await post(`/api/sprints/${s}/votes`, voter, { theme_id: themes[0], cast: true })).status).toBe(200)
    // The voter's stage and phone, the facilitator, and someone else.
    const [stage, phone, fac, theirs] = await Promise.all([openSocket(voter, s), openSocket(voter, s), openSocket(owner, s), openSocket(other, s)])
    await Promise.all([stage, phone, fac, theirs].map((x) => x.waitFor((m) => m.includes('"hello"'))))
    await sleep(200) // arrivals settle
    const marks = [stage, phone, fac, theirs].map((x) => x.messages.length)
    const heard = (i: number) => [stage, phone, fac, theirs][i].messages.slice(marks[i]).some((m) => m.includes('"resource":"votes"'))
    // A second vote: the facilitator's count of voters doesn't move, but the voter's votes left do.
    expect((await post(`/api/sprints/${s}/votes`, voter, { theme_id: themes[1], cast: true })).body.current.my_remaining).toBe(1)
    for (let i = 0; i < 80 && !(heard(0) && heard(1)); i++) await sleep(25)
    await sleep(200)
    expect([heard(0), heard(1), heard(2), heard(3)]).toEqual([true, true, false, false])
    for (const x of [stage, phone, fac, theirs]) x.socket.close()
  })
})

describe('handing over facilitation', () => {
  /** A ready sprint with an open vote round, and sockets for the facilitator and the next one. */
  async function voting() {
    const { owner, members, ws } = await team(3)
    const [next, voter] = members
    const s = await sprint(owner, members, ws, 'collecting')
    await entry(voter, s, 'improve', 'a thought')
    const shared = await closeCollection(owner, s)
    const theme = (await post(`/api/sprints/${s}/themes`, owner, { title: 'T', entry_ids: shared.map((e) => e.id) })).body.themes[0].id as string
    expect((await go(owner, s, 'ready')).status).toBe(200)
    expect((await post(`/api/sprints/${s}/votes/rounds`, owner)).status).toBe(200)
    return { owner, next, voter, s, theme }
  }
  const votesHint = (m: string) => m.includes('"resource":"votes"')

  it('moves what only the facilitator hears to the new facilitator’s open sockets, at once', async () => {
    const { owner, next, voter, s, theme } = await voting()
    const was = await openSocket(owner, s)
    const now = await openSocket(next, s)
    await Promise.all([was, now].map((x) => x.waitFor((m) => m.includes('"hello"'))))
    expect((await patch(`/api/sprints/${s}`, owner, { facilitator_id: next.account_id })).status).toBe(200)
    const [w0, n0] = [was.messages.length, now.messages.length]
    await post(`/api/sprints/${s}/votes`, voter, { theme_id: theme, cast: true })
    for (let i = 0; i < 80 && !now.messages.slice(n0).some(votesHint); i++) await sleep(25)
    expect(now.messages.slice(n0).some(votesHint)).toBe(true)
    await sleep(200)
    expect(was.messages.slice(w0).some(votesHint)).toBe(false)
    expect((await get(`/api/sprints/${s}/votes`, next)).body.current.voters).toBe(1)
    was.socket.close()
    now.socket.close()
  })

  it('doesn’t treat a socket as the facilitator’s when its request read that before the handover', async () => {
    const { owner, next, voter, s, theme } = await voting()
    const before = Date.now()
    expect((await patch(`/api/sprints/${s}`, owner, { facilitator_id: next.account_id })).status).toBe(200)
    // The old facilitator's reconnect, checked against D1 just before the handover was saved.
    const res = await env.ROOMS.get(env.ROOMS.idFromName(s)).fetch('https://room/ws', { headers: { upgrade: 'websocket', 'x-muni-account': owner.account_id, 'x-muni-fac': '1', 'x-muni-at': String(before - 1) } })
    const stale = res.webSocket!
    stale.accept()
    const messages: string[] = []
    stale.addEventListener('message', (e) => messages.push(String(e.data)))
    await post(`/api/sprints/${s}/votes`, voter, { theme_id: theme, cast: true })
    await sleep(300)
    expect(messages.some(votesHint)).toBe(false)
    stale.close()
  })
})
