/**
 * Limits that hold under concurrency, the edge rate limiter in front of D1, and the byte budget of
 * an encrypted thought. Each cap is hit by more requests at once than it has room for: the count is
 * part of the write, so exactly the room is taken and the rest are refused as before.
 */
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { b64u, newKeyPair, newRecoveryKey, newSprintSecret, sealEntry, sprintKeys, wrapForRecovery, wrapSprintSecret } from '../../web/src/lib/e2ee/crypto'
import worker from '../src/index'
import { config } from '../src/lib/config'
import { sendMail } from '../src/lib/email'
import { MAX_ENTRIES_EACH } from '../src/lib/limits'
import { limit } from '../src/lib/ratelimit'
import { thoughtEnvelopeMax } from '../src/lib/sealed'
import { closeCollection, entry, go, post, put, sprint, tag, team, type User } from './harness'

const n = async (sql: string, ...args: unknown[]) => Number((await env.DB.prepare(sql).bind(...args).first<{ n: number }>())!.n)
async function insert(sql: string, rows: unknown[][]) {
  for (let i = 0; i < rows.length; i += 100) await env.DB.batch(rows.slice(i, i + 100).map((r) => env.DB.prepare(sql).bind(...r)))
}
/** How many answered with `status`. */
const answered = (results: { status: number }[], status: number) => results.filter((r) => r.status === status).length

describe('caps under concurrency', () => {
  it('keep one person’s thoughts to MAX_ENTRIES_EACH when several are sent at once', async () => {
    const { owner, members, ws } = await team(1)
    const s = await sprint(owner, members, ws, 'collecting')
    const room = 3
    const now = Date.now()
    await insert('INSERT INTO entries (id, sprint_id, author_account_id, category, body, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', Array.from({ length: MAX_ENTRIES_EACH - room }, (_, i) => [crypto.randomUUID(), s, members[0].account_id, 'keep', `thought ${i}`, now, now]))
    const results = await Promise.all(Array.from({ length: room + 3 }, (_, i) => post(`/api/sprints/${s}/entries`, members[0], { category: 'improve', body: `at once ${i}`, idempotency_key: crypto.randomUUID() })))
    expect(answered(results, 200)).toBe(room)
    const refused = results.filter((r) => r.status !== 200)
    expect(refused.map((r) => r.status)).toEqual([409, 409, 409])
    for (const r of refused) expect(r.body.error).toBe(`you’ve saved ${MAX_ENTRIES_EACH} entries for this sprint — that’s the limit`)
    expect(await n('SELECT count(*) AS n FROM entries WHERE sprint_id = ? AND author_account_id = ?', s, members[0].account_id)).toBe(MAX_ENTRIES_EACH)
    // Someone else in the same sprint still has all of their own room.
    expect((await post(`/api/sprints/${s}/entries`, owner, { body: 'the facilitator’s own' })).status).toBe(200)
  })

  it('keep a sprint to ten experiments when more are proposed at once', async () => {
    const { owner, members, ws } = await team(1)
    const s = await sprint(owner, members, ws, 'collecting')
    await entry(members[0], s, 'improve', 'reviews take days')
    await closeCollection(owner, s)
    await go(owner, s, 'ready')
    await go(owner, s, 'live')
    const results = await Promise.all(
      Array.from({ length: 13 }, (_, i) => post(`/api/sprints/${s}/experiments`, owner, { change_to_try: `For the next sprint, reserve review window number ${i}`, success_signal: 'PRs wait less', override_limit: true })),
    )
    expect(answered(results, 200)).toBe(10)
    for (const r of results.filter((x) => x.status !== 200)) {
      expect(r.status).toBe(409)
      expect(r.body.error).toBe('ten experiments is the hard limit')
    }
    expect(await n('SELECT count(*) AS n FROM experiments WHERE sprint_id = ?', s)).toBe(10)
    // Only what was kept is recorded.
    expect(await n("SELECT count(*) AS n FROM audit_events WHERE sprint_id = ? AND action = 'experiment.proposed'", s)).toBe(10)
    // Without the override, the soft limit still answers as it did.
    const soft = await post(`/api/sprints/${s}/experiments`, owner, { change_to_try: 'For the next sprint, one more review window', success_signal: 'x y z' })
    expect(soft.status).toBe(409)
    expect(soft.body.error).toBe('ten experiments is the hard limit')
  })

  it('count a rate limit in the same statement that records it', async () => {
    const bucket = `race:${tag()}`
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => limit(env.DB, bucket, 5, 60_000)))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5)
    for (const r of results.filter((x): x is PromiseRejectedResult => x.status === 'rejected')) {
      expect(r.reason.status).toBe(429)
      expect(r.reason.extra.retry_after_seconds).toBeGreaterThan(0)
    }
    expect(await n('SELECT count(*) AS n FROM rate_events WHERE bucket = ?', bucket)).toBe(5)
  })

  it('send no more than the daily email limit when several go at once', async () => {
    const sent = () => n("SELECT count(*) AS n FROM rate_events WHERE bucket = 'email-sent' AND at > ?", Date.now() - 86_400_000)
    const cfg = config({ ...env, EMAIL_DAILY_LIMIT: String((await sent()) + 3) } as unknown as Parameters<typeof config>[0])
    const t = tag()
    const to = Array.from({ length: 6 }, (_, i) => `race-${i}-${t}@example.com`)
    const results = await Promise.allSettled(to.map((address) => sendMail(cfg, env.DB, { to: address, subject: 'at once', body: 'x' })))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3)
    for (const r of results.filter((x): x is PromiseRejectedResult => x.status === 'rejected')) expect(r.reason.message).toMatch(/daily email limit \(\d+\) is reached/)
    expect(await n(`SELECT count(*) AS n FROM dev_mail WHERE to_addr IN (${to.map(() => '?').join(',')})`, ...to)).toBe(3)
  })
})

