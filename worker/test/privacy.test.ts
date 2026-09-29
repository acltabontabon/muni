/** The privacy boundary, tested from the outside, through the public HTTP API. */
import { describe, expect, it, vi } from 'vitest'
import { env } from 'cloudflare:test'
import { MeetingRoom } from '../src/room'
import { closeCollection, entry, get, go, ids, openSocket, patch, post, req, runJobs, sprint, team } from './harness'

/** Any shared payload must not carry these keys next to entry text. */
const FORBIDDEN_KEYS = ['author', 'author_account_id', 'account_id', 'email', 'created_at', 'updated_at', 'ip', 'user_agent', 'alias', 'avatar', 'avatar_id', 'avatar_theme', 'avatar_intro']

function walk(v: unknown, f: (k: string, v: unknown) => void) {
  if (Array.isArray(v)) v.forEach((x) => walk(x, f))
  else if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      f(k, val)
      walk(val, f)
    }
  }
}

/** Entries (`body` + `category`) and context notes (`body` alone) are what people wrote; check their keys. */
function assertNoAuthorFields(payload: unknown, context: string) {
  const check = (obj: Record<string, unknown>) => {
    if ('body' in obj) for (const key of Object.keys(obj)) expect(FORBIDDEN_KEYS, `${context}: entry object carries \`${key}\``).not.toContain(key)
  }
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) check(payload as Record<string, unknown>)
  walk(payload, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) check(v as Record<string, unknown>)
  })
}

const text = (user: Parameters<typeof get>[1], path: string) => req<string>('GET', path, user)

