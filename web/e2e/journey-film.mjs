/**
 * A second, shorter film: the retro from both sides — the stage and a phone, side by side, through
 * Look back, Choose, Talk, Agree and the recap. Filmed from the marketing site's own journey
 * section (site/index.html, #demo) with the rest of the page hidden, then encoded next to the
 * main demo as docs/demo/muni-journey.mp4 and .gif.
 *
 *   python3 -m http.server 4321 --directory site      # or the "site" launch config
 *   cd web && SITE_URL=http://localhost:4321 node e2e/journey-film.mjs
 *
 * Needs Playwright's Chromium and ffmpeg (libx264). Each file stays under 10 MB.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'

const SITE = process.env.SITE_URL ?? 'http://localhost:4321'
const OUT = process.env.OUT ?? new URL('../e2e-artifacts/journey/', import.meta.url).pathname
const DOCS = new URL('../../docs/demo/', import.meta.url).pathname
const STEP_S = Number(process.env.STEP_S ?? 5.2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
rmSync(OUT, { recursive: true, force: true })
mkdirSync(`${OUT}/frames`, { recursive: true })

// Only the journey, centred on the page's paper; an end card is drawn over it at the close.
const ISOLATE = `
  .nav, .footer, main > section:not(#demo), .duo-film, .duo-controls, .scroll-cue { display: none !important; }
  html, body { overflow: hidden !important; }
  #demo { min-height: 100vh; padding: 44px 0 0 !important; }
  #demo .lede { display: none; }
  #demo .display { font-size: 44px; }
  #demo .duo-tabs { margin-top: 22px; }
  #demo .duo-panels { margin-top: 22px; }
  #film-end { position: fixed; inset: 0; z-index: 99; display: grid; place-items: center; text-align: center; background: var(--bg); opacity: 0; transition: opacity 700ms ease; }
  #film-end.on { opacity: 1; }
  #film-end p { font-family: var(--font-serif); font-size: 64px; font-weight: 500; letter-spacing: -0.02em; color: var(--ink); }
  #film-end h3 { margin-top: 18px; font-size: 28px; font-weight: 600; letter-spacing: -0.03em; color: var(--ink); }
  #film-end h3 em { font-family: var(--font-serif); font-style: italic; font-weight: 400; color: var(--accent); }
  #film-end span { display: block; margin-top: 18px; font-size: 20px; color: var(--accent); }
`

const browser = await chromium.launch({ channel: 'chromium' })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2, reducedMotion: 'no-preference' })
await page.goto(SITE)
await page.addStyleTag({ content: ISOLATE })
await page.evaluate(() => {
  const end = document.createElement('div')
  end.id = 'film-end'
  end.innerHTML = '<div><p>muni</p><h3>Two screens, <em>one conversation</em>.</h3><span>act.munimuni.app</span></div>'
  document.body.append(end)
  document.documentElement.dataset.sky = 'day'
  window.scrollTo(0, 0)
})
await page.evaluate(() => document.fonts.ready)
// Take the journey out of its autoplay: the film sets its own pace.
await page.evaluate(() => document.getElementById('duo-t1').click())
await sleep(1200)
if (process.env.PEEK) { await page.screenshot({ path: `${OUT}/peek.png` }); await browser.close(); process.exit(0) }

// Film: sharp 2× frames taken back to back, each stamped with its moment (as e2e/demo.mjs does).
const cdp = await page.context().newCDPSession(page)
const frames = []
const writes = []
let rolling = true
const camera = (async () => {
  while (rolling) {
    const t0 = Date.now()
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, optimizeForSpeed: true })
    const file = `${String(frames.length).padStart(5, '0')}.jpg`
    frames.push({ file, t: (t0 + Date.now()) / 2000 })
    writes.push(writeFile(`${OUT}/frames/${file}`, Buffer.from(data, 'base64')))
  }
})()
while (!frames.length) await sleep(10)
const start = Date.now() / 1000
await sleep(STEP_S * 1000)
for (const n of [2, 3, 4, 5]) {
  await page.evaluate((i) => document.getElementById(`duo-t${i}`).click(), n)
  await sleep(STEP_S * 1000 + (n === 4 ? 1200 : 0)) // Agree: long enough to see the owner say yes
}
await page.evaluate(() => document.getElementById('film-end').classList.add('on'))
await sleep(3600)
const end = Date.now() / 1000
rolling = false
await camera
await Promise.all(writes)
await browser.close()

// Each frame lasts until the next; the list ends on the last one.
let list = 'ffconcat version 1.0\n'
let last
for (let i = 0; i < frames.length; i++) {
  const at = (f) => Math.min(Math.max(f.t, start), end)
  const d = (i + 1 < frames.length ? at(frames[i + 1]) : end) - at(frames[i])
  if (d <= 0.0005) continue
  list += `file '${frames[i].file}'\nduration ${d.toFixed(4)}\n`
  last = frames[i].file
}
list += `file '${last}'\n`
writeFileSync(`${OUT}/frames/list.ffconcat`, list)
console.log(`filmed ${(end - start).toFixed(1)} s, ${frames.length} frames`)

const mp4 = `${DOCS}muni-journey.mp4`
const gif = `${DOCS}muni-journey.gif`
const tags = ['-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709']
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', `${OUT}/frames/list.ffconcat`, '-vf', 'fps=30,scale=1920:1080:flags=lanczos:out_range=tv:out_color_matrix=bt709,setsar=1,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryslow', '-crf', '22', '-pix_fmt', 'yuv420p', ...tags, '-profile:v', 'high', '-movflags', '+faststart', '-an', mp4], { stdio: 'inherit' })
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', `${OUT}/frames/list.ffconcat`, '-filter_complex', 'fps=12,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', '-loop', '0', gif], { stdio: 'inherit' })
for (const f of [mp4, gif]) console.log(`${f.split('/').pop()}  ${(statSync(f).size / 1024 / 1024).toFixed(1)} MB`)