describe('the edge rate limiter', () => {
  /** A request straight to the Worker, with `bindings` over the test environment's. */
  async function call(method: string, path: string, bindings: Record<string, unknown>, json?: unknown) {
    const ctx = createExecutionContext()
    const res = await worker.fetch(
      new Request(`https://muni.test${path}`, { method, headers: { origin: 'http://localhost:5173', 'cf-connecting-ip': '203.0.113.9', ...(json === undefined ? {} : { 'content-type': 'application/json' }) }, body: json === undefined ? undefined : JSON.stringify(json) }),
      { ...env, ...bindings } as never,
      ctx,
    )
    await waitOnExecutionContext(ctx)
    return { status: res.status, body: (await res.json()) as any }
  }
  const limiter = (success: boolean) => {
    const keys: string[] = []
    return { keys, binding: { limit: async ({ key }: { key: string }) => (keys.push(key), { success }) } }
  }
  /** A database that records (and refuses) every query or batch that reaches it. */
  const untouchable = () => {
    const touched: string[] = []
    const refuse = (name: string) => () => {
      touched.push(name)
      throw new Error('D1 was touched')
    }
    return { touched, db: { prepare: refuse('prepare'), batch: refuse('batch'), exec: refuse('exec'), withSession: refuse('withSession') } }
  }

  it('refuses a signed-out flood with 429 before D1 is touched', async () => {
    for (const path of ['/api/auth/passkey/login/options', '/api/auth/passkey/signup/options', '/api/join/preview', '/api/invitations/preview']) {
      const { keys, binding } = limiter(false)
      const { touched, db } = untouchable()
      const r = await call('POST', path, { EDGE_LIMIT: binding, DB: db }, {})
      expect(r.status, path).toBe(429)
      expect(r.body.code).toBe('rate_limited')
      expect(keys).toEqual(['203.0.113.9'])
      expect(touched, path).toEqual([])
    }
    // The stand-in database does notice: let through, the same request reaches it.
    const { touched, db } = untouchable()
    expect((await call('POST', '/api/join/preview', { EDGE_LIMIT: limiter(true).binding, DB: db }, { token: 'x'.repeat(43) })).status).toBe(500)
    expect(touched.length).toBeGreaterThan(0)
  })

  it('leaves signed-in reads and other paths to the D1 limits', async () => {
    const { keys, binding } = limiter(false)
    expect((await call('GET', '/api/auth/me', { EDGE_LIMIT: binding })).status).toBe(401)
    expect((await call('POST', '/api/workspaces', { EDGE_LIMIT: binding }, { name: 'x' })).status).not.toBe(429)
    expect(keys).toEqual([])
  })

  it('changes nothing when the binding is missing, or lets the request through', async () => {
    const token = { token: 'x'.repeat(43) }
    const missing = await call('POST', '/api/join/preview', { EDGE_LIMIT: undefined }, token)
    expect(missing.status).toBe(200)
    expect(missing.body.valid).toBe(false)
    const { keys, binding } = limiter(true)
    expect(await call('POST', '/api/join/preview', { EDGE_LIMIT: binding }, token)).toEqual(missing)
    expect(keys).toEqual(['203.0.113.9'])
    // A limiter that fails lets the request through too.
    expect(await call('POST', '/api/join/preview', { EDGE_LIMIT: { limit: async () => { throw new Error('unavailable') } } }, token)).toEqual(missing)
  })
})

