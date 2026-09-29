/**
 * Test harness: real HTTP through the Worker (SELF), the real D1 and room
 * bindings from the test pool. Every test mints its own accounts (signed in with passkeys) and
 * workspace with unique addresses, so tests never depend on each other.
 */
import { env, runInDurableObject, SELF } from 'cloudflare:test'
import { SoftAuthenticator } from './authenticator'

export interface User {
  email: string
  session: string
  csrf: string
  account_id: string
}
export type Res<T = unknown> = { status: number; body: T; headers: Headers }

const ORIGIN = 'http://localhost:5173'
export const tag = () => crypto.randomUUID().slice(0, 8)

export async function req<T = unknown>(method: string, path: string, user?: User | null, json?: unknown, extra: Record<string, string> = {}): Promise<Res<T>> {
  const headers: Record<string, string> = { origin: ORIGIN, ...extra }
  if (json !== undefined) headers['content-type'] = 'application/json'
  if (user) {
    headers.cookie = `muni_session=${user.session}; muni_csrf=${user.csrf}`
    headers['x-csrf-token'] = user.csrf
  }
  const r = await SELF.fetch(`https://muni.test${path}`, { method, headers, body: json !== undefined ? JSON.stringify(json) : undefined })
  const text = await r.text()
  let body: unknown = text
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    /* text */
  }
  return { status: r.status, body: body as T, headers: r.headers }
}
export const get = <T = any>(path: string, user?: User | null) => req<T>('GET', path, user)
export const post = <T = any>(path: string, user: User | null, json: unknown = {}) => req<T>('POST', path, user, json)
export const patch = <T = any>(path: string, user: User, json: unknown) => req<T>('PATCH', path, user, json)
export const put = <T = any>(path: string, user: User, json: unknown) => req<T>('PUT', path, user, json)
export const del = <T = any>(path: string, user: User, json: unknown = {}) => req<T>('DELETE', path, user, json)

export async function lastMailTo(email: string): Promise<{ subject: string; body: string } | null> {
  const r = await env.DB.prepare('SELECT subject, body FROM dev_mail WHERE to_addr = ? ORDER BY created_at DESC LIMIT 1').bind(email).first<{ subject: string; body: string }>()
  return r ?? null
}
/**
 * A person, signed in with a passkey (a software authenticator; test/authenticator.ts). The first
 * call for an address creates their account with a passkey and keeps the address as where their
 * invitations and reminders go, as accepting an emailed invitation would; later calls for the same
 * address sign in again with that passkey, as a new session. `name = null` leaves the name unchosen.
 */
const people = new Map<string, SoftAuthenticator>()
// Each person comes from their own simulated network, so the per-network limits apply to each.
const ipOf = (address: string) => `10.${[...address].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % 250}.${Math.floor(Math.random() * 250)}.${people.size % 250}`
const ips = new Map<string, string>()
export async function signin(email: string, name: string | null = 'Someone'): Promise<User> {
  const address = email.toLowerCase()
  const known = people.get(address)
  if (!ips.has(address)) ips.set(address, ipOf(address))
  const ip = ips.get(address)!
  if (known) {
    const r = await passkeyLogin(known, { credId: [...known.creds.keys()][0], ip })
    if (!r.user) throw new Error(`passkey sign-in ${r.status} ${JSON.stringify(r.body)}`)
    return { ...r.user, email: address }
  }
  const auth = new SoftAuthenticator()
  const r = await passkeySignup(auth, name ?? 'Someone', { ip })
  if (!r.user) throw new Error(`passkey sign-up ${r.status} ${JSON.stringify(r.body)}`)
  await env.DB.prepare('INSERT INTO account_emails (account_id, email, verified_at) VALUES (?,?,?)').bind(r.user.account_id, address, Date.now()).run()
  if (name === null) await env.DB.prepare("UPDATE accounts SET display_name = '', name_set_at = NULL WHERE id = ?").bind(r.user.account_id).run()
  people.set(address, auth)
  return { ...r.user, email: address }
}
/** The authenticator holding someone's passkey (to add another, or sign in with a specific one). */
export const authenticatorOf = (email: string) => people.get(email.toLowerCase())

