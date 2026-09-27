/**
 * Characters: a person's avatar and whether their own pages wear its world. Stored on the account,
 * returned by /api/auth/me only, and never attached to anything another person can see — not
 * entries, themes, votes, the meeting, member or participant lists, experiments, join requests,
 * audit records, exports, live-socket hints or what the AI provider is sent.
 */
import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { SoftAuthenticator } from './authenticator'
import { closeCollection, entry, get, go, ids, openSocket, passkeySignup, patch, post, req, runJobs, signin, sprint, tag, team, type User } from './harness'
import { AVATAR_IDS } from '../src/lib/avatars'

const me = async (u: User) => (await get('/api/auth/me', u)).body
const events = async (u: User) => ((await get('/api/auth/security-events', u)).body as unknown[]).length

describe('a person’s character', () => {
  it('is offered once to a new account, with its world on by default', async () => {
    const r = await passkeySignup(new SoftAuthenticator(), 'Nia New')
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.avatar).toEqual({ id: null, theme: true, intro: 'choose' })
    expect((await me(r.user!)).avatar.intro).toBe('choose')
  })

  it('never interrupts development accounts unless asked, and shows accounts from before a note', async () => {
    const dev = await req<{ avatar: unknown }>('POST', '/api/dev/session', null, { name: 'Dev' })
    expect(dev.body.avatar).toEqual({ id: null, theme: true, intro: 'done' })
    const u = await signin(`dev-${tag()}@example.com`, 'Dev')
    // 0006 marks every account that already existed as "note" (a quiet line, never a gate).
    await env.DB.prepare('UPDATE accounts SET avatar_intro = 1 WHERE id = ?').bind(u.account_id).run()
    expect((await me(u)).avatar.intro).toBe('note')
    const asked = await req<{ account_id: string }>('POST', '/api/dev/session', null, { name: 'Gate', intro: 'choose' })
    const row = await env.DB.prepare('SELECT avatar_intro FROM accounts WHERE id = ?').bind(asked.body.account_id).first<{ avatar_intro: number }>()
    expect(row!.avatar_intro).toBe(0)
  })

  it('is changed on its own, validated, and never logged as security activity', async () => {
    const u = await signin(`pick-${tag()}@example.com`, 'Pia Pick')
    await env.DB.prepare('UPDATE accounts SET avatar_intro = 0 WHERE id = ?').bind(u.account_id).run()
    const before = await events(u)

    // Avatar only: the name is untouched, the introduction is answered.
    let r = await patch('/api/auth/me', u, { avatar_id: 'kape' })
    expect(r.status).toBe(200)
    expect(r.body.avatar).toEqual({ id: 'kape', theme: true, intro: 'done' })
    expect(r.body.display_name).toBe('Pia Pick')

    // Name only: the character is untouched.
    r = await patch('/api/auth/me', u, { display_name: 'Pia P.' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ display_name: 'Pia P.', avatar: { id: 'kape', theme: true } })

    // The world can be switched off while keeping the character.
    r = await patch('/api/auth/me', u, { avatar_theme: false })
    expect(r.body.avatar).toEqual({ id: 'kape', theme: false, intro: 'done' })
    r = await patch('/api/auth/me', u, { avatar_id: 'sibol', avatar_theme: true })
    expect(r.body.avatar).toEqual({ id: 'sibol', theme: true, intro: 'done' })

    // Refused, changing nothing.
    for (const bad of [{ avatar_id: 'kopi' }, { avatar_id: '__proto__' }, { avatar_id: 'KAPE' }, { avatar_id: 3 }, { avatar_id: ['kape'] }, { avatar_theme: 'yes' }, { avatar_theme: 1 }, { avatar_intro: 'choose' }, { avatar_intro: true }, {}, { unrelated: 1 }, { display_name: '' }]) {
      const x = await patch('/api/auth/me', u, bad)
      expect(x.status, JSON.stringify(bad)).toBe(400)
    }
    expect((await req('PATCH', '/api/auth/me', u, ['kape'])).status).toBe(400)
    expect((await req('PATCH', '/api/auth/me', u, null)).status).toBe(400)
    expect((await me(u)).avatar).toEqual({ id: 'sibol', theme: true, intro: 'done' })

    // Clearing the character: Muni's own look, and the introduction stays answered.
    r = await patch('/api/auth/me', u, { avatar_id: null })
    expect(r.body.avatar).toEqual({ id: null, theme: true, intro: 'done' })

    // "Decide later" on its own.
    await env.DB.prepare('UPDATE accounts SET avatar_intro = 1 WHERE id = ?').bind(u.account_id).run()
    r = await patch('/api/auth/me', u, { avatar_intro: 'done' })
    expect(r.body.avatar.intro).toBe('done')

    // A character this build doesn't know (retired, or a newer client's) reads as none.
    await env.DB.prepare("UPDATE accounts SET avatar_id = 'retired' WHERE id = ?").bind(u.account_id).run()
    expect((await me(u)).avatar.id).toBeNull()

    expect(await events(u)).toBe(before)
  })

  it('only ever reaches its owner', async () => {
    const { owner, members, ws } = await team(2)
    const people = [owner, ...members]
    // Everyone picks a character; one keeps it but switches the world off.
    for (const [i, u] of people.entries()) expect((await patch('/api/auth/me', u, { avatar_id: AVATAR_IDS[i], avatar_theme: i !== 1 })).status).toBe(200)

    // Text that never names a character, so any id found below came from the account.
    const s = await sprint(owner, members, ws, 'collecting')
    await entry(members[0], s, 'improve', 'Tickets arrived without acceptance criteria', { impact: 'a day lost', might_help: 'a checklist' })
    await entry(members[1], s, 'keep', 'Short async stand-ups')
    await entry(owner, s, 'try', 'Rotate the facilitator')
    const shared = await closeCollection(owner, s)
    const themed = await post(`/api/sprints/${s}/themes`, owner, { title: 'Planning', entry_ids: ids(shared) })
    const theme = themed.body.themes[0].id as string
    expect((await post(`/api/sprints/${s}/ai/grouping`, owner)).status).toBe(200)
    await runJobs()
    expect((await go(owner, s, 'ready')).status).toBe(200)
    expect((await post(`/api/sprints/${s}/votes/rounds`, owner)).status).toBe(200)
    expect((await post(`/api/sprints/${s}/votes`, members[0], { theme_id: theme, cast: true })).status).toBe(200)
    expect((await post(`/api/sprints/${s}/votes/rounds/close`, owner, { action: 'close' })).status).toBe(200)

    const { socket, messages, waitFor } = await openSocket(members[1], s)
    await waitFor((m) => m.includes('"hello"'))
    expect((await go(owner, s, 'live')).status).toBe(200)
    for (const u of people) await post(`/api/sprints/${s}/meeting/attendance`, u, { present: true, ready: true })
    await post(`/api/sprints/${s}/meeting/context`, members[0], { theme_id: theme, body: 'More context later' })
    expect((await post(`/api/sprints/${s}/experiments`, owner, { change_to_try: 'Write acceptance criteria before estimates', success_signal: 'No ticket starts without them', theme_id: theme, owner_account_id: members[0].account_id })).status).toBe(200)
    await waitFor((m) => m.includes('experiments'), 1500)

    // Someone new asks to join through the team's QR link, with their own character.
    const link = await post(`/api/workspaces/${ws}/join-links`, owner, {})
    const stranger = await signin(`stranger-${tag()}@example.com`, 'Sam Stranger')
    await patch('/api/auth/me', stranger, { avatar_id: 'porma' })
    expect((await post('/api/join/request', stranger, { token: link.body.url.split('#')[1] })).status).toBe(200)

    const found: string[] = []
    const word = new RegExp(`\\b(${AVATAR_IDS.join('|')})\\b`, 'i')
    const scan = (where: string, v: unknown, out = found): void => {
      if (typeof v === 'string') {
        if (word.test(v)) out.push(`${where}: value “${v.slice(0, 60)}”`)
      } else if (Array.isArray(v)) v.forEach((x, i) => scan(`${where}[${i}]`, x, out))
      else if (v && typeof v === 'object')
        for (const [k, x] of Object.entries(v)) {
          if (/avatar/i.test(k)) out.push(`${where}.${k}`)
          scan(`${where}.${k}`, x, out)
        }
    }
    // The scan does see a character where one is: in the owner's own profile.
    const control: string[] = []
    scan('me', await me(owner), control)
    expect(control.length).toBeGreaterThan(0)
    const paths = [
      `/api/workspaces/${ws}`,
      `/api/workspaces/${ws}/sprints`,
      `/api/workspaces/${ws}/experiments`,
      `/api/workspaces/${ws}/audit`,
      `/api/workspaces/${ws}/join-requests`,
      `/api/workspaces/${ws}/join-links`,
      `/api/workspaces/${ws}/member-keys`,
      `/api/me/capture-target`,
      `/api/sprints/${s}`,
      `/api/sprints/${s}/entries`,
      `/api/sprints/${s}/entries/mine`,
      `/api/sprints/${s}/themes`,
      `/api/sprints/${s}/votes`,
      `/api/sprints/${s}/meeting`,
      `/api/sprints/${s}/experiments`,
      `/api/sprints/${s}/recap`,
      `/api/sprints/${s}/ai`,
      `/api/sprints/${s}/keys`,
      `/api/sprints/${s}/export.md?scope=raw`,
      `/api/sprints/${s}/export.csv?scope=raw`,
      `/api/sprints/${s}/export.md`,
    ]
    let reached = 0
    for (const u of people)
      for (const path of paths) {
        const r = await get(path, u)
        if (r.status === 200) reached++
        scan(`${path} as ${u.email}`, r.body)
      }
    expect(reached, 'most shared views answered').toBeGreaterThan(paths.length * 2)
    socket.close()
    scan('socket', messages)
    const snapshots = await env.DB.prepare('SELECT input_snapshot FROM ai_jobs WHERE sprint_id = ?').bind(s).all<{ input_snapshot: string }>()
    expect(snapshots.results.length).toBeGreaterThan(0)
    scan('ai input', snapshots.results.map((x) => x.input_snapshot))
    expect(found).toEqual([])

    // …while each person still sees their own.
    for (const [i, u] of people.entries()) expect((await me(u)).avatar.id).toBe(AVATAR_IDS[i])
  })
})
