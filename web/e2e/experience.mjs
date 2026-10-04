/** Everyday UX regressions and reproducible documentation screenshots. Synthetic local data only.
 * MUNI_URL=http://localhost:8870 SHOTS=../docs/screenshots node e2e/experience.mjs
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import assert from 'node:assert/strict'

const BASE = process.env.MUNI_URL ?? 'http://localhost:8787'
const SHOTS = process.env.SHOTS
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const browser = await chromium.launch()
const errors = []
let checks = 0
const check = (name, condition) => { assert.ok(condition, name); checks++; console.log(`PASS  ${name}`) }
const date = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
const requests = (context) => async (method, path, body) => {
  const csrf = (await context.cookies()).find((c) => c.name === 'muni_csrf')?.value
  const response = await context.request.fetch(BASE + path, { method, headers: { origin: BASE, ...(csrf ? { 'x-csrf-token': csrf } : {}) }, ...(body ? { data: body } : {}) })
  assert.ok(response.ok(), `${method} ${path}: ${await response.text()}`)
  return response.json()
}
const shot = async (page, name) => {
  if (!SHOTS) return
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0) })
  await page.screenshot({ path: `${SHOTS}/${name}.png`, animations: 'disabled' })
}

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light', reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(String(e)))
  const req = requests(ctx)
  const me = await req('POST', '/api/dev/session', { name: 'Maya Reyes', intro: 'done' })
  const ws = await req('POST', '/api/workspaces', { name: 'Harbor' })
  const teammateContext = await browser.newContext()
  const teammateReq = requests(teammateContext)
  const teammate = await teammateReq('POST', '/api/dev/session', { name: 'Priya Nair', intro: 'done' })
  const { url: joinUrl } = await req('POST', `/api/workspaces/${ws.id}/join-links`, { mode: 'direct', expires_in_hours: 24 })
  await teammateReq('POST', '/api/join/request', { token: joinUrl.split('#')[1] })
  const sprint = await req('POST', `/api/workspaces/${ws.id}/sprints`, { name: 'Sprint 14 · A calmer release', goal: 'Ship with confidence, and leave room to think.', timezone: 'Asia/Manila', starts_on: date(-4), ends_on: date(9), retro_date: date(9), retro_time: '14:00', participant_ids: [me.account_id, teammate.account_id], facilitator_id: me.account_id, reminders_enabled: false })
  await req('POST', `/api/sprints/${sprint.id}/transition`, { to: 'collecting' })
  const url = `${BASE}/sprints/${sprint.id}`
  await page.goto(url)
  await page.getByText('Nothing kept yet.', { exact: false }).waitFor()
  await page.locator('.capture-rhythm summary').click()
  check('New writers can understand capture, reveal, and experiments beside the field', await page.locator('.capture-rhythm li').count() === 3)
  await page.locator('.capture-rhythm summary').click()
  await shot(page, 'capture-empty-desktop')

  const thoughts = [
    ['Pairing on the release checklist caught two gaps before Friday.', 'proud'],
    ['A review buddy would help us keep small changes moving.', 'try', 'Staging fixes waited for a second pair of eyes.'],
    ['The runbook made the handover feel calm for once.', 'keep'],
    ['Planning ran long before we agreed what done meant.', 'improve'],
    ['Writing release notes as we went saved us an evening.', 'keep'],
    ['We found the expired certificate by accident.', 'stop'],
    ['Small PRs got a first review within the hour.', 'proud'],
    ['The staging outage cost us most of Wednesday.', 'improve'],
  ]
  for (const [body, category, impact] of thoughts) await req('POST', `/api/sprints/${sprint.id}/entries`, { body, category, impact, idempotency_key: crypto.randomUUID() })
  await page.reload()
  await page.getByRole('searchbox', { name: 'Find in your thoughts' }).waitFor()
  const search = page.getByRole('searchbox', { name: 'Find in your thoughts' })
  await search.fill('review staging')
  check('Private thought search includes context and every search word', await page.locator('.passage').count() === 1)
  await search.fill('a word that is absent')
  check('An empty search result offers a clear way back', await page.getByRole('button', { name: 'Clear filters' }).isVisible())
  await page.getByRole('button', { name: 'Clear filters' }).click()
  check('Clearing filters restores the collection', await page.locator('.passage').count() === 8)
  const writer = page.locator('textarea[name="thought"]')
  await writer.fill('A small thought, kept while it is fresh.')
  await page.getByRole('button', { name: 'Need a starting point?' }).click()
  await page.getByRole('button', { name: 'Hide the starting point' }).click()
  check('Showing and dismissing a prompt preserves the draft', await writer.inputValue() === 'A small thought, kept while it is fresh.')
  await writer.fill('a'.repeat(2000))
  check('The writer explains its character limit', await page.getByText('0 characters left', { exact: true }).isVisible())
  await writer.fill('A small thought, kept while it is fresh.')
  await shot(page, 'capture-desktop')

  for (const width of [390, 320, 768]) {
    await page.setViewportSize({ width, height: 844 })
    check(`${width}px has no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    if (width < 768) {
      check(`${width}px has visible navigation and touch-size actions`, await page.locator('.mobile-nav').isVisible() && await page.locator('.mobile-nav a').first().evaluate((el) => el.getBoundingClientRect().height >= 44))
    }
    if (width === 390) await shot(page, 'capture-mobile')
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('.mobile-nav').getByRole('link', { name: 'People' }).click()
  await page.waitForURL(`**/workspaces/${ws.id}/people`)
  await page.locator('.mobile-nav').getByRole('link', { name: 'Write' }).click()
  await writer.waitFor()
  await page.waitForFunction(() => document.querySelector('textarea[name="thought"]')?.value === 'A small thought, kept while it is fresh.')
  check('Mobile navigation returns to the writer with its draft intact', await writer.inputValue() === 'A small thought, kept while it is fresh.')
  await writer.fill('')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('link', { name: 'Sprints', exact: true }).click()
  await page.locator('.ws-body').waitFor()
  await page.getByRole('link', { name: 'Open sprint', exact: true }).waitFor()
  await shot(page, 'workspace-desktop')
  await page.setViewportSize({ width: 390, height: 844 })
  await shot(page, 'workspace-mobile')
  await page.getByRole('link', { name: 'New sprint', exact: true }).first().click()
  await page.locator('form').waitFor()
  await shot(page, 'setup-mobile')

  await req('POST', `/api/sprints/${sprint.id}/transition`, { to: 'preparing', confirm: true })
  await page.goto(url)
  const teamSearch = page.getByRole('searchbox', { name: 'Find in the team’s thoughts' })
  await teamSearch.waitFor()
  await teamSearch.fill('review staging')
  check('The revealed collection is searchable without adding names or changing the order', await page.locator('.team-list > li').count() === 1 && !(await page.locator('.team-list').innerText()).includes('Maya Reyes'))
  await page.getByRole('button', { name: 'Clear search' }).click()
  await shot(page, 'reveal-mobile')
  check('No browser exceptions', errors.length === 0)
  console.log(`\n${checks}/${checks} passed`)
} finally {
  await browser.close()
}
