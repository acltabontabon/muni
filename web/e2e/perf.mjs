/**
 * Idle and navigation cost, measured on a production build: what the page keeps doing when nobody
 * touches it. For each screen it waits for the page to settle, then records a Chrome trace for
 * IDLE_S seconds and reports main-thread busy time, frames produced, paints, style/layout work,
 * timers and network requests — per second. Then it navigates repeatedly and checks that
 * listeners, DOM nodes and heap come back down.
 *
 * Desktop Chromium with phone emulation (375×812, 4× CPU slowdown). This measures the app's own
 * recurring work; it does not measure a phone's heat or battery (see docs/PERFORMANCE.md).
 *
 *   MUNI_URL=http://localhost:8799 node e2e/perf.mjs            # prints a table + JSON
 *   BUDGET=1 … node e2e/perf.mjs                                # exits 1 when a budget is exceeded
 */
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const BASE = process.env.MUNI_URL ?? 'http://localhost:8799'
const IDLE_S = Number(process.env.IDLE_S ?? 15)
const OUT = process.env.OUT ?? null
const tag = crypto.randomUUID().slice(0, 6)
const d = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

async function account(prefix, name) {
  const email = `${prefix}-${tag}@example.test`
  const jar = new Map()
  const req = async (method, path, body) => {
    const csrf = jar.get('muni_csrf')
    const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', origin: BASE, 'x-muni-client': '4', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(csrf ? { 'x-csrf-token': csrf } : {}) }, body: body ? JSON.stringify(body) : undefined })
    for (const c of r.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(';')
      const i = kv.indexOf('=')
      jar.set(kv.slice(0, i), kv.slice(i + 1))
    }
    const t = await r.text()
    if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${t.slice(0, 200)}`)
    return t ? JSON.parse(t) : null
  }
  // A signed-in account, made by the development-only endpoint (passkeys themselves: e2e/passkeys.mjs).
  const me = await req('POST', '/api/dev/session', { name })
  if (me.needs_name) await req('PATCH', '/api/auth/me', { display_name: name })
  return { id: me.account_id, req, cookies: () => [...jar].map(([n, value]) => ({ name: n, value, domain: new URL(BASE).hostname, path: '/' })) }
}

const browser = await chromium.launch()
async function session({ cookies, ws, theme = 'light', phone = true } = {}) {
  const ctx = await browser.newContext({ viewport: phone ? { width: 375, height: 812 } : { width: 1440, height: 900 }, colorScheme: theme, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 3 : 1 })
  if (cookies) await ctx.addCookies(cookies)
  if (ws) await ctx.addInitScript((w) => localStorage.setItem('muni.prefs', JSON.stringify({ ...JSON.parse(localStorage.getItem('muni.prefs') ?? '{}'), lastWorkspace: w })), ws)
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Performance.enable')
  if (phone) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  const requests = []
  page.on('request', (r) => requests.push({ t: Date.now(), url: r.url() }))
  return { ctx, page, cdp, requests }
}

const metrics = async (cdp) => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))

/** A trace of `secs` seconds of whatever the page does on its own. */
async function idle(s, secs = IDLE_S) {
  try {
    return await idleOnce(s, secs)
  } catch (e) {
    return { error: String(e?.message ?? e).split('\n')[0] }
  }
}
async function idleOnce(s, secs) {
  const { cdp, requests } = s
  const events = []
  const collect = (e) => events.push(...e.value)
  cdp.on('Tracing.dataCollected', collect)
  const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r))
  const m0 = await metrics(cdp)
  const r0 = requests.length
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline.frame,v8.execute', transferMode: 'ReportEvents' })
  await new Promise((r) => setTimeout(r, secs * 1000))
  await cdp.send('Tracing.end')
  await done
  cdp.off('Tracing.dataCollected', collect)
  const m1 = await metrics(cdp)
  const count = (name) => events.filter((e) => e.name === name && (e.ph === 'X' || e.ph === 'B' || e.ph === 'I' || e.ph === 'i' || e.ph === 'n')).length
  const main = events.filter((e) => e.name === 'RunTask' && e.ph === 'X' && e.dur)
  const long = main.filter((e) => e.dur > 50_000)
  const per = (n) => +(n / secs).toFixed(1)
  const timers = {}
  for (const e of events.filter((e) => e.name === 'TimerFire')) timers[e.args?.data?.timerId] = (timers[e.args?.data?.timerId] ?? 0) + 1
  return {
    busyMsPerS: +(((m1.TaskDuration - m0.TaskDuration) * 1000) / secs).toFixed(1),
    scriptMsPerS: +(((m1.ScriptDuration - m0.ScriptDuration) * 1000) / secs).toFixed(1),
    styleRecalcPerS: per(m1.RecalcStyleCount - m0.RecalcStyleCount),
    layoutPerS: per(m1.LayoutCount - m0.LayoutCount),
    framesPerS: per(count('DrawFrame')),
    paintsPerS: per(count('Paint')),
    animationFramesPerS: per(count('FireAnimationFrame')),
    timerFiresPerS: per(count('TimerFire')),
    distinctTimers: Object.keys(timers).length,
    longTasks: long.length,
    requests: requests.length - r0,
    heapMB: +(m1.JSHeapUsedSize / 1e6).toFixed(1),
    nodes: m1.Nodes,
    listeners: m1.JSEventListeners,
  }
}

// ONLY=signin,home,pages,typing,scroll,navigate runs just those parts.
const ONLY = process.env.ONLY?.split(',') ?? null
const want = (part) => !ONLY || ONLY.includes(part)
const rows = []
const record = (name, r) => {
  rows.push({ name, ...r })
  console.log(name.padEnd(34), JSON.stringify(r))
}

try {
  // Signed out: the entrance (the scene people see before signing in).
  for (const theme of want('signin') ? ['light', 'dark'] : []) {
    const s = await session({ theme })
    await s.page.goto(`${BASE}/signin`)
    await s.page.waitForTimeout(3000)
    record(`signin (${theme}, phone) 3–${3 + IDLE_S} s`, await idle(s))
    // The scene's motion is a finite breath (styles.css): later, the page should be still.
    await s.page.waitForTimeout(Math.max(0, 26_000 - (3 + IDLE_S) * 1000))
    record(`signin (${theme}, phone) after 26 s`, await idle(s))
    await s.ctx.close()
  }

  // Signed in, with a collecting sprint and thoughts.
  const a = await account('perf', 'Perf Person')
  const ws = await a.req('POST', '/api/workspaces', { name: `Perf ${tag}` })
  const sprint = await a.req('POST', `/api/workspaces/${ws.id}/sprints`, { name: 'Perf sprint', timezone: 'Asia/Manila', starts_on: d(-3), ends_on: d(6), retro_date: d(7), retro_time: '14:00', participant_ids: [a.id], facilitator_id: a.id, reminders_enabled: false })
  await a.req('POST', `/api/sprints/${sprint.id}/transition`, { to: 'collecting' })
  for (let i = 0; i < 24; i++) await a.req('POST', `/api/sprints/${sprint.id}/entries`, { body: `Synthetic thought ${i}: the deploy queue was ${i % 2 ? 'quiet' : 'busy'} and ${'we paired on it. '.repeat(1 + (i % 4))}`, category: ['keep', 'improve', 'try', null][i % 4], idempotency_key: crypto.randomUUID() })

  for (const [world, theme] of !want('home') ? [] : [[null, 'light'], [null, 'dark'], ...['kape', 'guhit', 'biyahe', 'bola', 'pahina', 'himig', 'porma', 'sibol'].map((w) => [w, 'light']), ['sibol', 'dark']]) {
    await a.req('PATCH', '/api/auth/me', { avatar_id: world })
    const s = await session({ cookies: a.cookies(), ws: ws.id, theme })
    await s.page.goto(`${BASE}/`)
    await s.page.locator('textarea[name="thought"]').first().waitFor()
    await s.page.waitForTimeout(3000)
    record(`home ${world ?? 'muni'} (${theme}, phone)`, await idle(s))
    await s.ctx.close()
  }
  await a.req('PATCH', '/api/auth/me', { avatar_id: null })

  for (const path of want('pages') ? [`/sprints/${sprint.id}`, '/account', `/workspaces/${ws.id}`] : []) {
    const s = await session({ cookies: a.cookies(), ws: ws.id })
    await s.page.goto(BASE + path)
    await s.page.waitForTimeout(3000)
    const label = path.replace(sprint.id, ':id').replace(ws.id, ':id')
    record(path.startsWith('/workspaces/') ? `${label} (phone) 3–${3 + IDLE_S} s` : `${label} (phone)`, await idle(s))
    if (path.startsWith('/workspaces/')) {
      await s.page.waitForTimeout(Math.max(0, 26_000 - (3 + IDLE_S) * 1000))
      record(`${label} (phone) after 26 s`, await idle(s))
    }
    await s.ctx.close()
  }

  // Typing: what one keystroke costs while autosave runs.
  if (want('typing')) {
    const s = await session({ cookies: a.cookies(), ws: ws.id })
    await s.page.goto(`${BASE}/`)
    await s.page.locator('textarea[name="thought"]').first().waitFor()
    await s.page.waitForTimeout(2000)
    await s.page.locator('textarea[name="thought"]').click()
    const m0 = await metrics(s.cdp)
    const t0 = Date.now()
    await s.page.keyboard.type('Synthetic: typing at a steady pace to see what each keystroke costs. '.repeat(3), { delay: 60 })
    const secs = (Date.now() - t0) / 1000
    const m1 = await metrics(s.cdp)
    record('typing 200 chars (phone)', { busyMsPerS: +(((m1.TaskDuration - m0.TaskDuration) * 1000) / secs).toFixed(1), styleRecalcPerS: +((m1.RecalcStyleCount - m0.RecalcStyleCount) / secs).toFixed(1), layoutPerS: +((m1.LayoutCount - m0.LayoutCount) / secs).toFixed(1), requests: s.requests.filter((r) => r.t >= t0).length })
    await s.ctx.close()
  }

  // Scrolling the collection: what each scrolled frame costs (the sticky header, the scene strip).
  if (want('scroll')) {
    const s = await session({ cookies: a.cookies(), ws: ws.id })
    await s.page.goto(`${BASE}/`)
    await s.page.locator('.passage').first().waitFor()
    await s.page.waitForTimeout(2500)
    const m0 = await metrics(s.cdp)
    const events = []
    s.cdp.on('Tracing.dataCollected', (e) => events.push(...e.value))
    const done = new Promise((r) => s.cdp.once('Tracing.tracingComplete', r))
    await s.cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline.frame', transferMode: 'ReportEvents' })
    const t0 = Date.now()
    for (let i = 0; i < 6; i++) {
      for (let k = 0; k < 20; k++) await s.cdp.send('Input.dispatchTouchEvent', { type: k === 0 ? 'touchStart' : 'touchMove', touchPoints: [{ x: 190, y: 600 - k * 22 }] })
      await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await s.page.waitForTimeout(250)
      for (let k = 0; k < 20; k++) await s.cdp.send('Input.dispatchTouchEvent', { type: k === 0 ? 'touchStart' : 'touchMove', touchPoints: [{ x: 190, y: 200 + k * 22 }] })
      await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await s.page.waitForTimeout(250)
    }
    const secs = (Date.now() - t0) / 1000
    await s.cdp.send('Tracing.end')
    await done
    const m1 = await metrics(s.cdp)
    const count = (n) => events.filter((e) => e.name === n).length
    const rasterMs = events.filter((e) => /RasterTask|Rasterize/.test(e.name) && e.dur).reduce((t, e) => t + e.dur / 1000, 0)
    record('scroll the collection (phone)', { busyMsPerS: +(((m1.TaskDuration - m0.TaskDuration) * 1000) / secs).toFixed(1), paintsPerS: +(count('Paint') / secs).toFixed(1), framesPerS: +(count('DrawFrame') / secs).toFixed(1), layoutPerS: +((m1.LayoutCount - m0.LayoutCount) / secs).toFixed(1), rasterMsPerS: +(rasterMs / secs).toFixed(1) })
    await s.ctx.close()
  }

  // Navigation: 12 round trips between pages; what's left afterwards.
  if (want('navigate')) {
    const s = await session({ cookies: a.cookies(), ws: ws.id, phone: false })
    await s.page.goto(`${BASE}/`)
    await s.page.locator('textarea[name="thought"]').first().waitFor()
    await s.page.waitForTimeout(2000)
    await s.cdp.send('HeapProfiler.collectGarbage')
    const before = await metrics(s.cdp)
    const r0 = s.requests.length
    for (let i = 0; i < 12; i++) {
      await s.page.getByRole('link', { name: 'Sprints' }).first().click()
      await s.page.waitForTimeout(400)
      await s.page.getByRole('link', { name: 'Write' }).first().click()
      await s.page.locator('textarea[name="thought"]').first().waitFor()
      await s.page.waitForTimeout(400)
    }
    await s.page.waitForTimeout(2000)
    await s.cdp.send('HeapProfiler.collectGarbage')
    const after = await metrics(s.cdp)
    record('navigate ×12 (desktop)', { listenersDelta: after.JSEventListeners - before.JSEventListeners, nodesDelta: after.Nodes - before.Nodes, heapDeltaMB: +((after.JSHeapUsedSize - before.JSHeapUsedSize) / 1e6).toFixed(2), requests: s.requests.length - r0, requestsPerRoundTrip: +((s.requests.length - r0) / 12).toFixed(1) })
    record('…then idle (desktop)', await idle(s, 10))
    await s.ctx.close()
  }
} finally {
  await browser.close()
}
if (OUT) writeFileSync(OUT, JSON.stringify(rows, null, 1))

// Budgets (docs/PERFORMANCE.md). A page left alone settles: no frames, paints, timers or requests.
// Measured with 4× CPU slowdown, so busy time here is roughly four times a desktop's.
const over = []
for (const r of rows) {
  const settled = !/3–\d+ s/.test(r.name) && !/^typing|^scroll|^navigate/.test(r.name)
  if (settled) {
    if (r.framesPerS > 2) over.push(`${r.name}: ${r.framesPerS} frames/s idle (budget 2)`)
    if (r.paintsPerS > 1) over.push(`${r.name}: ${r.paintsPerS} paints/s idle (budget 1)`)
    if (r.timerFiresPerS > 1) over.push(`${r.name}: ${r.timerFiresPerS} timers/s idle (budget 1)`)
    if (r.requests > 0) over.push(`${r.name}: ${r.requests} requests while idle (budget 0)`)
    if (r.busyMsPerS > 8) over.push(`${r.name}: ${r.busyMsPerS} ms/s main thread idle (budget 8)`)
  }
  if (/^navigate/.test(r.name)) {
    if (r.listenersDelta > 20) over.push(`${r.name}: +${r.listenersDelta} listeners after 12 round trips (budget 20)`)
    if (r.nodesDelta > 200) over.push(`${r.name}: +${r.nodesDelta} DOM nodes after 12 round trips (budget 200)`)
    if (r.requestsPerRoundTrip > 8) over.push(`${r.name}: ${r.requestsPerRoundTrip} requests per round trip (budget 8)`)
  }
  if (/^typing/.test(r.name) && r.busyMsPerS > 200) over.push(`${r.name}: ${r.busyMsPerS} ms/s while typing (budget 200)`)
}
if (over.length) console.log(`\nOver budget:\n  ${over.join('\n  ')}`)
else console.log('\nAll budgets met.')
if (process.env.BUDGET && over.length) process.exit(1)
