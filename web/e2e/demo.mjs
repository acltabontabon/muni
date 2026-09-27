/**
 * The release demo: a short, calm walkthrough of the real app, captured frame by frame.
 *
 * Everything on screen is this build of Muni running locally, driven through its own UI — a
 * fictional team (Harbor) signs up with passkeys, writes into an encrypted sprint, and holds a
 * retro. Only the cursor, the captions and the closing card are added. The script films its
 * segments as frames (Chromium's screencast, with each frame's real timestamp) and writes an
 * ffconcat list per segment; docs/demo/export.sh turns them into the MP4 and GIF.
 *
 *   cd web && DEMO_OUT=<dir>/capture MUNI_URL=http://localhost:8870 node e2e/demo.mjs
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
const FONTS = new URL('../node_modules/@fontsource-variable/', import.meta.url).href
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
  tomas: [['I didn’t know who to ask for a review on the billing code.', 'improve'], ['Writing the release notes as we went saved us an evening.', 'keep']],
  aiko: [['Reviews bunch up on Thursday afternoon, right before the cut.', 'improve'], ['Pairing with Sam on the migration made it far less scary.', 'proud']],
  sam: [['Small PRs were reviewed within the hour; big ones stalled.', null], ['Planning ran forty minutes over — half the tickets weren’t ready.', 'improve']],
}
/** Written by Priya on camera. */
const ON_CAMERA = 'Pairing on the release checklist caught two gaps before Friday.'
const THEMES = [
  { title: 'Who owns staging?', question: 'What would have made Wednesday’s outage shorter?', entries: ['Staging was down most', 'We found the expired certificate', 'The on-call runbook still', 'On-call was quiet'] },
  { title: 'Reviews that wait', question: 'What would get a first review to happen the same day?', entries: ['Three PRs waited', 'Reviews bunch up', 'Small PRs were reviewed', 'I didn’t know who to ask'] },
  { title: 'What helped us ship', question: 'What should we make sure we keep doing?', entries: ['Pairing on the release checklist', 'Pairing with Sam', 'Writing the release notes'] },
  { title: 'Planning runs long', question: 'What does a ticket need before it’s ready to plan?', entries: ['Planning ran forty minutes', 'We estimated the search work'] },
]
// Indexes into THEMES, three votes each at most.
const VOTES = { maya: [0, 1, 3], jonas: [0, 1, 2], priya: [0, 1, 2], tomas: [1, 0], aiko: [1, 0, 3], sam: [0, 2] }
const TAKEAWAY = 'Staging needs a named owner every sprint, the way on-call has one.'
const EXPERIMENTS = [
  { change: 'Name a staging owner in every on-call handover, starting this sprint.', signal: 'A staging incident has someone on it within 15 minutes.', owner: 'jonas', theme: 0 },
  { change: 'Keep 20 minutes after standup for first reviews, every day.', signal: 'No PR waits more than a working day for a first review.', owner: 'aiko', theme: 1 },
]
const RECAP = `Sprint 14, looking back

We spent most of the hour on Wednesday’s staging outage, then on reviews that wait.

Takeaway: staging needs a named owner every sprint, the way on-call has one.

We’ll try:
- a named staging owner in every on-call handover (Jonas)
- 20 minutes after standup for first reviews (Aiko)`
const CAPTIONS = {
  write: 'Write it down while it’s fresh.',
  reveal: 'When collection closes, everyone’s thoughts arrive together — without names.',
  discuss: 'Talk it through, one topic at a time.',
  outcomes: 'Agree what to try — it comes back next sprint.',
}

