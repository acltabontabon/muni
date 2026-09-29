/**
 * The workspace (Sprints, People, Settings), end to end: one opening that stays in place while the
 * section changes; direct links, refresh, back and forward; rapid switching between sections and
 * between workspaces never showing another place's data; loading, empty and error states in the
 * section only; membership and settings changes with the right refresh; what owners and members
 * may see and do; keyboard focus; and phones, with larger text. Synthetic accounts and text only.
 *
 * Run against a production build served by the Worker (the dev-only session endpoint must exist):
 *   MUNI_URL=http://localhost:8787 node e2e/workspace.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.MUNI_URL ?? 'http://localhost:8787'
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const d = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
const tag = crypto.randomUUID().slice(0, 5)

async function account(name) {
  const jar = new Map()
  const req = async (method, path, body) => {
    const csrf = jar.get('muni_csrf')
    const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', origin: BASE, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(csrf ? { 'x-csrf-token': csrf } : {}) }, body: body ? JSON.stringify(body) : undefined })
    for (const c of r.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(';')
      const i = kv.indexOf('=')
      jar.set(kv.slice(0, i), kv.slice(i + 1))
    }
    const t = await r.text()
    if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${t.slice(0, 200)}`)
    return t ? JSON.parse(t) : null
  }
  const me = await req('POST', '/api/dev/session', { name, intro: 'done' })
  return { id: me.account_id, name, req, cookies: () => [...jar].map(([n, value]) => ({ name: n, value, domain: new URL(BASE).hostname, path: '/' })) }
}
const join = async (owner, wsId, who) => {
  const { url } = await owner.req('POST', `/api/workspaces/${wsId}/join-links`, { mode: 'direct', expires_in_hours: 24 })
  await who.req('POST', '/api/join/request', { token: url.split('#')[1] })
}
const sprint = (owner, wsId, name, start, ids) =>
  owner.req('POST', `/api/workspaces/${wsId}/sprints`, { name, timezone: 'Asia/Manila', starts_on: d(start), ends_on: d(start + 13), retro_date: d(start + 13), retro_time: '15:00', participant_ids: ids, facilitator_id: owner.id })

// ── Setup: two teams and an empty one.
const owner = await account('Mara Santos')
const member = await account('Ben Okafor')
const other = await account('Liza Dizon')
const asker = await account('Gabriel Ocampo')
const one = await owner.req('POST', '/api/workspaces', { name: `Payments ${tag}` })
const two = await owner.req('POST', '/api/workspaces', { name: `Platform ${tag}` })
const empty = await owner.req('POST', '/api/workspaces', { name: `Fresh ${tag}` })
await join(owner, one.id, member)
await join(owner, one.id, other)
const cur = await sprint(owner, one.id, `Checkout reliability ${tag}`, -5, [owner.id, member.id, other.id])
await owner.req('POST', `/api/sprints/${cur.id}/transition`, { to: 'collecting' })
await sprint(owner, two.id, `Platform only ${tag}`, -5, [owner.id])
await owner.req('POST', `/api/workspaces/${one.id}/invitations`, { email: `invitee-${tag}@example.test` })
const qr = await owner.req('POST', `/api/workspaces/${one.id}/join-links`, { mode: 'approval', expires_in_hours: 168, max_requests: 10 })
await asker.req('POST', '/api/join/request', { token: qr.url.split('#')[1] })

const browser = await chromium.launch()
async function open(who, { phone = false } = {}) {
  const ctx = await browser.newContext({ viewport: phone ? { width: 375, height: 812 } : { width: 1280, height: 900 }, isMobile: phone, hasTouch: phone })
  await ctx.addCookies(who.cookies())
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  return { ctx, page, errors }
}
const W = (id, s = '') => `${BASE}/workspaces/${id}${s}`
const tab = (page, label) => page.locator('nav[aria-label="Workspace"] a', { hasText: label })
const current = (page) => page.locator('nav[aria-label="Workspace"] a[aria-current="page"]').innerText()
const mainText = (page) => page.locator('main').innerText()

try {
  // ── Direct links, the stable opening, back and forward.
  {
    const { ctx, page, errors } = await open(owner)
    await page.goto(W(one.id, '/people'))
    await page.getByText('Ben Okafor').waitFor()
    check('a direct link opens People inside the workspace', (await page.locator('h1').innerText()) === one.name && (await current(page)) === 'People')
    await page.reload()
    await page.getByText('Ben Okafor').waitFor()
    check('refreshing keeps the section', (await current(page)) === 'People')
    // The opening is the same element across sections: it is never taken down and rebuilt.
    await page.locator('.ws-head').evaluate((el) => (el.dataset.probe = 'kept'))
    let gone = false
    const watch = page.evaluate(() => new Promise((r) => { const t0 = performance.now(); const f = () => { if (!document.querySelector('.ws-head[data-probe="kept"] h1')) return r(true); if (performance.now() - t0 > 2500) return r(false); requestAnimationFrame(f) }; f() }))
    await tab(page, 'Settings').click()
    await page.getByLabel('Workspace name').waitFor()
    await tab(page, 'Sprints').click()
    await page.getByText(`Checkout reliability ${tag}`).first().waitFor()
    gone = await watch
    check('the name and navigation stay in place while switching sections', !gone && (await page.locator('.ws-head[data-probe="kept"]').count()) === 1)
    await page.goBack()
    await page.getByLabel('Workspace name').waitFor()
    check('back returns to the previous section', page.url().endsWith('/settings') && (await current(page)) === 'Settings')
    await page.goBack()
    await page.getByText('Ben Okafor').waitFor()
    await page.goForward()
    await page.getByLabel('Workspace name').waitFor()
    check('forward works too', (await current(page)) === 'Settings')

    // ── Rapid switching: the last choice wins, with nothing from the others.
    for (const l of ['People', 'Settings', 'Sprints', 'People', 'Settings', 'People']) await tab(page, l).click()
    await page.getByText('Ben Okafor').waitFor()
    await page.waitForTimeout(800)
    const txt = await mainText(page)
    check('rapid switching ends on the last section chosen, and only it', (await current(page)) === 'People' && !txt.includes('Workspace name') && !txt.includes('Earlier sprints') && !txt.includes('Current sprint'))

    // ── Revisiting shows what was read at once, then checks quietly.
    await tab(page, 'Sprints').click()
    await page.getByText(`Checkout reliability ${tag}`).first().waitFor()
    const t0 = Date.now()
    await tab(page, 'People').click()
    await page.getByText('Ben Okafor').waitFor()
    check('a section seen before appears without waiting for the network', Date.now() - t0 < 400, `${Date.now() - t0} ms`)

    // ── Lifecycle and actions.
    await tab(page, 'Sprints').click()
    await page.getByText('Collecting thoughts').waitFor()
    check('the list says where the current sprint is, and opens it', (await page.locator('.chapter-state').innerText()).includes('Collecting thoughts') && (await page.getByRole('link', { name: 'Open sprint' }).getAttribute('href')) === `/sprints/${cur.id}`)
    check('no stepper, guide or facilitator box on the list: those live on the sprint', (await page.locator('.life, .chapter-fac, .sbar-control').count()) === 0 && (await page.getByText('Sprint guide').count()) === 0)

    // ── Keyboard: sections are links in order, with a visible focus.
    await tab(page, 'People').focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle)
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await page.getByLabel('Workspace name').waitFor()
    check('keyboard focus is visible and Enter opens a section', outline === 'solid' && (await current(page)) === 'Settings')
    check('no script errors', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ── Workspace switching: a slow answer for one workspace never lands in another.
  {
    const { ctx, page } = await open(owner)
    await page.route(`**/api/workspaces/${two.id}/sprints`, async (r) => { await new Promise((x) => setTimeout(x, 1200)); await r.continue() })
    await page.goto(W(two.id))
    await page.waitForTimeout(150)
    await page.goto(W(one.id))
    await page.getByText(`Checkout reliability ${tag}`).first().waitFor()
    await page.waitForTimeout(1600)
    const txt = await mainText(page)
    check('switching workspaces mid-load shows only the chosen workspace', (await page.locator('h1').innerText()) === one.name && !txt.includes(`Platform only ${tag}`))
    // In-app: the switcher, then straight back.
    await page.unroute(`**/api/workspaces/${two.id}/sprints`)
    await page.goto(W(two.id, '/people'))
    await page.getByText('Mara Santos').first().waitFor()
    check('each workspace lists its own people', !(await mainText(page)).includes('Ben Okafor'))
    await ctx.close()
  }

  // ── Loading, empty and error states stay in the section.
  {
    const { ctx, page } = await open(owner)
    let release
    const held = new Promise((r) => (release = r))
    await page.route(`**/api/workspaces/${empty.id}/sprints`, async (r) => { await held; await r.continue() })
    await page.goto(W(empty.id))
    await page.locator('.ws-head h1').waitFor()
    await page.waitForTimeout(600)
    const before = await mainText(page)
    check('before the answer: the opening shows, and no empty state is claimed', (await page.locator('h1').innerText()) === empty.name && !before.includes('first sprint') && (await page.locator('.ws-pending').count()) === 1)
    release()
    await page.getByText(/Set up your first/).waitFor()
    check('after an answer with nothing in it: the first-sprint invitation', true)
    await page.unroute(`**/api/workspaces/${empty.id}/sprints`)

    await page.route(`**/api/workspaces/${empty.id}`, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"internal error","code":"internal"}' }))
    await tab(page, 'People').click()
    await page.getByText('Couldn’t load the people in this workspace.').waitFor()
    check('a failed load says so in the section, with the opening intact', (await current(page)) === 'People' && (await page.locator('h1').innerText()) === empty.name)
    await page.unroute(`**/api/workspaces/${empty.id}`)
    await page.getByRole('button', { name: 'Try again' }).click()
    await page.getByText('Mara Santos').first().waitFor()
    check('trying again loads it', true)
    await ctx.close()
  }

  // ── Membership changes, and what follows from them.
  {
    const { ctx, page } = await open(owner)
    await page.goto(W(one.id, '/people'))
    await page.getByText('Asking to join').waitFor()
    await page.getByRole('button', { name: 'Approve' }).click()
    await page.getByText('Gabriel Ocampo joined').waitFor()
    await page.waitForFunction(() => !document.querySelector('main')?.innerText.includes('Asking to join'))
    const members = page.locator('section[aria-labelledby="members"]')
    check('approving someone adds them to the members, and the request goes', (await members.innerText()).includes('Gabriel Ocampo'))
    await page.getByRole('button', { name: 'Manage Liza Dizon' }).click()
    await page.getByRole('button', { name: 'Make an owner' }).click()
    await page.getByText('Liza Dizon is now an owner').waitFor()
    await page.waitForFunction(() => document.querySelector('section[aria-labelledby="owners"]')?.textContent.includes('Liza Dizon'))
    check('changing a role moves the person to their group', !(await members.innerText()).includes('Liza Dizon'))
    await page.getByRole('button', { name: 'Withdraw' }).click()
    await page.getByText('Invitation withdrawn').waitFor()
    await page.waitForFunction(() => !document.querySelector('main')?.innerText.includes('Invited by email'))
    check('withdrawing an invitation removes it', true)
    await page.getByRole('button', { name: 'Manage Gabriel Ocampo' }).click()
    await page.getByRole('button', { name: 'Remove from workspace…' }).click()
    check('removing someone asks first', await page.getByRole('dialog').getByText('They lose access to this workspace immediately').isVisible())
    await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click()
    await page.getByText('Gabriel Ocampo was removed').waitFor()
    await page.waitForFunction(() => !document.querySelector('section[aria-labelledby="members"]')?.textContent.includes('Gabriel Ocampo'))
    check('removing takes them off the list', true)

    // ── Settings: validation, a draft kept across sections, saving.
    await tab(page, 'Settings').click()
    const name = page.getByLabel('Workspace name')
    await name.waitFor()
    check('nothing to save until something changes', await page.getByRole('button', { name: 'Save changes' }).isDisabled())
    await name.fill(`Payments & Checkout ${tag}`)
    await page.getByLabel('Thoughts, themes and notes').fill('3')
    check('an out-of-range value is explained where it is', await page.getByText('Between 7 and 3650 days.').isVisible() && await page.getByText('Unsaved changes').isVisible())
    await tab(page, 'People').click()
    await page.getByText('Ben Okafor').waitFor()
    await tab(page, 'Settings').click()
    check('unsaved edits are still there after visiting another section', (await page.getByLabel('Workspace name').inputValue()) === `Payments & Checkout ${tag}` && await page.getByText('Unsaved changes').isVisible())
    await page.getByRole('button', { name: 'Save changes' }).click()
    check('an invalid form isn’t sent', await page.getByText('Unsaved changes').isVisible())
    await page.getByLabel('Thoughts, themes and notes').fill('120')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await page.getByText('Settings saved').waitFor()
    await page.getByText('All changes saved').waitFor()
    await page.waitForFunction((n) => document.querySelector('.ws-head h1')?.textContent === n, `Payments & Checkout ${tag}`)
    check('saving updates the workspace’s name in the opening', true)
    await page.waitForFunction(() => document.querySelector('.activity')?.textContent.includes('changed workspace settings'))
    check('the change appears in the activity, in words', !(await page.locator('.activity').innerText()).includes('join_link'))
    await ctx.close()
  }

  // ── A member: no settings, no management, no addresses.
  {
    const { ctx, page } = await open(member)
    await page.goto(W(one.id, '/people'))
    await page.getByText('Mara Santos').first().waitFor()
    check('a member sees no Settings section', (await tab(page, 'Settings').count()) === 0)
    check('a member sees no management or invitations', (await page.getByRole('button', { name: /^Manage / }).count()) === 0 && (await page.getByRole('button', { name: /Invite/ }).count()) === 0 && !(await mainText(page)).includes('@example'))
    await page.goto(W(one.id, '/settings'))
    await page.getByText('Only workspace owners can change these settings.').waitFor()
    check('the settings link, opened directly, says who can change them', (await page.getByLabel('Workspace name').count()) === 0)
    await page.goto(W(empty.id))
    await page.getByText('Can’t open this workspace').waitFor()
    check('a workspace you’re not in says so, without showing it', !(await mainText(page)).includes(empty.name))
    await ctx.close()
  }

  // ── Phones, and larger text.
  {
    const { ctx, page } = await open(owner, { phone: true })
    for (const s of ['', '/people', '/settings']) {
      await page.goto(W(one.id, s))
      await page.locator('.ws-body > *').first().waitFor()
      await page.waitForTimeout(500)
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      await page.evaluate(() => (document.documentElement.style.fontSize = '200%'))
      await page.waitForTimeout(200)
      const zoomed = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      await page.evaluate(() => (document.documentElement.style.fontSize = ''))
      check(`phone ${s || '/'}: no sideways scrolling, at 100% and 200% text`, over <= 0 && zoomed <= 0, `${over} / ${zoomed}px`)
    }
    await page.goto(W(one.id))
    await page.getByText('Collecting thoughts').waitFor()
    const way = await page.getByRole('link', { name: 'Open sprint' }).boundingBox()
    check('phone: the current sprint’s state in a line, and a way in that’s easy to press', await page.locator('.chapter-state').isVisible() && way.height >= 44, `${way.height}px`)
    const menu = await page.locator('.ws-tab').first().boundingBox()
    check('phone: sections have comfortable touch targets', menu.height >= 44, `${menu.height}px`)
    await ctx.close()
  }
} catch (e) {
  check('run completed', false, String(e?.message ?? e).split('\n')[0])
}
await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
