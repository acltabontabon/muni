/**
 * End-to-end checks of offline capture, against a local `wrangler dev` serving the production
 * build (service worker included). Run from web/:  node e2e/offline.mjs [outDir]
 *
 * Each scenario prints PASS/FAIL. The first one also records a video of offline capture
 * reconnecting into a confirmed submission.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.MUNI_URL ?? 'http://localhost:8787'
const OUT = process.argv[2] ?? 'e2e-artifacts'
mkdirSync(OUT, { recursive: true })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

/** A signed-in account with one collecting sprint. `keepLocal` turns on device storage. */
async function account(ctx, { keepLocal = true, name = 'Ana Reyes' } = {}) {
  const page = await ctx.newPage()
  await page.goto(`${BASE}/signin`)
  const info = await page.evaluate(
    async ({ keepLocal, name }) => {
      const email = `e2e-${crypto.randomUUID().slice(0, 8)}@example.test`
      const h = { 'content-type': 'application/json' }
      const csrf = () => document.cookie.match(/muni_csrf=([^;]+)/)?.[1]
      // A signed-in account from the development-only endpoint (passkeys themselves: e2e/passkeys.mjs).
      await fetch('/api/dev/session', { method: 'POST', headers: h, body: JSON.stringify({ name }) })
      void csrf
      const me = await fetch('/api/auth/me').then((r) => r.json())
      const post = (u, b) => fetch(u, { method: 'POST', headers: { ...h, 'x-csrf-token': csrf() }, body: JSON.stringify(b) }).then((r) => r.json())
      const ws = await post('/api/workspaces', { name: 'Payments team' })
      const d = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
      const s = await post(`/api/workspaces/${ws.id}/sprints`, { name: 'Sprint 43 — Search relevance', timezone: 'Asia/Manila', starts_on: d(-4), ends_on: d(9), retro_date: d(10), retro_time: '14:00', retro_duration_min: 45, participant_ids: [me.account_id], facilitator_id: me.account_id, ai_processing: false, reminders_enabled: false })
      await post(`/api/sprints/${s.id}/transition`, { to: 'collecting', confirm: true })
      localStorage.setItem('muni.prefs', JSON.stringify({ lastWorkspace: ws.id, keepLocal }))
      return { email, accountId: me.account_id, workspaceId: ws.id, sprintId: s.id }
    },
    { keepLocal, name },
  )
  return { page, ...info }
}

/** Loads the app and waits until the service worker controls the page (the shell is cached). */
async function openControlled(page) {
  await page.goto(`${BASE}/`)
  await page.evaluate(() => navigator.serviceWorker.ready)
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload()
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
  await page.waitForSelector('textarea[name="thought"]')
}
const mine = (page, sprintId) => page.evaluate((s) => fetch(`/api/sprints/${s}/entries/mine`).then((r) => r.json()), sprintId)
const write = async (page, text) => {
  await page.fill('textarea[name="thought"]', text)
  await page.click('button:has-text("Save thought")')
}
const statusText = (page) => page.locator('[role=status]').allInnerTexts().then((t) => t.join(' | '))

const browser = await chromium.launch()

// 1 ── Offline capture → reopen offline → reconnect into a confirmed submission (recorded).
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, recordVideo: { dir: OUT, size: { width: 1280, height: 860 } } })
  const a = await account(ctx)
  await openControlled(a.page)
  await ctx.setOffline(true)
  await write(a.page, 'Staging went down on Wednesday and nobody knew who owned it.')
  await a.page.waitForTimeout(600)
  const said = await statusText(a.page)
  check('Offline submit says it is saved on this device', /Saved on this device\. We’ll send it when you reconnect\./.test(said), said.slice(0, 120))
  check('Offline item shows "Waiting to send"', await a.page.locator('text=Waiting to send').first().isVisible())
  await a.page.screenshot({ path: `${OUT}/1-offline-queued.png` })
  // Draft restoration: start another thought, close the app, reopen it offline.
  await a.page.fill('textarea[name="thought"]', 'Half-written: the on-call rota for staging')
  await a.page.waitForTimeout(700)
  await a.page.close()
  const b = await ctx.newPage()
  await b.goto(`${BASE}/`)
  await b.waitForSelector('textarea[name="thought"]', { timeout: 10000 }).catch(() => {})
  const shell = await b.locator('textarea[name="thought"]').count()
  check('App opens offline from the cached shell (device keeps drafts)', shell === 1)
  check('Draft restored after reopening', (await b.inputValue('textarea[name="thought"]').catch(() => '')) === 'Half-written: the on-call rota for staging')
  check('Queued thought still waiting after reopening', await b.locator('text=Waiting to send').first().isVisible().catch(() => false))
  check('Offline state is explained', /You’re offline/.test(await statusText(b)))
  await b.screenshot({ path: `${OUT}/2-reopened-offline.png` })
  await ctx.setOffline(false)
  await b.waitForSelector('text=Submitted', { timeout: 15000 }).catch(() => {})
  await b.waitForTimeout(800)
  const list = await mine(b, a.sprintId)
  check('Reconnecting sends it; the server holds exactly one entry', list.length === 1 && /Staging went down/.test(list[0].body), `${list.length} entr${list.length === 1 ? 'y' : 'ies'}`)
  check('List shows it as Submitted, no longer waiting', (await b.locator('text=Waiting to send').count()) === 0 && (await b.locator('text=Submitted').count()) >= 1)
  await b.screenshot({ path: `${OUT}/3-reconnected-submitted.png` })
  await ctx.close()
}

