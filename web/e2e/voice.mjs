/**
 * Voice capture, end to end, against a production build (CSP, COOP/COEP and the SPA fallback as
 * deployed): Chromium's fake microphone plays a recording, the real capture → speech worker →
 * draft path runs, and the checks read what a person would see. Synthetic accounts; the
 * recordings are FLEURS clips (CC BY 4.0) or silence, never a person's voice.
 *
 * Run from web/, after `npm run build` with the model in public/voice (scripts/voice-assets.mjs):
 *   MUNI_URL=http://localhost:8799 VOICE_AUDIO=path/to/speech.wav VOICE_SILENCE=path/to/silence.wav node e2e/voice.mjs
 * (48 kHz mono 16-bit WAV files; SHOTS=dir saves screenshots.)
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.MUNI_URL ?? 'http://localhost:8799'
const AUDIO = process.env.VOICE_AUDIO
const SILENCE = process.env.VOICE_SILENCE
const EXPECT = (process.env.VOICE_EXPECT ?? 'elepante,giraffe,hayop').split(',')
const SHOTS = process.env.SHOTS ?? null
if (!AUDIO || !SILENCE) throw new Error('set VOICE_AUDIO and VOICE_SILENCE')
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
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
  return { email, name, id: me.account_id, req, cookies: () => [...jar].map(([n, value]) => ({ name: n, value, domain: new URL(BASE).hostname, path: '/' })) }
}

/** Every microphone stream the page opens, so the test can see that each one was released. */
const trackStreams = () => {
  window.__streams = []
  const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  navigator.mediaDevices.getUserMedia = async (c) => {
    const s = await orig(c)
    window.__streams.push(s)
    return s
  }
}
const liveTracks = (page) => page.evaluate(() => window.__streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live').length)

async function launch(file) {
  return chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${file}%noloop`] })
}
async function open(browser, a, ws, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport ?? { width: 1280, height: 860 }, colorScheme: opts.theme ?? 'light', reducedMotion: opts.reducedMotion ?? 'no-preference', hasTouch: !!opts.touch, isMobile: !!opts.touch, serviceWorkers: 'allow' })
  await ctx.grantPermissions(['microphone'], { origin: BASE })
  await ctx.addCookies(a.cookies())
  await ctx.addInitScript((w) => localStorage.setItem('muni.prefs', JSON.stringify({ lastWorkspace: w })), ws)
  await ctx.addInitScript(trackStreams)
  const page = await ctx.newPage()
  const requests = []
  page.on('request', (r) => requests.push({ url: r.url(), method: r.method(), post: r.postData() ?? '' }))
  ctx.on('request', (r) => requests.push({ url: r.url(), method: r.method(), post: r.postData() ?? '' }))
  const errors = []
  // Accounts made by /api/dev/session have no passkey, so reopening this device's encryption key is
  // refused (403 passkey_required) — expected here, and the only failure tolerated.
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()))
  page.on('response', (r) => r.status() >= 400 && !/\/api\/me\/devices\/[^/]+\/unlock$/.test(r.url()) && errors.push(`${r.status()} ${new URL(r.url()).pathname}`))
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('worker', (w) => {
    if (process.env.DEBUG) console.log('worker started', w.url())
    w.on('console', (m) => process.env.DEBUG && console.log('worker console:', m.type(), m.text().slice(0, 300)))
    w.on('close', () => process.env.DEBUG && console.log('worker closed', w.url()))
  })
  if (process.env.DEBUG) page.on('console', (m) => console.log('page console:', m.type(), m.text().slice(0, 300)))
  if (process.env.DEBUG) page.on('response', (r) => /\/voice\/|ort-wasm|voice-whisper/.test(r.url()) && console.log('resp', r.status(), r.url().slice(-70)))
  await page.goto(`${BASE}/`)
  await page.waitForSelector('textarea[name="thought"]')
  return { ctx, page, requests, errors }
}
const shot = async (page, name, full = false) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full })
const field = (page) => page.locator('textarea[name="thought"]')
const panel = (page) => page.locator('.journal-voice')

const timings = {}
let browser
let debug = null
try {
  const pia = await account('voice', 'Pia Voice')
  const ws = await pia.req('POST', '/api/workspaces', { name: `Voice team ${tag}` })
  const sprint = await pia.req('POST', `/api/workspaces/${ws.id}/sprints`, { name: 'Voice sprint', timezone: 'Asia/Manila', starts_on: d(-3), ends_on: d(6), retro_date: d(7), retro_time: '14:00', participant_ids: [pia.id], facilitator_id: pia.id, reminders_enabled: false })
  await pia.req('POST', `/api/sprints/${sprint.id}/transition`, { to: 'collecting' })

  browser = await launch(AUDIO)
  let { ctx, page, requests, errors } = await open(browser, pia, ws.id)
  debug = { page, errors }
  check('The page is cross-origin isolated (threads for the model)', await page.evaluate(() => self.crossOriginIsolated))
  check('Nothing voice-related loads at startup', !requests.some((r) => /\/voice\/|ort-wasm|voice-whisper/.test(r.url)))

  // ── First use: the offer, with the verified size; nothing is recorded or fetched before "yes".
  await field(page).fill('Existing note.')
  await page.getByRole('button', { name: 'Speak instead of typing' }).click()
  await page.waitForSelector('text=Speak your thought')
  const offer = await panel(page).innerText()
  check('First use explains the one-time download and its size', /252 MB/.test(offer) && /isn’t uploaded/.test(offer), offer.replace(/\s+/g, ' ').slice(0, 160))
  check('Nothing is recorded before agreeing', (await liveTracks(page)) === 0)
  await shot(page, 'voice-offer-desktop')
  await page.getByRole('button', { name: 'Not now' }).click()
  check('"Not now" leaves the text as it was', (await field(page).inputValue()) === 'Existing note.')

  // ── Download and record.
  await page.getByRole('button', { name: 'Speak instead of typing' }).click()
  await page.getByRole('button', { name: 'Download and record' }).click()
  await page.waitForSelector('.journal-voice.is-recording', { timeout: 10000 })
  const dl = await page.waitForSelector('text=Downloading the speech model', { timeout: 5000 }).then(() => panel(page).innerText()).catch(() => '')
  check('The download shows measured progress while recording', /\d+ MB of 252 MB/.test(dl), dl.replace(/\s+/g, ' ').slice(-80))
  check('Recording shows its duration and limit', /Recording\s*0:0\d\s*\/\s*2:00/.test((await panel(page).innerText()).replace(/\s+/g, ' ')))
  check('Stop has focus (Enter/Space stops)', await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Stop recording and transcribe'))
  check('The microphone is open while recording', (await liveTracks(page)) === 1)
  check('The mic button says Stop and is pressed', (await page.locator('.journal-voice-mic[aria-pressed="true"]').count()) === 1)
  await page.waitForTimeout(1500)
  const ring = await page.locator('.journal-voice-ring').evaluate((el) => getComputedStyle(el).getPropertyValue('--lvl'))
  check('The ripple follows the measured input level', Number(ring) > 0, `--lvl=${ring}`)
  await shot(page, 'voice-recording-desktop')
  await page.waitForTimeout(18000) // the clip is ~20 s
  const t0 = Date.now()
  await page.keyboard.press('Enter') // Stop has focus
  await page.waitForSelector('text=Transcribing on this device', { timeout: 5000 })
  check('Stopping releases the microphone at once', (await liveTracks(page)) === 0)
  await shot(page, 'voice-processing-desktop')
  if (process.env.DEBUG) {
    for (let i = 0; i < 12; i++) {
      console.log('t+', i * 5, 's panel:', (await panel(page).innerText().catch(() => '?')).replace(/\s+/g, ' ').slice(0, 120))
      if (/Added to your draft/.test(await panel(page).innerText().catch(() => ''))) break
      await page.waitForTimeout(5000)
    }
  }
  await page.waitForSelector('text=Added to your draft', { timeout: 300000 })
  timings.firstUseMs = Date.now() - t0
  const text = await field(page).inputValue()
  check('The words are added after the existing text, never replacing it', text.startsWith('Existing note. ') && text.length > 40, text.slice(0, 140))
  check('Tagalog stays Tagalog (not translated)', EXPECT.filter((w) => text.toLowerCase().includes(w)).length >= 2, `expected some of ${EXPECT.join('/')}`)
  const doneText = await panel(page).innerText()
  check('Saying truthfully where the draft is kept', /kept in this tab, not sent|saved on this device, not sent/.test(doneText), doneText.replace(/\s+/g, ' '))
  await shot(page, 'voice-done-desktop')

  // ── Privacy: only this origin; no transcript or audio in any request.
  const foreign = requests.filter((r) => !r.url.startsWith(BASE) && !r.url.startsWith('data:') && !r.url.startsWith('blob:'))
  check('No request leaves this origin', foreign.length === 0, foreign.map((r) => r.url).slice(0, 3).join(' '))
  const leaked = requests.filter((r) => r.post && (r.post.includes('elepante') || r.post.includes('giraffe')))
  check('No request carries the transcript', leaked.length === 0)
  check('Model parts came from /voice/…', requests.some((r) => /\/voice\/whisper-small-[^/]+\/onnx\/encoder_model_quantized\.onnx\.part0$/.test(r.url)))
  const cached = await page.evaluate(async () => (await (await caches.open('transformers-cache')).keys()).map((r) => new URL(r.url).pathname))
  check('The model is cached on this device (7 files)', cached.filter((p) => p.startsWith('/voice/')).length === 7, cached.join(' '))
  check('Download parts are cleaned up once the model is whole', !(await page.evaluate(() => caches.has('muni-voice-parts'))))

  // ── Undo, then a second recording: no offer, faster, appended.
  await page.getByRole('button', { name: 'Undo' }).click()
  check('Undo takes the words back out exactly', (await field(page).inputValue()) === 'Existing note.')

  await page.getByRole('button', { name: 'Speak instead of typing' }).click()
  await page.waitForSelector('.journal-voice.is-recording', { timeout: 10000 })
  check('Second use goes straight to recording', true)
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: 'Cancel recording' }).click()
  check('Cancel releases the microphone', (await liveTracks(page)) === 0)
  check('Cancel changes nothing', (await field(page).inputValue()) === 'Existing note.')

  // Typing while it transcribes: kept, and the words go at the end.
  await page.getByRole('button', { name: 'Speak instead of typing' }).click()
  await page.waitForSelector('.journal-voice.is-recording', { timeout: 10000 })
  await page.waitForTimeout(8000)
  const t1 = Date.now()
  await page.getByRole('button', { name: 'Stop recording and transcribe' }).click()
  await field(page).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Typed while it listened.')
  await page.waitForSelector('text=Added to your draft', { timeout: 120000 })
  timings.warmMs = Date.now() - t1
  const t2 = await field(page).inputValue()
  check('Typing during transcription is kept; the words go after it', t2.startsWith('Existing note. Typed while it listened. ') && t2.length > 60, t2.slice(0, 120))

  // Persisted as a draft (reload restores it) — and nothing was submitted.
  const entries = await pia.req('GET', `/api/sprints/${sprint.id}/entries/mine`).catch(() => [])
  check('Nothing was submitted to the sprint', Array.isArray(entries) ? entries.length === 0 : (entries.entries?.length ?? 0) === 0)

  // ── Reduced motion and dark, same page (the model is cached here): still clearly recording.
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await page.getByRole('button', { name: 'Speak instead of typing' }).click()
  await page.waitForSelector('.journal-voice.is-recording', { timeout: 10000 })
  await page.waitForTimeout(800)
  const tf = await page.locator('.journal-voice-ring').evaluate((el) => getComputedStyle(el).transform)
  check('Reduced motion: the ring does not scale', tf === 'none', tf)
  check('Reduced motion: "Recording" is said in words', (await page.locator('.journal-voice-rec').innerText()).includes('Recording'))
  await shot(page, 'voice-recording-dark-reduced')
  await page.getByRole('button', { name: 'Cancel recording' }).click()
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' })

  // ── A character world.
  await pia.req('PATCH', '/api/auth/me', { avatar_id: 'himig' })
  await page.reload()
  await page.waitForSelector('textarea[name="thought"]')
  await page.getByRole('button', { name: 'Speak instead of typing' }).click()
  await page.waitForSelector('.journal-voice.is-recording', { timeout: 10000 })
  await page.waitForTimeout(1500)
  check('Himig: the level shows as bars', await page.locator('.journal-voice-bars').evaluate((el) => getComputedStyle(el).display !== 'none'))
  await shot(page, 'voice-recording-himig')
  await page.getByRole('button', { name: 'Cancel recording' }).click()
  await pia.req('PATCH', '/api/auth/me', { avatar_id: 'guhit' })
  await page.reload()
  await page.waitForSelector('textarea[name="thought"]')
  await page.getByRole('button', { name: 'Speak instead of typing' }).click()
  await page.waitForSelector('.journal-voice.is-recording', { timeout: 10000 })
  await page.waitForTimeout(1500)
  check('Guhit: a pencil line', (await page.locator('.journal-voice-line').evaluate((el) => getComputedStyle(el).strokeDasharray)) !== 'none')
  await shot(page, 'voice-recording-guhit')
  await page.getByRole('button', { name: 'Cancel recording' }).click()
  await pia.req('PATCH', '/api/auth/me', { avatar_id: null })

  // ── Phone (a fresh browser profile, so first use again): a bottom sheet, Stop and Cancel in reach.
  const phone = await open(browser, pia, ws.id, { viewport: { width: 375, height: 740 }, touch: true })
  await phone.page.getByRole('button', { name: 'Speak instead of typing' }).tap()
  await phone.page.waitForSelector('text=Speak your thought')
  await phone.page.waitForTimeout(400) // the sheet slides up
  const offerBox = await phone.page.locator('.journal-voice').boundingBox()
  check('Phone: the first-use offer is a bottom sheet', offerBox && Math.abs(offerBox.y + offerBox.height - 740) < 2, JSON.stringify(offerBox))
  await shot(phone.page, 'voice-offer-phone')
  await phone.page.getByRole('button', { name: 'Download and record' }).tap()
  await phone.page.waitForSelector('.journal-voice.is-recording', { timeout: 10000 })
  await phone.page.waitForTimeout(1500)
  const box = await phone.page.locator('.journal-voice').boundingBox()
  check('Phone: recording is a sheet at the bottom of the screen', box && Math.abs(box.y + box.height - 740) < 2, JSON.stringify(box))
  const stopBox = await phone.page.getByRole('button', { name: 'Stop recording and transcribe' }).boundingBox()
  check('Phone: Stop is at least 44 px', stopBox && stopBox.width >= 44 && stopBox.height >= 44)
  const cancelBox = await phone.page.getByRole('button', { name: 'Cancel recording' }).boundingBox()
  check('Phone: Cancel is at least 44 px', cancelBox && cancelBox.width >= 44 && cancelBox.height >= 44)
  const scrollW = await phone.page.evaluate(() => document.documentElement.scrollWidth)
  check('Phone: no sideways scroll', scrollW <= 375, String(scrollW))
  await shot(phone.page, 'voice-recording-phone')
  await phone.page.getByRole('button', { name: 'Cancel recording' }).tap()
  check('Phone: cancel closes the sheet and the text is untouched', (await phone.page.locator('.journal-voice.is-open').count()) === 0 && (await field(phone.page).inputValue()) === '')
  await phone.ctx.close()

  check('No console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  await ctx.close()
  await browser.close()

  // ── Silence: no text is made up.
  browser = await launch(SILENCE)
  ;({ ctx, page } = await open(browser, pia, ws.id))
  await field(page).fill('Quiet test.')
  await page.getByRole('button', { name: 'Speak instead of typing' }).click()
  await page.getByRole('button', { name: 'Download and record' }).click() // a fresh browser profile: first use
  await page.waitForSelector('.journal-voice.is-recording', { timeout: 10000 })
  await page.waitForTimeout(4000)
  await page.getByRole('button', { name: 'Stop recording and transcribe' }).click()
  await page.waitForSelector('text=No sound came through, text=No speech caught', { timeout: 60000 }).catch(() => {})
  const quiet = await panel(page).innerText()
  check('Silence: nothing is added, and it says so', /No sound came through|No speech caught/.test(quiet) && (await field(page).inputValue()) === 'Quiet test.', quiet.replace(/\s+/g, ' ').slice(0, 100))
  await shot(page, 'voice-silence-desktop')
} catch (e) {
  check('run', false, String(e?.stack ?? e))
  if (debug) console.log('panel:', await debug.page.locator('.journal-voice').innerText().catch(() => '?'), '\nerrors:', debug.errors.slice(0, 5))
} finally {
  await browser?.close()
}
console.log(JSON.stringify(timings))
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
