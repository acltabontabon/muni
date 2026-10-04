/**
 * The release demo, part 1: the footage. Every shot is this build of Muni running locally, driven
 * through its own UI — a fictional team (Harbor) signs up with passkeys, writes into an encrypted
 * sprint on laptops and a phone, and holds a retro. Only a drawn cursor (and a tap mark on the
 * phone) is added here. Each shot is kept as sharp 2× frames with their real timestamps (an
 * ffconcat list and a meta.json per shot); part 2, e2e/demo-reel.mjs, sets them in the reel.
 *
 *   cd web && DEMO_OUT=<dir>/capture MUNI_URL=http://localhost:8870 node e2e/demo.mjs
 *   cd web && DEMO_OUT=<dir>/capture node e2e/demo-reel.mjs
 *   docs/demo/export.sh <dir>/capture
 *
 * Needs a fresh local `wrangler dev` serving a production build (docs/demo/README.md has the
 * commands). Synthetic people and content only.
 */
import { chromium } from 'playwright'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'

const BASE = process.env.MUNI_URL ?? 'http://localhost:8870'
const OUT = process.env.DEMO_OUT ?? new URL('../e2e-artifacts/demo/', import.meta.url).pathname
rmSync(`${OUT}/frames`, { recursive: true, force: true })
mkdirSync(`${OUT}/frames`, { recursive: true })
const tag = crypto.randomUUID().slice(0, 6)
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- the team and what they wrote ----------
const PEOPLE = { maya: 'Maya Reyes', jonas: 'Jonas Weber', priya: 'Priya Nair', tomas: 'Tomás Ibarra', aiko: 'Aiko Tanaka', sam: 'Sam O’Neill' }
const email = (k) => `${k}-${tag}@harbor.example`
const THOUGHTS = {
  maya: [['Staging was down most of Wednesday, and nobody was sure who should bring it back.', 'improve'], ['On-call was quiet, but the handover notes were thin.', 'improve']],
  jonas: [['Three PRs waited more than two days for a first review.', 'improve'], ['We found the expired certificate by accident, two hours into the outage.', null]],
  priya: [['The on-call runbook still pointed at the old staging cluster.', 'stop'], ['We estimated the search work before anyone had seen the designs.', null]],
  tomas: [['I didn’t know who to ask for a review on the billing code.', 'improve']],
  aiko: [['Reviews bunch up on Thursday afternoon, right before the cut.', 'improve'], ['Pairing with Sam on the migration made it far less scary.', 'proud']],
  sam: [['Small PRs were reviewed within the hour; big ones stalled.', null], ['Planning ran forty minutes over — half the tickets weren’t ready.', 'improve']],
}
/** Written on camera: Priya on her laptop, Tomás on his phone. */
const ON_CAMERA = 'Pairing on the release checklist caught two gaps before Friday.'
const ON_PHONE = 'Writing the release notes as we went saved us an evening.'
/** The rooms shown in the reel's montage (Priya's own choice, on her own screen). */
const ROOMS = ['kape', 'biyahe', 'himig', 'sibol']
const THEMES = [
  { title: 'Who owns staging?', question: 'What would have made Wednesday’s outage shorter?', entries: ['Staging was down most', 'We found the expired certificate', 'The on-call runbook still', 'On-call was quiet'] },
  { title: 'Reviews that wait', question: 'What would get a first review to happen the same day?', entries: ['Three PRs waited', 'Reviews bunch up', 'Small PRs were reviewed', 'I didn’t know who to ask'] },
  { title: 'What helped us ship', question: 'What should we make sure we keep doing?', entries: ['Pairing on the release checklist', 'Pairing with Sam', 'Writing the release notes'] },
  { title: 'Planning runs long', question: 'What does a ticket need before it’s ready to plan?', entries: ['Planning ran forty minutes', 'We estimated the search work'] },
]
// Indexes into THEMES: two votes each, since a retro never gives more than half its topics.
const VOTES = { maya: [0, 1], jonas: [0, 1], priya: [0, 2], tomas: [1, 0], aiko: [1, 3], sam: [0, 2] }
/** Faces in the retro: each person's character (Sam has none, and shows as a monogram). */
const FACES = { maya: 'kape', jonas: 'guhit', priya: 'himig', tomas: 'biyahe', aiko: 'sibol' }
const TAKEAWAY = 'Staging needs a named owner every sprint, the way on-call has one.'
const EXPERIMENTS = [
  { change: 'Name a staging owner in every on-call handover, starting this sprint.', signal: 'A staging incident has someone on it within 15 minutes.', owner: 'tomas', theme: 0 },
  { change: 'Keep 20 minutes after standup for first reviews, every day.', signal: 'No PR waits more than a working day for a first review.', owner: 'aiko', theme: 1 },
]
const RECAP = `Sprint 14, looking back

We spent most of the hour on Wednesday’s staging outage, then on reviews that wait.

Takeaway: staging needs a named owner every sprint, the way on-call has one.

We’ll try:
- a named staging owner in every on-call handover (Tomás)
- 20 minutes after standup for first reviews (Aiko)`