/** Runs queued jobs (emails, reminders) until none are due. */
export async function runJobs() {
  const { runDue } = await import('../src/jobs')
  await runDue(env as any, 50)
}

export async function inviteToken(email: string): Promise<string> {
  // The request that queued the mail may be sending it right now (after its response, in waitUntil):
  // wait until nothing is on its way to this address, then read the newest mail.
  const sending = () => env.DB.prepare("SELECT count(*) AS n FROM jobs WHERE kind = 'email' AND status IN ('queued','running') AND json_extract(payload, '$.to') = ?").bind(email).first<{ n: number }>()
  for (let i = 0; i < 80; i++) {
    await runJobs()
    if (!(await sending())?.n) break
    await sleep(25)
  }
  const m = await lastMailTo(email)
  const line = m?.body.split('\n').find((l) => l.trim().startsWith('http://localhost:5173/invite#'))
  if (!line) throw new Error('no invite mail')
  return line.trim().replace('http://localhost:5173/invite#', '')
}

/** Owner + workspace + `n` invited-and-joined members. */
export async function team(n: number): Promise<{ owner: User; members: User[]; ws: string }> {
  const t = tag()
  const owner = await signin(`owner-${t}@example.com`, 'Owner')
  const w = await post('/api/workspaces', owner, { name: `Team ${t}` })
  const ws = w.body.id as string
  const members: User[] = []
  for (let i = 0; i < n; i++) {
    const email = `m${i}-${t}@example.com`
    const inv = await post(`/api/workspaces/${ws}/invitations`, owner, { email })
    if (inv.status !== 200) throw new Error(`invite ${inv.status}`)
    const token = await inviteToken(email)
    const u = await signin(email, `Member ${i}`)
    const acc = await post('/api/invitations/accept', u, { token })
    if (acc.status !== 200) throw new Error(`accept ${acc.status} ${JSON.stringify(acc.body)}`)
    members.push(u)
  }
  return { owner, members, ws }
}

const ORDER = ['draft', 'collecting', 'preparing', 'ready', 'live', 'completed']

/** A sprint with the owner as facilitator and all members as participants, moved to `status`. */
export async function sprint(owner: User, members: User[], ws: string, status: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await post(`/api/workspaces/${ws}/sprints`, owner, {
    name: 'Sprint T',
    timezone: 'Europe/Berlin',
    starts_on: '2026-09-14',
    ends_on: '2026-09-27',
    retro_date: '2026-09-28',
    retro_time: '14:00',
    retro_duration_min: 45,
    participant_ids: members.map((m) => m.account_id),
    facilitator_id: owner.account_id,
    reminders_enabled: false,
    ...extra,
  })
  if (r.status !== 200) throw new Error(`create sprint ${r.status} ${JSON.stringify(r.body)}`)
  const id = r.body.id as string
  const target = ORDER.indexOf(status)
  for (let i = 1; i <= target; i++) {
    const t = await post(`/api/sprints/${id}/transition`, owner, { to: ORDER[i], confirm: true })
    if (t.status !== 200) throw new Error(`transition to ${ORDER[i]}: ${t.status} ${JSON.stringify(t.body)}`)
  }
  return id
}

export async function entry(u: User, sprintId: string, category: string | null, body: string, extra: Record<string, unknown> = {}) {
  const r = await post(`/api/sprints/${sprintId}/entries`, u, { category, body, ...extra })
  if (r.status !== 200) throw new Error(`entry ${r.status} ${JSON.stringify(r.body)}`)
  return r.body
}
export const go = (owner: User, sprintId: string, to: string) => post(`/api/sprints/${sprintId}/transition`, owner, { to, confirm: true })
export async function command(u: User, sprintId: string, cmd: unknown) {
  const snap = await get(`/api/sprints/${sprintId}/meeting`, u)
  return post(`/api/sprints/${sprintId}/meeting/command`, u, { expected_version: snap.body.version, command: cmd })
}
export const ids = (arr: { id: string }[]) => arr.map((e) => e.id)