// 2 ── Server accepted, response lost: the retry resolves to the same entry.
{
  const ctx = await browser.newContext()
  const a = await account(ctx)
  await openControlled(a.page)
  let dropped = 0
  await ctx.route('**/api/sprints/*/entries', async (route) => {
    if (route.request().method() === 'POST' && dropped === 0) {
      dropped++
      await route.fetch() // reaches the server, which stores it…
      return route.abort('connectionreset') // …but the response never arrives
    }
    return route.continue()
  })
  await write(a.page, 'Lost-response check')
  await a.page.waitForTimeout(800)
  check('Lost response keeps the thought queued, not "submitted"', (await a.page.locator('text=Waiting to send').count()) === 1)
  await ctx.unroute('**/api/sprints/*/entries')
  await a.page.locator('header button:has-text("waiting")').click().catch(() => {}) // Retry
  await a.page.waitForTimeout(1500)
  const list = await mine(a.page, a.sprintId)
  check('Retry after a lost response creates no duplicate', list.filter((e) => e.body === 'Lost-response check').length === 1 && (await a.page.locator('text=Waiting to send').count()) === 0, `${list.length} entries`)
  await ctx.close()
}

// 3 ── Two tabs with the same queue come online at once.
{
  const ctx = await browser.newContext()
  const a = await account(ctx)
  await openControlled(a.page)
  await ctx.setOffline(true)
  await write(a.page, 'Two tabs, one thought')
  await a.page.waitForTimeout(400)
  const second = await ctx.newPage()
  await second.goto(`${BASE}/`)
  await second.waitForSelector('text=Waiting to send')
  await ctx.setOffline(false) // both tabs see `online` and try to send
  await a.page.waitForTimeout(2500)
  const list = await mine(a.page, a.sprintId)
  check('Two tabs sending the same queue produce one entry', list.filter((e) => e.body === 'Two tabs, one thought').length === 1, `${list.length} entries`)
  await ctx.close()
}