// ---------- the overlay: a tidy cursor, and a soft mark where a finger taps ----------
function overlay() {
  if (window.__demo) return
  const css = `
    #demo-cursor { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none; width: 22px; height: 22px; opacity: 0; transition: opacity 260ms ease; will-change: transform; filter: drop-shadow(0 1px 1.5px rgba(29,27,24,.28)); }
    #demo-cursor.on { opacity: 1; }
    .demo-ripple { position: fixed; z-index: 2147483646; pointer-events: none; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; border: 2px solid rgba(164,69,42,.55); animation: demo-ripple 520ms cubic-bezier(.2,.7,.3,1) forwards; }
    .demo-ripple.touch { width: 46px; height: 46px; margin: -23px 0 0 -23px; border: 0; background: rgba(29,27,24,.16); }
    @keyframes demo-ripple { from { transform: scale(.35); opacity: .9 } to { transform: scale(1.25); opacity: 0 } }`
  const mount = () => {
    const style = document.createElement('style')
    style.textContent = css
    document.head.append(style)
    const cur = document.createElement('div')
    cur.id = 'demo-cursor'
    cur.innerHTML = '<svg viewBox="0 0 22 22" width="22" height="22"><path d="M4 2.5 L4 18 L8.2 14.2 L11 20.2 L13.6 19 L10.9 13.1 L16.6 13.1 Z" fill="#1d1b18" stroke="#fbf8f2" stroke-width="1.5" stroke-linejoin="round"/></svg>'
    document.body.append(cur)
    const ripple = (x, y, touch) => {
      const r = document.createElement('div')
      r.className = touch ? 'demo-ripple touch' : 'demo-ripple'
      r.style.left = `${x}px`
      r.style.top = `${y}px`
      document.body.append(r)
      setTimeout(() => r.remove(), 600)
    }
    document.addEventListener('mousemove', (e) => { cur.style.transform = `translate(${e.clientX - 4}px, ${e.clientY - 2.5}px)` }, true)
    document.addEventListener('mousedown', (e) => ripple(e.clientX, e.clientY, false), true)
    document.addEventListener('touchstart', (e) => ripple(e.touches[0].clientX, e.touches[0].clientY, true), true)
    window.__demo = { cursor(on) { cur.classList.toggle('on', on) } }
  }
  if (document.body) mount()
  else document.addEventListener('DOMContentLoaded', mount)
}

// ---------- filming ----------
/**
 * Films `fn` on `page` as one segment: sharp 2× frames (screenshots taken back to back while the
 * scene plays, ~20 a second in Chromium's new headless mode), each stamped with the moment it was
 * taken, and an ffconcat list that gives every frame its real duration. (Chromium's screencast is
 * smoother but only delivers 1× frames.)
 */
async function film(page, name, fn) {
  const dir = `${OUT}/frames/${name}`
  mkdirSync(dir, { recursive: true })
  const cdp = await page.context().newCDPSession(page)
  const vp = page.viewportSize()
  const frames = []
  const writes = []
  let rolling = true
  const camera = (async () => {
    while (rolling) {
      const t0 = Date.now()
      // A clip is in page coordinates: follow the scroll so the frame is what's on screen.
      const { cssVisualViewport: v } = await cdp.send('Page.getLayoutMetrics')
      const clip = { x: v.pageX, y: v.pageY, width: vp.width, height: vp.height, scale: 2 }
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, optimizeForSpeed: true, clip })
      const file = `${String(frames.length).padStart(5, '0')}.jpg`
      frames.push({ file, t: (t0 + Date.now()) / 2000 })
      writes.push(writeFile(`${dir}/${file}`, Buffer.from(data, 'base64')))
    }
  })()
  while (!frames.length) await sleep(10)
  const start = Date.now() / 1000
  await fn()
  const end = Date.now() / 1000
  rolling = false
  await camera
  await Promise.all(writes)
  await cdp.detach()
  // Each frame lasts until the next one; the last until the segment ends. The last file is listed
  // once more so ffmpeg reaches the end; export.sh cuts each segment at the sum of the durations.
  const at = (f) => Math.min(Math.max(f.t, start), end)
  let list = 'ffconcat version 1.0\n'
  let total = 0
  let last
  for (let i = 0; i < frames.length; i++) {
    const d = (i + 1 < frames.length ? at(frames[i + 1]) : end) - at(frames[i])
    if (d <= 0.0005) continue
    list += `file '${frames[i].file}'\nduration ${d.toFixed(4)}\n`
    total += d
    last = frames[i].file
  }
  list += `file '${last}'\n`
  writeFileSync(`${dir}/list.ffconcat`, list)
  writeFileSync(`${dir}/meta.json`, JSON.stringify({ width: vp.width, height: vp.height, seconds: total }))
  log(`filmed ${name}: ${total.toFixed(2)} s, ${frames.length} frames (${(frames.length / (end - start)).toFixed(1)}/s)`)
}