// ---------- the overlay: a tidy cursor and a caption band, drawn in the page ----------
function overlay() {
  if (window.__demo) return
  const css = `
    #demo-cursor { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none; width: 22px; height: 22px; opacity: 0; transition: opacity 260ms ease; will-change: transform; filter: drop-shadow(0 1px 1.5px rgba(29,27,24,.28)); }
    #demo-cursor.on { opacity: 1; }
    .demo-ripple { position: fixed; z-index: 2147483646; pointer-events: none; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; border: 2px solid rgba(164,69,42,.55); animation: demo-ripple 520ms cubic-bezier(.2,.7,.3,1) forwards; }
    @keyframes demo-ripple { from { transform: scale(.35); opacity: .9 } to { transform: scale(1.25); opacity: 0 } }
    #demo-caption { position: fixed; left: 50%; bottom: calc(100vw * 34 / 1280); z-index: 2147483645; pointer-events: none; transform: translate(-50%, 6px); opacity: 0; transition: opacity 420ms ease, transform 420ms ease;
      max-width: 88vw; white-space: nowrap; padding: calc(100vw * 11 / 1280) calc(100vw * 24 / 1280); border-radius: 999px;
      background: rgba(244,239,230,.93); color: #1d1b18; box-shadow: 0 0 0 1px rgba(29,27,24,.08), 0 10px 30px -12px rgba(29,27,24,.35); backdrop-filter: blur(8px);
      font: 500 calc(100vw * 22 / 1280)/1.25 'Geist Variable', ui-sans-serif, system-ui, sans-serif; letter-spacing: -0.012em; }
    #demo-caption.on { opacity: 1; transform: translate(-50%, 0); }
    #demo-caption.instant { transition: none; }`
  const mount = () => {
    const style = document.createElement('style')
    style.textContent = css
    document.head.append(style)
    const cur = document.createElement('div')
    cur.id = 'demo-cursor'
    cur.innerHTML = '<svg viewBox="0 0 22 22" width="22" height="22"><path d="M4 2.5 L4 18 L8.2 14.2 L11 20.2 L13.6 19 L10.9 13.1 L16.6 13.1 Z" fill="#1d1b18" stroke="#fbf8f2" stroke-width="1.5" stroke-linejoin="round"/></svg>'
    const cap = document.createElement('div')
    cap.id = 'demo-caption'
    document.body.append(cur, cap)
    document.addEventListener('mousemove', (e) => { cur.style.transform = `translate(${e.clientX - 4}px, ${e.clientY - 2.5}px)` }, true)
    document.addEventListener('mousedown', (e) => {
      const r = document.createElement('div')
      r.className = 'demo-ripple'
      r.style.left = `${e.clientX}px`
      r.style.top = `${e.clientY}px`
      document.body.append(r)
      setTimeout(() => r.remove(), 600)
    }, true)
    window.__demo = {
      cursor(on) { cur.classList.toggle('on', on) },
      caption(text, instant) {
        cap.classList.toggle('instant', !!instant)
        if (text) cap.textContent = text
        cap.classList.toggle('on', !!text)
      },
    }
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
  log(`filmed ${name}: ${total.toFixed(2)} s, ${frames.length} frames (${(frames.length / (end - start)).toFixed(1)}/s)`)
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
const caption = (page, text, instant = false) => page.evaluate(([t, i]) => window.__demo.caption(t, i), [text, instant])

// ---------- the app, through its UI ----------
async function api(page, method, path, body) {
  return page.evaluate(async ([m, p, b]) => {
    const csrf = document.cookie.match(/(?:^|; )(?:__Host-)?muni_csrf=([^;]+)/)?.[1] ?? ''
    const r = await fetch(p, { method: m, headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, 'x-muni-client': '5' }, body: b ? JSON.stringify(b) : undefined })
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
const newCtx = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'no-preference', locale: 'en-US', timezoneId: 'Europe/Amsterdam' })
  await ctx.addInitScript(overlay)
  return ctx
}
/** A new account through the real entrance: name, passkey, no character yet. */
async function signUp(name) {
  const page = await (await newCtx()).newPage()
  await authenticator(page)
  await page.goto(`${BASE}/signin`)
  await page.click('button:has-text("Create an account")')
  await page.fill('input[autocomplete="name"]', name)
  await page.click('button:has-text("Create with a passkey")')
  await page.waitForSelector('text=Add a second passkey')
  await page.click('button:has-text("Not now")')
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'))
  await page.locator('button:has-text("Decide later")').click({ timeout: 5000 }).catch(() => {})
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
/** The facilitator gathers thoughts into themes on the Prepare page (titles are sealed in the browser). */
async function group(page) {
  for (const t of THEMES) {
    for (const e of t.entries) await page.locator('section[aria-label="Ungrouped entries"] div.bg-card', { has: page.locator('p', { hasText: e }) }).locator('input[type=checkbox]').check()
    await page.locator(`section[aria-label="Ungrouped entries"] button:has-text("Move ${t.entries.length} to")`).click()
    await page.fill('[role=menu] input[aria-label="New theme title"]', t.title)
    await page.click('[role=menu] button:has-text("Create")')
    await page.waitForSelector(`input[aria-label="Theme title"][value="${t.title}"]`, { timeout: 15000 })
  }
  for (const t of THEMES) {
    const card = page.locator('section[aria-label="Themes"] article', { has: page.locator(`input[value="${t.title}"]`) })
    await card.locator('textarea[aria-label="Opening question"]').fill(t.question)
    await card.locator('button:has-text("Save theme")').click()
    await card.locator('button:has-text("Save theme")').waitFor({ state: 'detached' })
  }
}
/** A still closing card: the mark, the name, where to find it. */
function endCard() {
  const html = `<!doctype html><meta charset="utf-8"><style>
    @font-face { font-family: Geist; src: url('${FONTS}geist/files/geist-latin-wght-normal.woff2') format('woff2'); font-weight: 100 900; }
    @font-face { font-family: Fraunces; src: url('${FONTS}fraunces/files/fraunces-latin-wght-normal.woff2') format('woff2'); font-weight: 100 900; }
    @font-face { font-family: Fraunces; font-style: italic; src: url('${FONTS}fraunces/files/fraunces-latin-wght-italic.woff2') format('woff2'); font-weight: 100 900; }
    html, body { margin: 0; height: 100%; }
    body { background: radial-gradient(120% 90% at 50% 8%, #f8f3ea 0%, #f4efe6 55%, #eee6d8 100%); color: #1d1b18; display: grid; place-items: center; font-family: Geist, sans-serif; }
    .card { display: flex; flex-direction: column; align-items: center; text-align: center; transform: translateY(-10px); }
    .lockup { display: flex; align-items: center; gap: 18px; }
    .word { font-family: Fraunces, serif; font-size: 92px; line-height: 1; letter-spacing: -0.02em; font-weight: 500; }
    .def { margin-top: 26px; font-family: Fraunces, serif; font-size: 23px; color: #5b554c; }
    .def i { color: #1d1b18; }
    .rule { width: 56px; height: 1px; background: rgba(29,27,24,.22); margin: 34px 0 30px; }
    .url { font-size: 27px; font-weight: 500; letter-spacing: -0.01em; color: #a4452a; }
  </style>
  <div class="card">
    <div class="lockup">
      <svg width="118" height="118" viewBox="0 0 64 64" aria-label="Muni"><g fill="none" stroke="#1d1b18" stroke-width="7" stroke-linecap="round"><path d="M10 40V28a8 8 0 0 1 16 0v12"/><path d="M26 40V28a8 8 0 0 1 16 0v12"/></g><circle cx="52" cy="40" r="4.5" fill="#a4452a"/><g fill="none" stroke="#1d1b18" stroke-width="5" stroke-linecap="round" opacity="0.2" transform="translate(0 92) scale(1 -1)"><path d="M10 40V33a8 8 0 0 1 16 0v7"/><path d="M26 40V33a8 8 0 0 1 16 0v7"/></g></svg>
      <span class="word">muni</span>
    </div>
    <div class="def"><i>muni-muni</i> · to reflect; to turn a thought over.</div>
    <div class="rule"></div>
    <div class="url">act.munimuni.app</div>
  </div>`
  writeFileSync(`${OUT}/end-card.html`, html)
  return `file://${OUT}/end-card.html`
}

// ---------- the demo ----------
let failed = false
try {
  // Harbor: six people, each with their own passkey and browser.
  const p = {}
  p.maya = await signUp(PEOPLE.maya)
  const ws = must(await api(p.maya, 'POST', '/api/workspaces', { name: 'Harbor' }), 'workspace')
  for (const k of Object.keys(PEOPLE).filter((k) => k !== 'maya')) must(await api(p.maya, 'POST', `/api/workspaces/${ws.id}/invitations`, { email: email(k) }), 'invite')
  for (const k of Object.keys(PEOPLE).filter((k) => k !== 'maya')) {
    p[k] = await signUp(PEOPLE[k])
    const link = await p[k].evaluate(async (e) => (await fetch('/api/dev/inbox').then((r) => r.json())).find((m) => m.to === e && /invited/.test(m.subject))?.body.split('\n').map((l) => l.trim()).find((l) => l.includes('/invite')), email(k))
    must(await api(p[k], 'POST', '/api/invitations/accept', { token: link.split('#')[1] }), 'accept')
  }
  log('team ready')
  // Maya opens Sprint 14 (encrypted by default) and everyone writes.
  await p.maya.goto(`${BASE}/workspaces/${ws.id}/sprints/new`)
  await p.maya.fill('#f-name', 'Sprint 14')
  if (!(await p.maya.isChecked('#f-encrypt'))) throw new Error('expected an encrypted sprint')
  await p.maya.click('button:has-text("Create and open collection")')
  await p.maya.waitForURL(/\/sprints\/[0-9a-f-]+$/)
  const sprintId = p.maya.url().split('/').pop()
  for (const [k, list] of Object.entries(THOUGHTS)) for (const [t, c] of list) await write(p[k], sprintId, t, c)
  log('thoughts written')

  // 1 · The entrance, signed out.
  const visitor = await (await newCtx()).newPage()
  await visitor.goto(`${BASE}/signin`)
  await visitor.waitForSelector('text=Welcome back.')
  await visitor.evaluate(() => document.fonts.ready)
  await sleep(1200)
  await film(visitor, '01-entrance', () => sleep(2600))
  await visitor.context().close()

  // 2 · Priya writes a thought.
  const priya = p.priya
  await priya.goto(`${BASE}/?sprint=${sprintId}`)
  await priya.waitForSelector('.passage[data-state=submitted]')
  await priya.evaluate(() => document.fonts.ready)
  await sleep(1500)
  const pc = cursorOf(priya)
  const field = priya.locator('textarea[name="thought"]')
  const add = priya.locator('button:has-text("Add to sprint")')
  await pc.show(640, 700)
  await film(priya, '02-write', async () => {
    await caption(priya, CAPTIONS.write)
    await sleep(450)
    await pc.to(field, 750, 0.66, 0.72) // away from where the words appear
    await sleep(80)
    await pc.click()
    await sleep(250)
    await priya.keyboard.type(ON_CAMERA, { delay: 40 })
    await sleep(350)
    await pc.to(add, 700)
    await sleep(120)
    await pc.click()
    await priya.waitForSelector(`.passage[data-state=submitted]:has-text("${ON_CAMERA.slice(0, 30)}")`, { timeout: 15000 })
    await pc.glide(1060, 640, 650)
    await sleep(500)
    await caption(priya, null)
    await sleep(450)
  })
  await pc.hide()
  log('written on camera')

  // Maya closes collection: the reveal happens on her device.
  const maya = p.maya
  await maya.goto(`${BASE}/sprints/${sprintId}`)
  await maya.click('button:has-text("Close collection…")')
  await maya.click('[role=dialog] button:text-is("Close collection")')
  await maya.waitForSelector('.sbar-state:has-text("Collection closed")')
  await maya.click('a:has-text("Group into themes")')
  await maya.waitForURL(/prepare$/)
  await maya.waitForSelector('text=Three PRs waited', { timeout: 15000 })
  await maya.reload()
  await maya.waitForSelector('text=Three PRs waited', { timeout: 15000 })
  await maya.evaluate(() => document.fonts.ready)
  await sleep(1200)

  // 3a · Prepare: everyone's thoughts, together and without names.
  await film(maya, '03-prepare', async () => {
    await caption(maya, CAPTIONS.reveal)
    await sleep(2300)
  })

  // Maya gathers them into themes, then starts the retro. The room votes.
  await maya.evaluate(() => { window.scrollTo(0, 0); window.__demo.caption(null, true) })
  await group(maya)
  log('grouped')
  await maya.click('button:has-text("Start the retro…")')
  await maya.click('[role=dialog] button:text-is("Start the retro")')
  await maya.waitForURL(/stage$/)
  await maya.setViewportSize({ width: 1152, height: 720 }) // a big-screen layout: film it a little closer (four themes in a row)
  for (const k of Object.keys(PEOPLE)) must(await api(p[k], 'POST', `/api/sprints/${sprintId}/meeting/attendance`, { present: true }), 'attendance')
  for (let i = 0; i < 5 && !(await maya.locator('text=This sprint').count()); i++) {
    await maya.keyboard.press('ArrowRight')
    await sleep(1000)
  }
  const ids = must(await api(maya, 'GET', `/api/sprints/${sprintId}/themes`), 'themes').themes.map((t) => t.id)
  must(await api(maya, 'POST', `/api/sprints/${sprintId}/votes/rounds`, {}), 'open voting')
  for (const [k, list] of Object.entries(VOTES)) for (const i of list) must(await api(p[k], 'POST', `/api/sprints/${sprintId}/votes`, { theme_id: ids[i], cast: true }), 'vote')
  must(await api(maya, 'POST', `/api/sprints/${sprintId}/votes/rounds/close`, { action: 'close' }), 'close voting')
  await maya.reload()
  const open = maya.locator('button:has-text("Open the sprint")')
  await open.waitFor()
  await maya.evaluate(() => document.fonts.ready)
  await sleep(1500)

  // 3b · The room sees them for the first time: folded, then opened — in themes, with the votes.
  const mc = cursorOf(maya)
  await mc.show(620, 560)
  await caption(maya, CAPTIONS.reveal, true)
  await film(maya, '04-reveal', async () => {
    await sleep(500)
    await mc.to(open, 800, 0.4, 0.55)
    await sleep(150)
    await mc.click()
    await sleep(500)
    await mc.glide(800, 470, 700)
    await sleep(1400)
    await caption(maya, null)
    await sleep(450)
  })
  await mc.hide()

  // To the first topic, with a takeaway and an invitation to speak; then present it.
  await maya.click('button:has-text("Top three → agenda")')
  await sleep(600)
  await maya.keyboard.press('ArrowRight')
  await maya.click(`button:has-text("${THEMES[0].title}")`)
  await maya.waitForSelector('text=Capture a takeaway')
  await maya.click('button:has-text("Capture a takeaway")')
  await maya.fill('textarea[aria-label="Takeaway"]', TAKEAWAY)
  await maya.fill('input[aria-label="What could we try"]', EXPERIMENTS[0].change)
  await maya.click('button:has-text("Save takeaway")')
  await maya.waitForSelector(`text=${TAKEAWAY}`)
  await maya.click('button:has-text("Invite a voice")')
  await sleep(600)
  await maya.keyboard.press(' ') // the timer runs
  await maya.keyboard.press('h') // present on this screen
  await maya.mouse.move(1100, 690)
  await sleep(2000)

  // 4 · Discuss, one topic at a time.
  await film(maya, '05-discuss', async () => {
    await caption(maya, CAPTIONS.discuss)
    await sleep(1900)
    await maya.keyboard.press('n') // the next voice is invited
    await sleep(2700)
    await caption(maya, null)
    await sleep(450)
  })
  log('discussed')

  // Decide: two experiments, each owner says yes. Then complete the retro and publish the recap.
  await maya.keyboard.press('h')
  await maya.setViewportSize({ width: 1280, height: 800 })
  await maya.keyboard.press('ArrowRight')
  await maya.waitForSelector('#ex-change')
  const members = must(await api(maya, 'GET', `/api/sprints/${sprintId}`), 'sprint').participants
  for (const e of EXPERIMENTS) {
    await maya.fill('#ex-change', e.change)
    await maya.fill('#ex-signal', e.signal)
    await maya.selectOption('#ex-owner', members.find((m) => m.display_name === PEOPLE[e.owner]).account_id)
    await maya.selectOption('#ex-theme', { label: THEMES[e.theme].title })
    await maya.click('button:has-text("Propose this experiment")')
    await maya.waitForSelector(`text=${e.change}`)
  }
  const exps = must(await api(maya, 'GET', `/api/sprints/${sprintId}/experiments`), 'experiments')
  for (const e of EXPERIMENTS) must(await api(p[e.owner], 'POST', `/api/sprints/${sprintId}/experiments/${exps.find((x) => x.owner_name === PEOPLE[e.owner]).id}/accept`, { accept: true }), 'accept ownership')
  await maya.keyboard.press('ArrowRight')
  await maya.click('button:has-text("Complete the retro")')
  await maya.waitForURL(new RegExp(`/sprints/${sprintId}$`))
  await maya.fill('textarea[aria-label="Recap (Markdown)"]', RECAP)
  await maya.click('button:has-text("Publish")')
  await maya.waitForSelector('text=published')

  // 5 · Priya's outcomes: what the team will try next.
  await priya.goto(`${BASE}/sprints/${sprintId}`)
  await priya.waitForSelector(`text=${EXPERIMENTS[1].change}`)
  await priya.evaluate(() => document.fonts.ready)
  await sleep(1500)
  await film(priya, '06-outcomes', async () => {
    await caption(priya, CAPTIONS.outcomes)
    await sleep(1300)
    await priya.evaluate(() => window.scrollTo({ top: 290, behavior: 'smooth' }))
    await sleep(2400)
    await caption(priya, null)
    await sleep(450)
  })

  // 6 · The closing card.
  const card = await (await newCtx()).newPage()
  await card.goto(endCard())
  await card.evaluate(() => document.fonts.ready)
  await sleep(600)
  await film(card, '07-end', () => sleep(2600))
  log('done')
} catch (e) {
  failed = true
  console.error(e)
  for (const [i, pg] of browser.contexts().flatMap((c) => c.pages()).entries()) await pg.screenshot({ path: `${OUT}/failure-${i}.png` }).catch(() => {})
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
