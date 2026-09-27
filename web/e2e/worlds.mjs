/**
 * Character worlds, end to end: every world on desktop and phone, light and dark, populated and
 * empty; worlds only on personal pages; a live switch that keeps what someone is writing; the
 * theme switch; fallbacks; reduced motion; the first-visit chooser; offline (production build).
 * Synthetic accounts and text only.
 *
 * Run from web/:  MUNI_URL=http://localhost:5173 node e2e/worlds.mjs          (SHOTS=dir for screenshots)
 * Offline part:   MUNI_URL=http://localhost:8787 OFFLINE=1 node e2e/worlds.mjs (wrangler serving web/dist)
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.MUNI_URL ?? 'http://localhost:5173'
const SHOTS = process.env.SHOTS ?? null
const OFFLINE = !!process.env.OFFLINE
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const WORLDS = ['kape', 'guhit', 'biyahe', 'bola', 'pahina', 'himig', 'porma', 'sibol']
const FONT = { kape: 'Young Serif', guhit: 'Bricolage Grotesque Variable', biyahe: 'Barlow Condensed', bola: 'Archivo Variable', pahina: 'Newsreader Variable', himig: 'Unbounded Variable', porma: 'Bodoni Moda Variable', sibol: 'Alegreya Variable' }
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const tag = crypto.randomUUID().slice(0, 6)
const d = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

async function account(prefix, name, intro = 'done') {
  const email = `${prefix}-${tag}@example.test`
  const jar = new Map()
  const req = async (method, path, body) => {
    const csrf = jar.get('muni_csrf') ?? jar.get('__Host-muni_csrf')
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
  // A signed-in account, made by the development-only endpoint (passkeys themselves: e2e/passkeys.mjs).
  const me = await req('POST', '/api/dev/session', { name, intro })
  return { email, name, id: me.account_id, req, cookies: () => [...jar].map(([n, value]) => ({ name: n, value, domain: new URL(BASE).hostname, path: '/' })) }
}

const browser = await chromium.launch()
async function pageFor(a, opts = {}) {
  const viewport = opts.viewport ?? { width: 1440, height: 900 }
  const ctx = await browser.newContext({ viewport, colorScheme: opts.theme ?? 'light', reducedMotion: opts.reducedMotion ?? 'no-preference', hasTouch: viewport.width < 600 })
  await ctx.addCookies(a.cookies())
  if (opts.prefs) await ctx.addInitScript((p) => localStorage.setItem('muni.prefs', JSON.stringify(p)), opts.prefs)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  return { ctx, page, errors }
}
const world = (page) => page.evaluate(() => document.documentElement.dataset.world ?? null)
const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

try {
  // ── A person with a full sprint (every category, long unbroken text, Filipino diacritics) and an empty one.
  const ana = await account('ana', 'Ana Reyes')
  const ws = await ana.req('POST', '/api/workspaces', { name: `Kalye ${tag}` })
  const full = await ana.req('POST', `/api/workspaces/${ws.id}/sprints`, { name: 'Sprint 14 — Checkout revamp', timezone: 'Asia/Manila', starts_on: d(-6), ends_on: d(5), retro_date: d(6), retro_time: '15:00', participant_ids: [ana.id], facilitator_id: ana.id, reminders_enabled: false })
  await ana.req('POST', `/api/sprints/${full.id}/transition`, { to: 'collecting' })
  const bodies = [
    ['proud', 'Pairing on the release checklist saved us a whole day. Salamat sa pag-unawa — ñ, á, ì, ng̃ all render.'],
    ['keep', 'Short async stand-ups.'],
    ['improve', 'Supercalifragilisticexpialidocious-length-branch-name-that-never-breaks-anywhere-in-the-layout-at-all-period'],
    ['stop', 'Merging on Friday afternoons.'],
    ['try', 'A shared glossary for the payments domain, so product and engineering stop translating for each other in every single review we hold.'],
    [null, 'The staging rota felt uneven this sprint.'],
    ['proud', 'Accessibility fixes landed before the deadline.'],
    ['improve', 'Tickets arrived without acceptance criteria.\nWe guessed.\nThen we guessed again.'],
    ['keep', 'Design reviews on Wednesday mornings.'],
    ['try', 'Rotate the facilitator every sprint.'],
    ['stop', 'Starting work that is not on the board.'],
  ]
  for (const [category, body] of bodies) await ana.req('POST', `/api/sprints/${full.id}/entries`, { body, category, idempotency_key: crypto.randomUUID() })
  const ws2 = await ana.req('POST', '/api/workspaces', { name: `Quiet ${tag}` })
  const empty = await ana.req('POST', `/api/workspaces/${ws2.id}/sprints`, { name: 'Sprint 1', timezone: 'Asia/Manila', starts_on: d(-1), ends_on: d(10), retro_date: d(11), retro_time: '10:00', participant_ids: [ana.id], facilitator_id: ana.id, reminders_enabled: false })
  await ana.req('POST', `/api/sprints/${empty.id}/transition`, { to: 'collecting' })

  if (!OFFLINE) {
    // ── Every world, both schemes, desktop and phone.
    for (const w of WORLDS) {
      await ana.req('PATCH', '/api/auth/me', { avatar_id: w, avatar_theme: true })
      for (const [label, viewport] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]])
        for (const theme of ['light', 'dark']) {
          for (const [kind, wsId] of [['full', ws.id], ['empty', ws2.id]]) {
            const { ctx, page, errors } = await pageFor(ana, { viewport, theme, prefs: { lastWorkspace: wsId } })
            await page.goto(`${BASE}/`)
            await page.waitForSelector('textarea[name="thought"]')
            await page.waitForSelector(kind === 'full' ? '.passage' : '.mine-empty', { timeout: 15000 })
            await page.waitForFunction(() => document.querySelector('.journal-art svg') !== null, null, { timeout: 8000 }).catch(() => {})
            await page.evaluate(() => document.fonts.ready)
            const facts = await page.evaluate(() => {
              const vw = document.documentElement.clientWidth
              const field = document.querySelector('textarea[name="thought"]').getBoundingClientRect()
              // Guhit's studio names the action for what it does ("Add to sprint"); the other worlds keep Muni's composer.
              const save = [...document.querySelectorAll('button')].find((b) => ['Save thought', 'Add to sprint'].includes(b.textContent.trim())).getBoundingClientRect()
              return { overflow: document.documentElement.scrollWidth - vw, fieldTop: field.top, saveBottom: save.bottom, vh: innerHeight, label: document.querySelector('label[for="thought-field"]')?.textContent }
            })
            const at = `${w} ${label} ${theme} ${kind}`
            if (kind === 'full' && theme === 'light') {
              check(`${w} ${label}: world applied`, (await world(page)) === w)
              check(`${w} ${label}: no horizontal overflow`, facts.overflow <= 0, `${facts.overflow}px`)
              check(`${w} ${label}: heading still labels the field`, facts.label === (w === 'kape' ? 'What’s on your mind?' : 'What’s worth remembering?'))
              if (label === '390') check(`${w} 390: the field and Save are in the first screen`, facts.fieldTop < facts.vh && facts.saveBottom <= facts.vh, `field ${Math.round(facts.fieldTop)}, save ${Math.round(facts.saveBottom)} of ${facts.vh}`)
              const fontOk = await page.evaluate(async (f) => {
                await document.fonts.load(`16px "${f}"`)
                return document.fonts.check(`16px "${f}"`)
              }, FONT[w])
              check(`${w}: its display face is loaded`, fontOk)
            }
            if (kind === 'empty' && theme === 'light' && label === '1440') check(`${w}: an illustrated, written empty state`, (await page.locator('.w-empty-art svg').count()) > 0 && (await page.locator('.w-joke').count()) === 1)
            if (errors.length) check(`${at}: no page errors`, false, errors[0])
            await shot(page, `${w}-${kind}-${label}-${theme}`)
            await ctx.close()
          }
        }
    }

    // ── Keyboard focus is visible in a world (Save, a category, the ⋯ menu).
    {
      await ana.req('PATCH', '/api/auth/me', { avatar_id: 'porma', avatar_theme: true })
      const { ctx, page } = await pageFor(ana, { prefs: { lastWorkspace: ws.id } })
      await page.goto(`${BASE}/`)
      await page.waitForSelector('.passage')
      await page.locator('textarea[name="thought"]').fill('Focus check')
      const outline = async (sel) => {
        await page.locator(sel).first().focus()
        await page.keyboard.press('Shift+Tab')
        await page.keyboard.press('Tab')
        return page.evaluate(() => {
          const s = getComputedStyle(document.activeElement)
          return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2 ? s.outlineColor : s.boxShadow !== 'none' ? 'shadow' : null
        })
      }
      check('Focus is visible on Save', !!(await outline('button:has-text("Save thought")')))
      check('Focus is visible on a thought’s ⋯ menu', !!(await outline('.passage-menu')))
      await ctx.close()
    }

    // ── Worlds live on personal pages only.
    {
      await ana.req('PATCH', '/api/auth/me', { avatar_id: 'bola', avatar_theme: true })
      const { ctx, page } = await pageFor(ana, { prefs: { lastWorkspace: ws.id } })
      await page.goto(`${BASE}/account`)
      await page.waitForSelector('#character-t')
      check('Account wears the world', (await world(page)) === 'bola')
      for (const path of [`/workspaces/${ws.id}`, `/sprints/${full.id}`, `/privacy`]) {
        await page.goto(`${BASE}${path}`)
        await page.waitForLoadState('networkidle')
        check(`No world on ${path.split('/')[1]}`, (await world(page)) === null)
      }
      check('Shared pages show initials, not the portrait', (await page.locator('[data-account-trigger] [data-portrait]').count()) === 0)
      await page.goto(`${BASE}/`)
      await page.waitForSelector('.passage')
      check('…and the portrait on your own page', (await page.locator('[data-account-trigger] [data-portrait="bola"]').count()) === 1)
      await ctx.close()
    }

    // ── Changing character live: the draft, the filter and focus stay; no reload.
    {
      await ana.req('PATCH', '/api/auth/me', { avatar_id: 'kape', avatar_theme: true })
      const { ctx, page } = await pageFor(ana, { prefs: { lastWorkspace: ws.id } })
      await page.goto(`${BASE}/`)
      await page.waitForSelector('.passage')
      await page.evaluate(() => (window.__sameDocument = true))
      const draft = 'Half a thought, still being written — ñ'
      await page.locator('textarea[name="thought"]').fill(draft)
      await page.locator('[aria-label="Show one category"] [role=radio]', { hasText: 'Keep' }).click()
      const before = await page.locator('.passage').count()
      await page.locator('[data-account-trigger]').click()
      await page.locator('button:has-text("Change character")').click()
      await page.waitForSelector('[role=dialog] .w-tile')
      await page.locator('[role=dialog] [role=radio][aria-label^="Himig"]').click()
      await page.locator('[role=dialog] button:has-text("Choose Himig")').click()
      await page.waitForSelector('[role=dialog]', { state: 'detached' })
      await page.waitForFunction(() => document.documentElement.dataset.world === 'himig')
      check('Switched world without a reload', await page.evaluate(() => window.__sameDocument === true))
      check('The draft is untouched', (await page.locator('textarea[name="thought"]').inputValue()) === draft)
      check('The filter is untouched', (await page.locator('[aria-label="Show one category"] [role=radio][aria-checked=true]').innerText()).startsWith('Keep') && (await page.locator('.passage').count()) === before)
      const refocused = await page.waitForFunction(() => document.activeElement?.hasAttribute('data-account-trigger'), null, { timeout: 3000 }).then(() => true).catch(() => false)
      check('Focus returns to where it was', refocused)
      await ctx.close()
    }

    // ── “Use avatar theme” off: Muni’s look and words; the character stays.
    {
      await ana.req('PATCH', '/api/auth/me', { avatar_id: 'sibol', avatar_theme: true })
      const { ctx, page } = await pageFor(ana, { prefs: { lastWorkspace: ws2.id } })
      await page.goto(`${BASE}/account`)
      await page.waitForSelector('#avatar-theme')
      await page.locator('#avatar-theme').click()
      await page.waitForFunction(() => !document.documentElement.dataset.world)
      check('Theme off: Muni’s look on Account', (await world(page)) === null)
      await page.goto(`${BASE}/`)
      await page.waitForSelector('.mine-empty')
      check('Theme off: neutral words in the empty collection', (await page.locator('text=Nothing kept yet').count()) === 1 && (await page.locator('.w-joke').count()) === 0)
      check('Theme off: the character is still yours', (await page.locator('[data-account-trigger] [data-portrait="sibol"]').count()) === 1)
      check('Theme off: the duyan evening is back', (await page.locator('.journal-scene:not([data-scene]) .journal-sun').count()) === 1)
      await ctx.close()
      await ana.req('PATCH', '/api/auth/me', { avatar_theme: true })
    }

    // ── A world this build doesn't know (or someone else's) falls back quietly.
    {
      const { ctx, page, errors } = await pageFor(ana, { prefs: { lastWorkspace: ws.id, world: { account: 'someone-else', avatar: 'nope', theme: true } } })
      await ana.req('PATCH', '/api/auth/me', { avatar_id: null })
      await page.goto(`${BASE}/`)
      await page.waitForSelector('.passage')
      check('Unknown cached world: Muni’s look, no errors', (await world(page)) === null && errors.length === 0)
      await ctx.close()
    }

    // ── Reduced motion: a save still answers; nothing keeps moving.
    {
      await ana.req('PATCH', '/api/auth/me', { avatar_id: 'himig', avatar_theme: true })
      const { ctx, page } = await pageFor(ana, { prefs: { lastWorkspace: ws.id }, reducedMotion: 'reduce' })
      await page.goto(`${BASE}/`)
      await page.waitForSelector('.passage')
      await page.locator('textarea[name="thought"]').fill('Synthetic: reduced motion in a world')
      await page.locator('button:has-text("Save thought")').click()
      await page.waitForSelector('text=Submitted. It stays hidden')
      await page.waitForTimeout(2500)
      const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)
      check('Reduced motion: nothing is still animating after a save', running === 0, `${running} running`)
      await ctx.close()
    }

    // ── The first visit: a new account chooses (or decides later) before its own page — never before a shared one.
    {
      const nia = await account('nia', 'Nia New', 'choose')
      await ana.req('POST', `/api/workspaces/${ws.id}/invitations`, { email: nia.email })
      const { ctx, page } = await pageFor(nia, { viewport: { width: 390, height: 844 }, theme: 'dark' })
      await page.goto(`${BASE}/privacy`)
      check('No chooser in front of a public page', (await page.locator('.w-chooser').count()) === 0)
      await page.goto(`${BASE}/`)
      await page.waitForSelector('.w-chooser')
      check('A new account meets the chooser on its own page', (await page.locator('.w-tile').count()) === 8)
      check('Kape is chosen by default', (await page.locator('[role=radio][aria-checked=true]').getAttribute('aria-label')).startsWith('Kape'))
      await page.locator('[role=radio][aria-label^="Pahina"]').click()
      check('Previewing changes the page', (await page.locator('.w-gate').getAttribute('data-world')) === 'pahina')
      await page.locator('button:has-text("Read Pahina’s story")').click()
      check('The story opens on request', await page.locator('.w-lore-story').isVisible())
      await shot(page, 'gate-390-dark')
      await page.locator('button:has-text("Decide later")').click()
      await page.waitForSelector('.journal-scene')
      check('Decide later: Muni’s own look', (await world(page)) === null)
      await page.reload()
      await page.waitForSelector('.journal-scene')
      check('…and the chooser doesn’t come back', (await page.locator('.w-chooser').count()) === 0)
      await ctx.close()

      const old = await account('old', 'Olivia Old', 'note')
      const o = await pageFor(old)
      await o.page.goto(`${BASE}/`)
      await o.page.waitForSelector('.journal-scene')
      check('An account from before characters: a quiet note, no gate', (await o.page.locator('.w-note').count()) === 1 && (await o.page.locator('.w-chooser').count()) === 0)
      await o.page.locator('.w-note button[aria-label="Dismiss"]').click()
      await o.page.waitForSelector('.w-note', { state: 'detached' })
      check('…dismissed for good', (await old.req('GET', '/api/auth/me')).avatar.intro === 'done')
      await o.ctx.close()
    }
  } else {
    // ── Offline (production build with the service worker): the chosen world keeps its art and type.
    await ana.req('PATCH', '/api/auth/me', { avatar_id: 'pahina', avatar_theme: true })
    // Opening offline needs "Keep drafts on this device" (Muni's rule for any account). Set once:
    // the device's own preferences (including its remembered world) must survive the reloads below.
    const { ctx, page } = await pageFor(ana)
    await page.goto(`${BASE}/privacy`)
    await page.evaluate(([w, a]) => localStorage.setItem('muni.prefs', JSON.stringify({ lastWorkspace: w, keepLocalFor: [a] })), [ws.id, ana.id])
    await page.goto(`${BASE}/`)
    await page.waitForSelector('.passage')
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.reload()
    await page.waitForSelector('.passage')
    const cached = await page.waitForFunction(async () => {
      const c = await caches.open('muni-fonts')
      return (await c.keys()).some((r) => r.url.includes('newsreader-latin'))
    }, null, { timeout: 15000 }).then(() => true).catch(() => false)
    check('The chosen world’s fonts are cached', cached)
    const others = await page.evaluate(async () => (await (await caches.open('muni-fonts')).keys()).filter((r) => /young-serif|unbounded|bodoni/.test(r.url)).length)
    check('Other worlds’ fonts are not downloaded', others === 0, `${others}`)
    await ctx.setOffline(true)
    await page.reload()
    await page.waitForSelector('textarea[name="thought"]')
    check('Offline: the world is still on', (await world(page)) === 'pahina')
    await page.waitForFunction(() => document.querySelector('.journal-art svg') !== null, null, { timeout: 8000 }).catch(() => {})
    check('Offline: its art is there', (await page.locator('.journal-art svg.pahina-head').count()) === 1)
    const face = await page.evaluate(async () => {
      await document.fonts.load('16px "Newsreader Variable"')
      return document.fonts.check('16px "Newsreader Variable"')
    })
    check('Offline: its type is there', face)
    await shot(page, 'offline-pahina')
    await ctx.close()
  }
} catch (e) {
  check('Run completed', false, e.message.split('\n')[0])
} finally {
  await browser.close()
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