/** One sharp 2× frame of what's on screen, for a shot that holds still. */
async function still(page, name) {
  const dir = `${OUT}/frames/${name}`
  mkdirSync(dir, { recursive: true })
  const vp = page.viewportSize()
  writeFileSync(`${dir}/00000.jpg`, await page.screenshot({ type: 'jpeg', quality: 92, scale: 'device' }))
  writeFileSync(`${dir}/list.ffconcat`, "ffconcat version 1.0\nfile '00000.jpg'\nduration 1.0000\nfile '00000.jpg'\n")
  writeFileSync(`${dir}/meta.json`, JSON.stringify({ width: vp.width, height: vp.height, seconds: 1, still: true }))
  log(`still ${name}`)
}

/** The cursor glides with gentle easing; real mouse events move it (hover states are real). */
function cursorOf(page) {
  let at = { x: 0, y: 0 }
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
  return {
    async show(x, y) {
      at = { x, y }
      await page.mouse.move(x, y)
      await page.evaluate(() => window.__demo.cursor(true))
    },
    hide: () => page.evaluate(() => window.__demo.cursor(false)),
    async glide(x, y, ms = 800) {
      const from = at
      const t0 = Date.now()
      for (;;) {
        const t = Math.min((Date.now() - t0) / ms, 1)
        const k = ease(t)
        await page.mouse.move(from.x + (x - from.x) * k, from.y + (y - from.y) * k)
        if (t >= 1) break
        await sleep(12)
      }
      at = { x, y }
    },
    async to(locator, ms, dx = 0.5, dy = 0.5) {
      const b = await locator.boundingBox()
      await this.glide(b.x + b.width * dx, b.y + b.height * dy, ms)
    },
    async click() {
      await page.mouse.down()
      await sleep(110)
      await page.mouse.up()
    },
  }
}

/** Scrolls the element's scroller (the page, or the sticky loose column), gently, until it's clear of the tray at the foot of the screen. */
async function reveal(page, locator) {
  const b = await locator.boundingBox()
  const room = page.viewportSize().height - 150
  if (b.y >= 90 && b.y + b.height <= room) return
  await locator.evaluate((el, dy) => {
    let s = el.parentElement
    while (s && !(s.scrollHeight > s.clientHeight && /auto|scroll/.test(getComputedStyle(s).overflowY))) s = s.parentElement
    ;(s ?? window).scrollBy({ top: dy, behavior: 'smooth' })
  }, b.y + b.height / 2 - room / 2)
  await sleep(750)
}

