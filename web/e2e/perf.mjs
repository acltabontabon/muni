/**
 * Idle and navigation cost, measured on a production build: what the page keeps doing when nobody
 * touches it. For each screen it waits for the page to settle, then records a Chrome trace for
 * IDLE_S seconds and reports main-thread busy time, frames produced, paints, style/layout work,
 * timers and network requests — per second. Then it navigates repeatedly and checks that
 * listeners, DOM nodes and heap come back down. For the live retro it also counts the API requests
 * each screen makes to arrive and for one step, in an encrypted sprint (`ONLY=retro-reads`).
 *
 * Desktop Chromium with phone emulation (375×812, 4× CPU slowdown). This measures the app's own
 * recurring work; it does not measure a phone's heat or battery (see docs/performance.md).
 *
 *   MUNI_URL=http://localhost:8799 node e2e/perf.mjs            # prints a table + JSON
 *   BUDGET=1 … node e2e/perf.mjs                                # exits 1 when a budget is exceeded
 *   GUIDE=on … node e2e/perf.mjs                                # with the first evening's firefly out
 */
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const BASE = process.env.MUNI_URL ?? 'http://localhost:8799'
const IDLE_S = Number(process.env.IDLE_S ?? 15)
// With the first evening's guide on, a page's firefly arrives and swells once (about 3.5 s, once per
// step): pages are measured after it has come to rest.
const SETTLE_MS = 3000 + (process.env.GUIDE ? 4500 : 0)
const OUT = process.env.OUT ?? null
const tag = crypto.randomUUID().slice(0, 6)
const d = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