describe('privacy', () => {
  it('seals entries during collection, even for the facilitator', async () => {
    const { owner, members, ws } = await team(2)
    const s = await sprint(owner, members, ws, 'collecting')
    await entry(members[0], s, 'improve', 'secret while collecting')
    // Facilitator: no shared listing, no themes, no export, no aggregate count.
    expect((await get(`/api/sprints/${s}/entries`, owner)).status).toBe(409)
    expect((await get(`/api/sprints/${s}/themes`, owner)).status).toBe(409)
    expect((await text(owner, `/api/sprints/${s}/export.md?scope=raw`)).status).toBe(409)
    expect((await text(owner, `/api/sprints/${s}/export.csv?scope=raw`)).status).toBe(409)
    const d = await get(`/api/sprints/${s}`, owner)
    expect(d.body.entry_count).toBeNull()
    // "mine" is only ever the caller's own.
    expect((await get(`/api/sprints/${s}/entries/mine`, owner)).body).toHaveLength(0)
    expect((await get(`/api/sprints/${s}/entries/mine`, members[1])).body).toHaveLength(0)
    expect((await get(`/api/sprints/${s}/entries/mine`, members[0])).body).toHaveLength(1)
    // No live hint is emitted for submissions during collection.
    const { socket, messages, waitFor } = await openSocket(owner, s)
    await waitFor((m) => m.includes('"hello"'))
    await entry(members[1], s, 'keep', 'another sealed one')
    expect(await waitFor((m) => m.includes('entries'), 400)).toBe(false)
    expect(messages.join('\n')).not.toContain('sealed')
    socket.close()
    void ws
  })

  it('lets only the sprint’s facilitator close collection', async () => {
    const { owner, members, ws } = await team(2)
    const [fac, writer] = members
    // The workspace owner takes part but doesn't facilitate.
    const created = await post(`/api/workspaces/${ws}/sprints`, owner, { name: 'Sealed', timezone: 'UTC', starts_on: '2026-09-01', ends_on: '2026-09-10', retro_date: '2026-09-11', retro_time: '10:00', participant_ids: [owner.account_id, fac.account_id, writer.account_id], facilitator_id: fac.account_id })
    const s = created.body.id as string
    expect((await go(fac, s, 'collecting')).status).toBe(200)
    await entry(writer, s, 'improve', 'still sealed')
    for (const who of [writer, owner]) {
      const r = await post(`/api/sprints/${s}/transition`, who, { to: 'preparing', confirm: true })
      expect(r.status).toBe(403)
      expect((await get(`/api/sprints/${s}/entries`, who)).status).toBe(409)
    }
    expect((await get(`/api/sprints/${s}`, fac)).body.status).toBe('collecting')
    expect((await go(fac, s, 'preparing')).status).toBe(200)
    expect((await get(`/api/sprints/${s}/entries`, writer)).status).toBe(200)
  })

  it('writes no entry text or email address to the log', async () => {
    const lines: string[] = []
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) => vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))))
    try {
      const { owner, members, ws } = await team(2)
      const s = await sprint(owner, members, ws, 'collecting')
      const needle = 'log-needle-5521'
      const e = await entry(members[0], s, 'improve', `${needle} body`, { impact: `${needle} impact`, might_help: `${needle} help` })
      expect((await patch(`/api/sprints/${s}/entries/${e.id}`, members[0], { category: 'keep', body: `${needle} edited` })).status).toBe(200)
      expect((await post(`/api/sprints/${s}/entries`, members[1], { body: `${needle} `.repeat(400) })).status).toBe(400)
      expect((await req('POST', `/api/sprints/${s}/entries`, members[1], undefined, { 'content-type': 'application/json' })).status).toBe(400)
      await closeCollection(owner, s)
      expect((await post(`/api/sprints/${s}/entries`, members[1], { body: `${needle} late` })).status).toBe(409)
      expect((await req('GET', `/api/sprints/${s}/export.csv?scope=raw`, owner)).status).toBe(200)
      expect((await post(`/api/workspaces/${ws}/invitations`, owner, { email: `${needle}@example.com` })).status).toBe(200)
      await runJobs()
      // Malformed input is a plain 400, not a failure.
      const malformed = await post(`/api/workspaces/${ws}/sprints`, owner, { name: `${needle} sprint`, timezone: 'UTC', starts_on: '2026-09-01', ends_on: '2026-09-10', retro_date: '2026-09-11', retro_time: '10:00', participant_ids: 'not-a-list', facilitator_id: owner.account_id })
      expect(malformed.status).toBe(400)
      // An unexpected failure is logged (path, method, a short error) — and still carries no content:
      // here the room fails while a note with the needle in it is being added.
      const theme = (await post(`/api/sprints/${s}/themes`, owner, { title: 'T' })).body.themes[0].id as string
      expect((await go(owner, s, 'live')).status).toBe(200)
      const real = MeetingRoom.prototype.fetch
      const room = vi.spyOn(MeetingRoom.prototype, 'fetch').mockImplementation(function (this: MeetingRoom, r: Request) {
        if (new URL(r.url).pathname === '/state') throw new Error('the room fell over')
        return real.call(this, r)
      })
      try {
        expect((await post(`/api/sprints/${s}/meeting/context`, members[1], { theme_id: theme, body: `${needle} context` })).status).toBe(500)
      } finally {
        room.mockRestore()
      }
      expect(lines.some((l) => l.includes('request failed')), 'the spy sees the Worker’s own error log').toBe(true)
      const all = lines.join('\n')
      expect(all).not.toContain(needle)
      for (const u of [owner, ...members]) expect(all).not.toContain(u.email)
    } finally {
      spies.forEach((s) => s.mockRestore())
    }
  })

  it('shared representations carry no authorship anywhere', async () => {
    const { owner, members, ws } = await team(3)
    const s = await sprint(owner, members, ws, 'collecting')
    const needle = '=HYPERLINK("x") unique-needle-7431'
    await entry(members[0], s, 'improve', needle)
    await entry(members[1], s, 'keep', 'second entry')
    await entry(members[2], s, 'try', 'third entry')
    await closeCollection(owner, s)

    // REST: shared entries and themes.
    const entries = await get(`/api/sprints/${s}/entries`, members[2])
    expect(entries.status).toBe(200)
    expect(entries.body).toHaveLength(3)
    assertNoAuthorFields(entries.body, 'entries')
    const g = await get(`/api/sprints/${s}/themes`, owner)
    assertNoAuthorFields(g.body, 'themes')
    const g2 = await post(`/api/sprints/${s}/themes`, owner, { title: 'T', entry_ids: ids(entries.body) })
    expect(g2.status).toBe(200)
    assertNoAuthorFields(g2.body, 'themes after grouping')
    // Order is randomised: a reveal_order was assigned to every entry.
    const order = await env.DB.prepare('SELECT count(DISTINCT reveal_order) AS n, count(*) FILTER (WHERE reveal_order IS NULL) AS nulls FROM entries WHERE sprint_id = ?').bind(s).first<{ n: number; nulls: number }>()
    expect(order!.nulls).toBe(0)
    expect(order!.n).toBe(3)

    // Exports: no emails/names, formula-safe CSV.
    expect((await go(owner, s, 'ready')).status).toBe(200)
    const csv = await text(owner, `/api/sprints/${s}/export.csv?scope=raw`)
    expect(csv.status).toBe(200)
    expect(csv.body).toContain("'=HYPERLINK")
    for (const m of members) {
      expect(csv.body).not.toContain(m.email)
      expect(csv.body).not.toContain('Member ')
    }
    const md = await text(owner, `/api/sprints/${s}/export.md?scope=raw`)
    expect(md.status).toBe(200)
    expect(md.body).toContain('unique-needle')
    for (const m of members) expect(md.body).not.toContain(m.email)
    expect(md.body).not.toContain('Member ')
    expect(md.body).not.toContain('2026-09-')
    // Summary export by default excludes raw bodies.
    const summary = await text(members[0], `/api/sprints/${s}/export.md`)
    expect(summary.status).toBe(200)
    expect(summary.body).not.toContain('unique-needle')
    // Raw export is facilitator-only.
    expect((await text(members[0], `/api/sprints/${s}/export.md?scope=raw`)).status).toBe(403)
    expect((await text(members[0], `/api/sprints/${s}/export.csv?scope=raw`)).status).toBe(403)

    // Live socket: hints only. Trigger a change while connected and inspect the payload.
    const { socket, messages, waitFor } = await openSocket(members[0], s)
    await waitFor((m) => m.includes('"hello"'))
    expect((await post(`/api/sprints/${s}/themes`, owner, { title: 'Another' })).status).toBe(200)
    expect(await waitFor((m) => m.includes('"resource":"themes"'))).toBe(true)
    const all = messages.join('\n')
    expect(all).not.toContain('unique-needle')
    expect(all).not.toContain('Another')
    for (const m of members) expect(all).not.toContain(m.account_id)
    socket.close()

    // Audit log: ids only.
    const audit = await get(`/api/workspaces/${ws}/audit`, owner)
    expect(audit.status).toBe(200)
    expect(JSON.stringify(audit.body)).not.toContain('unique-needle')
  })

  it('keeps votes private until the round closes and never names voters', async () => {
    const { owner, members, ws } = await team(2)
    const s = await sprint(owner, members, ws, 'collecting')
    await entry(members[0], s, 'improve', 'a')
    const entries = await closeCollection(owner, s)
    const g = await post(`/api/sprints/${s}/themes`, owner, { title: 'T', entry_ids: ids(entries) })
    const theme = g.body.themes[0].id as string
    await go(owner, s, 'ready')
    expect((await post(`/api/sprints/${s}/votes/rounds`, owner)).status).toBe(200)
    expect((await post(`/api/sprints/${s}/votes`, members[0], { theme_id: theme, cast: true })).status).toBe(200)
    // While open: the other member sees no totals and not the voter's choice.
    const v = await get(`/api/sprints/${s}/votes`, members[1])
    expect(v.body.current.totals).toBeNull()
    expect(v.body.current.my_votes).toHaveLength(0)
    const themes = await get(`/api/sprints/${s}/themes`, owner)
    expect(themes.body.themes[0].votes).toBeNull()
    // After close: totals only.
    expect((await post(`/api/sprints/${s}/votes/rounds/close`, owner, { action: 'close' })).status).toBe(200)
    const after = await get(`/api/sprints/${s}/votes`, members[1])
    expect(after.body.current).toBeNull()
    expect(after.body.previous[0].totals[theme]).toBe(1)
    expect(JSON.stringify(after.body)).not.toContain(members[0].account_id)
    expect(JSON.stringify(after.body)).not.toContain(members[0].email)
    const themesAfter = await get(`/api/sprints/${s}/themes`, members[1])
    expect(themesAfter.body.themes[0].votes).toBe(1)
  })

  it('never echoes entry bodies in error responses', async () => {
    const { owner, members, ws } = await team(1)
    const s = await sprint(owner, members, ws, 'collecting')
    // An oversized body triggers a validation error.
    const big = 'log-needle-9182 '.repeat(200)
    const r = await post(`/api/sprints/${s}/entries`, members[0], { category: 'improve', body: big })
    expect(r.status).toBe(400)
    expect(JSON.stringify(r.body)).not.toContain('log-needle')
    // A conflict path (closed collection) likewise.
    await entry(members[0], s, 'keep', 'fine')
    await closeCollection(owner, s)
    const late = await post(`/api/sprints/${s}/entries`, members[0], { category: 'improve', body: 'late-needle-3311' })
    expect(late.status).toBe(409)
    expect(JSON.stringify(late.body)).not.toContain('late-needle')
    // Editing after close: same.
    const mine = await get(`/api/sprints/${s}/entries/mine`, members[0])
    const p = await req('PATCH', `/api/sprints/${s}/entries/${mine.body[0].id}`, members[0], { category: 'keep', body: 'edit-needle-4412' })
    expect(p.status).toBe(409)
    expect(JSON.stringify(p.body)).not.toContain('edit-needle')
  })

  it('offers no author lookup route', async () => {
    const { owner, members, ws } = await team(1)
    const s = await sprint(owner, members, ws, 'collecting')
    const e = await entry(members[0], s, 'improve', 'who wrote this')
    await closeCollection(owner, s)
    for (const path of [`/api/sprints/${s}/entries/${e.id}/author`, `/api/entries/${e.id}`, `/api/workspaces/${ws}/entries`, `/api/sprints/${s}/entries/${e.id}`]) {
      const r = await get(path, owner)
      expect([404, 405], `${path} -> ${r.status}`).toContain(r.status)
    }
  })
})