// ---------- the app, through its UI ----------
async function api(page, method, path, body) {
  return page.evaluate(async ([m, p, b]) => {
    const csrf = document.cookie.match(/(?:^|; )(?:__Host-)?muni_csrf=([^;]+)/)?.[1] ?? ''
    const r = await fetch(p, { method: m, headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: b ? JSON.stringify(b) : undefined })
    return { status: r.status, body: await r.json().catch(() => null) }
  }, [method, path, body])
}
const must = (r, what) => {
  if (r.status >= 300) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body)}`)
  return r.body
}
/** A virtual platform authenticator (Chromium CDP) with PRF, so the passkey also unlocks encrypted writing. */
async function authenticator(page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, defaultBackupEligibility: true, defaultBackupState: true, hasPrf: true },
  })
}
// The new headless mode (channel 'chromium'): its screenshots at 2× are fast enough to film with.
const browser = await chromium.launch({ channel: 'chromium' })
const newCtx = async (phone = false) => {
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone, colorScheme: 'light', reducedMotion: 'no-preference', locale: 'en-US', timezoneId: 'Europe/Amsterdam' })
  await ctx.addInitScript(overlay)
  return ctx
}
/** A new account through the real entrance: name, passkey, no character yet. */
async function signUp(name, phone = false) {
  const page = await (await newCtx(phone)).newPage()
  await authenticator(page)
  await page.goto(`${BASE}/signin`)
  await page.click('button:has-text("Create an account")')
  await page.fill('input[autocomplete="name"]', name)
  await page.click('button:has-text("Create with a passkey")')
  await page.waitForSelector('text=Add a second passkey')
  await page.click('button:has-text("Not now")')
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'))
  // A new account's first evening: past the prologue, and the guide hidden (e2e/firstrun.mjs covers it).
  await page.locator('.prologue-skip').click({ timeout: 8000 }).catch(() => {})
  await page.locator('button:has-text("Decide later")').click({ timeout: 5000 }).catch(() => {})
  await page.evaluate(() => fetch('/api/auth/me', { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-csrf-token': decodeURIComponent((document.cookie.match(/__Host-muni_csrf=([^;]+)/) ?? document.cookie.match(/muni_csrf=([^;]+)/))?.[1] ?? '') }, body: JSON.stringify({ guide: 'hidden' }) })).catch(() => {})
  await page.reload()
  // Keys are made without asking; wait until this device holds them (once more after a reload if slow).
  const unlocked = () => page.waitForSelector('text=Your encrypted writing is unlocked on this device.', { timeout: 20000 })
  await page.goto(`${BASE}/account#encryption`)
  await unlocked().catch(async () => {
    await page.reload()
    await unlocked()
  })
  return page
}
/** Writes a thought through the composer and waits until the server has it. */
async function write(page, sprintId, text, category) {
  await page.goto(`${BASE}/?sprint=${sprintId}`)
  await page.waitForSelector('textarea[name="thought"]')
  await page.fill('textarea[name="thought"]', text)
  if (category) await page.getByRole('radio', { name: { proud: 'Proud of', keep: 'Keep', improve: 'Improve', stop: 'Stop', try: 'Try' }[category], exact: true }).click()
  await page.click('button:has-text("Add to sprint")')
  await page.waitForSelector(`.passage[data-state=submitted]:has-text("${text.slice(0, 30)}")`, { timeout: 15000 })
}
/** The facilitator gathers thoughts into themes on the Themes page (titles are sealed in the browser). */
async function group(page, skip = 0) {
  const titled = (title) => page.waitForFunction((t) => [...document.querySelectorAll('textarea[aria-label="Theme title"]')].some((f) => f.value === t), title, { timeout: 15000 })
  for (const t of THEMES.slice(skip)) {
    for (const e of t.entries) await page.locator('.sort-loose .sort-slip-btn', { hasText: e }).click()
    await page.fill('.sort-tray input[aria-label="New theme title"]', t.title)
    await page.click('.sort-tray button:has-text("Create")')
    await titled(t.title)
  }
  for (const t of THEMES.slice(skip)) {
    const chapter = page.locator('.sort-pile:not(.sort-pile--ghost)').nth(THEMES.indexOf(t))
    const q = chapter.locator('textarea[aria-label="Opening question"]')
    await q.fill(t.question)
    await q.press('Enter')
    await chapter.locator('.sort-saved').waitFor({ timeout: 10000 })
  }
}