describe('an encrypted thought’s byte budget', () => {
  async function encryptedSprint(owner: User, members: User[], ws: string) {
    const person = async (u: User) => {
      const keys = newKeyPair()
      expect((await put('/api/me/keys', u, { public_key: b64u(keys.pk), recovery_blob: wrapForRecovery(keys.sk, newRecoveryKey(), u.account_id) })).status).toBe(200)
      return keys
    }
    const fac = await person(owner)
    const author = await person(members[0])
    const secret = newSprintSecret()
    const k = sprintKeys(secret, 1)
    const id = crypto.randomUUID()
    const r = await post(`/api/workspaces/${ws}/sprints`, owner, {
      id, name: 'Sprint B', timezone: 'UTC', starts_on: '2026-09-14', ends_on: '2026-09-27', retro_date: '2026-09-28', retro_time: '14:00',
      participant_ids: [members[0].account_id], facilitator_id: owner.account_id, reminders_enabled: false,
      encryption: 'e1', sprint_key: { public_key: b64u(k.pk) },
      key_wraps: [{ account_id: owner.account_id, version: 1, recipient_public_key: b64u(fac.pk), wrapped: wrapSprintSecret(fac.pk, secret, { sprintId: id, version: 1, recipientId: owner.account_id }) }],
    })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect((await go(owner, id, 'collecting')).status).toBe(200)
    return { id, pk: k.pk, author }
  }
  const max = 2000

  it('takes the longest thought the capture form allows, and not much more', async () => {
    const { owner, members, ws } = await team(1)
    const s = await encryptedSprint(owner, members, ws)
    const send = (body: string, recordId: string) => post(`/api/sprints/${s.id}/entries`, members[0], { id: recordId, idempotency_key: recordId, body, category: 'improve' })
    // Every field full of 3-byte characters: the most UTF-8 a field of `max` UTF-16 units can hold.
    // Then 4-byte ones (two units each), and characters JSON escapes.
    for (const fill of ['界', '😀'.repeat(1), '"\\\n']) {
      const text = fill.repeat(Math.ceil(max / fill.length)).slice(0, max)
      const id = crypto.randomUUID()
      const sealed = sealEntry({ sprintId: s.id, recordId: id, version: 1, sprintPk: s.pk, authorPk: s.author.pk }, { body: text, impact: text, might_help: text })
      expect(sealed.length).toBeLessThanOrEqual(thoughtEnvelopeMax(max))
      const r = await send(sealed, id)
      expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200)
    }
    // The worst case is the arithmetic in lib/sealed.ts: what's left is the headroom and the key
    // version's unused digits.
    const id = crypto.randomUUID()
    const worst = sealEntry({ sprintId: s.id, recordId: id, version: 1, sprintPk: s.pk, authorPk: s.author.pk }, { body: '界'.repeat(max), impact: '界'.repeat(max), might_help: '界'.repeat(max) })
    expect(thoughtEnvelopeMax(max) - worst.length).toBeGreaterThanOrEqual(1024)
    expect(thoughtEnvelopeMax(max) - worst.length).toBeLessThanOrEqual(1024 + 16)
    // One character past the budget is refused before anything else is looked at.
    const over = await send(`e1.${'A'.repeat(thoughtEnvelopeMax(max) - 2)}`, crypto.randomUUID())
    expect(over.status).toBe(400)
    expect(over.body.error).toBe('The observation is too long')
  })
})
