/**
 * The Themes page (the facilitator's sorting table), end to end: picking thoughts up by click and
 * by keyboard, the tray (a new theme, an existing one, back to loose), dragging, editing a title
 * and an opening question where they're read (Enter and leaving the field save; Escape puts it
 * back), the ⋯ menu (flag, merge, remove), who may open it, and phones. Synthetic accounts and
 * text only.
 *
 * Run against a production build served by the Worker (the dev-only session endpoint must exist):
 *   MUNI_URL=http://localhost:8787 node e2e/themes.mjs      (SHOTS=dir to save screenshots)
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.MUNI_URL ?? 'http://localhost:8787'
const SHOTS = process.env.SHOTS ?? null
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const d = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

async function account(name) {
  const jar = new Map()
  const req = async (method, path, body) => {
    const csrf = jar.get('muni_csrf')
    const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', origin: BASE, 'x-muni-client': '5', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(csrf ? { 'x-csrf-token': csrf } : {}) }, body: body ? JSON.stringify(body) : undefined })
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
  return { id: me.account_id, req, cookies: () => [...jar].map(([n, value]) => ({ name: n, value, domain: new URL(BASE).hostname, path: '/' })) }
}

const maya = await account('Maya Reyes')
const ben = await account('Ben Okafor')
const ws = await maya.req('POST', '/api/workspaces', { name: `Harbor ${crypto.randomUUID().slice(0, 4)}` })
const { url } = await maya.req('POST', `/api/workspaces/${ws.id}/join-links`, { mode: 'direct', expires_in_hours: 24 })
await ben.req('POST', '/api/join/request', { token: url.split('#')[1] })
const s = await maya.req('POST', `/api/workspaces/${ws.id}/sprints`, { name: 'Sprint 14', timezone: 'Asia/Manila', starts_on: d(-12), ends_on: d(1), retro_date: d(2), retro_time: '15:00', participant_ids: [maya.id, ben.id], facilitator_id: maya.id, reminders_enabled: false })
await maya.req('POST', `/api/sprints/${s.id}/transition`, { to: 'collecting' })
const TEXTS = [
  'Staging was down most of Wednesday, and nobody was sure who should bring it back.',
  'The on-call runbook still pointed at the old staging cluster.',
  'Three PRs waited more than two days for a first review.',
  'Reviews bunch up on Thursday afternoon, right before the cut.',
  'Pairing with Sam on the migration made it far less scary.',
  'Planning ran forty minutes over — half the tickets weren’t ready.',
]
for (const [i, body] of TEXTS.entries()) await (i % 2 ? ben : maya).req('POST', `/api/sprints/${s.id}/entries`, { body, category: i % 3 ? 'improve' : null, idempotency_key: crypto.randomUUID() })
await maya.req('POST', `/api/sprints/${s.id}/transition`, { to: 'preparing', confirm: true })
const themes = () => maya.req('GET', `/api/sprints/${s.id}/themes`)

const browser = await chromium.launch()
async function open(who, { phone = false } = {}) {
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1360, height: 900 }, isMobile: phone, hasTouch: phone })
  await ctx.addCookies(who.cookies())
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`${BASE}/sprints/${s.id}/prepare`)
  return { ctx, page, errors }
}
const loose = (page, text) => page.locator('.sort-loose .sort-thought-inner', { hasText: text })

try {
  const { ctx, page, errors } = await open(maya)
  await page.getByRole('heading', { name: /Group into themes/ }).waitFor()
  check('The page names what it’s for, and that it’s optional', /Optional/.test(await page.locator('.sort-head').innerText()))
  check('No cards, checkboxes or per-thought menus', (await page.locator('.sort input[type=checkbox], .sort .card, .sort article').count()) === 0)
  check('Everything starts loose, with a tally', (await page.locator('.sort-loose .sort-thought').count()) === 6 && /0 of 6/.test(await page.locator('.sort-tally').innerText()))
  check('No themes yet: an invitation, not an empty box', (await page.locator('.sort-invite').count()) === 1)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/themes-empty.png`, fullPage: true })

  // Pick up two thoughts, make a theme of them.
  await loose(page, 'Staging was down').click()
  await loose(page, 'on-call runbook').click()
  check('Picking up marks the thought (pressed) and shows the tray', (await page.locator('.sort-loose [aria-pressed="true"]').count()) === 2 && /2 picked up/.test(await page.locator('.sort-tray').innerText()))
  await page.locator('.sort-tray button:has-text("New theme")').click()
  await page.fill('.sort-tray input[aria-label="New theme title"]', 'Who owns staging?')
  await page.click('.sort-tray button:has-text("Create")')
  await page.locator('.sort-chapter').first().waitFor()
  let g = await themes()
  check('A new theme is made with the picked-up thoughts', g.themes.length === 1 && g.themes[0].title === 'Who owns staging?' && g.themes[0].entries.length === 2 && g.ungrouped.length === 4)
  check('…the tray goes, and the tally follows', (await page.locator('.sort-tray').count()) === 0 && /2 of 6/.test(await page.locator('.sort-tally').innerText()))

  // Keyboard: focus a thought, Space picks it up; put it in the existing theme.
  await loose(page, 'Three PRs').focus()
  await page.keyboard.press('Space')
  check('Space picks a thought up from the keyboard', (await loose(page, 'Three PRs').getAttribute('aria-pressed')) === 'true')
  await page.locator('.sort-tray button.sort-tray-to', { hasText: 'Who owns staging?' }).click()
  await page.waitForFunction(() => document.querySelectorAll('.sort-loose .sort-thought').length === 3)
  g = await themes()
  check('Putting it in an existing theme', g.themes[0].entries.length === 3)

  // Back to loose from inside a theme.
  await page.locator('.sort-chapter .sort-thought-inner', { hasText: 'Three PRs' }).click()
  check('Inside a theme, the tray offers “Back to loose” (not the theme it’s in)', (await page.locator('.sort-tray button', { hasText: 'Back to loose' }).count()) === 1 && (await page.locator('.sort-tray button.sort-tray-to', { hasText: 'Who owns staging?' }).count()) === 0)
  await page.locator('.sort-tray button', { hasText: 'Back to loose' }).click()
  await page.waitForFunction(() => document.querySelectorAll('.sort-loose .sort-thought').length === 4)
  check('Back to loose works', (await themes()).ungrouped.length === 4)

  // Title and opening question, edited where they're read.
  const title = page.locator('textarea[aria-label="Theme title"]').first()
  await title.fill('Who owns staging, really?')
  await title.press('Enter')
  await page.locator('.sort-saved').first().waitFor({ timeout: 8000 })
  const q = page.locator('textarea[aria-label="Opening question"]').first()
  await q.fill('What would have made Wednesday’s outage shorter?')
  await q.press('Tab')
  await page.waitForTimeout(700)
  g = await themes()
  check('Enter saves a title; leaving the field saves a question', g.themes[0].title === 'Who owns staging, really?' && g.themes[0].question === 'What would have made Wednesday’s outage shorter?')
  await title.fill('Something else')
  await title.press('Escape')
  await page.waitForTimeout(400)
  check('Escape puts it back, unsaved', (await title.inputValue()) === 'Who owns staging, really?' && (await themes()).themes[0].title === 'Who owns staging, really?')

  // A second theme by name, then drag a thought into it.
  await page.click('button:has-text("New theme")')
  await page.fill('.sort-new-form input', 'Reviews that wait')
  await page.click('.sort-new-form button:has-text("Add")')
  await page.locator('.sort-chapter').nth(1).waitFor()
  await loose(page, 'Three PRs').dragTo(page.locator('.sort-chapter').nth(1))
  await page.waitForFunction(() => document.querySelectorAll('.sort-chapter')[1]?.querySelectorAll('.sort-thought').length === 1)
  check('Dragging a thought onto a theme puts it there', (await themes()).themes[1].entries.length === 1)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/themes-two.png`, fullPage: true })

  // The ⋯ menu: flag, merge, remove.
  await page.locator('.sort-chapter').nth(1).getByRole('button', { name: 'More for this theme' }).click()
  await page.getByRole('menuitem', { name: /Flag/ }).click()
  await page.locator('.sort-chapter').nth(1).locator('text=Flagged for the retro').waitFor()
  check('Flag, from the theme’s menu', (await themes()).themes[1].needs_attention === true)
  await page.locator('.sort-chapter').nth(1).getByRole('button', { name: 'More for this theme' }).click()
  await page.getByRole('menuitem', { name: /Merge/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: /Who owns staging/ }).click()
  await page.waitForFunction(() => document.querySelectorAll('.sort-chapter').length === 1)
  g = await themes()
  check('Merge moves its thoughts and drops the theme', g.themes.length === 1 && g.themes[0].entries.length === 3)
  await page.locator('.sort-chapter').first().getByRole('button', { name: 'More for this theme' }).click()
  await page.getByRole('menuitem', { name: /Remove/ }).click()
  check('Removing says what happens to the thoughts', /go back among the loose/.test(await page.getByRole('dialog').innerText()))
  await page.getByRole('dialog').getByRole('button', { name: 'Remove the theme' }).click()
  await page.locator('.sort-invite').waitFor()
  g = await themes()
  check('…and every thought is loose again, exactly as written', g.themes.length === 0 && g.ungrouped.length === 6 && TEXTS.every((t) => g.ungrouped.some((e) => e.body === t)))
  check('No page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  await ctx.close()

  // Only the facilitator.
  const P = await open(ben)
  await P.page.getByText('Only the facilitator prepares themes.').waitFor()
  check('A participant can’t open it', (await P.page.locator('.sort').count()) === 0)
  await P.ctx.close()

  // Phones: no sideways scroll, the tray at the foot, touch targets.
  await maya.req('POST', `/api/sprints/${s.id}/themes`, { title: 'Who owns staging?', question: 'What would have made Wednesday’s outage shorter than it was?', entry_ids: (await themes()).ungrouped.slice(0, 2).map((e) => e.id) })
  const M = await open(maya, { phone: true })
  await M.page.locator('.sort-chapter').waitFor()
  await M.page.locator('.sort-loose .sort-thought-inner').first().tap()
  await M.page.locator('.sort-tray').waitFor()
  await M.page.waitForTimeout(400) // its short rise
  const f = await M.page.evaluate(() => ({ over: document.documentElement.scrollWidth - document.documentElement.clientWidth, tray: document.querySelector('.sort-tray').getBoundingClientRect(), vh: innerHeight, target: document.querySelector('.sort-tray-to').getBoundingClientRect().height, q: document.querySelector('textarea[aria-label="Opening question"]').scrollWidth <= document.querySelector('textarea[aria-label="Opening question"]').clientWidth + 1 }))
  check('Phone: no sideways scroll', f.over <= 0, `${f.over}px`)
  check('Phone: the tray sits at the foot, full width, with targets a finger can hit', Math.abs(f.tray.bottom - f.vh) < 2 && f.tray.width >= 388 && f.target >= 40, JSON.stringify({ bottom: f.tray.bottom, w: f.tray.width, t: f.target }))
  check('Phone: a long question wraps instead of running off', f.q)
  if (SHOTS) await M.page.screenshot({ path: `${SHOTS}/themes-phone.png` })
  await M.ctx.close()
} catch (e) {
  check('Run completed', false, e.message.split('\n')[0])
} finally {
  await browser.close()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
}
