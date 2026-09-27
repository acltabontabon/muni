/**
 * Worlds with their own writing page (worlds/desk.tsx: Guhit's sketchbook, Kape's café table), end
 * to end, each with Muni's behaviour unchanged: the sprint label (details on request), one optional
 * category from a short list, context folded away and summarised, one starting point at a time,
 * the shortcut without keycaps, one submission per press, offline saving, the draft surviving a
 * change of character, reduced motion, a phone's first screen — and each world's scene (Guhit's
 * master plan; Kape's 40-minute stir, played once). Synthetic accounts and text only.
 *
 * Run against a production build (the dev server's StrictMode breaks draft keeping):
 *   MUNI_URL=http://localhost:8787 node e2e/desk.mjs          (WORLDS=kape to run one; SHOTS=dir)
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
  await ctx.addInitScript((p) => localStorage.setItem('muni.prefs', JSON.stringify(p)), { lastWorkspace: wsId })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${BASE}/`)
  await page.locator('.guhit-sheet, .kape-sheet').first().waitFor({ timeout: 15000 })
  return { ctx, page, errors }
}
const field = (page) => page.locator('textarea[name="thought"]')
const mine = (a, sprintId) => a.req('GET', `/api/sprints/${sprintId}/entries/mine`)

const HEADING = { guhit: 'What’s worth remembering?', kape: 'What’s on your mind?' }
const NAME = { guhit: 'Guhit', kape: 'Kape', bola: 'Bola' }
const WORLDS = (process.env.WORLDS ?? 'guhit,kape').split(',')

for (const W of WORLDS) try {
  console.log(`\n── ${NAME[W]}`)
  const $ = (cls) => `.${W}-${cls}`
  const ana = await account('Ana Reyes')
  await ana.req('PATCH', '/api/auth/me', { avatar_id: W, avatar_theme: true })
  const ws = await ana.req('POST', '/api/workspaces', { name: 'Studio' })
  const name = 'Sprint 27 — Onboarding flow rewrite, payments reconciliation and the great Q4 accessibility audit'
  const s = await ana.req('POST', `/api/workspaces/${ws.id}/sprints`, { name, timezone: 'Asia/Manila', starts_on: d(-3), ends_on: d(4), retro_date: d(5), retro_time: '15:00', participant_ids: [ana.id], facilitator_id: ana.id, reminders_enabled: false })
  await ana.req('POST', `/api/sprints/${s.id}/transition`, { to: 'collecting' })

  // ── The page, in reading order: where it goes, the invitation, the field, one action, the collection.
  {
    const { ctx, page, errors } = await open(ana, ws.id)
    await page.locator('.mine-empty').waitFor()
    const order = await page.evaluate((w) => {
      const y = (sel) => document.querySelector(sel)?.getBoundingClientRect().top ?? -1
      return [y(`.${w}-tab`), y(`.${w}-title`), y('textarea[name="thought"]'), y(`.${w}-save`), y('.mine')]
    }, W)
    check(`${W}: reading order: label, heading, field, action, then the collection`, order.every((v, i) => v >= 0 && (i === 0 || v >= order[i - 1] || i === 4)), order.map(Math.round).join(' → '))
    check('The tab names the sprint', (await page.locator(`.${W}-tab-name`).innerText()) === name)
    check('…with its state and the next date, concisely', /Collecting · retro /.test(await page.locator(`.${W}-tab-meta`).innerText()))
    check('The heading labels the field', (await page.locator('label[for="thought-field"]').innerText()) === HEADING[W])
    check('No category row until asked', (await page.locator(`.${W}-cat`).count()) === 0 && (await page.locator('.cat-choice').count()) === 0)
    check('No Prompt button, no keycaps on screen', (await page.locator('button', { hasText: /^Prompt$/ }).count()) === 0 && (await page.locator('kbd:visible').count()) === 0)
    check('Privacy is plain text, not a control', (await page.locator('button.privacy-mark').count()) === 0 && (await page.locator(`.${W}-fine`).innerText()).startsWith('Hidden from your team until collection closes'))
    check('One primary action, named for what it does', (await page.locator(`.${W}-save`).innerText()).trim() === 'Add to sprint' && (await page.locator(`.${W}-save`).isDisabled()))
    check('An empty collection: one character moment and one line', (await page.locator('.mine-empty .w-empty-art').count()) === 1 && (await page.locator('.mine-empty .w-joke').count()) === 1)
    if (W === 'guhit') check('The master plan starts at one feeling', /rev\. 0/.test(await page.locator('.guhit-plan').textContent()))
    if (W === 'kape') {
      check('The label says literally where it goes', (await page.locator('.kape-tab-kicker').innerText()).toLowerCase() === 'writing for')
      await page.locator('.kape-stir').scrollIntoViewIfNeeded()
      const played = await page.waitForFunction(() => document.querySelector('.kape-stir')?.hasAttribute('data-play'), null, { timeout: 5000 }).then(() => true).catch(() => false)
      check('The 40-minute stir plays when it’s seen', played)
      await page.waitForTimeout(4800)
      const still = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)
      check('…then the scene is still', still === 0, `${still} running`)
      await page.evaluate(() => (window.__sameDocument = true))
      await page.locator('a', { hasText: 'Sprints' }).first().click()
      await page.waitForURL((u) => u.pathname !== '/')
      await page.locator('a', { hasText: 'Write' }).first().click()
      await page.locator('.kape-stir').waitFor()
      await page.locator('.kape-stir').scrollIntoViewIfNeeded()
      await page.waitForTimeout(800)
      check('…and doesn’t replay when you come back', (await page.evaluate(() => window.__sameDocument === true)) && !(await page.locator('.kape-stir').evaluate((el) => el.hasAttribute('data-play'))))
      await page.evaluate(() => window.scrollTo(0, 0))
      await field(page).focus()
    }
    check('The field has focus on a desktop', await field(page).evaluate((el) => el === document.activeElement))

    // Details, on request.
    await page.locator(`.${W}-tab`).click()
    const details = page.locator(`.${W}-pop`)
    await details.waitFor()
    const text = await details.innerText()
    check('Details: the full name, the retro with its timezone, who sees what', text.includes(name) && /15:00 Manila time/.test(text) && text.includes('Who sees what'))
    await page.keyboard.press('Escape')
    await details.waitFor({ state: 'detached' })
    const onTab = await page.waitForFunction(() => document.activeElement?.className.endsWith('-tab'), null, { timeout: 2000 }).then(() => true).catch(() => false)
    check('Escape closes details and returns to the tab', onTab, await page.evaluate(() => document.activeElement?.className))
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/empty.png` })

    // Category: one, optional, changeable, clearable — by keyboard.
    await field(page).fill('Standups ran long again.')
    await page.locator(`.${W}-opt`, { hasText: 'Category' }).focus()
    await page.keyboard.press('Enter')
    await page.locator(`.${W}-cats`).waitFor()
    check('The list offers the five categories with hints', (await page.locator(`.${W}-cat`).count()) === 5)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.locator(`.${W}-cats`).waitFor({ state: 'detached' })
    check('Chosen by keyboard: Improve, shown quietly', (await page.locator(`.${W}-opt[data-set]`).first().innerText()).includes('Improve'))
    check('…and focus is back on the control', await page.locator(`.${W}-opt[data-set]`).first().evaluate((el) => el === document.activeElement))
    await page.locator(`.${W}-opt[data-set]`).first().click()
    check('Changing it offers “No category”', (await page.locator(`.${W}-cat`, { hasText: 'No category' }).count()) === 1)
    await page.locator(`.${W}-cat`, { hasText: 'Try' }).click()
    check('Changed to Try', (await page.locator(`.${W}-opt[data-set]`).first().innerText()).includes('Try'))

    // Context: folded away, then summarised.
    await page.locator(`.${W}-opt`, { hasText: 'Context' }).click()
    await page.locator('textarea[id$="-impact"]').fill('We lost the first hour of focus.')
    await page.locator(`.${W}-context [role=radio]`, { hasText: 'Mid sprint' }).click()
    await page.locator(`.${W}-opt`, { hasText: 'Fold context away' }).click()
    check('Folded context is summarised', (await page.locator(`.${W}-opt`, { hasText: 'Context' }).innerText()).replace(/\s+/g, ' ').includes('Context: impact, mid sprint'))
    check('…and nothing typed is lost', (await field(page).inputValue()) === 'Standups ran long again.')

    // Submit with the shortcut; a second press can't send it twice.
    await field(page).focus()
    await page.keyboard.press('ControlOrMeta+Enter')
    await page.keyboard.press('ControlOrMeta+Enter')
    await page.locator(`.${W}-note`, { hasText: 'Added to' }).waitFor({ timeout: 10000 })
    check('Saved: says where it went, with its mark', (await page.locator(`.${W}-note strong`).innerText()) === name && (await page.locator(`.${W}-note svg`).count()) === 1)
    check('The field is clear and still focused', (await field(page).inputValue()) === '' && (await field(page).evaluate((el) => el === document.activeElement)))
    await page.locator('.passage').first().waitFor()
    const list = await mine(ana, s.id)
    check('Exactly one thought was submitted', list.length === 1, `${list.length}`)
    check('…with its category and context as chosen', list[0]?.category === 'try' && list[0]?.impact === 'We lost the first hour of focus.' && list[0]?.period === 'middle')
    check('The options reset for the next thought', (await page.locator(`.${W}-opt[data-set]`).count()) === 0)
    if (W === 'guhit') check('The master plan gains a room, drawn once', /rev\. 1/.test(await page.locator('.guhit-plan').textContent()) && (await page.locator('.guhit-plan .guhit-p-new').count()) === 1)
    check('The new thought settles into the collection', (await page.locator('.passage.anim-reflect').count()) === 1)
    await page.waitForTimeout(1800)
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)
    check('After the moment, nothing keeps moving', running === 0, `${running} running`)

    // Starting point: one at a time, never over the writing.
    await field(page).fill('')
    await page.locator('button', { hasText: 'Need a starting point?' }).click()
    const first = await page.locator(`.${W}-prompt p`).innerText()
    const focused = await page.waitForFunction(() => document.activeElement?.id === 'thought-field', null, { timeout: 2000 }).then(() => true).catch(() => false)
    check('A starting point appears, and focus goes to the field', first.length > 10 && focused)
    await field(page).fill('My own words')
    await page.locator(`.${W}-prompt button`, { hasText: 'Another' }).click()
    check('“Another” changes only the prompt', (await page.locator(`.${W}-prompt p`).innerText()) !== first && (await field(page).inputValue()) === 'My own words')

    // Editing a thought uses the same category control.
    await page.locator('.passage .passage-menu').first().click()
    await page.locator('[role=menuitem]', { hasText: 'Edit' }).click()
    await page.locator('.passage form').waitFor()
    check('Editing offers the category as one control, not five', (await page.locator(`.passage .${W}-opt`).count()) === 1 && (await page.locator('.passage [aria-label="Category (optional)"]').count()) === 0)
    await page.keyboard.press('Escape')
    check('No page errors', errors.length === 0, errors[0])
    await ctx.close()
  }

  // ── Offline: saved on the device and sent later; the words are never lost.
  {
    const { ctx, page } = await open(ana, ws.id)
    await ctx.setOffline(true)
    await field(page).fill('Written with no connection.')
    await page.locator(`.${W}-save`).click()
    await page.locator(`.${W}-note[data-tone="local"]`).waitFor({ timeout: 10000 })
    check('Offline: kept here, said plainly', /Kept in this tab|Saved on this device/.test(await page.locator(`.${W}-note`).innerText()))
    check('…and it waits in the collection', (await page.locator('.passage[data-state="queued"], .passage[data-state="sending"]').count()) === 1)
    await ctx.setOffline(false)
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    const sent = await page.waitForFunction(() => !document.querySelector('.passage[data-state="queued"], .passage[data-state="sending"]'), null, { timeout: 15000 }).then(() => true).catch(() => false)
    check('Back online: it is sent', sent && (await mine(ana, s.id)).length === 2)
    await ctx.close()
  }

  // ── A change of character keeps the draft (this world's composer and Muni's are different components).
  {
    const { ctx, page } = await open(ana, ws.id)
    const draft = 'Half a thought — still being written, ñ'
    await field(page).fill(draft)
    await page.waitForTimeout(600)
    await page.locator('[data-account-trigger]').click()
    await page.locator('button:has-text("Change character")').click()
    await page.locator('[role=dialog] [role=radio][aria-label^="Bola"]').click()
    await page.locator('[role=dialog] button:has-text("Choose Bola")').click()
    await page.waitForFunction(() => document.documentElement.dataset.world === 'bola')
    await page.locator('textarea[name="thought"].journal-field').waitFor()
    const kept = await page.waitForFunction((t) => document.querySelector('textarea[name="thought"]')?.value === t, draft, { timeout: 5000 }).then(() => true).catch(() => false)
    check(`${NAME[W]} → Bola: the draft is still there`, kept)
    await page.locator('[data-account-trigger]').click()
    await page.locator('button:has-text("Change character")').click()
    await page.locator(`[role=dialog] [role=radio][aria-label^="${NAME[W]}"]`).click()
    await page.locator(`[role=dialog] button:has-text("Choose ${NAME[W]}")`).click()
    await page.locator(`form.${W}-book`).waitFor()
    const back = await page.waitForFunction((t) => document.querySelector('textarea[name="thought"]')?.value === t, draft, { timeout: 5000 }).then(() => true).catch(() => false)
    check(`Bola → ${NAME[W]}: still there`, back)
    await field(page).fill('')
    await page.waitForTimeout(600)
    await ctx.close()
  }

  // ── Reduced motion: the underline is simply there.
  {
    const { ctx, page } = await open(ana, ws.id, { reducedMotion: 'reduce' })
    const anim = W === 'guhit' ? await page.locator('.guhit-title em').evaluate((el) => getComputedStyle(el, '::after').animationName) : 'none'
    if (W === 'guhit') check('Reduced motion: no drawn underline', anim === 'none', anim)
    if (W === 'kape') {
      await page.locator('.kape-stir').scrollIntoViewIfNeeded()
      await page.waitForTimeout(800)
      check('Reduced motion: the scene is the finished picture, never played', !(await page.locator('.kape-stir').evaluate((el) => el.hasAttribute('data-play'))))
    }
    await ctx.close()
  }

  // ── A phone: the field and the action in the first screen; choices in a sheet; no sideways scroll.
  for (const theme of ['light', 'dark']) {
    const { ctx, page } = await open(ana, ws.id, { viewport: { width: 390, height: 844 }, theme })
    const f = await page.evaluate((w) => ({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, save: document.querySelector(`.${w}-save`).getBoundingClientRect().bottom, vh: innerHeight }), W)
    check(`Phone (${theme}): no horizontal overflow`, f.overflow <= 0, `${f.overflow}px`)
    check(`Phone (${theme}): Add to sprint in the first screen`, f.save <= f.vh, `${Math.round(f.save)} of ${f.vh}`)
    check(`Phone (${theme}): the field doesn't take focus by itself`, !(await field(page).evaluate((el) => el === document.activeElement)))
    if (W === 'guhit') check(`Phone (${theme}): the master plan stays off the small screen`, !(await page.locator('.guhit-plan').isVisible()))
    if (W === 'kape') {
      const pos = await page.evaluate(() => ({ scene: document.querySelector('.kape-scene').getBoundingClientRect().top, mine: document.querySelector('.mine').getBoundingClientRect().top }))
      check(`Phone (${theme}): the scene comes after your thoughts`, pos.scene > pos.mine)
      check(`Phone (${theme}): the scene is framed for a phone`, (await page.locator('.kape-stir[data-narrow]').count()) === 1 && !(await page.locator('.kape-s-wide').first().isVisible()))
    }
    await page.locator(`.${W}-opt`, { hasText: 'Category' }).click()
    const sheet = page.locator(`.${W}-drawer[role=dialog]`)
    await sheet.waitFor()
    await page.waitForTimeout(400)
    const box = await sheet.boundingBox()
    check(`Phone (${theme}): categories open as a sheet from the bottom`, Math.abs(box.y + box.height - 844) < 2)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-sheet-${theme}.png` })
    await ctx.close()
  }

  // ── Collection closed: the same sketchbook, read-only, the tab says so.
  {
    await ana.req('POST', `/api/sprints/${s.id}/transition`, { to: 'preparing', confirm: true })
    const { ctx, page } = await open(ana, ws.id)
    check('Closed: the tab says so', (await page.locator(`.${W}-tab-state`).innerText()).includes('Collection closed'))
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
