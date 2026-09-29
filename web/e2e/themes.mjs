/**
 * The Themes page (the facilitator's sorting table), end to end, as someone who's never seen it:
 * the three numbered lines, slips with a visible check (click, Enter, Space), naming a theme in the
 * always-open empty pile or in the bar at the foot of the screen, "Add here" on a pile while
 * something is selected, "Take out" on a slip in a theme, dragging, editing a title and an opening
 * question where they're read (Enter and leaving the field save; Escape puts it back), the ⋯ menu
 * (notes, flag, merge, remove), Escape to clear, who may open it, and phones. Synthetic accounts
 * and text only.
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
const loose = (page, text) => page.locator('.sort-loose .sort-slip-btn', { hasText: text })
const pile = (page, i) => page.locator('.sort-pile:not(.sort-pile--ghost)').nth(i)
const piles = (page) => page.locator('.sort-pile:not(.sort-pile--ghost)')

try {
  const { ctx, page, errors } = await open(maya)
  await page.getByRole('heading', { name: /Group into themes/ }).waitFor()
  // The heading shows before the thoughts arrive; wait for the table itself.
  await page.locator('.sort-loose .sort-slip').first().waitFor()
  check('The page names what it’s for, and that it’s optional', /Optional/.test(await page.locator('.sort-head').innerText()))
  check('First visit: how it works, in three numbered lines', (await page.locator('.sort-steps li').count()) === 3 && /Tap the thoughts that belong together/.test(await page.locator('.sort-steps').innerText()))
  check('The sprint stays at two lines, so the sorting starts near the top', (await page.locator('.sbar[data-slim]').count()) === 1 && (await page.locator('.sort-slip').first().boundingBox()).y < 600, `${Math.round((await page.locator('.sort-slip').first().boundingBox()).y)}px`)
  check('Every thought is a slip with a visible check', (await page.locator('.sort-loose .sort-slip').count()) === 6 && (await page.locator('.sort-loose .sort-check').count()) === 6)
  check('The first theme can be named straight away — the field is already there', await page.locator('.sort-pile--ghost input[aria-label="New theme title"]').isVisible() && /Name your first theme/.test(await page.locator('.sort-pile--ghost input').getAttribute('placeholder')))
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/themes-empty.png`, fullPage: true })

  // Select two thoughts, name them in the empty pile.
  await loose(page, 'Staging was down').click()
  await loose(page, 'on-call runbook').click()
  check('Selecting fills the check and brings up the bar with its name field open', (await page.locator('.sort-loose [aria-pressed="true"]').count()) === 2 && /2 selected/.test(await page.locator('.sort-tray').innerText()) && (await page.locator('.sort-tray input[aria-label="New theme title"]').isVisible()))
  check('The empty pile says it will take them', /these 2/.test(await page.locator('.sort-pile--ghost input').getAttribute('placeholder')) && /Create with 2/.test(await page.locator('.sort-pile--ghost button').innerText()))
  const room = await page.evaluate(() => ({ pad: parseFloat(getComputedStyle(document.querySelector('.sort-loose')).paddingBottom), tray: document.querySelector('.sort-tray').getBoundingClientRect().height }))
  check('Desktop: the last thought to sort can scroll clear of the bar', room.pad >= room.tray, JSON.stringify(room))
  await page.waitForTimeout(300)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/themes-selected.png` })
  await page.fill('.sort-pile--ghost input', 'Who owns staging?')
  await page.keyboard.press('Enter')
  await pile(page, 0).waitFor()
  let g = await themes()
  check('Naming it makes a theme of the selected thoughts', g.themes.length === 1 && g.themes[0].title === 'Who owns staging?' && g.themes[0].entries.length === 2 && g.ungrouped.length === 4)
  check('…the bar goes, the guide gives way to the tally, and a new empty pile waits', (await page.locator('.sort-tray').count()) === 0 && /2 of 6/.test(await page.locator('.sort-tally').innerText()) && (await page.locator('.sort-steps').count()) === 0 && /Name another theme/.test(await page.locator('.sort-pile--ghost input').getAttribute('placeholder')))

  // Keyboard: Space selects; the pile offers itself.
  await loose(page, 'Three PRs').focus()
  await page.keyboard.press('Space')
  check('Space selects a thought from the keyboard', (await loose(page, 'Three PRs').getAttribute('aria-pressed')) === 'true')
  check('While something is selected, each pile says “Add here”', /Add the selected thought here/.test(await pile(page, 0).locator('.sort-pile-add').innerText()))
  await pile(page, 0).locator('.sort-pile-add').click()
  await page.waitForFunction(() => document.querySelectorAll('.sort-loose .sort-slip').length === 3)
  g = await themes()
  check('“Add here” puts it in that theme', g.themes[0].entries.length === 3)
  check('Escape clears a selection', await (async () => { await loose(page, 'Pairing').click(); await page.keyboard.press('Escape'); return (await page.locator('.sort-tray').count()) === 0 })())

  // Take out, from inside a theme — no selecting needed.
  await pile(page, 0).locator('.sort-slip', { hasText: 'Three PRs' }).hover()
  await pile(page, 0).locator('.sort-slip', { hasText: 'Three PRs' }).getByRole('button', { name: 'Take out of this theme' }).click()
  await page.waitForFunction(() => document.querySelectorAll('.sort-loose .sort-slip').length === 4)
  check('“Take out” sends a thought back to be sorted', (await themes()).ungrouped.length === 4)

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

  // A second theme by name alone, then the bar's "or add to", then a drag.
  await page.fill('.sort-pile--ghost input', 'Reviews that wait')
  await page.locator('.sort-pile--ghost button', { hasText: 'Create' }).click()
  await pile(page, 1).waitFor()
  check('A theme can also start empty, by name', (await themes()).themes[1].entries.length === 0 && /Empty/.test(await pile(page, 1).innerText()))
  await loose(page, 'Reviews bunch up').click()
  await page.locator('.sort-tray button.sort-tray-to', { hasText: 'Reviews that wait' }).click()
  await page.waitForFunction(() => document.querySelectorAll('.sort-loose .sort-slip').length === 3)
  check('The bar’s “or add to” names every theme', (await themes()).themes[1].entries.length === 1)
  await pile(page, 1).scrollIntoViewIfNeeded()
  const calls = []
  const record = (r) => {
    const path = new URL(r.url()).pathname
    if (path.startsWith('/api/')) calls.push(`${r.method()} ${path}`)
  }
  page.on('request', record)
  await loose(page, 'Three PRs').dragTo(pile(page, 1))
  await page.waitForFunction(() => document.querySelectorAll('.sort-pile:not(.sort-pile--ghost)')[1]?.querySelectorAll('.sort-slip').length === 2)
  await page.waitForTimeout(1500) // the room's hint about the change arrives meanwhile
  page.off('request', record)
  check('Dragging a thought onto a theme still works', (await themes()).themes[1].entries.length === 2)
  check('…in one request: its answer is the table, and its own hint isn’t read again', calls.length === 1 && calls[0].startsWith('PATCH '), calls.join(', '))
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/themes-two.png`, fullPage: true })

  // The ⋯ menu: notes, flag, merge, remove.
  check('Notes stay out of the way until asked for', (await page.locator('.sort-notes').count()) === 0)
  await pile(page, 1).getByRole('button', { name: 'More for this theme' }).click()
  await page.getByRole('menuitem', { name: /Add notes/ }).click()
  check('…and open from the menu', (await pile(page, 1).locator('textarea[aria-label="Summary"]').count()) === 1)
  await pile(page, 1).getByRole('button', { name: 'More for this theme' }).click()
  await page.getByRole('menuitem', { name: /Flag/ }).click()
  await pile(page, 1).locator('text=Flagged for the retro').waitFor()
  check('Flag, from the theme’s menu', (await themes()).themes[1].needs_attention === true)
  await pile(page, 1).getByRole('button', { name: 'More for this theme' }).click()
  await page.getByRole('menuitem', { name: /Merge/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: /Who owns staging/ }).click()
  await page.waitForFunction(() => document.querySelectorAll('.sort-pile:not(.sort-pile--ghost)').length === 1)
  g = await themes()
  check('Merge moves its thoughts and drops the theme', g.themes.length === 1 && g.themes[0].entries.length === 4)
  await pile(page, 0).getByRole('button', { name: 'More for this theme' }).click()
  await page.getByRole('menuitem', { name: /Remove/ }).click()
  check('Removing says what happens to the thoughts', /go back to be sorted/.test(await page.getByRole('dialog').innerText()))
  await page.getByRole('dialog').getByRole('button', { name: 'Remove the theme' }).click()
  await page.locator('.sort-steps').waitFor()
  g = await themes()
  check('…and every thought is back to sort, exactly as written', g.themes.length === 0 && g.ungrouped.length === 6 && TEXTS.every((t) => g.ungrouped.some((e) => e.body === t)))
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
  await pile(M.page, 0).waitFor()
  await M.page.locator('.sort-loose .sort-slip-btn').first().tap()
  await M.page.locator('.sort-tray').waitFor()
  await M.page.waitForTimeout(400) // its short rise
  const f = await M.page.evaluate(() => ({ over: document.documentElement.scrollWidth - document.documentElement.clientWidth, tray: document.querySelector('.sort-tray').getBoundingClientRect(), vh: innerHeight, target: document.querySelector('.sort-tray-to').getBoundingClientRect().height, q: document.querySelector('textarea[aria-label="Opening question"]').scrollWidth <= document.querySelector('textarea[aria-label="Opening question"]').clientWidth + 1 }))
  check('Phone: no sideways scroll', f.over <= 0, `${f.over}px`)
  check('Phone: the bar sits at the foot, full width, with targets a finger can hit', Math.abs(f.tray.bottom - f.vh) < 2 && f.tray.width >= 388 && f.target >= 44, JSON.stringify({ bottom: f.tray.bottom, w: f.tray.width, t: f.target }))
  const slipH = (await M.page.locator('.sort-loose .sort-slip-btn').first().boundingBox()).height
  check('Phone: slips are comfortable to tap, and “Take out” shows without hovering', slipH >= 44 && (await M.page.locator('.sort-takeout').first().evaluate((el) => getComputedStyle(el).opacity)) === '1', `${Math.round(slipH)}px`)
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
