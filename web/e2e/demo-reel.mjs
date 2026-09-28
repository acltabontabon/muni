/**
 * The release demo, part 2: the reel. Sets the footage from e2e/demo.mjs — every app frame as it
 * was captured, never retouched — on Muni's paper, in chapters: a title in Muni's type, the app in
 * a window (a phone beside it where one was filmed), a slow camera that moves closer to what
 * matters, and the evening's horizon along the top with the sun travelling it as the film goes on.
 * It ends on the mark.
 *
 * Deterministic: each output frame is drawn for its moment (30 per second) and screenshotted, so
 * the pacing is the same every time. Writes <DEMO_OUT>/reel/NNNNN.jpg at 2560×1600; export.sh
 * encodes them.
 *
 *   cd web && DEMO_OUT=<dir>/capture node e2e/demo-reel.mjs
 */
import { chromium } from 'playwright'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'

const OUT = process.env.DEMO_OUT ?? new URL('../e2e-artifacts/demo/', import.meta.url).pathname
const FPS = Number(process.env.REEL_FPS ?? 60)
const FONTS = new URL('../node_modules/@fontsource-variable/', import.meta.url).href
const FRAMES = `${OUT}/frames`
const REEL = `${OUT}/reel`
rmSync(REEL, { recursive: true, force: true })
mkdirSync(REEL, { recursive: true })

// ---------- the footage ----------
/** A shot: its frames with the moment each starts, its length, and the viewport it was filmed at. */
function shot(name) {
  const dir = `${FRAMES}/${name}`
  if (!existsSync(dir)) throw new Error(`missing shot ${name}`)
  const meta = JSON.parse(readFileSync(`${dir}/meta.json`, 'utf8'))
  const lines = readFileSync(`${dir}/list.ffconcat`, 'utf8').split('\n')
  const frames = []
  let t = 0
  for (let i = 0; i < lines.length; i++) {
    const f = lines[i].match(/^file '(.+)'$/)
    const d = lines[i + 1]?.match(/^duration ([\d.]+)$/)
    if (f && d) {
      frames.push({ src: `file://${dir}/${f[1]}`, t })
      t += Number(d[1])
    }
  }
  return { name, frames, length: t, w: meta.width, h: meta.height }
}
const shots = Object.fromEntries(readdirSync(FRAMES).sort().map((n) => [n, shot(n)]))
const rooms = Object.keys(shots).filter((n) => n.startsWith('04-room-'))
const len = (n) => shots[n].length