/** Closes collection (collecting → preparing) and returns the shared entries. */
export async function closeCollection(owner: User, sprintId: string) {
  const r = await go(owner, sprintId, 'preparing')
  if (r.status !== 200) throw new Error(`close ${r.status} ${JSON.stringify(r.body)}`)
  return (await get(`/api/sprints/${sprintId}/entries`, owner)).body as { id: string; body: string; category: string | null; theme_id: string | null }[]
}

/** The sprint's room object, read directly (test-only visibility into ordering etc.). */
export async function roomState(sprintId: string): Promise<any> {
  const stub = env.ROOMS.get(env.ROOMS.idFromName(sprintId))
  return (await stub.fetch('https://room/state')).json()
}
export async function roomCancel(sprintId: string): Promise<void> {
  const stub = env.ROOMS.get(env.ROOMS.idFromName(sprintId))
  await stub.fetch('https://room/cancel', { method: 'POST' })
}
/** The room loses everything it stored (as if its session never started). */
export async function roomWipe(sprintId: string): Promise<void> {
  await runInDurableObject(env.ROOMS.get(env.ROOMS.idFromName(sprintId)), (_room, state) => state.storage.deleteAll())
}
/** Calls the room directly, as the Worker does. */
export async function roomPost(sprintId: string, path: string, body: unknown = {}): Promise<{ status: number; body: any }> {
  const r = await env.ROOMS.get(env.ROOMS.idFromName(sprintId)).fetch(`https://room${path}`, { method: 'POST', body: JSON.stringify(body) })
  return { status: r.status, body: await r.json().catch(() => null) }
}

/** Opens the live-hint socket as `user`; messages are collected as strings. */
export async function openSocket(user: User, sprintId: string): Promise<{ socket: WebSocket; messages: string[]; waitFor: (pred: (m: string) => boolean, ms?: number) => Promise<boolean> }> {
  const res = await SELF.fetch(`https://muni.test/api/sprints/${sprintId}/ws`, { headers: { upgrade: 'websocket', origin: ORIGIN, cookie: `muni_session=${user.session}; muni_csrf=${user.csrf}` } })
  if (res.status !== 101 || !res.webSocket) throw new Error(`ws upgrade ${res.status}`)
  const socket = res.webSocket
  const messages: string[] = []
  socket.accept()
  socket.addEventListener('message', (e) => messages.push(String(e.data)))
  const waitFor = (pred: (m: string) => boolean, ms = 3000) =>
    new Promise<boolean>((resolve) => {
      const start = Date.now()
      const tick = () => {
        if (messages.some(pred)) return resolve(true)
        if (Date.now() - start > ms) return resolve(false)
        setTimeout(tick, 25)
      }
      tick()
    })
  return { socket, messages, waitFor }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ------------------------------------------------------------------ passkeys

/** A request with an arbitrary cookie header (the ceremony binding cookie, old sessions, …). */
export async function rawReq<T = any>(method: string, path: string, opts: { cookie?: string; csrf?: string; json?: unknown; origin?: string; ip?: string } = {}): Promise<Res<T>> {
  const headers: Record<string, string> = { origin: opts.origin ?? ORIGIN }
  if (opts.ip) headers['cf-connecting-ip'] = opts.ip
  if (opts.json !== undefined) headers['content-type'] = 'application/json'
  if (opts.cookie) headers.cookie = opts.cookie
  if (opts.csrf) headers['x-csrf-token'] = opts.csrf
  const r = await SELF.fetch(`https://muni.test${path}`, { method, headers, body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined })
  const text = await r.text()
  let body: unknown = text
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    /* text */
  }
  return { status: r.status, body: body as T, headers: r.headers }
}
export const setCookie = (r: Res, name: string) => (r.headers.getSetCookie?.() ?? []).find((c) => c.startsWith(`${name}=`))?.split(';')[0].split('=')[1] ?? null
const userFrom = (r: Res<any>): User => ({ email: r.body.email, session: setCookie(r, 'muni_session')!, csrf: setCookie(r, 'muni_csrf')!, account_id: r.body.account_id })