// ---------- the demo ----------
let failed = false
try {
  // Harbor: six people, each with their own passkey and browser (Tomás on his phone).
  const p = {}
  p.maya = await signUp(PEOPLE.maya)
  const ws = must(await api(p.maya, 'POST', '/api/workspaces', { name: 'Harbor' }), 'workspace')
  for (const k of Object.keys(PEOPLE).filter((k) => k !== 'maya')) must(await api(p.maya, 'POST', `/api/workspaces/${ws.id}/invitations`, { email: email(k) }), 'invite')
  for (const k of Object.keys(PEOPLE).filter((k) => k !== 'maya')) {
    p[k] = await signUp(PEOPLE[k], k === 'tomas')
    const link = await p[k].evaluate(async (e) => (await fetch('/api/dev/inbox').then((r) => r.json())).find((m) => m.to === e && /invited/.test(m.subject))?.body.split('\n').map((l) => l.trim()).find((l) => l.includes('/invite')), email(k))
    must(await api(p[k], 'POST', '/api/invitations/accept', { token: link.split('#')[1] }), 'accept')
  }
  log('team ready')
  // Maya sets up Sprint 14 (encrypted by default) and opens collection; everyone writes.
  await p.maya.goto(`${BASE}/workspaces/${ws.id}/sprints/new`)
  await p.maya.fill('#f-name', 'Sprint 14')
  if (!(await p.maya.isChecked('#f-encrypt'))) throw new Error('expected an encrypted sprint')
  await p.maya.click('button:has-text("Create and open collection")')
  await p.maya.waitForURL(/\/sprints\/[0-9a-f-]+$/)
  const sprintId = p.maya.url().split('/').pop()
  for (const [k, list] of Object.entries(THOUGHTS)) for (const [t, c] of list) await write(p[k], sprintId, t, c)
  log('thoughts written')

  // 01 · The entrance, signed out.
  const visitor = await (await newCtx()).newPage()
  await visitor.goto(`${BASE}/signin`)
  await visitor.waitForSelector('text=Welcome back.')
  await visitor.evaluate(() => document.fonts.ready)
  await sleep(1200)
  await film(visitor, '01-entrance', () => sleep(3800))
  await visitor.context().close()

  // 02 · Priya writes a thought on her sprint's page ("/" opens it).
  const priya = p.priya
  await priya.goto(`${BASE}/`)
  await priya.waitForURL(`**/sprints/${sprintId}`)
  await priya.waitForSelector('.passage[data-state=submitted]')
  await priya.evaluate(() => document.fonts.ready)
  // The writer, from its heading down (the sprint's bar is above it; the facilitator's shot shows it).
  await priya.evaluate(() => window.scrollTo(0, document.querySelector('.journal-scene').getBoundingClientRect().top + window.scrollY - 40))
  await sleep(1500)
  const pc = cursorOf(priya)
  const field = priya.locator('textarea[name="thought"]')
  const add = priya.locator('button:has-text("Add to sprint")')
  await pc.show(700, 760)
  await film(priya, '02-write', async () => {
    await sleep(500)
    await pc.to(field, 750, 0.7, 0.72) // away from where the words appear
    await sleep(80)
    await pc.click()
    await sleep(250)
    await priya.keyboard.type(ON_CAMERA, { delay: 42 })
    await sleep(350)
    await pc.to(add, 700)
    await sleep(120)
    await pc.click()
    await priya.waitForSelector(`.passage[data-state=submitted]:has-text("${ON_CAMERA.slice(0, 30)}")`, { timeout: 15000 })
    await pc.glide(1060, 700, 650)
    await sleep(1100)
  })
  await pc.hide()
  log('written on camera')

  // 03 · Tomás, on his phone: the same page, the same writer.
  const tomas = p.tomas
  await tomas.goto(`${BASE}/`)
  await tomas.waitForURL(`**/sprints/${sprintId}`)
  await tomas.waitForSelector('.passage[data-state=submitted]')
  await tomas.evaluate(() => document.fonts.ready)
  await tomas.evaluate(() => window.scrollTo(0, 0))
  await sleep(1200)
  await film(tomas, '03-phone', async () => {
    await sleep(400)
    await tomas.locator('textarea[name="thought"]').tap()
    await sleep(300)
    await tomas.keyboard.type(ON_PHONE, { delay: 38 })
    await sleep(300)
    await tomas.getByRole('radio', { name: 'Keep', exact: true }).tap()
    await sleep(350)
    await tomas.locator('button:has-text("Add to sprint")').tap()
    await tomas.waitForSelector(`.passage[data-state=submitted]:has-text("${ON_PHONE.slice(0, 30)}")`, { timeout: 15000 })
    await sleep(1200)
  })
  log('written on a phone')

  // 04 · The same page in four of the characters' rooms (Priya's own choice, on her own screen).
  for (const [i, room] of ROOMS.entries()) {
    must(await api(priya, 'PATCH', '/api/auth/me', { avatar_id: room, avatar_theme: true }), 'character')
    await priya.goto(`${BASE}/sprints/${sprintId}`)
    await priya.waitForSelector(`.room[data-room="${room}"] .passage`)
    await priya.evaluate(() => document.fonts.ready)
    await priya.evaluate(() => window.scrollTo(0, 0))
    await sleep(1400)
    await still(priya, `04-room-${i}-${room}`)
  }
  must(await api(priya, 'PATCH', '/api/auth/me', { avatar_id: null }), 'character off')

  // 05 · Maya closes collection early, from the sprint's page: what it does, then the closed state.
  const maya = p.maya
  await maya.goto(`${BASE}/sprints/${sprintId}`)
  await maya.waitForSelector('button:has-text("Close collection…")')
  await maya.evaluate(() => document.fonts.ready)
  await maya.evaluate(() => window.scrollTo(0, 0)) // the browser restores where she last was on this page
  await sleep(1500)
  const mc = cursorOf(maya)
  await mc.show(760, 420)
  await film(maya, '05-close', async () => {
    await sleep(500)
    await mc.to(maya.locator('button:has-text("Close collection…")'), 900)
    await sleep(350)
    await mc.click()
    await maya.locator('[role=dialog]').waitFor()
    await sleep(2600)
    await mc.to(maya.locator('[role=dialog] button:text-is("Close collection")'), 700)
    await sleep(200)
    await mc.click()
    await maya.waitForSelector('.sbar-state:has-text("Collection closed")')
    await sleep(700)
    await mc.to(maya.locator('button:has-text("Start the retro…")'), 900)
    await sleep(1500)
  })
  await mc.hide()
  log('closed on camera')

  // 06 · Maya gathers thoughts into themes (optional, and worth it here): the first on camera.
  await maya.click('a:has-text("Group into themes")')
  await maya.waitForURL(/prepare$/)
  await maya.waitForSelector('.sort-loose .sort-slip-btn:has-text("Three PRs waited")', { timeout: 15000 })
  await maya.evaluate(() => document.fonts.ready)
  // Down to the table: the loose thoughts and the (still empty) themes.
  await maya.evaluate(() => window.scrollTo(0, document.querySelector('.sort').getBoundingClientRect().top + window.scrollY - 90))
  await sleep(1200)
  const tc = cursorOf(maya)
  await tc.show(900, 560)
  await film(maya, '06-themes', async () => {
    await sleep(500)
    for (const e of THEMES[0].entries) {
      const thought = maya.locator('.sort-loose .sort-slip-btn', { hasText: e })
      await reveal(maya, thought)
      await tc.to(thought, 520, 0.62, 0.5)
      await sleep(90)
      await tc.click()
      await sleep(260)
    }
    // Across to the empty pile, where the theme will appear, and name it there.
    await sleep(350)
    const ghost = maya.locator('.sort-pile--ghost input[aria-label="New theme title"]')
    await tc.to(ghost, 700, 0.3, 0.5)
    await sleep(120)
    await tc.click()
    await sleep(250)
    await maya.keyboard.type(THEMES[0].title, { delay: 55 })
    await sleep(300)
    await tc.to(maya.locator('.sort-pile--ghost button:has-text("Create")'), 500)
    await sleep(100)
    await tc.click()
    await maya.waitForFunction((t) => [...document.querySelectorAll('textarea[aria-label="Theme title"]')].some((f) => f.value === t), THEMES[0].title, { timeout: 15000 })
    await maya.evaluate(() => document.querySelector('.sort-loose')?.scrollTo({ top: 0, behavior: 'smooth' }))
    await sleep(700)
    await tc.glide(1100, 470, 600)
    await sleep(1500)
  })
  await tc.hide()
  await group(maya, 1)
  const first = maya.locator('.sort-pile:not(.sort-pile--ghost)').first().locator('textarea[aria-label="Opening question"]')
  await first.fill(THEMES[0].question)
  await first.press('Enter')
  await maya.locator('.sort-pile:not(.sort-pile--ghost)').first().locator('.sort-saved').waitFor({ timeout: 10000 })
  log('grouped')
  await maya.click('button:has-text("Start the retro…")')
  await maya.click('[role=dialog] button:text-is("Start the retro")')
  await maya.waitForURL(/stage$/)
  await maya.setViewportSize({ width: 1152, height: 720 }) // a big-screen layout: film it a little closer
  // Faces in the room: most of Harbor has a character; Sam doesn't, and shows as a monogram.
  for (const [k, avatar] of Object.entries(FACES)) must(await api(p[k], 'PATCH', '/api/auth/me', { avatar_id: avatar, avatar_theme: false }), 'character')
  await maya.reload()
  await maya.locator('.retro-title').waitFor()
  await maya.evaluate(() => document.fonts.ready)
  await sleep(1500)
  const ROOM = `${BASE}/sprints/${sprintId}/room`
  const offsets = {}
  /** Films a phone while the stage is being filmed, and notes when it started, so the reel can play them in step. */
  const alongside = async (stageStart, name, page, fn) => {
    offsets[name] = (Date.now() - stageStart) / 1000
    await film(page, name, fn)
  }

  // 07 · The room fills: the team opens the retro, on laptops and a phone; faces light up, each arrival said once.
  await film(maya, '07-arrive', async () => {
    await sleep(900)
    for (const k of ['jonas', 'tomas', 'priya', 'aiko', 'sam']) {
      await p[k].goto(ROOM)
      await p[k].locator('.retro-title').waitFor()
      await sleep(650)
    }
    await sleep(1800)
  })
  log('arrived')

  // 08 · Choose: moving there opens the vote. Everyone votes on their own screen; Tomás on his phone, on camera.
  await maya.click('.retro-rail-end button:has-text("Next: Choose")')
  await maya.locator('.retro-title', { hasText: 'What matters' }).waitFor()
  const ids = must(await api(maya, 'GET', `/api/sprints/${sprintId}/themes`), 'themes').themes.map((t) => t.id)
  for (const [k, list] of Object.entries(VOTES)) if (k !== 'tomas') for (const i of list) must(await api(p[k], 'POST', `/api/sprints/${sprintId}/votes`, { theme_id: ids[i], cast: true }), 'vote')
  await maya.locator('.rm-big', { hasText: /^5/ }).waitFor({ timeout: 10000 })
  await tomas.locator('.vote-purse').waitFor()
  await tomas.evaluate(() => window.scrollTo(0, 0))
  await maya.evaluate(() => document.fonts.ready)
  await sleep(1200)
  const next = maya.locator('.retro-rail-end button', { hasText: 'Next: Talk' })
  const sc = cursorOf(maya)
  await sc.show(620, 520)
  await film(maya, '08-choose', async () => {
    const t0 = Date.now()
    await sleep(700)
    await alongside(t0, '08b-vote-phone', tomas, async () => {
      await sleep(500)
      for (const i of VOTES.tomas) {
        const vote = tomas.locator('.retro-topic', { hasText: THEMES[i].title }).locator('.retro-vote')
        await vote.scrollIntoViewIfNeeded()
        await sleep(350)
        await vote.tap()
        await tomas.locator('.retro-topic[data-voted]', { hasText: THEMES[i].title }).waitFor()
        await sleep(650)
      }
      await sleep(600)
    })
    await maya.locator('.rm-big', { hasText: /^6/ }).waitFor({ timeout: 10000 })
    await sleep(900)
    await sc.to(next, 900, 0.5, 0.55)
    await sleep(150)
    await sc.click()
    await maya.locator('.retro-talk-title').waitFor()
    await sc.glide(760, 430, 700)
    await sleep(2200)
  })
  await sc.hide()
  log('chosen')

  // 09 · Talk: the facilitator asks how the first topic showed up. Four answer off camera, in their
  // own browsers (so the lines are sealed); Tomás answers on his phone, on camera; then her cue
  // offers to share, and she does.
  await maya.click('.retro-asks button:has-text("Ask how it showed up")')
  const ANSWERS = { jonas: ['I felt this', 'Nobody knew the runbook still pointed at the old cluster.'], priya: ['I felt this', null], aiko: ['I felt this', 'I restarted it twice without knowing whose it was.'], sam: ['I’d need context', null] }
  for (const [k, [choice, line]] of Object.entries(ANSWERS)) {
    const pg = p[k]
    await pg.locator('.ci-choice', { hasText: choice }).click()
    await pg.locator('.ci-choice[aria-checked="true"]').waitFor()
    if (line) {
      await pg.locator('.ci-ask button:has-text("Add a line")').click()
      await pg.fill('textarea[aria-label="Your line (optional)"]', line)
      await pg.click('button:has-text("Save line")')
      await pg.locator('.ci-your-line').waitFor()
    }
  }
  await maya.locator('.retro-asks .retro-asking-n', { hasText: '4 answers' }).waitFor()
  await tomas.locator('.ci-ask').waitFor()
  await tomas.evaluate(() => window.scrollTo(0, 0))
  // Opening the question can scroll its margin control into view. Begin this chapter with the
  // full topic heading visible; sharing the answers will then naturally bring those into view.
  await maya.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await maya.evaluate(() => document.fonts.ready)
  await sleep(1200)
  const tc2 = cursorOf(maya)
  await tc2.show(760, 600)
  // Sharing is the cue's next step once most have answered: the facilitator follows it.
  const share = maya.locator('.cue-act', { hasText: 'Share the answers' })
  await film(maya, '09-talk', async () => {
    const t0 = Date.now()
    await sleep(500)
    await alongside(t0, '09b-answer-phone', tomas, async () => {
      await sleep(500)
      await tomas.locator('.ci-choice', { hasText: 'Not in my work' }).tap()
      await tomas.locator('.ci-choice[aria-checked="true"]').waitFor()
      await sleep(500)
      await tomas.locator('.ci-ask button:has-text("Add a line")').tap()
      await sleep(250)
      await tomas.keyboard.type('Mobile never touched staging this sprint.', { delay: 36 })
      await sleep(250)
      await tomas.locator('button:has-text("Save line")').tap()
      await tomas.locator('.ci-your-line').waitFor()
      await sleep(900)
    })
    await maya.locator('.retro-asks .retro-asking-n', { hasText: '5 answers' }).waitFor({ timeout: 10000 })
    await sleep(500)
    await tc2.to(share, 900, 0.5, 0.55)
    await sleep(150)
    await tc2.click()
    await maya.locator('.ci-moment .ci-tally').waitFor()
    await tc2.glide(640, 560, 800)
    await sleep(2600)
  })
  await tc2.hide()
  // What the room will remember, and an idea to try, written on the screen.
  await maya.fill('textarea[aria-label="We’ll remember"]', TAKEAWAY)
  await maya.keyboard.press('Enter')
  await maya.locator('.retro-saved').first().waitFor()
  await maya.fill('textarea[aria-label="We could try"]', EXPERIMENTS[0].change)
  await maya.keyboard.press('Enter')
  await maya.locator('.retro-saved').first().waitFor()
  log('talked')

  // 10 · Agree: the idea from the talk becomes an experiment; Tomás is asked on his phone and says yes.
  await maya.setViewportSize({ width: 1280, height: 800 })
  await maya.click('.retro-steps button:has-text("Agree")')
  await maya.waitForSelector('#ex-change')
  await tomas.locator('.retro-title', { hasText: 'What will we' }).waitFor()
  await maya.evaluate(() => document.fonts.ready)
  await sleep(1200)
  const members = must(await api(maya, 'GET', `/api/sprints/${sprintId}`), 'sprint').participants
  const ac = cursorOf(maya)
  await ac.show(700, 300)
  await film(maya, '10-agree', async () => {
    const t0 = Date.now()
    await sleep(500)
    const use = maya.locator('.retro-idea-use').first()
    await ac.to(use, 800)
    await sleep(120)
    await ac.click()
    await sleep(500)
    const signal = maya.locator('#ex-signal')
    await ac.to(signal, 600, 0.3, 0.5)
    await ac.click()
    await maya.keyboard.type(EXPERIMENTS[0].signal, { delay: 22 })
    await sleep(250)
    await maya.selectOption('#ex-owner', members.find((m) => m.display_name === PEOPLE[EXPERIMENTS[0].owner]).account_id)
    await sleep(400)
    const addBtn = maya.locator('.exp-form button[type=submit]')
    await reveal(maya, addBtn)
    await ac.to(addBtn, 600)
    await sleep(120)
    await ac.click()
    await maya.locator('.retro-exp', { hasText: 'Waiting for' }).waitFor()
    // Back up to what's agreed: the experiment, waiting for its owner.
    await maya.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
    await ac.glide(900, 380, 700)
    await sleep(500)
    await alongside(t0, '10b-own-phone', tomas, async () => {
      await tomas.locator('.retro-invite').waitFor({ timeout: 10000 })
      await tomas.evaluate(() => window.scrollTo(0, 0))
      await sleep(900)
      await tomas.locator('.retro-invite button:has-text("I’ll own this")').tap()
      await tomas.locator('.retro-invite').waitFor({ state: 'detached' })
      await sleep(900)
    })
    await maya.locator('.retro-exp', { hasText: `${PEOPLE[EXPERIMENTS[0].owner]} owns this` }).waitFor({ timeout: 10000 })
    await sleep(2200)
  })
  await ac.hide()
  writeFileSync(`${OUT}/offsets.json`, JSON.stringify(offsets))
  // Off camera: the second experiment, its owner's yes, the end of the retro and the recap.
  const e2 = EXPERIMENTS[1]
  await maya.fill('#ex-change', e2.change)
  await maya.fill('#ex-signal', e2.signal)
  await maya.selectOption('#ex-owner', members.find((m) => m.display_name === PEOPLE[e2.owner]).account_id)
  // The theme waits behind a link on the stage's form.
  if (!(await maya.locator('#ex-theme').count())) await maya.click('.exp-form-more')
  await maya.selectOption('#ex-theme', { label: THEMES[e2.theme].title })
  await maya.click('.exp-form button[type=submit]')
  await maya.locator('.retro-exp', { hasText: e2.change }).waitFor()
  const exps = must(await api(maya, 'GET', `/api/sprints/${sprintId}/experiments`), 'experiments')
  must(await api(p[e2.owner], 'POST', `/api/sprints/${sprintId}/experiments/${exps.find((x) => x.owner_name === PEOPLE[e2.owner]).id}/accept`, { accept: true }), 'accept ownership')
  await maya.click('.retro-end button:has-text("End the retro")')
  await maya.click('[role=dialog] button:has-text("End the retro")')
  await maya.waitForURL(new RegExp(`/sprints/${sprintId}$`))
  await maya.fill('textarea[aria-label="Recap (Markdown)"]', RECAP)
  await maya.click('button:has-text("Publish")')
  await maya.waitForSelector('text=published')
  log('done')
} catch (e) {
  failed = true
  console.error(e)
  for (const [i, pg] of browser.contexts().flatMap((c) => c.pages()).entries()) await pg.screenshot({ path: `${OUT}/failure-${i}.png` }).catch(() => {})
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