// ---------- the timeline (seconds) ----------
const X = 0.5 // crossfade between chapters
const OPEN = 3.6
const ROOM = 1.1
const CHAPTERS = [
  { id: 'write', kicker: 'During the sprint', title: 'Keep the thought <em>while it’s fresh</em>.', shot: '02-write', label: 'Sprint 14 · Harbor', length: Math.max(len('02-write'), 1.5 + len('03-phone')) + 0.3, phone: { shot: '03-phone', at: 1.5 },
    camera: [[0, 1, 400, 300], [0.9, 1, 400, 300], [2.2, 1.16, 330, 330], [99, 1.16, 330, 330]] },
  { id: 'rooms', kicker: 'Eight characters, one calm room each', title: 'Make the page <em>your own</em>.', rooms: true, length: rooms.length * ROOM + 0.35,
    camera: [[0, 1, 640, 180], [99, 1.05, 640, 180]] },
  { id: 'close', kicker: 'The facilitator, when the team is ready', title: 'Close collection <em>whenever you’re ready</em>.', shot: '05-close', label: 'Sprint 14 · Harbor', length: len('05-close'), from: 0.35, cut: 0.6,
    camera: [[0, 1, 1060, 160], [0.4, 1, 1060, 160], [1.5, 1.2, 1060, 160], [2.2, 1.24, 640, 400], [4.5, 1.24, 640, 400], [5.4, 1.12, 1060, 200], [99, 1.12, 1060, 200]] },
  { id: 'themes', kicker: 'Before the retro, if it helps', title: 'Gather them into <em>themes</em>.', shot: '06-themes', label: 'Themes · Sprint 14', length: len('06-themes'), from: 0.6,
    // Picking up in the loose column; down to the tray at the screen's foot to name the theme; across to where it appears.
    camera: [[0, 1, 640, 420], [0.7, 1.12, 330, 470], [5.6, 1.12, 330, 470], [6.3, 1.08, 640, 758, 640, 640], [9.2, 1.08, 640, 758, 640, 640], [9.9, 1.12, 1010, 330], [99, 1.12, 1010, 330]] },
  { id: 'choose', kicker: 'The retro, in four steps', title: 'Choose what matters, <em>privately</em>.', shot: '07-choose', label: 'The stage · Sprint 14', length: len('07-choose'),
    // Wide while the cursor goes to the step's one button in the corner; closer once the talk opens.
    camera: [[0, 1, 576, 360], [2.4, 1, 576, 360], [3.4, 1.08, 470, 260], [99, 1.1, 470, 260]] },
  { id: 'talk', kicker: 'The talk, one topic at a time', title: 'Everyone answers. <em>Nobody has to speak first.</em>', shot: '08-talk', label: 'The stage · Sprint 14', length: len('08-talk'),
    // Still and wide: the cursor goes to Share in the facilitator's margin, and what came back appears in place.
    camera: [[0, 1.02, 576, 330], [99, 1.02, 576, 330]] },
  { id: 'outcomes', kicker: 'What comes of it', title: 'Agree what to <em>try next</em>.', shot: '09-outcomes', label: 'Sprint 14 · Harbor', length: len('09-outcomes') + 0.3,
    camera: [[0, 1, 640, 300], [99, 1.04, 640, 300]] },
]
// Dead time trimmed off a shot's footage: `from` at its start, `cut` at its end.
for (const c of CHAPTERS) if (c.shot) c.length = Math.min(c.length, len(c.shot) - (c.cut ?? 0)) - (c.from ?? 0)
let at = OPEN - X
for (const c of CHAPTERS) {
  c.start = at
  c.end = at + c.length
  at = c.end - X
}
const END = { start: at, length: 4.2 }
const TOTAL = END.start + END.length
const ROOM_NAMES = { kape: 'Kape · a quiet café table', guhit: 'Guhit · an artist’s working folio', biyahe: 'Biyahe · a moment by the window', bola: 'Bola · the court after everyone leaves', pahina: 'Pahina · a private reading room', himig: 'Himig · a listening room in print', porma: 'Porma · a small sense of occasion', sibol: 'Sibol · a sheltered balcony' }