// 4 ── Collection closes before the queued thought reaches the server.
{
  const ctx = await browser.newContext()
  const a = await account(ctx)
  await openControlled(a.page)
  const cookies = await ctx.cookies()
  await ctx.setOffline(true)
  await write(a.page, 'Queued before close')
  await a.page.waitForTimeout(400)
  // The facilitator (same account, another device) closes collection meanwhile.
  const admin = await browser.newContext()
  await admin.addCookies(cookies)
  const ap = await admin.newPage()
  await ap.goto(`${BASE}/signin`)
  await ap.evaluate((s) => fetch(`/api/sprints/${s}/transition`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': document.cookie.match(/muni_csrf=([^;]+)/)[1] }, body: JSON.stringify({ to: 'preparing', confirm: true }) }), a.sprintId)
  await admin.close()
  await ctx.setOffline(false)
  await a.page.waitForSelector('text=Needs attention', { timeout: 10000 }).catch(() => {})
  check('Closed collection: marked "Needs attention", not submitted', (await a.page.locator('text=Needs attention').count()) >= 1 && (await mine(a.page, a.sprintId)).length === 0)
  check('Explains it wasn’t submitted and keeps the text', (await a.page.locator('text=Collection closed before this reached the sprint').count()) === 1 && (await a.page.locator('text=Queued before close').count()) >= 1)
  await a.page.screenshot({ path: `${OUT}/4-closed-needs-attention.png`, fullPage: true })
  await ctx.close()
}

// 5 ── Session expires with a queued thought; another account signs in on the device.
{
  const ctx = await browser.newContext()
  const a = await account(ctx)
  await openControlled(a.page)
  await ctx.setOffline(true)
  await write(a.page, 'Written as Ana')
  await a.page.waitForTimeout(400)
  await ctx.clearCookies() // the session ends
  await ctx.setOffline(false)
  await a.page.evaluate(() => window.dispatchEvent(new Event('online')))
  await a.page.waitForTimeout(1500)
  check('Expired session: nothing sent, thought kept', (await a.page.locator('text=Waiting to send').count()) === 1)
  // Someone else signs in on this device (no sign-out): Ana's queue is neither shown nor sent.
  const b = await account(ctx, { name: 'Ben Cruz' })
  await b.page.goto(`${BASE}/`)
  await b.page.waitForSelector('textarea[name="thought"]')
  await b.page.waitForTimeout(1500)
  check('Another account never sees the first account’s queue', (await b.page.locator('text=Written as Ana').count()) === 0)
  check('…and never sends it under their own name', (await mine(b.page, b.sprintId)).length === 0)
  await ctx.close()
}

// 6 ── Storage unavailable: the text stays in the composer.
{
  const ctx = await browser.newContext()
  const a = await account(ctx)
  await a.page.addInitScript(() => {
    IDBFactory.prototype.open = function () {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    }
  })
  await a.page.goto(`${BASE}/`)
  await a.page.waitForSelector('textarea[name="thought"]')
  await write(a.page, 'Storage is full')
  await a.page.waitForTimeout(600)
  const alert = await a.page.locator('[role=alert]').allInnerTexts()
  check('Storage full: visible error, text kept in the composer', alert.some((t) => /storage|Your text is still here/i.test(t)) && (await a.page.inputValue('textarea[name="thought"]')) === 'Storage is full', alert.join(' ').slice(0, 100))
  await ctx.close()
}

// 7 ── No Background Sync: reconnecting still sends (correctness doesn't depend on it).
{
  const ctx = await browser.newContext()
  const a = await account(ctx)
  await a.page.addInitScript(() => { delete ServiceWorkerRegistration.prototype.sync })
  await openControlled(a.page)
  await ctx.setOffline(true)
  await write(a.page, 'No background sync here')
  await a.page.waitForTimeout(400)
  await ctx.setOffline(false)
  await a.page.waitForTimeout(2000)
  check('Without Background Sync, reconnecting sends the thought', (await mine(a.page, a.sprintId)).some((e) => e.body === 'No background sync here'))
  await ctx.close()
}

// 8 ── Drafts not kept on this device: offline submit says so honestly.
{
  const ctx = await browser.newContext()
  const a = await account(ctx, { keepLocal: false })
  await openControlled(a.page)
  await ctx.setOffline(true)
  await write(a.page, 'Memory only')
  await a.page.waitForTimeout(500)
  const said = await statusText(a.page)
  check('Without device storage, offline submit says it is kept in this tab', /Kept in this tab/.test(said), said.slice(0, 100))
  const dbs = await a.page.evaluate(() => indexedDB.databases().then((d) => d.map((x) => x.name)))
  check('…and nothing is written to device storage', !dbs.includes('muni-device'), dbs.join(','))
  await ctx.close()
}

// 9 ── A new version arrives while unsent writing exists only in this tab: offered, not forced.
{
  const { readFileSync, writeFileSync } = await import('node:fs')
  const swPath = new URL('../dist/sw.js', import.meta.url)
  const original = readFileSync(swPath, 'utf8')
  const ctx = await browser.newContext()
  const a = await account(ctx, { keepLocal: false })
  await openControlled(a.page)
  await a.page.fill('textarea[name="thought"]', 'Typing while an update lands')
  await a.page.waitForTimeout(500)
  try {
    writeFileSync(swPath, `${original}\n// e2e: a newer build\n`)
    // The dev server notices a changed file after a moment (longer with the speech model in dist).
    await a.page.waitForFunction(async () => (await (await fetch('/sw.js', { cache: 'no-store' })).text()).includes('// e2e: a newer build'), null, { timeout: 20000, polling: 250 })
    await a.page.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration()
      for (let i = 0; i < 10 && !r.waiting && !r.installing; i++) {
        await r.update().catch(() => {})
        await new Promise((res) => setTimeout(res, 1000))
      }
    })
    await a.page.waitForSelector('text=A new version of Muni is ready', { timeout: 15000 }).catch(async () => {
      if (process.env.DEBUG) console.log('DEBUG', a.page.url(), JSON.stringify(await a.page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return { waiting: !!r?.waiting, installing: r?.installing?.state ?? null, active: r?.active?.state, controller: !!navigator.serviceWorker.controller } })), JSON.stringify(await a.page.locator('[role=status]').allInnerTexts()))
    })
    check('New version is offered quietly', (await a.page.locator('text=A new version of Muni is ready').count()) === 1)
    await a.page.click('button:has-text("Update")').catch(() => {})
    await a.page.waitForTimeout(400)
    check('Update is held back while unsent writing lives only in this tab', (await a.page.locator('text=only kept in this tab').count()) === 1 && (await a.page.inputValue('textarea[name="thought"]')) === 'Typing while an update lands')
  } finally {
    writeFileSync(swPath, original)
  }
  await ctx.close()
}

