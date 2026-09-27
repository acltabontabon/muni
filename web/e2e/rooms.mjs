/**
 * The eight character rooms (worlds/rooms), end to end, each with Muni's behaviour unchanged: the
 * sprint label and its details, one optional category from a short list, context folded away and
 * summarised, one starting point at a time, the shortcut without keycaps, one submission per press,
 * the right sprint, failure and offline recovery, editing, the draft surviving a change of character
 * and of the theme, keyboard order, stillness, reduced motion and a phone's first screen.
 * Synthetic accounts and text only.
 *
 * Run against a production build (the dev server's StrictMode breaks draft keeping):
 *   MUNI_URL=http://localhost:8787 node e2e/rooms.mjs          (WORLDS=kape,pahina to run some; SHOTS=dir)
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.MUNI_URL ?? 'http://localhost:5173'
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

const browser = await chromium.launch()
async function open(a, wsId, opts = {}) {
  const viewport = opts.viewport ?? { width: 1440, height: 900 }
  const phone = viewport.width < 600
  const ctx = await browser.newContext({ viewport, colorScheme: opts.theme ?? 'light', reducedMotion: opts.reducedMotion ?? 'no-preference', hasTouch: phone, isMobile: phone })
  await ctx.addCookies(a.cookies())
  await ctx.addInitScript((p) => {
    localStorage.setItem('muni.prefs', JSON.stringify(p))
    // Count animation frames the page asks for, to catch anything that keeps drawing when idle.
    const raf = window.requestAnimationFrame.bind(window)
    window.__frames = 0
    window.requestAnimationFrame = (cb) => {
      window.__frames++
      return raf(cb)
    }
  }, { lastWorkspace: wsId })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${BASE}/`)
  await page.locator(opts.ready ?? '.room-writer').first().waitFor({ timeout: 15000 })
  return { ctx, page, errors }
}
const field = (page) => page.locator('textarea[name="thought"]')
const mine = (a, sprintId) => a.req('GET', `/api/sprints/${sprintId}/entries/mine`)
const choose = async (page, name) => {
  await page.locator('[data-account-trigger]').click()
  await page.locator('button:has-text("Change character")').click()
  await page.locator(`[role=dialog] [role=radio][aria-label^="${name}"]`).click()
  await page.locator(`[role=dialog] button:has-text("Choose ${name}")`).click()
  // The chooser previews rooms in miniature: wait until it has gone before looking at the page.
  await page.locator('[role=dialog]').waitFor({ state: 'detached' })
}

const ALL = ['kape', 'guhit', 'biyahe', 'bola', 'pahina', 'himig', 'porma', 'sibol']
const NAME = { kape: 'Kape', guhit: 'Guhit', biyahe: 'Biyahe', bola: 'Bola', pahina: 'Pahina', himig: 'Himig', porma: 'Porma', sibol: 'Sibol' }
const HEADING = { kape: 'What’s on your mind?', guhit: 'What caught your eye?', biyahe: 'What stayed with you today?', bola: 'What’s worth talking about?', pahina: 'What would you underline?', himig: 'What’s still playing in your head?', porma: 'What’s worth noting?', sibol: 'What’s worth tending to?' }
/** Each room's own composition root, on the page (the chooser's miniature is a room too). */
const ROOT = Object.fromEntries(['kape', 'guhit', 'biyahe', 'bola', 'pahina', 'himig', 'porma', 'sibol'].map((w) => [w, `main .${w}-room`]))
const WORLDS = (process.env.WORLDS ?? ALL.join(',')).split(',')