// ---------- the stage ----------
const html = `<!doctype html><meta charset="utf-8"><style>
  @font-face { font-family: Geist; src: url('${FONTS}geist/files/geist-latin-wght-normal.woff2') format('woff2'); font-weight: 100 900; }
  @font-face { font-family: Fraunces; src: url('${FONTS}fraunces/files/fraunces-latin-wght-normal.woff2') format('woff2'); font-weight: 100 900; }
  @font-face { font-family: Fraunces; font-style: italic; src: url('${FONTS}fraunces/files/fraunces-latin-wght-italic.woff2') format('woff2'); font-weight: 100 900; }
  html, body { margin: 0; width: 1280px; height: 800px; overflow: hidden; }
  body { font-family: Geist, sans-serif; color: #1d1b18; -webkit-font-smoothing: antialiased; }
  #stage { position: relative; width: 1280px; height: 800px; overflow: hidden;
    background: radial-gradient(70% 60% at 88% -10%, #f6dcc6 0%, rgba(246,220,198,0) 60%), radial-gradient(60% 50% at 0% 110%, #ece3d4 0%, rgba(236,227,212,0) 70%), #f4efe6; }
  .layer { position: absolute; inset: 0; will-change: opacity, transform; }
  .full img { width: 1280px; height: 800px; display: block; }
  .chap { position: absolute; left: 140px; top: 50px; width: 1000px; }
  .kicker { display: flex; align-items: center; gap: 12px; font-size: 12.5px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; color: #7a6e60; }
  .kicker b { font-family: Fraunces; font-style: italic; font-weight: 400; font-size: 21px; letter-spacing: 0; text-transform: none; color: #a4452a; }
  .kicker i { width: 26px; height: 1px; background: #cdbfae; }
  h2 { margin: 12px 0 0; font-weight: 600; font-size: 43px; line-height: 1.04; letter-spacing: -.036em; white-space: nowrap; }
  h2 em { font-family: Fraunces; font-style: italic; font-weight: 400; letter-spacing: -.012em; color: #8f3a22; padding-right: .04em; }
  #rule { position: absolute; left: 140px; top: 170px; width: 1000px; height: 30px; margin-top: -29px; overflow: hidden; }
  #rule::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 1px; background: #cdbfae; }
  #sun { position: absolute; bottom: -8px; width: 16px; height: 16px; margin-left: -8px; border-radius: 50%; background: #dc8b67; box-shadow: 0 0 0 7px rgba(220,139,103,.16), 0 0 26px 10px rgba(231,196,164,.55); }
  .win { position: absolute; left: 140px; top: 200px; width: 1000px; transform-origin: 0 0; border-radius: 13px; overflow: hidden; background: #fbf8f2;
    box-shadow: 0 0 0 1px rgba(29,27,24,.09), 0 34px 70px -34px rgba(52,34,20,.5), 0 12px 24px -18px rgba(52,34,20,.25); }
  .win .bar { position: relative; height: 30px; display: flex; align-items: center; gap: 7px; padding: 0 14px; background: #f7f2ea; border-bottom: 1px solid rgba(29,27,24,.07); }
  .win .bar s { width: 10px; height: 10px; border-radius: 50%; background: #e2d8ca; }
  .win .bar span { position: absolute; left: 0; right: 0; text-align: center; font-size: 12px; letter-spacing: .01em; color: #8b8073; }
  .win .screen { position: relative; overflow: hidden; }
  .win .screen img { position: absolute; left: 0; top: 0; width: 100%; display: block; }
  #phone { position: absolute; left: 996px; top: 226px; width: 250px; padding: 8px; border-radius: 40px; background: #1d1b18;
    box-shadow: 0 0 0 1px rgba(255,255,255,.06) inset, 0 40px 70px -30px rgba(40,26,16,.6), 0 12px 26px -16px rgba(40,26,16,.4); }
  #phone .screen { position: relative; width: 234px; height: 506px; border-radius: 32px; overflow: hidden; background: #f4efe6; }
  #phone img { position: absolute; left: 0; top: 0; width: 234px; display: block; }
  #entrance img { position: absolute; inset: 0; }
  #end { display: grid; place-items: center; }
  .card { display: flex; flex-direction: column; align-items: center; text-align: center; transform: translateY(-34px); }
  .lockup { display: flex; align-items: center; gap: 18px; }
  .word { font-family: Fraunces, serif; font-size: 96px; line-height: 1; letter-spacing: -0.02em; font-weight: 500; }
  .line { margin-top: 30px; font-size: 30px; font-weight: 600; letter-spacing: -.03em; }
  .line em { font-family: Fraunces; font-style: italic; font-weight: 400; color: #8f3a22; letter-spacing: -.01em; }
  .def { margin-top: 14px; font-family: Fraunces, serif; font-size: 19px; color: #6a6156; }
  .def i { color: #1d1b18; }
  .url { margin-top: 22px; font-size: 24px; font-weight: 550; letter-spacing: -0.01em; color: #a4452a; }
</style>
<div id="stage">
  <div id="entrance" class="layer full"><img class="a"><img class="b"></div>
  ${CHAPTERS.map((c, i) => `<div class="layer chap" id="t-${c.id}"><div class="kicker"><b>${String(i + 1).padStart(2, '0')}</b><i></i>${c.kicker}</div><h2>${c.title}</h2></div>`).join('')}
  <div id="rule"><div id="sun"></div></div>
  ${CHAPTERS.map((c) => `<div class="win" id="w-${c.id}"><div class="bar"><s></s><s></s><s></s><span></span></div><div class="screen"><img class="a"><img class="b"></div></div>`).join('')}
  <div id="phone"><div class="screen"><img class="a"><img class="b"></div></div>
  <div id="end" class="layer"><div class="card">
    <div class="lockup">
      <svg width="120" height="120" viewBox="0 0 64 64" aria-label="Muni"><g fill="none" stroke="#1d1b18" stroke-width="7" stroke-linecap="round"><path d="M10 40V28a8 8 0 0 1 16 0v12"/><path d="M26 40V28a8 8 0 0 1 16 0v12"/></g><circle cx="52" cy="40" r="4.5" fill="#a4452a"/><g fill="none" stroke="#1d1b18" stroke-width="5" stroke-linecap="round" opacity="0.2" transform="translate(0 92) scale(1 -1)"><path d="M10 40V33a8 8 0 0 1 16 0v7"/><path d="M26 40V33a8 8 0 0 1 16 0v7"/></g></svg>
      <span class="word">muni</span>
    </div>
    <div class="line">Keep the <em>thought</em>. Bring it to the conversation.</div>
    <div class="def"><i>muni-muni</i> · to reflect; to turn a thought over.</div>
    <div class="url">act.munimuni.app</div>
  </div></div>
</div>`
writeFileSync(`${OUT}/reel.html`, html)

