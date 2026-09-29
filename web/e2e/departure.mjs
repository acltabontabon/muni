/**
 * Leaving, end to end: a member leaves a workspace from People; the last owner and a facilitator
 * are told what to hand on first, with the way to do it; someone alone in a workspace deletes it
 * by leaving; and deleting an account from Account — the preview of what goes and what stays, the
 * typed confirmation, signing out here, and the account being gone. Synthetic accounts only.
 *
 * Run against a production build served by the Worker (the dev-only session endpoint must exist):
 *   MUNI_URL=http://localhost:8787 node e2e/departure.mjs
 * With SHOTS=<dir>, screenshots of each dialog are saved there.
 */
import { chromium } from 'playwright'

const BASE = process.env.MUNI_URL ?? 'http://localhost:8787'
const SHOTS = process.env.SHOTS ?? null
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const d = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
const tag = crypto.randomUUID().slice(0, 5)

async function account(name) {
  const jar = new Map()
  const raw = async (method, path, body) => {
    const csrf = jar.get('muni_csrf')
    const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', origin: BASE, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(csrf ? { 'x-csrf-token': csrf } : {}) }, body: body ? JSON.stringify(body) : undefined })
    for (const c of r.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(';')
      const i = kv.indexOf('=')
      jar.set(kv.slice(0, i), kv.slice(i + 1))
    }
    const t = await r.text()
    return { status: r.status, body: t ? JSON.parse(t) : null }
  }
  const req = async (method, path, body) => {
    const r = await raw(method, path, body)
    if (r.status >= 400) throw new Error(`${method} ${path} ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`)
    return r.body
  }
  const me = await req('POST', '/api/dev/session', { name, intro: 'done' })
  return { id: me.account_id, name, req, raw, cookies: () => [...jar].map(([n, value]) => ({ name: n, value, domain: new URL(BASE).hostname, path: '/' })) }
}
const join = async (owner, wsId, who) => {
  const { url } = await owner.req('POST', `/api/workspaces/${wsId}/join-links`, { mode: 'direct', expires_in_hours: 24 })
  await who.req('POST', '/api/join/request', { token: url.split('#')[1] })
}
const sprint = (by, wsId, name, ids) =>
  by.req('POST', `/api/workspaces/${wsId}/sprints`, { name, timezone: 'Asia/Manila', starts_on: d(-5), ends_on: d(8), retro_date: d(8), retro_time: '15:00', participant_ids: ids, facilitator_id: by.id })

// ── Setup: a team of three, a sprint Ben facilitates, and a workspace only Ben is in.
const owner = await account('Mara Santos')
const member = await account('Ben Okafor')
const leaver = await account('Liza Dizon')
const team = await owner.req('POST', '/api/workspaces', { name: `Payments ${tag}` })
await join(owner, team.id, member)
await join(owner, team.id, leaver)
const bens = await sprint(member, team.id, `Ben’s sprint ${tag}`, [member.id, owner.id])
const alone = await member.req('POST', '/api/workspaces', { name: `Side project ${tag}` })

const browser = await chromium.launch()
async function open(who, { phone = false } = {}) {
  const ctx = await browser.newContext({ viewport: phone ? { width: 375, height: 812 } : { width: 1280, height: 900 }, isMobile: phone, hasTouch: phone })
  await ctx.addCookies(who.cookies())
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  return { ctx, page, errors }
}
const shot = async (page, name) => {
  if (!SHOTS) return
  await page.waitForTimeout(500) // let the dialog finish settling
  await page.screenshot({ path: `${SHOTS}/${name}.png` })
}
const openOwnMenu = async (page) => {
  await page.getByRole('button', { name: 'Your membership' }).click()
  await page.getByRole('button', { name: 'Leave workspace…' }).click()
}