// 10 ── The live retro loses its connection: shown as reconnecting, live actions disabled.
{
  const ctx = await browser.newContext()
  const a = await account(ctx)
  await a.page.evaluate(async (s) => {
    const h = { 'content-type': 'application/json', 'x-csrf-token': document.cookie.match(/muni_csrf=([^;]+)/)[1] }
    await fetch(`/api/sprints/${s}/entries`, { method: 'POST', headers: h, body: JSON.stringify({ body: 'For the retro', idempotency_key: crypto.randomUUID() }) })
    for (const to of ['preparing', 'ready', 'live']) await fetch(`/api/sprints/${s}/transition`, { method: 'POST', headers: h, body: JSON.stringify({ to, confirm: true }) })
  }, a.sprintId)
  await a.page.goto(`${BASE}/sprints/${a.sprintId}/room`)
  await a.page.waitForTimeout(2000)
  check('Live room connects', (await a.page.locator('text=Reconnecting to the retro').count()) === 0)
  await ctx.setOffline(true)
  await a.page.evaluate(() => window.dispatchEvent(new Event('offline')))
  await a.page.waitForSelector('text=Reconnecting to the retro', { timeout: 20000 }).catch(() => {})
  const bar = (await a.page.locator('text=Reconnecting to the retro').count()) === 1
  const disabled = await a.page.locator('button:has-text("Mark me present"), button:has-text("I’m here")').first().isDisabled().catch(() => false)
  check('Lost connection shows "Reconnecting" and disables live actions', bar && disabled, `bar=${bar} disabled=${disabled}`)
  await a.page.screenshot({ path: `${OUT}/5-retro-reconnecting.png` })
  await ctx.setOffline(false)
  await a.page.waitForFunction(() => !document.body.innerText.includes('Reconnecting to the retro'), null, { timeout: 30000 }).catch(() => {})
  check('Reconnects on its own when the network returns', (await a.page.locator('text=Reconnecting to the retro').count()) === 0)
  await ctx.close()
}

// 11 ── Chrome's installability audit (manifest, icons, service worker).
{
  const ctx = await browser.newContext()
  const a = await account(ctx)
  await openControlled(a.page)
  const cdp = await ctx.newCDPSession(a.page)
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors')
  check('Chrome reports the app as installable', installabilityErrors.length === 0, installabilityErrors.map((e) => e.errorId).join(',') || 'no errors')
  const manifest = await a.page.evaluate(() => fetch('/manifest.webmanifest').then((r) => r.json()))
  check('Manifest has a stable id, scope, standalone display and a maskable icon', manifest.id === '/' && manifest.scope === '/' && manifest.display === 'standalone' && manifest.icons.some((i) => i.purpose === 'maskable'))
  await ctx.close()
}

// 12 ── After a session expires, signing in again sends what was waiting.
{
  const ctx = await browser.newContext()
  const a = await account(ctx)
  await openControlled(a.page)
  const cookies = await ctx.cookies()
  await ctx.setOffline(true)
  await write(a.page, 'Sent after signing back in')
  await a.page.waitForTimeout(400)
  await ctx.clearCookies()
  await ctx.setOffline(false)
  await a.page.evaluate(() => window.dispatchEvent(new Event('online')))
  await a.page.waitForSelector('text=Your session ended', { timeout: 10000 }).catch(() => {})
  check('Expired session asks to sign in again, page stays', (await a.page.locator('text=Your session ended').count()) === 1 && (await a.page.locator('text=Sent after signing back in').count()) >= 1)
  await ctx.addCookies(cookies) // signing in again (same account)
  await a.page.evaluate(() => window.dispatchEvent(new Event('online')))
  await a.page.waitForTimeout(2500)
  check('…and once signed in, the waiting thought is sent', (await mine(a.page, a.sprintId)).some((e) => e.body === 'Sent after signing back in'))
  await ctx.close()
}

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