/** Sign-in options → the authenticator → verify, with the browser's binding cookie. */
export async function passkeyLogin(
  auth: { assert: (o: any, id?: string, over?: any) => Promise<any> },
  opts: { credId?: string; over?: Record<string, unknown>; presented?: User; tamper?: (resp: any) => void; ip?: string } = {},
): Promise<Res<any> & { user?: User; response?: any; binding?: string }> {
  const o = await rawReq('POST', '/api/auth/passkey/login/options', { json: {}, ip: opts.ip })
  if (o.status !== 200) return o
  const binding = setCookie(o, 'muni_wa')!
  const response = await auth.assert(o.body, opts.credId, opts.over)
  opts.tamper?.(response)
  const cookie = [`muni_wa=${binding}`, opts.presented ? `muni_session=${opts.presented.session}` : ''].filter(Boolean).join('; ')
  const r = await rawReq('POST', '/api/auth/passkey/login/verify', { cookie, json: { response }, ip: opts.ip })
  return { ...r, user: r.status === 200 ? userFrom(r) : undefined, response, binding }
}
/** Replays a verify with a given response and binding (for replay and concurrency tests). */
export const passkeyVerify = (response: unknown, binding: string) => rawReq('POST', '/api/auth/passkey/login/verify', { cookie: `muni_wa=${binding}`, json: { response } })

export async function addPasskeyTo(user: User, auth: { register: (o: any, over?: any) => Promise<any> }, opts: { over?: Record<string, unknown>; name?: string; as?: User } = {}): Promise<Res<any> & { response?: any }> {
  const o = await post('/api/auth/passkey/register/options', user)
  if (o.status !== 200) return o
  const response = await auth.register(o.body, opts.over)
  const r = await post('/api/auth/passkey/register/verify', opts.as ?? user, { response, name: opts.name ?? 'Test passkey' })
  return { ...r, response }
}
/** Makes the session look like it signed in long ago (beyond the recent-authentication window). */
export async function ageSession(user: User, minutes = 60) {
  const { sha256Hex } = await import('../src/lib/crypto')
  await env.DB.prepare('UPDATE sessions SET authenticated_at = authenticated_at - ? WHERE token_hash = ?').bind(minutes * 60_000, await sha256Hex(user.session)).run()
}

/** A new, passkey-only account (no email address), signed in. */
export async function passkeySignup(auth: { register: (o: any, over?: any) => Promise<any> }, name = 'Passkey Person', opts: { over?: Record<string, unknown>; tamper?: (r: any) => void; ip?: string } = {}): Promise<Res<any> & { user?: User; response?: any }> {
  const o = await rawReq('POST', '/api/auth/passkey/signup/options', { json: { display_name: name }, ip: opts.ip })
  if (o.status !== 200) return o
  const binding = setCookie(o, 'muni_wa')!
  const response = await auth.register(o.body, opts.over)
  opts.tamper?.(response)
  const r = await rawReq('POST', '/api/auth/passkey/signup/verify', { cookie: `muni_wa=${binding}`, json: { response, name: 'First passkey' }, ip: opts.ip })
  return { ...r, response, user: r.status === 200 ? { email: '', session: setCookie(r, 'muni_session')!, csrf: setCookie(r, 'muni_csrf')!, account_id: r.body.account_id } : undefined }
}