async function account(prefix, name) {
  const email = `${prefix}-${tag}@example.test`
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
  // A signed-in account, made by the development-only endpoint (passkeys themselves: e2e/passkeys.mjs).
  const me = await req('POST', '/api/dev/session', { name, ...(process.env.GUIDE ? { guide: process.env.GUIDE } : {}) })
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
  const ownFrame = (await cdp.send('Page.getFrameTree')).frameTree.frame.id
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline.frame,v8.execute', transferMode: 'ReportEvents' })
  await new Promise((r) => setTimeout(r, secs * 1000))
  await cdp.send('Tracing.end')
  await done
  cdp.off('Tracing.dataCollected', collect)
  const m1 = await metrics(cdp)
  // Tracing is browser-wide: with two pages open (the stage and a phone) each trace holds both.
  // Count only the renderer process that draws this page, found from its main frame's events.
  const ownPid = events.find((e) => e.args?.data?.frame === ownFrame)?.pid
  const own = (e) => ownPid === undefined || e.pid === ownPid
  const count = (name) => events.filter((e) => e.name === name && own(e) && (e.ph === 'X' || e.ph === 'B' || e.ph === 'I' || e.ph === 'i' || e.ph === 'n')).length
  const main = events.filter((e) => e.name === 'RunTask' && e.ph === 'X' && e.dur && own(e))
  const long = main.filter((e) => e.dur > 50_000)
  const per = (n) => +(n / secs).toFixed(1)
  const timers = {}
  for (const e of events.filter((e) => e.name === 'TimerFire' && own(e))) timers[e.args?.data?.timerId] = (timers[e.args?.data?.timerId] ?? 0) + 1
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

// ONLY=signin,home,pages,retro,retro-reads,typing,scroll,navigate runs just those parts.
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
    await s.page.waitForTimeout(SETTLE_MS)
    record(`home ${world ?? 'muni'} (${theme}, phone)`, await idle(s))
    await s.ctx.close()
  }
  await a.req('PATCH', '/api/auth/me', { avatar_id: null })

  for (const path of want('pages') ? [`/sprints/${sprint.id}`, '/account', `/workspaces/${ws.id}`] : []) {
    const s = await session({ cookies: a.cookies(), ws: ws.id })
    await s.page.goto(BASE + path)
    await s.page.waitForTimeout(SETTLE_MS)
    const label = path.replace(sprint.id, ':id').replace(ws.id, ':id')
    record(path.startsWith('/workspaces/') ? `${label} (phone) 3–${3 + IDLE_S} s` : `${label} (phone)`, await idle(s))
    if (path.startsWith('/workspaces/')) {
      await s.page.waitForTimeout(Math.max(0, 26_000 - (3 + IDLE_S) * 1000))
      record(`${label} (phone) after 26 s`, await idle(s))
    }
    await s.ctx.close()
  }

  // The retro: the stage during a topic (the clock ticking, faces in the rail, the sun on the
  // horizon) and a phone on the same topic. Finite animations only: at rest, it should be quiet.
  if (want('retro')) {
    const b = await account('perf-b', 'Perf Teammate')
    const { url } = await a.req('POST', `/api/workspaces/${ws.id}/join-links`, { mode: 'direct', expires_in_hours: 24 })
    await b.req('POST', '/api/join/request', { token: url.split('#')[1] })
    const r = await a.req('POST', `/api/workspaces/${ws.id}/sprints`, { name: 'Perf retro', timezone: 'Asia/Manila', starts_on: d(-3), ends_on: d(6), retro_date: d(7), retro_time: '14:00', participant_ids: [a.id, b.id], facilitator_id: a.id, reminders_enabled: false })
    await a.req('POST', `/api/sprints/${r.id}/transition`, { to: 'collecting' })
    for (let i = 0; i < 12; i++) await (i % 2 ? b : a).req('POST', `/api/sprints/${r.id}/entries`, { body: `Retro thought ${i}: reviews waited, staging broke, pairing helped.`, category: ['improve', 'keep', null][i % 3], idempotency_key: crypto.randomUUID() })
    await a.req('POST', `/api/sprints/${r.id}/transition`, { to: 'preparing', confirm: true })
    const loose = (await a.req('GET', `/api/sprints/${r.id}/themes`)).ungrouped
    for (let t = 0; t < 3; t++) await a.req('POST', `/api/sprints/${r.id}/themes`, { title: `Theme ${t + 1}`, entry_ids: loose.slice(t * 4, t * 4 + 4).map((e) => e.id) })
    await a.req('POST', `/api/sprints/${r.id}/transition`, { to: 'ready' })
    await a.req('POST', `/api/sprints/${r.id}/transition`, { to: 'live' })
    const stage = await session({ cookies: a.cookies(), ws: ws.id, phone: false, theme: 'dark' })
    await stage.page.goto(`${BASE}/sprints/${r.id}/stage`)
    await stage.page.locator('.retro-rail-end button', { hasText: 'Next: Choose' }).click()
    await stage.page.locator('.retro-rail-end button', { hasText: 'Next: Talk' }).click()
    await stage.page.locator('.horizon-sun').waitFor()
    const phone = await session({ cookies: b.cookies(), ws: ws.id })
    await phone.page.goto(`${BASE}/sprints/${r.id}/room`)
    await phone.page.locator('.horizon').waitFor()
    await stage.page.waitForTimeout(6500) // arrival line gone, sun risen
    record('retro stage, talk (desktop)', await idle(stage))
    record('retro phone, talk (phone)', await idle(phone))
    await stage.ctx.close()
    await phone.ctx.close()
  }

  // The retro's reads, in an encrypted sprint: a facilitator's stage and five phones. The room sends
  // hints and every screen reads again (and decrypts what it read), so this counts what arriving and
  // "Next → Talk" cost each screen — a fan-out regression shows here. Keys, thoughts, the reveal and
  // the themes go through the app, since content is sealed on each device.
  if (want('retro-reads')) {
    const fac = await account('perf-f', 'Perf Facilitator')
    const crowd = []
    for (let i = 0; i < 5; i++) crowd.push(await account(`perf-p${i}`, `Perf Person ${i + 1}`))
    const wr = await fac.req('POST', '/api/workspaces', { name: `Perf reads ${tag}` })
    for (const p of crowd) {
      const { url } = await fac.req('POST', `/api/workspaces/${wr.id}/join-links`, { mode: 'direct', expires_in_hours: 24 })
      await p.req('POST', '/api/join/request', { token: url.split('#')[1] })
    }
    const F = await session({ cookies: fac.cookies(), ws: wr.id, phone: false, theme: 'dark' })
    const P = []
    for (const p of crowd) P.push(await session({ cookies: p.cookies(), ws: wr.id }))
    const everyone = [[fac, F], ...crowd.map((p, i) => [p, P[i]])]
    // Setting up runs at full speed; the phones are slowed down again for the moments measured.
    for (const s of P) await s.cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    // Each device makes its key on its first load (a new account: no questions asked). A session made
    // without a passkey can't reopen that key after a reload, so from then on each person moves
    // around inside the app, as they would by following its links.
    const go = (s, path) => s.page.evaluate((p) => { history.pushState(null, '', p); dispatchEvent(new PopStateEvent('popstate')) }, path)
    for (const [who, s] of everyone) {
      await s.page.goto(`${BASE}/`)
      for (let i = 0; i < 80 && !(await who.req('GET', '/api/me/keys'))?.public_key; i++) await s.page.waitForTimeout(250)
    }
    await go(F, `/workspaces/${wr.id}/sprints/new`)
    await F.page.fill('#f-name', `Perf encrypted ${tag}`)
    await F.page.locator('button', { hasText: 'Create and open collection' }).click()
    await F.page.waitForURL(/\/sprints\/[0-9a-f-]+$/)
    const sid = new URL(F.page.url()).pathname.split('/').pop()
    for (const [i, [, s]] of everyone.entries()) {
      await go(s, `/sprints/${sid}`)
      await s.page.locator('.sbar').first().waitFor({ timeout: 20000 })
      await go(s, `/?sprint=${sid}`)
      for (let k = 0; k < 2; k++) {
        const body = `Perf thought ${i + 1}.${k + 1}: reviews waited, staging broke, pairing helped.`
        await s.page.locator('textarea[name="thought"]').first().fill(body)
        await s.page.locator('button', { hasText: 'Add to sprint' }).first().click()
        await s.page.locator('.passage[data-state="submitted"]', { hasText: body }).first().waitFor({ timeout: 20000 })
      }
    }
    // The reveal happens on the facilitator's device; then three themes of four thoughts.
    await go(F, `/sprints/${sid}`)
    await F.page.locator('button', { hasText: 'Close collection…' }).click()
    await F.page.locator('[role=dialog] button:text-is("Close collection")').click()
    await F.page.locator('.sbar-state', { hasText: 'Collection closed' }).waitFor({ timeout: 20000 })
    await go(F, `/sprints/${sid}/prepare`)
    await F.page.locator('.sort-loose .sort-slip').first().waitFor({ timeout: 20000 })
    for (const [n, title] of ['Reviews that wait', 'Who owns staging?', 'What helped us ship'].entries()) {
      for (let k = 0; k < 4; k++) await F.page.locator('.sort-loose .sort-slip-btn').nth(k).click()
      await F.page.fill('.sort-pile--ghost input', title)
      await F.page.keyboard.press('Enter')
      await F.page.waitForFunction((n) => document.querySelectorAll('.sort-pile:not(.sort-pile--ghost)').length > n, n)
    }
    await fac.req('POST', `/api/sprints/${sid}/transition`, { to: 'live' })
    for (const s of P) await s.cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    // The themes page reads the change of state too: let it, so the stage's count is the stage's own.
    await F.page.waitForTimeout(2500)

    // What a screen asked the API for (not the socket), from now until the returned function is called.
    const reads = (s) => {
      const from = s.requests.length
      return () => {
        const by = {}
        for (const r of s.requests.slice(from)) {
          const p = new URL(r.url).pathname
          if (!p.startsWith('/api/') || p.endsWith('/ws')) continue
          const k = p === `/api/sprints/${sid}` ? 'sprint' : p.startsWith(`/api/sprints/${sid}/`) ? p.slice(`/api/sprints/${sid}/`.length) : p.slice(5)
          by[k] = (by[k] ?? 0) + 1
        }
        return { requests: Object.values(by).reduce((a, b) => a + b, 0), by }
      }
    }
    const opening = reads(F)
    await go(F, `/sprints/${sid}/stage`)
    await F.page.locator('.retro-steps').waitFor({ timeout: 20000 })
    await F.page.waitForTimeout(3000)
    record('reads: arriving, stage', opening())
    // The phones join together, as a room fills.
    const joining = reads(F)
    const arrivals = P.map((s) => reads(s))
    await Promise.all(P.map((s) => go(s, `/sprints/${sid}/room`)))
    await Promise.all(P.map((s) => s.page.locator('.retro-map').first().waitFor({ timeout: 30000 })))
    await F.page.waitForTimeout(4000)
    arrivals.forEach((done, i) => record(`reads: arriving, phone ${i + 1}`, done()))
    record('reads: the stage while five phones arrive', joining())
    await F.page.locator('.retro-rail-end button', { hasText: 'Next: Choose' }).click()
    await Promise.all(P.map((s) => s.page.locator('.retro-vote').first().waitFor({ timeout: 30000 })))
    const ids = (await fac.req('GET', `/api/sprints/${sid}/themes`)).themes.map((t) => t.id)
    for (const [i, p] of crowd.entries()) await p.req('POST', `/api/sprints/${sid}/votes`, { theme_id: ids[i % ids.length], cast: true })
    await F.page.waitForTimeout(3000)
    const talking = [F, ...P].map((s) => reads(s))
    await F.page.locator('.retro-rail-end button', { hasText: 'Next: Talk' }).click()
    await F.page.locator('.retro-talk-title').waitFor({ timeout: 20000 })
    await Promise.all(P.map((s) => s.page.locator('.horizon').waitFor({ timeout: 30000 })))
    await F.page.waitForTimeout(4000)
    const talk = talking.map((done) => done())
    record('reads: Next → Talk, stage', talk[0])
    talk.slice(1).forEach((t, i) => record(`reads: Next → Talk, phone ${i + 1}`, t))
    record('reads: Next → Talk, all six screens', { requests: talk.reduce((n, t) => n + t.requests, 0) })
    for (const [, s] of everyone) await s.ctx.close()
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

// Budgets (docs/performance.md). A page left alone settles: no frames, paints, timers or requests.
// Measured with 4× CPU slowdown, so busy time here is roughly four times a desktop's.
// The retro's reads: what arriving, and one step, cost each screen (in an encrypted sprint each
// read is a decrypt too). Before these were gathered and read once: 20–27 to arrive, 7 per step.
const READ_BUDGETS = [
  [/^reads: arriving, (stage|phone)/, 10],
  [/^reads: the stage while/, 6],
  [/^reads: Next → Talk, (stage|phone)/, 4],
]
const over = []
for (const r of rows) {
  const settled = !/3–\d+ s/.test(r.name) && !/^typing|^scroll|^navigate|^reads/.test(r.name)
  if (settled) {
    // A retro topic has a clock that visibly ticks once a second: that tick is its whole budget.
    const clock = /^retro/.test(r.name)
    const [frames, paints, timers] = clock ? [2.5, 5, 2] : [2, 1, 1]
    if (r.framesPerS > frames) over.push(`${r.name}: ${r.framesPerS} frames/s idle (budget ${frames})`)
    if (r.paintsPerS > paints) over.push(`${r.name}: ${r.paintsPerS} paints/s idle (budget ${paints})`)
    if (r.timerFiresPerS > timers) over.push(`${r.name}: ${r.timerFiresPerS} timers/s idle (budget ${timers})`)
    if (r.requests > 0) over.push(`${r.name}: ${r.requests} requests while idle (budget 0)`)
    if (r.busyMsPerS > 8) over.push(`${r.name}: ${r.busyMsPerS} ms/s main thread idle (budget 8)`)
  }
  if (/^navigate/.test(r.name)) {
    if (r.listenersDelta > 20) over.push(`${r.name}: +${r.listenersDelta} listeners after 12 round trips (budget 20)`)
    if (r.nodesDelta > 200) over.push(`${r.name}: +${r.nodesDelta} DOM nodes after 12 round trips (budget 200)`)
    if (r.requestsPerRoundTrip > 8) over.push(`${r.name}: ${r.requestsPerRoundTrip} requests per round trip (budget 8)`)
  }
  if (/^typing/.test(r.name) && r.busyMsPerS > 200) over.push(`${r.name}: ${r.busyMsPerS} ms/s while typing (budget 200)`)
  for (const [pattern, budget] of READ_BUDGETS) if (pattern.test(r.name) && r.requests > budget) over.push(`${r.name}: ${r.requests} API requests (budget ${budget})`)
}
if (over.length) console.log(`\nOver budget:\n  ${over.join('\n  ')}`)
else console.log('\nAll budgets met.')
if (process.env.BUDGET && over.length) process.exit(1)
