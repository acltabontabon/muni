/**
 * Test harness: real HTTP through the Worker (SELF), the real D1 and room
 * bindings from the test pool. Every test mints its own accounts and
 * workspace with unique emails, so tests never depend on each other.
 */
import { env, SELF } from 'cloudflare:test'

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
export async function codeFor(email: string): Promise<string> {
  const m = await lastMailTo(email)
  if (!m) throw new Error(`no sign-in mail for ${email}`)
  return m.subject.split(' ')[0]
}

export async function verify(email: string, code: string, name = 'Someone'): Promise<Res<any> & { user?: User }> {
  const r = await req<any>('POST', '/api/auth/verify', null, { email, code, display_name: name })
  if (r.status !== 200) return r
  const cookies = r.headers.getSetCookie?.() ?? []
  const find = (n: string) => cookies.find((c) => c.startsWith(`${n}=`))?.split(';')[0].split('=')[1] ?? ''
  return { ...r, user: { email: email.toLowerCase(), session: find('muni_session'), csrf: find('muni_csrf'), account_id: r.body.account_id } }
}

export async function signin(email: string, name = 'Someone'): Promise<User> {
  const r = await post('/api/auth/request-code', null, { email })
  if (r.status !== 200) throw new Error(`request-code ${r.status} ${JSON.stringify(r.body)}`)
  const v = await verify(email, await codeFor(email.toLowerCase()), name)
  if (!v.user) throw new Error(`verify failed ${v.status} ${JSON.stringify(v.body)}`)
  return v.user
}

/** Runs queued jobs (emails, AI) until none are due. */
export async function runJobs() {
  const { runDue } = await import('../src/jobs')
  await runDue(env as any, 50)
}

export async function inviteToken(email: string): Promise<string> {
  await runJobs()
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
    ai_processing: true,
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