for (const W of WORLDS) try {
  console.log(`\n── ${NAME[W]}`)
  // The next room along, to switch to and back.
  const OTHER = ALL[(ALL.indexOf(W) + 1) % ALL.length]
  const ana = await account('Ana Reyes')
  await ana.req('PATCH', '/api/auth/me', { avatar_id: W, avatar_theme: true })
  const ws = await ana.req('POST', '/api/workspaces', { name: 'Studio' })
  const name = 'Sprint 27 — Onboarding flow rewrite, payments reconciliation and the great Q4 accessibility audit'
  const s = await ana.req('POST', `/api/workspaces/${ws.id}/sprints`, { name, timezone: 'Asia/Manila', starts_on: d(-3), ends_on: d(4), retro_date: d(5), retro_time: '15:00', participant_ids: [ana.id], facilitator_id: ana.id, reminders_enabled: false })
  await ana.req('POST', `/api/sprints/${s.id}/transition`, { to: 'collecting' })

  // ── The page, in reading order: where it goes, the question, the field, one action, the collection.
  {
    const { ctx, page, errors } = await open(ana, ws.id)
    await page.locator('.room-empty').waitFor()
    check(`${W}: its own composition, and no other room's`, (await page.locator(ROOT[W]).count()) === 1 && (await page.locator(ALL.filter((x) => x !== W).map((x) => ROOT[x]).join(',')).count()) === 0 && (await page.locator('.room').getAttribute('data-room')) === W)
    const order = await page.evaluate(() => {
      const box = (sel) => document.querySelector(sel)?.getBoundingClientRect() ?? null
      return ['.room-tab', '.room-heading', 'textarea[name="thought"]', '.room-save', '.mine'].map((q) => box(q))
    })
    // On a wide screen a room may put the label in a margin or the collection beside the writing;
    // what never changes is the heading → field → action sequence, and the label before the field.
    const [tab, heading, f, save] = order
    // Before means above, or (Bola's opening, Guhit's margin) in the column to its left.
    const before = (a, b) => a.top < b.top || a.right <= b.left
    check('Reading order: label, heading, field, action', !!(tab && heading && f && save) && before(tab, f) && before(heading, f) && f.bottom <= save.top + 1, order.map((b) => (b ? `${Math.round(b.left)},${Math.round(b.top)}` : 'missing')).join(' → '))
    const dom = await page.evaluate(() => ['.room-tab', '.room-heading', 'textarea[name="thought"]', '.room-save', '.mine'].map((q) => document.querySelector(q)).reduce((ok, el, i, l) => ok && !!el && (i === 0 || !!(l[i - 1].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)), true))
    check('…and the same order for a screen reader', dom)
    check('The label names the sprint', (await page.locator('.room-tab-name').innerText()).trim() === name)
    check('…says literally where it goes', (await page.locator('.room-tab-kicker').innerText()).toLowerCase() === 'writing for')
    check('…while the state and the planned retro sit once, in the sprint bar above', (await page.locator('.sbar-state').innerText()).includes('Collecting') && /Planned/.test(await page.locator('.sbar-progress').innerText()) && (await page.locator('.room-tab-meta').count()) === 0)
    check('The heading labels the field', (await page.locator('label[for="thought-field"]').innerText()) === HEADING[W])
    check('No category row until asked', (await page.locator('.room-cat').count()) === 0 && (await page.locator('.cat-choice').count()) === 0)
    check('No Prompt button, no keycaps on screen', (await page.locator('button', { hasText: /^Prompt$/ }).count()) === 0 && (await page.locator('kbd:visible').count()) === 0)
    check('No privacy reassurance under the writer (Privacy explains it)', (await page.locator('button.privacy-mark, .room-fine').count()) === 0)
    check('One primary action, named for what it does', (await page.locator('.room-save').innerText()).trim() === 'Add to sprint' && (await page.locator('.room-save').isDisabled()) && (await page.locator('button[type=submit]').count()) === 1)
    check('An empty collection: one line, and where thoughts will go', (await page.locator('.room-empty-line').count()) === 1 && (await page.locator('.room-empty-sub').innerText()).includes('settle here'))
    check('The field has focus on a desktop', await field(page).evaluate((el) => el === document.activeElement))
    check('The field is opaque, and its text is large enough to read', await field(page).evaluate((el) => { const c = getComputedStyle(el); return !/rgba\(.*, 0\)|transparent/.test(c.backgroundColor) && parseFloat(c.fontSize) >= 16 }))
    await page.waitForTimeout(1200)
    const still = await page.evaluate(async () => {
      const running = document.getAnimations().filter((a) => a.playState === 'running').length
      const before = window.__frames
      await new Promise((r) => setTimeout(r, 2000))
      return { running, frames: window.__frames - before }
    })
    check('Still when idle: no animation, no drawing loop', still.running === 0 && still.frames <= 2, `${still.running} running, ${still.frames} frames in 2 s`)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${W}-empty.png` })

    // Keyboard: label → field → starting point → Category → Context → action, in that order.
    await page.locator('.room-tab').focus()
    const stops = []
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab')
      stops.push(await page.evaluate(() => { const el = document.activeElement; return el.id === 'thought-field' ? 'field' : el.textContent.trim().replace(/\s+/g, ' ') }))
    }
    // (Add to sprint is disabled while the field is empty, so the fifth stop leaves the room.)
    check('Tab order follows the page', stops.slice(0, 4).join(' | ') === 'field | Need a starting point? | Category (optional) | Context (optional)', stops.slice(0, 4).join(' | '))
    const ring = await page.locator('.room-opt').first().evaluate((el) => { el.focus(); return getComputedStyle(el).outlineStyle })
    check('Keyboard focus is visible on the controls', ring !== 'none', ring)

    // Details, on request.
    await page.locator('.room-tab').click()
    const details = page.locator('.room-pop')
    await details.waitFor()
    const text = await details.innerText()
    check('Details: the team, the sprint’s dates, the retro with its timezone — no privacy essay, no second way to the page it’s on', /Team/i.test(text) && /Sprint/i.test(text) && /15:00/.test(text) && /Manila time \(GMT\+8\)/.test(text) && !/Sprint guide|Open sprint/.test(text) && !/Who sees what|encryption|without your name/i.test(text))
    await page.keyboard.press('Escape')
    await details.waitFor({ state: 'detached' })
    const onTab = await page.waitForFunction(() => document.activeElement?.classList.contains('room-tab'), null, { timeout: 2000 }).then(() => true).catch(() => false)
    check('Escape closes details and returns to the label', onTab)

    // Category: one, optional, changeable, clearable — by keyboard.
    await field(page).fill('Standups ran long again.')
    await page.locator('.room-opt', { hasText: 'Category' }).focus()
    await page.keyboard.press('Enter')
    await page.locator('.room-cats').waitFor()
    check('The list offers the five categories with hints', (await page.locator('.room-cat').count()) === 5 && (await page.locator('.room-cat-hint').count()) === 5)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.locator('.room-cats').waitFor({ state: 'detached' })
    check('Chosen by keyboard: Improve, named in words', (await page.locator('.room-opt[data-set]').first().innerText()).includes('Improve'))
    check('…and focus is back on the control', await page.locator('.room-opt[data-set]').first().evaluate((el) => el === document.activeElement))
    await page.locator('.room-opt[data-set]').first().click()
    check('Changing it offers “No category”', (await page.locator('.room-cat', { hasText: 'No category' }).count()) === 1)
    await page.locator('.room-cat', { hasText: 'Try' }).click()
    check('Changed to Try', (await page.locator('.room-opt[data-set]').first().innerText()).includes('Try'))

    // Context: folded away, then summarised.
    await page.locator('.room-opt', { hasText: 'Context' }).click()
    await page.locator('textarea[id$="-impact"]').fill('We lost the first hour of focus.')
    await page.locator('.room-context [role=radio]', { hasText: 'Mid sprint' }).click()
    await page.locator('.room-opt', { hasText: 'Fold context away' }).click()
    check('Folded context is summarised', (await page.locator('.room-opt', { hasText: 'Context' }).innerText()).replace(/\s+/g, ' ').includes('Context: impact, mid sprint'))
    check('…and nothing typed is lost', (await field(page).inputValue()) === 'Standups ran long again.')

    // Submit with the shortcut; a second press can't send it twice.
    await field(page).focus()
    await page.keyboard.press('ControlOrMeta+Enter')
    await page.keyboard.press('ControlOrMeta+Enter')
    await page.locator('.room-note', { hasText: 'Added to' }).waitFor({ timeout: 10000 })
    check('Saved: says where it went', (await page.locator('.room-note strong').innerText()) === name)
    check('The field is clear and still focused', (await field(page).inputValue()) === '' && (await field(page).evaluate((el) => el === document.activeElement)))
    await page.locator('.passage').first().waitFor()
    const list = await mine(ana, s.id)
    check('Exactly one thought was submitted, to this sprint', list.length === 1, `${list.length}`)
    check('…with its category and context as chosen', list[0]?.category === 'try' && list[0]?.impact === 'We lost the first hour of focus.' && list[0]?.period === 'middle')
    check('The options reset for the next thought', (await page.locator('.room-opt[data-set]').count()) === 0)
    check('The new thought settles into the collection', (await page.locator('.passage.anim-reflect').count()) === 1)
    check('Its category is a word, not only a colour', (await page.locator('.passage .passage-mark .cat').first().textContent()).trim() === 'Try')
    if (W === 'biyahe') {
      check('Thoughts sit under a heading per day', (await page.locator('.passages-day h3').allTextContents()).join('|') === 'Today')
      check('…each keeping only its time', /^\d{1,2}:\d{2}/.test((await page.locator('.passage time').first().innerText()).trim()))
    }
    await page.waitForTimeout(1600)
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)
    check('After the moment, nothing keeps moving', running === 0, `${running} running`)

    // Starting point: one at a time, never over the writing.
    await page.locator('button', { hasText: 'Need a starting point?' }).click()
    const first = await page.locator('.room-prompt p').innerText()
    const focused = await page.waitForFunction(() => document.activeElement?.id === 'thought-field', null, { timeout: 2000 }).then(() => true).catch(() => false)
    check('A starting point appears, and focus goes to the field', first.length > 10 && focused)
    await field(page).fill('My own words')
    await page.locator('.room-prompt button', { hasText: 'Another' }).click()
    check('“Another” changes only the prompt', (await page.locator('.room-prompt p').innerText()) !== first && (await field(page).inputValue()) === 'My own words')
    await field(page).fill('')

    // Editing: the same category control; a failed save keeps every word.
    await page.locator('.passage .passage-menu').first().click()
    await page.locator('[role=menuitem]', { hasText: 'Edit' }).click()
    await page.locator('.passage form').waitFor()
    check('Editing offers the category as one control, not five', (await page.locator('.passage .room-opt').count()) === 1 && (await page.locator('.passage [aria-label="Category (optional)"]').count()) === 0)
    await page.route('**/api/sprints/*/entries/*', (r) => (r.request().method() === 'PATCH' ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"server trouble"}' }) : r.continue()))
    await page.locator('.passage form textarea').first().fill('Edited words that must survive a failure.')
    await page.locator('.passage form button[type=submit]').click()
    await page.locator('.passage form [role=alert]').waitFor({ timeout: 5000 })
    check('A failed edit says so and keeps the words', (await page.locator('.passage form [role=alert]').innerText()).includes('Your changes are still here') && (await page.locator('.passage form textarea').first().inputValue()) === 'Edited words that must survive a failure.')
    await page.unroute('**/api/sprints/*/entries/*')
    await page.locator('.passage form button[type=submit]').click()
    await page.locator('.passage form').waitFor({ state: 'detached', timeout: 5000 })
    check('…and saves once the server is back', (await mine(ana, s.id))[0]?.body === 'Edited words that must survive a failure.')
    check('No page errors', errors.length === 0, errors[0])
    await ctx.close()
  }

  // ── A server failure while adding: nothing is lost, nothing is sent twice.
  {
    const { ctx, page } = await open(ana, ws.id)
    let failures = 0
    await page.route('**/api/sprints/*/entries', (r) => (r.request().method() === 'POST' && failures++ < 1 ? r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' }) : r.continue()))
    await field(page).fill('Written while the server hiccups.')
    await page.locator('.room-save').click()
    await page.locator('.room-note[data-tone="local"]').waitFor({ timeout: 10000 })
    check('A failed send: kept here, said plainly', /Kept in this tab|Saved on this device/.test(await page.locator('.room-note').innerText()) && (await page.locator('.passage[data-state="queued"], .passage[data-state="sending"]').count()) === 1)
    const sent = await page.waitForFunction(() => !document.querySelector('.passage[data-state="queued"], .passage[data-state="sending"]'), null, { timeout: 25000 }).then(() => true).catch(() => false)
    const now = await mine(ana, s.id)
    check('…then sent once, on the retry', sent && now.filter((e) => e.body === 'Written while the server hiccups.').length === 1, `${now.length} in the sprint`)
    await ctx.close()
  }

  // ── Offline: saved on the device and sent later.
  {
    const { ctx, page } = await open(ana, ws.id)
    await ctx.setOffline(true)
    await field(page).fill('Written with no connection.')
    await page.locator('.room-save').click()
    await page.locator('.room-note[data-tone="local"]').waitFor({ timeout: 10000 })
    check('Offline: kept here, said plainly', /Kept in this tab|Saved on this device/.test(await page.locator('.room-note').innerText()))
    check('…and it waits in the collection', (await page.locator('.passage[data-state="queued"], .passage[data-state="sending"]').count()) === 1)
    await ctx.setOffline(false)
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    const sent = await page.waitForFunction(() => !document.querySelector('.passage[data-state="queued"], .passage[data-state="sending"]'), null, { timeout: 15000 }).then(() => true).catch(() => false)
    check('Back online: it is sent', sent && (await mine(ana, s.id)).length === 3)
    await ctx.close()
  }

  // ── A change of character, and the theme switched off, keep everything being written.
  {
    const { ctx, page } = await open(ana, ws.id)
    const draft = 'Half a thought — still being written, ñ, at saka Taglish din.'
    await field(page).fill(draft)
    await page.locator('.room-opt', { hasText: 'Category' }).click()
    await page.locator('.room-cat', { hasText: 'Keep' }).click()
    await page.locator('.room-opt', { hasText: 'Context' }).click()
    await page.locator('textarea[id$="-help"]').fill('Pair on it next time.')
    await choose(page, NAME[OTHER])
    await page.waitForFunction((o) => document.documentElement.dataset.world === o && document.querySelector('.room')?.dataset.room === o, OTHER)
    const same = await page.evaluate(() => ({ body: document.querySelector('textarea[name="thought"]')?.value, help: document.querySelector('textarea[id$="-help"]')?.value, cat: document.querySelector('.room-opt[data-set]')?.textContent }))
    check(`${NAME[W]} → ${NAME[OTHER]}: text, category and open context all kept`, same.body === draft && same.help === 'Pair on it next time.' && /Keep/.test(same.cat ?? ''), JSON.stringify(same))
    check('…in the new room only (no styles or pieces left behind)', (await page.locator(ROOT[W]).count()) === 0 && (await page.locator(ROOT[OTHER]).count()) === 1)
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    // The theme off (in Account, so the page is left and come back to): Muni's journal, the same writing.
    const toAccount = async () => {
      await page.locator('[data-account-trigger]').click()
      await page.locator('a[href="/account"]').click()
      await page.locator('#avatar-theme').waitFor()
    }
    await toAccount()
    await page.locator('#avatar-theme').click()
    await page.waitForFunction(() => !document.documentElement.dataset.world)
    await page.locator('a', { hasText: 'Write' }).first().click()
    await page.locator('textarea[name="thought"].journal-field').waitFor()
    const journal = await page.waitForFunction((t) => document.querySelector('textarea[name="thought"]')?.value === t, draft, { timeout: 5000 }).then(() => true).catch(() => false)
    check('Theme off: Muni’s journal, same draft', journal && (await page.locator('.room').count()) === 0)
    check('…and the page is Muni’s colour again', (await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) !== bg)
    await toAccount()
    await page.locator('#avatar-theme').click()
    await page.waitForFunction((o) => document.documentElement.dataset.world === o, OTHER)
    await page.locator('a', { hasText: 'Write' }).first().click()
    await choose(page, NAME[W])
    await page.locator(ROOT[W]).waitFor()
    const back = await page.waitForFunction((t) => document.querySelector('textarea[name="thought"]')?.value === t, draft, { timeout: 5000 }).then(() => true).catch(() => false)
    check(`…and back in ${NAME[W]}: still there`, back)
    await field(page).fill('')
    await page.waitForTimeout(600)
    await ctx.close()
  }

  // ── Two sprints collecting: the label moves the draft, and the thought lands where it says.
  {
    const s2 = await ana.req('POST', `/api/workspaces/${ws.id}/sprints`, { name: 'Design crit', timezone: 'Asia/Manila', starts_on: d(-2), ends_on: d(4), retro_date: d(5), retro_time: '10:00', participant_ids: [ana.id], facilitator_id: ana.id, reminders_enabled: false })
    await ana.req('POST', `/api/sprints/${s2.id}/transition`, { to: 'collecting' })
    const { ctx, page } = await open(ana, ws.id, { ready: '.room-writer, .room-sheet--state' })
    if ((await page.locator('.room-sheet--state').count()) && (await page.locator('button', { hasText: 'Design crit' }).count())) await page.locator('button', { hasText: name.slice(0, 20) }).first().click()
    await field(page).waitFor()
    await field(page).fill('This belongs to the design crit.')
    await page.locator('.room-tab').click()
    await page.locator('.room-pop .room-row', { hasText: 'Design crit' }).click()
    await page.waitForFunction(() => document.querySelector('.room-tab-name')?.textContent.includes('Design crit'))
    const moved = await page.waitForFunction(() => document.querySelector('textarea[name="thought"]')?.value === 'This belongs to the design crit.', null, { timeout: 5000 }).then(() => true).catch(() => false)
    check('Choosing another sprint moves the draft with it', moved)
    await page.locator('.room-save').click()
    await page.locator('.room-note', { hasText: 'Added to' }).waitFor({ timeout: 10000 })
    check('…and it lands in that sprint, not the other', (await mine(ana, s2.id)).length === 1 && (await mine(ana, s.id)).every((e) => e.body !== 'This belongs to the design crit.'))
    await ana.req('POST', `/api/sprints/${s2.id}/transition`, { to: 'preparing', confirm: true })
    await ctx.close()
  }

  // ── Reduced motion: nothing fades or rises.
  {
    const { ctx, page } = await open(ana, ws.id, { reducedMotion: 'reduce' })
    check('Reduced motion: the room simply appears', (await page.locator('.room').evaluate((el) => getComputedStyle(el).animationName)) === 'none')
    await ctx.close()
  }

  // ── A phone: the field and the action in the first screen; choices in a sheet; no sideways scroll.
  for (const theme of ['light', 'dark']) {
    const { ctx, page } = await open(ana, ws.id, { viewport: { width: 390, height: 844 }, theme })
    const f = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, save: document.querySelector('.room-save').getBoundingClientRect().bottom, vh: innerHeight, size: parseFloat(getComputedStyle(document.querySelector('textarea[name="thought"]')).fontSize), target: document.querySelector('.room-opt').getBoundingClientRect().height }))
    check(`Phone (${theme}): no horizontal overflow`, f.overflow <= 0, `${f.overflow}px`)
    check(`Phone (${theme}): Add to sprint in the first screen`, f.save <= f.vh, `${Math.round(f.save)} of ${f.vh}`)
    check(`Phone (${theme}): text at 16px or more, controls a finger can hit`, f.size >= 16 && f.target >= 40, `${f.size}px, ${f.target}px`)
    check(`Phone (${theme}): the field doesn't take focus by itself`, !(await field(page).evaluate((el) => el === document.activeElement)))
    check(`Phone (${theme}): your thoughts follow the writing`, await page.evaluate(() => document.querySelector('.mine').getBoundingClientRect().top > document.querySelector('.room-save').getBoundingClientRect().bottom))
    await page.locator('.room-opt', { hasText: 'Category' }).click()
    const sheet = page.locator('.room-drawer[role=dialog]')
    await sheet.waitFor()
    await page.waitForTimeout(400)
    const box = await sheet.boundingBox()
    check(`Phone (${theme}): categories open as a sheet from the bottom`, Math.abs(box.y + box.height - 844) < 2)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${W}-phone-sheet-${theme}.png` })
    await ctx.close()
  }

  // ── Collection closed: the same room, read-only, and the sprint bar says so.
  {
    await ana.req('POST', `/api/sprints/${s.id}/transition`, { to: 'preparing', confirm: true })
    const { ctx, page } = await open(ana, ws.id, { ready: '.room-sheet--state' })
    check('Closed: the sprint bar says so', (await page.locator('.sbar-state').innerText()).includes('Collection closed'))
    check('Closed: no composer', (await field(page).count()) === 0)
    await page.locator('.passage').first().waitFor()
    check('Closed: thoughts are read-only', (await page.locator('.passage .passage-menu').count()) === 0)
    await ctx.close()
  }
} catch (e) {
  check(`${W}: script ran to the end`, false, e.message)
}
await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
