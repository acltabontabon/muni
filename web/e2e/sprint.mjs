/**
 * A sprint's one page, end to end, as the facilitator and as a participant: create → contribute →
 * close collection early → the closed state → reopen → close again → start the retro → record
 * outcomes → come back later. Also: the header's "Write" and "/" as shortcuts to the same page,
 * the old outcomes link, refreshes and a second tab following along, a double-clicked transition,
 * a participant mid-sentence and mid-submit when collection closes, workspace switching, the
 * workspace's sprint list, and phones. Synthetic accounts and text only.
 *
 * Run against a production build served by the Worker (the dev-only session endpoint must exist):
 *   MUNI_URL=http://localhost:8787 node e2e/sprint.mjs      (SHOTS=dir to save screenshots)
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

const browser = await chromium.launch()
async function open(who, { phone = false, theme = 'light', ws } = {}) {
  const ctx = await browser.newContext({ viewport: phone ? { width: 375, height: 812 } : { width: 1360, height: 900 }, isMobile: phone, hasTouch: phone, colorScheme: theme })
  await ctx.addCookies(who.cookies())
  if (ws) await ctx.addInitScript((w) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('muni.prefs', JSON.stringify({ lastWorkspace: w })); sessionStorage.setItem('seeded', '1') } }, ws)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  return { ctx, page, errors }
}
const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}
const S = (id, s = '') => `${BASE}/sprints/${id}${s}`
const bar = (page) => page.locator('section.sbar')
const status = async (page) => (await page.locator('.sbar-state').innerText()).trim()
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

// ── Setup: a facilitator, a participant, a second team, and a sprint not open yet.
const mara = await account('Mara Santos')
const ben = await account('Ben Okafor')
const ws = await mara.req('POST', '/api/workspaces', { name: `Payments ${tag}` })
const other = await mara.req('POST', '/api/workspaces', { name: `Platform ${tag}` })
await join(mara, ws.id, ben)
const sprint = await mara.req('POST', `/api/workspaces/${ws.id}/sprints`, { name: `Checkout reliability ${tag}`, goal: 'Fewer failed payments at peak', timezone: 'Asia/Manila', starts_on: d(-8), ends_on: d(5), retro_date: d(6), retro_time: '15:00', participant_ids: [mara.id, ben.id], facilitator_id: mara.id, reminders_enabled: false })
const elsewhere = await mara.req('POST', `/api/workspaces/${other.id}/sprints`, { name: `Platform only ${tag}`, timezone: 'Asia/Manila', starts_on: d(-3), ends_on: d(10), retro_date: d(11), retro_time: '10:00', participant_ids: [mara.id], facilitator_id: mara.id, reminders_enabled: false })
await mara.req('POST', `/api/sprints/${elsewhere.id}/transition`, { to: 'collecting' })

try {
  const F = await open(mara, { ws: ws.id })
  const P = await open(ben, { ws: ws.id })

  // ── Not open yet: "/" opens the sprint; the bar says where it is and who does what.
  await F.page.goto(BASE + '/')
  await F.page.waitForURL(`**/sprints/${sprint.id}`)
  await bar(F.page).waitFor()
  check('"/" opens the facilitator’s sprint page (one home per sprint)', F.page.url() === S(sprint.id))
  check('The sprint’s name is the page’s one h1', (await F.page.locator('h1').count()) === 1 && (await F.page.locator('h1').innerText()).includes('Checkout reliability'))
  check('Draft: "Not open yet", with the next change and what it does', (await status(F.page)) === 'Not open yet' && (await F.page.getByRole('button', { name: 'Open collection' }).count()) === 1 && /start adding thoughts/.test(await bar(F.page).innerText()))
  check('Three stops, not five steps; the retro shows as planned', (await F.page.locator('.sbar-progress li').count()) === 3 && /Planned/.test(await F.page.locator('.sbar-progress').innerText()))
  check('No "Sprint guide", no five-step stepper, no tinted facilitator banner', (await F.page.locator('text=Sprint guide').count()) === 0 && (await F.page.locator('.life, .steps, .fac-area').count()) === 0)
  await P.page.goto(BASE + '/')
  await P.page.waitForURL(`**/sprints/${sprint.id}`)
  await bar(P.page).waitFor()
  check('Participant: the same page, the same state, no facilitator controls', (await status(P.page)) === 'Not open yet' && (await P.page.locator('.sbar-control').count()) === 0 && (await P.page.locator('text=You’re facilitating').count()) === 0)
  check('Participant: told who opens it, and that there’s nothing to do yet', /hasn’t opened this sprint for thoughts yet/.test(await bar(P.page).innerText()) && /Nothing to do until then/.test(await P.page.locator('main').innerText()))
  await shot(F.page, '01-draft-facilitator')

  // ── Open collection: both tabs follow without a refresh.
  await F.page.getByRole('button', { name: 'Open collection' }).click()
  await F.page.locator('.sbar-state', { hasText: 'Collecting thoughts' }).waitFor()
  await P.page.locator('textarea[name="thought"]').waitFor({ timeout: 8000 })
  check('Opening collection updates the participant’s open page by itself', (await status(P.page)) === 'Collecting thoughts')
  check('Facilitator copy: close any time, no "wraps up"', /don’t have to wait/.test(await bar(F.page).innerText()) && !/wraps up/.test(await F.page.locator('main').innerText()))
  check('One composer on the page', (await P.page.locator('textarea[name="thought"]').count()) === 1 && (await F.page.locator('textarea[name="thought"]').count()) === 1)

  // ── Contribute.
  await P.page.fill('textarea[name="thought"]', 'Synthetic: the retry banner confused two customers')
  await P.page.getByRole('button', { name: 'Add to sprint' }).click()
  // Wait for the server to have it (a queued thought also shows in the list, before it's sent).
  await P.page.locator('.passage[data-state="submitted"] .passage-text', { hasText: 'retry banner' }).waitFor()
  check('A thought saves from the sprint page and appears in "yours"', true)
  await mara.req('POST', `/api/sprints/${sprint.id}/entries`, { body: 'Synthetic: on-call handover was smooth', category: null, idempotency_key: crypto.randomUUID() })
  await shot(P.page, '02-collecting-participant')
  await shot(F.page, '03-collecting-facilitator')

  // ── "Write" is a shortcut to the same page, with the field in reach.
  await P.page.goto(`${BASE}/workspaces/${ws.id}`)
  await P.page.getByRole('link', { name: 'Open sprint' }).waitFor()
  check('Workspace list: "Open sprint", no guide, no stepper, no facilitator box', (await P.page.locator('text=Sprint guide').count()) === 0 && (await P.page.locator('.life, .chapter-fac').count()) === 0)
  await shot(P.page, '02b-workspace-list')
  await P.page.locator('header nav[aria-label="Main"] a', { hasText: 'Write' }).click()
  await P.page.waitForURL(`**/sprints/${sprint.id}`)
  await P.page.waitForFunction(() => document.activeElement?.getAttribute('name') === 'thought')
  check('"Write" opens the collecting sprint’s page with the field focused', true)
  await P.page.goto(`${BASE}/capture?sprint=${sprint.id}`)
  await P.page.waitForURL(`**/sprints/${sprint.id}`)
  check('The old /capture?sprint= link lands on the sprint page', true)

  // ── Close early, with a participant mid-sentence.
  await P.page.fill('textarea[name="thought"]', 'Half a thought about the fraud rules that I haven’t sent')
  await F.page.reload()
  await F.page.getByRole('button', { name: 'Close collection…' }).click()
  const dialog = F.page.getByRole('dialog')
  await dialog.waitFor()
  const dtext = await dialog.innerText()
  check('Before closing: who sees what, what stops, that it doesn’t start the retro, that reopening is possible', /revealed, without names, to all 2 people/.test(dtext) && /Nobody can add or edit/.test(dtext) && /doesn’t start the retro/.test(dtext) && /reopen collection/.test(dtext))
  await shot(F.page, '04-close-confirm')
  // Two quick presses: one transition.
  const confirm = dialog.getByRole('button', { name: 'Close collection' })
  await confirm.dblclick()
  await F.page.locator('.sbar-state', { hasText: 'Collection closed' }).waitFor()
  await F.page.waitForTimeout(600)
  check('A double press closes once, with no error', (await F.page.locator('[role=status], [role=alert]').filter({ hasText: /changed while you were working|can’t move/ }).count()) === 0)
  check('Closing doesn’t jump to another page', F.page.url() === S(sprint.id))
  const fbar = await bar(F.page).innerText()
  check('Closed (facilitator): count, optional themes, start the retro, reopen in the menu', /2 thoughts are in/.test(fbar) && (await F.page.getByRole('button', { name: 'Start the retro…' }).count()) === 1 && (await F.page.getByRole('link', { name: 'Group into themes (optional)' }).count()) === 1, fbar.replace(/\s+/g, ' ').slice(0, 160))
  await P.page.locator('text=Collection closed while you were writing').waitFor({ timeout: 8000 })
  check('Participant mid-sentence: the words stay, and it says nothing was sent', (await P.page.inputValue('textarea[name="thought"]')) === 'Half a thought about the fraud rules that I haven’t sent')
  check('…and adding is off', await P.page.getByRole('button', { name: 'Add to sprint' }).isDisabled())
  await shot(P.page, '05-closed-mid-sentence')
  await shot(F.page, '06-closed-facilitator')
  // Themes are optional work inside the same sprint: the same bar, the same next step, no "mark ready".
  await F.page.getByRole('link', { name: 'Group into themes (optional)' }).click()
  await F.page.waitForURL('**/prepare')
  await F.page.getByRole('heading', { name: /Group into themes/ }).waitFor()
  check('Themes page: the same sprint bar and next step, no "Mark ready", a way back', (await F.page.getByRole('button', { name: 'Start the retro…' }).count()) === 1 && (await F.page.getByText('Mark ready').count()) === 0 && (await F.page.locator('.sbar-name a').getAttribute('href')) === `/sprints/${sprint.id}`)
  await shot(F.page, '06b-themes')
  await F.page.locator('.sbar-name a').click()
  await F.page.waitForURL(`**/sprints/${sprint.id}`)
  await P.page.reload()
  await P.page.locator('.sbar-state', { hasText: 'Collection closed' }).waitFor()
  check('Participant after a refresh: closed state, read-only thoughts, the planned retro date', /read-only/.test(await P.page.locator('main').innerText()) && /Planned/.test(await P.page.locator('.sbar-progress').innerText()) && (await P.page.locator('textarea[name="thought"]').count()) === 0)

  // ── Reopen (before the retro), then a participant submitting as it closes again.
  await F.page.getByRole('button', { name: 'More' }).click()
  await F.page.getByRole('menuitem', { name: 'Reopen collection…' }).click()
  const rd = F.page.getByRole('dialog')
  check('Before reopening: what was revealed stays visible', /can’t make it private again/.test(await rd.innerText()))
  await rd.getByRole('button', { name: 'Reopen collection' }).click()
  await F.page.locator('.sbar-state', { hasText: 'Collecting thoughts' }).waitFor()
  await P.page.locator('textarea[name="thought"]').waitFor({ timeout: 8000 })
  check('Reopening brings the writer back for the participant', true)
  await P.page.fill('textarea[name="thought"]', 'Sent just as collection closed')
  // Closed on the server a moment before the participant presses the button.
  await P.page.route('**/api/sprints/*/entries', async (route) => {
    await mara.req('POST', `/api/sprints/${sprint.id}/transition`, { to: 'preparing', confirm: true }).catch(() => {})
    await route.continue()
  })
  await P.page.getByRole('button', { name: 'Add to sprint' }).click()
  await P.page.locator('text=wasn’t submitted').first().waitFor({ timeout: 8000 })
  await P.page.unroute('**/api/sprints/*/entries')
  const ptext = await P.page.locator('main').innerText()
  check('Submitting during closure: not claimed as submitted, kept with what to do', /wasn’t submitted/.test(ptext) && /Sent just as collection closed/.test(ptext) && /Needs attention/.test(ptext))
  await shot(P.page, '07-submitted-during-close')

  // ── Start the retro.
  await F.page.reload()
  await F.page.getByRole('button', { name: 'Start the retro…' }).click()
  const sd = F.page.getByRole('dialog')
  check('Before starting: the stage opens for everyone, collection can’t be reopened after', /everyone’s devices/.test(await sd.innerText()) && /can’t be reopened/.test(await sd.innerText()))
  await sd.getByRole('button', { name: 'Start the retro' }).click()
  await F.page.waitForURL('**/stage')
  check('Starting goes to the stage', true)
  await P.page.goto(S(sprint.id))
  await P.page.getByRole('link', { name: 'Join the retro' }).waitFor()
  check('Participant during the retro: one way in, no facilitator controls', (await status(P.page)) === 'Retro in progress' && (await P.page.locator('.sbar-control').count()) === 0)
  await F.page.goto(S(sprint.id))
  await bar(F.page).waitFor()
  check('Facilitator during the retro: back to the stage, pause kept quiet, no reopen', (await F.page.getByRole('link', { name: 'Open the stage' }).count()) === 1 && !/Reopen/.test(await F.page.locator('main').innerText()))
  const refused = await mara.req('POST', `/api/sprints/${sprint.id}/transition`, { to: 'collecting', confirm: true }).then(() => 'allowed', (e) => e.message)
  check('The server refuses to reopen once the retro has started', /409/.test(refused), refused.slice(0, 80))
  const benTry = await ben.req('POST', `/api/sprints/${sprint.id}/transition`, { to: 'completed' }).then(() => 'allowed', (e) => e.message)
  check('A participant can’t change the sprint’s state', /403/.test(benTry))
  await shot(P.page, '08-live-participant')

  // ── Outcomes, then coming back later.
  await mara.req('POST', `/api/sprints/${sprint.id}/experiments`, { change_to_try: 'Show the retry state inline, not in a banner', success_signal: 'No support tickets about it for two weeks', owner_account_id: ben.id, review_on: d(20) }).catch((e) => console.log('   (experiment not recorded:', e.message.slice(0, 120), ')'))
  await mara.req('POST', `/api/sprints/${sprint.id}/transition`, { to: 'completed' })
  await P.page.goto(S(sprint.id, '/outcomes'))
  await P.page.waitForURL(`**/sprints/${sprint.id}`)
  await P.page.getByRole('heading', { name: /What we’ll try/ }).waitFor()
  check('The old outcomes link lands on the sprint page, which is the outcomes now', true)
  check('Done: the bar says so and the outcomes are the page', (await status(P.page)) === 'Retro done' && /Held/.test(await P.page.locator('.sbar-progress').innerText()))
  await shot(P.page, '09-done-participant')
  await F.page.goto(S(sprint.id))
  await F.page.getByRole('heading', { name: /What we’ll try/ }).waitFor()
  check('Facilitator later: no transition button, archiving in the menu', (await F.page.locator('.sbar-control .sbar-button').count()) === 0 && (await F.page.getByRole('button', { name: 'More' }).count()) === 1)
  await shot(F.page, '10-done-facilitator')

  // ── Setup, edited: saved in the order the server takes it, and only what changed.
  {
    const cy = await account('Cy Ramos')
    await join(mara, ws.id, cy)
    const plan = (name) => ({ name, timezone: 'Asia/Manila', starts_on: d(-2), ends_on: d(9), retro_date: d(10), retro_time: '10:00', participant_ids: [mara.id, ben.id], facilitator_id: mara.id, reminders_enabled: false })
    const h = await mara.req('POST', `/api/workspaces/${ws.id}/sprints`, plan(`Handover ${tag}`))
    await F.page.goto(S(h.id, '/setup'))
    await F.page.locator('#f-facilitator_id').selectOption(cy.id)
    await F.page.getByRole('checkbox', { name: /Ben Okafor/ }).uncheck()
    await F.page.locator('#f-name').fill(`Handed over ${tag}`)
    await F.page.getByRole('button', { name: 'Save changes' }).click()
    await F.page.waitForURL(`**/sprints/${h.id}`, { timeout: 10000 }).catch(() => {})
    const after = await mara.req('GET', `/api/sprints/${h.id}`)
    const who = after.participants.map((p) => p.account_id)
    check('Setup: a facilitator who wasn’t in the sprint yet, someone taken off and a new name, in one save', after.name === `Handed over ${tag}` && after.participants.find((p) => p.is_facilitator)?.account_id === cy.id && !who.includes(ben.id) && who.includes(mara.id), `${after.name} · ${who.length} people`)

    // A vote is open: changing anything but the budget still saves.
    const v = await mara.req('POST', `/api/workspaces/${ws.id}/sprints`, plan(`Voting ${tag}`))
    await mara.req('POST', `/api/sprints/${v.id}/transition`, { to: 'collecting' })
    await mara.req('POST', `/api/sprints/${v.id}/transition`, { to: 'preparing', confirm: true })
    await mara.req('POST', `/api/sprints/${v.id}/themes`, { title: 'Reviews that wait' })
    await mara.req('POST', `/api/sprints/${v.id}/transition`, { to: 'ready', confirm: true })
    await mara.req('POST', `/api/sprints/${v.id}/votes/rounds`, {})
    await F.page.goto(S(v.id, '/setup'))
    await F.page.locator('#f-goal').fill('Keep reviews moving')
    await F.page.getByRole('button', { name: 'Save changes' }).click()
    await F.page.waitForURL(`**/sprints/${v.id}`, { timeout: 10000 }).catch(() => {})
    check('Setup: saving during an open vote works when the budget isn’t touched', (await mara.req('GET', `/api/sprints/${v.id}`)).goal === 'Keep reviews moving')
  }

  // ── Workspace switching: "/" follows the workspace; the dropdown's entries are honest.
  await F.page.locator('header button[aria-label^="Workspace:"]').click()
  check('Workspace menu: no "Sprint guide", sprints listed as such', (await F.page.locator('text=Sprint guide').count()) === 0 && (await F.page.getByRole('link', { name: /Sprints/ }).count()) >= 1)
  await F.page.getByRole('menuitemradio', { name: new RegExp(`Platform ${tag}`) }).click()
  await F.page.waitForURL(`**/sprints/${elsewhere.id}`)
  check('Switching workspace opens that workspace’s collecting sprint', (await F.page.locator('h1').innerText()).includes('Platform only'))

  // ── Phones.
  const M = await open(mara, { phone: true, ws: other.id })
  await M.page.goto(S(elsewhere.id))
  await bar(M.page).waitFor()
  check('Phone: the state and the facilitator’s next change are near the top', (await M.page.getByRole('button', { name: 'Close collection…' }).boundingBox()).y < 560)
  check('Phone: no horizontal scroll', (await overflow(M.page)) <= 0, `${await overflow(M.page)}px`)
  const tb = await M.page.getByRole('button', { name: 'Close collection…' }).boundingBox()
  check('Phone: the control is a comfortable touch target', tb.height >= 44, `${tb.height}px`)
  check('Phone, writing: the bar folds to two lines, the field is in the first screen', (await M.page.locator('.sbar-progress').isHidden()) && (await M.page.locator('textarea[name="thought"]').boundingBox()).y < 700)
  await shot(M.page, '11-phone-facilitator-collecting')
  await M.page.getByRole('button', { name: 'Details' }).click()
  check('Phone: "Details" unfolds the rest of the bar', await M.page.locator('.sbar-progress').isVisible() && await M.page.locator('.sbar-consequence').isVisible())
  await shot(M.page, '11b-phone-details-open')
  const MP = await open(ben, { phone: true, ws: ws.id })
  await MP.page.goto(S(sprint.id))
  await bar(MP.page).waitFor()
  check('Phone (participant, done): no horizontal scroll', (await overflow(MP.page)) <= 0)
  await shot(MP.page, '12-phone-participant-done')
  const D = await open(mara, { theme: 'dark', ws: other.id })
  await D.page.goto(S(elsewhere.id))
  await bar(D.page).waitFor()
  await shot(D.page, '13-dark-facilitator-collecting')

  // ── Keyboard: the bar's controls are reachable and named.
  await D.page.keyboard.press('Tab')
  let reached = false
  for (let i = 0; i < 25 && !reached; i++) {
    reached = await D.page.evaluate(() => document.activeElement?.tagName === 'BUTTON' && document.activeElement.textContent.includes('Close collection'))
    if (!reached) await D.page.keyboard.press('Tab')
  }
  check('Keyboard reaches the facilitator’s control', reached)
  await D.page.keyboard.press('Enter')
  await D.page.getByRole('dialog').waitFor()
  await D.page.keyboard.press('Escape')
  check('Escape cancels the confirmation without closing collection', (await status(D.page)) === 'Collecting thoughts')

  const errs = [...F.errors, ...P.errors, ...M.errors, ...MP.errors, ...D.errors]
  check('No page errors', errs.length === 0, errs.slice(0, 2).join(' | '))
} catch (e) {
  check('Run completed', false, e.message.split('\n')[0])
} finally {
  await browser.close()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
}