try {
  // ── A member leaves.
  {
    const { ctx, page, errors } = await open(leaver)
    await page.goto(`${BASE}/workspaces/${team.id}/people`)
    await page.getByText('Liza Dizon').first().waitFor()
    await openOwnMenu(page)
    const dialog = page.getByRole('dialog')
    await dialog.getByText('You’ll lose access right away').waitFor()
    check('member: leaving says what happens to access and to what they wrote', (await dialog.innerText()).includes('stay in their sprints'))
    await shot(page, 'leave-member')
    await dialog.getByRole('button', { name: 'Leave workspace' }).click()
    await page.waitForURL(`${BASE}/`)
    const me = await leaver.req('GET', '/api/auth/me')
    check('member: after leaving, the workspace is gone from their list and they’re home', !me.workspaces.some((w) => w.id === team.id))
    check('member: no page errors', errors.length === 0, errors.join('; '))
    await ctx.close()
  }

  // ── The last owner, and a facilitator: told what to hand on first.
  {
    const { ctx, page } = await open(owner)
    await page.goto(`${BASE}/workspaces/${team.id}/people`)
    await page.getByText('Mara Santos').first().waitFor()
    await openOwnMenu(page)
    const dialog = page.getByRole('dialog')
    await dialog.getByText('You’re the only owner').waitFor()
    check('last owner: no Leave button, and a way to make someone else an owner', (await dialog.getByRole('button', { name: 'Leave workspace' }).count()) === 0 && (await dialog.getByRole('link', { name: 'Make someone else an owner' }).count()) === 1)
    await shot(page, 'leave-last-owner')
    await ctx.close()
  }
  {
    const { ctx, page } = await open(member)
    await page.goto(`${BASE}/workspaces/${team.id}/people`)
    await page.getByText('Ben Okafor').first().waitFor()
    await openOwnMenu(page)
    const dialog = page.getByRole('dialog')
    await dialog.getByText(`Ben’s sprint ${tag}`).waitFor()
    const link = dialog.getByRole('link', { name: 'Choose another facilitator' })
    check('facilitator: names the sprint and links to its setup', (await link.getAttribute('href')) === `/sprints/${bens.id}/setup`)
    await ctx.close()
  }

  // ── An owner can't remove someone from under a sprint they facilitate; the dialog says why.
  {
    const { ctx, page, errors } = await open(owner)
    await page.goto(`${BASE}/workspaces/${team.id}/people`)
    await page.getByRole('button', { name: 'Manage Ben Okafor' }).click()
    await page.getByRole('button', { name: 'Remove from workspace…' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByText('Ask them to choose another facilitator').waitFor()
    check('removal: names the sprint they facilitate, with no Remove button', (await dialog.innerText()).includes(`Ben’s sprint ${tag}`) && (await dialog.getByRole('button', { name: 'Remove' }).count()) === 0)
    await shot(page, 'remove-facilitator')
    check('removal: no page errors', errors.length === 0, errors.join('; '))
    await ctx.close()
  }

  // ── Alone in a workspace: leaving deletes it, and says so.
  {
    const { ctx, page } = await open(member)
    await page.goto(`${BASE}/workspaces/${alone.id}/people`)
    await page.getByText('Ben Okafor').first().waitFor()
    await openOwnMenu(page)
    const dialog = page.getByRole('dialog')
    await dialog.getByText('You’re the only one here').waitFor()
    check('alone: the dialog is about deleting the workspace', (await dialog.getByRole('heading').innerText()).startsWith('Delete'))
    await shot(page, 'leave-alone')
    await dialog.getByRole('button', { name: 'Delete and leave' }).click()
    await page.waitForURL(`${BASE}/`)
    const gone = await member.raw('GET', `/api/workspaces/${alone.id}`)
    check('alone: the workspace is deleted', gone.status === 403 || gone.status === 404, String(gone.status))
    await ctx.close()
  }

  // ── Deleting an account: blocked while Ben facilitates, then done on a phone once handed on.
  {
    const { ctx, page } = await open(member)
    await page.goto(`${BASE}/account#delete`)
    await page.getByRole('button', { name: 'Delete account…' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByText('there’s something to hand on first').waitFor()
    check('delete: blocked with the sprint to hand on, and no delete button', (await dialog.getByRole('button', { name: 'Delete my account' }).count()) === 0 && (await dialog.innerText()).includes(`Ben’s sprint ${tag}`))
    await shot(page, 'delete-blocked')
    await ctx.close()
  }
  await member.req('PATCH', `/api/sprints/${bens.id}`, { facilitator_id: owner.id })
  const solo2 = await member.req('POST', '/api/workspaces', { name: `Notes ${tag}` })
  {
    const { ctx, page, errors } = await open(member, { phone: true })
    await page.goto(`${BASE}/account#delete`)
    await page.getByRole('button', { name: 'Delete account…' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Type “delete” to confirm').waitFor()
    const text = await dialog.innerText()
    check('delete: says what stays with the team and which workspace goes with them', text.includes(`Payments ${tag}`) && text.includes(`Notes ${tag}`) && text.includes('tied to no one'))
    const button = dialog.getByRole('button', { name: 'Delete my account' })
    check('delete: the button waits for the typed confirmation', await button.isDisabled())
    await dialog.getByLabel('Type “delete” to confirm').fill('delete')
    check('delete: typing it enables the button', await button.isEnabled())
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    check('delete: phone — no sideways scroll', fits)
    await shot(page, 'delete-confirm-phone')
    await button.click()
    await page.waitForURL(/\/signin/)
    const after = await member.raw('GET', '/api/auth/me')
    check('delete: signed out here, and the session no longer works', after.status === 401, String(after.status))
    const team2 = await owner.req('GET', `/api/workspaces/${team.id}`)
    check('delete: the team no longer lists them', !team2.members.some((m) => m.account_id === member.id))
    const audit = await owner.req('GET', `/api/workspaces/${team.id}/audit`)
    check('delete: the team’s activity says someone deleted their account', audit.some((e) => e.action === 'account.deleted' && e.actor_gone))
    check('delete: no page errors', errors.length === 0, errors.join('; '))
    await ctx.close()
  }
} catch (e) {
  check('run completed', false, String(e?.message ?? e).split('\n')[0])
}
await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