// ---------- drawing one moment (runs in the page) ----------
function install(data) {
  const { shots, chapters, open, x, end, total, roomNames, rooms, roomLen } = data
  const $ = (s) => document.querySelector(s)
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
  const out = (t) => 1 - Math.pow(1 - t, 3)
  /**
   * The two captured frames around a moment and how far between them it is. Footage is captured
   * at about 20 frames a second; blending the pair makes motion read continuously at the reel's
   * own rate instead of stepping.
   */
  const pairAt = (name, t) => {
    const f = shots[name].frames
    if (t <= 0 || f.length === 1) return [f[0].src, f[0].src, 0]
    let lo = 0, hi = f.length - 1
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (f[m].t <= t) lo = m; else hi = m - 1 }
    const next = f[Math.min(lo + 1, f.length - 1)]
    if (next === f[lo]) return [f[lo].src, f[lo].src, 0]
    return [f[lo].src, next.src, clamp((t - f[lo].t) / (next.t - f[lo].t))]
  }
  /** Draws a shot at a moment into an element holding img.a (this frame) and img.b (the next, faded in). */
  const blend = (el, name, t) => {
    const [a, b, k] = pairAt(name, t)
    setSrc(el.querySelector('img.a'), a)
    const nb = el.querySelector('img.b')
    if (k > 0.02) setSrc(nb, b)
    nb.style.opacity = k > 0.02 ? k : 0
  }
  const pending = []
  const setSrc = (img, src) => {
    if (img.dataset.src === src) return
    img.dataset.src = src
    img.src = src
    pending.push(img.decode().catch(() => {}))
  }
  /**
   * Keyframes [t, zoom, ax, ay, tx?, ty?]: the app point (ax, ay) is shown at the canvas point
   * (tx, ty) — by default where it already is, so the window zooms about it; given, the camera
   * also travels (to bring something below the window's edge into view). Eased between keys.
   */
  const camera = (keys, t, c) => {
    const pose = (key) => {
      const [, z, ax, ay, tx, ty] = key
      const lx = ax * c.k, ly = BAR + ay * c.k
      return [z, (tx ?? WX + lx) - WX - z * lx, (ty ?? WY + ly) - WY - z * ly]
    }
    let a = keys[0], b = keys[keys.length - 1]
    for (let i = 0; i < keys.length - 1; i++) if (t >= keys[i][0] && t <= keys[i + 1][0]) { a = keys[i]; b = keys[i + 1]; break }
    const k = b[0] === a[0] ? 1 : ease(clamp((t - a[0]) / (b[0] - a[0])))
    const pa = pose(a), pb = pose(b)
    return pa.map((v, i) => v + (pb[i] - v) * k)
  }
  const W = 1000, BAR = 30, WX = 140, WY = 200
  // Size each window's screen to its footage.
  for (const c of chapters) {
    const s = shots[c.shot ?? rooms[0]]
    const h = Math.round((W * s.h) / s.w)
    $(`#w-${c.id} .screen`).style.height = `${h}px`
    c.k = W / s.w
  }
  window.draw = async (t) => {
    pending.length = 0
    // Opening: the entrance, full bleed, a slow push in.
    const eo = 1 - clamp((t - (open - x)) / x)
    const en = $('#entrance')
    en.style.opacity = eo
    en.style.transform = `scale(${1 + 0.05 * out(clamp(t / open))})`
    if (eo > 0) blend($('#entrance'), '01-entrance', t)
    // Chapters.
    for (const c of chapters) {
      const lt = t - c.start
      const vis = lt > -0.01 && t < c.end + 0.01
      const fin = out(clamp(lt / x))
      const fout = clamp((c.end - t) / x)
      const o = vis ? Math.min(fin, fout) : 0
      const title = $(`#t-${c.id}`)
      title.style.opacity = o
      title.style.transform = `translateY(${(1 - fin) * 10}px)`
      const w = $(`#w-${c.id}`)
      w.style.opacity = o
      w.style.visibility = o > 0 ? 'visible' : 'hidden'
      if (!o) continue
      const [z, dx, dy] = camera(c.camera, lt, c)
      const lift = (1 - fin) * 18
      w.style.transform = `translate(${dx}px, ${dy + lift}px) scale(${z})`
      if (c.rooms) {
        const i = Math.min(rooms.length - 1, Math.floor(Math.max(0, lt) / roomLen))
        const p = clamp((lt - i * roomLen) / 0.35)
        const a = w.querySelector('img.a'), b = w.querySelector('img.b')
        setSrc(b, shots[rooms[i]].frames[0].src)
        b.style.opacity = i === 0 ? 1 : p
        if (i > 0) { setSrc(a, shots[rooms[i - 1]].frames[0].src); a.style.opacity = 1 } else a.style.opacity = 0
        w.querySelector('.bar span').textContent = roomNames[rooms[i].replace(/^04-room-\d-/, '')] ?? ''
      } else {
        w.querySelector('img.a').style.opacity = 1
        blend(w.querySelector('.screen'), c.shot, lt + (c.from ?? 0))
        w.querySelector('.bar span').textContent = c.label
      }
    }
    // The phone, beside the first chapter.
    const pc = chapters.find((c) => c.phone)
    const ph = $('#phone')
    const plt = t - pc.start - pc.phone.at
    const pin = out(clamp((plt + 0.5) / 0.7))
    const po = Math.min(pin, clamp((pc.end - t) / x))
    ph.style.opacity = t > pc.start ? po : 0
    ph.style.transform = `translateY(${(1 - pin) * 60}px) rotate(${(1 - pin) * 2}deg)`
    if (po > 0) blend(ph.querySelector('.screen'), pc.phone.shot, plt)
    // The horizon: the sun travels it as the film goes on, then settles at the end.
    const rule = $('#rule'), sun = $('#sun')
    const ro = clamp((t - (open - x)) / x)
    const ep = out(clamp((t - end.start) / 1.1))
    rule.style.opacity = ro
    rule.style.transform = `translateY(${ep * 390}px)`
    const prog = clamp((t - open) / (end.start - open))
    sun.style.left = `${(prog + (0.5 - prog) * ep) * 1000}px`
    sun.style.bottom = `${-8 + ep * 4 - clamp((t - end.start - 1.3) / 1.6) * 10}px`
    // The end.
    const eo2 = out(clamp((t - end.start) / 0.8))
    const endEl = $('#end')
    endEl.style.opacity = eo2
    endEl.style.transform = `translateY(${(1 - eo2) * 12}px)`
    await Promise.all(pending)
    await document.fonts.ready
  }
}

// ---------- rendering ----------
const browser = await chromium.launch({ channel: 'chromium' })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })
await page.goto(`file://${OUT}/reel.html`)
await page.evaluate(install, {
  shots: Object.fromEntries(Object.entries(shots).map(([k, v]) => [k, { frames: v.frames, w: v.w, h: v.h }])),
  chapters: CHAPTERS,
  open: OPEN,
  x: X,
  end: END,
  total: TOTAL,
  roomNames: ROOM_NAMES,
  rooms,
  roomLen: ROOM,
})
await page.evaluate(() => document.fonts.ready)
const n = Math.round(TOTAL * FPS)
const cdp = await page.context().newCDPSession(page)
console.log(`reel: ${TOTAL.toFixed(2)} s, ${n} frames`)
for (let i = 0; i < n; i++) {
  await page.evaluate((t) => window.draw(t), i / FPS)
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 93 })
  writeFileSync(`${REEL}/${String(i).padStart(5, '0')}.jpg`, Buffer.from(data, 'base64'))
  if (i % 150 === 0) console.log(`  ${i}/${n}`)
}
await browser.close()
console.log('reel written')
