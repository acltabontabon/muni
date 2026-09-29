/**
 * The first evening, end to end: a new account's prologue, the firefly on each real control of a
 * team's first sprint, the sky, and the closing when the first retro is done. Then an invited
 * member on a phone (a shorter prologue, swiped; the note docked, folding while they type; silence
 * until the retro; the closing with four stars), and someone who hides the guide.
 * Synthetic accounts and text only.
 *
 * Run against a production build served by the Worker (the dev-only session endpoint must exist):
 *   MUNI_URL=http://localhost:8787 node e2e/firstrun.mjs      (SHOTS=dir to save screenshots)
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.MUNI_URL ?? 'http://localhost:8787'
const SHOTS = process.env.SHOTS ?? null
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const d = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
const tag = crypto.randomUUID().slice(0, 5)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function account(name, extra = {}) {
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
  const me = await req('POST', '/api/dev/session', { name, intro: 'done', ...extra })
  return { id: me.account_id, name, req, cookies: () => [...jar].map(([n, value]) => ({ name: n, value, domain: new URL(BASE).hostname, path: '/' })) }
}
const joinLink = async (owner, wsId) => (await owner.req('POST', `/api/workspaces/${wsId}/join-links`, { mode: 'direct', expires_in_hours: 24 })).url.split('#')[1]
const go = (who, id, to) => who.req('POST', `/api/sprints/${id}/transition`, { to, confirm: true })

const browser = await chromium.launch()
async function open(who, { phone = false, theme = 'light', reduced = false } = {}) {
  const ctx = await browser.newContext({ viewport: phone ? { width: 375, height: 812 } : { width: 1360, height: 900 }, isMobile: phone, hasTouch: phone, colorScheme: theme, reducedMotion: reduced ? 'reduce' : 'no-preference' })
  await ctx.addCookies(who.cookies())
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  return { ctx, page, errors }
}
const shot = async (page, name, full = false) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full })
}
const S = (id, s = '') => `${BASE}/sprints/${id}${s}`
const kicker = async (page) => (await page.locator('.prologue-kicker').textContent()) ?? ''
/** The firefly's current step (waits for it to settle), or null when there's none. */
async function firefly(page, step, ms = 6000) {
  const note = page.locator(step ? `[data-guide-note="${step}"]` : '[data-guide-note]')
  try {
    await note.first().waitFor({ timeout: ms })
    // The light arrives and the note settles before anything is measured or shot.
    await sleep(1200)
    return await note.first().getAttribute('data-guide-note')
  } catch {
    return null
  }
}
const lights = (page) => page.locator('.firefly').count()
/** Distance from the light to the control it's by (it never covers it: `over`), and from the note to it. */
const near = (page, spot) =>
  page.evaluate((spot) => {
    const a = document.querySelector(`[data-guide="${spot}"][data-guide-on]`)?.getBoundingClientRect()
    const l = document.querySelector('.firefly')?.getBoundingClientRect()
    const n = document.querySelector('[data-guide-note]')?.getBoundingClientRect()
    if (!a || !l) return null
    const lx = l.left + l.width / 2
    const ly = l.top + l.height / 2
    const light = Math.hypot(Math.max(a.left - lx, 0, lx - a.right), Math.max(a.top - ly, 0, ly - a.bottom))
    const note = n ? Math.max(0, n.top - a.bottom, a.top - n.bottom) : null
    const over = l.left < a.right && l.right > a.left && l.top < a.bottom && l.bottom > a.top
    return { light, over, note, noteBottom: n?.bottom ?? null, vh: innerHeight }
  }, spot)
const endless = (page) => page.evaluate(() => document.getAnimations().filter((a) => a.effect?.getComputedTiming?.().iterations === Infinity).length)

try {
  // ── A starter, on a laptop: the prologue, from the entrance's evening on.
  const ana = await account(`Ana Reyes ${tag}`, { guide: 'prologue', intro: 'choose' })
  const A = await open(ana)
  await A.page.goto(BASE + '/')
  await A.page.locator('.prologue').waitFor()
  check('A new account opens on the prologue, before the character chooser', (await A.page.locator('.prologue').count()) === 1 && (await A.page.getByRole('dialog', { name: 'Choose a character' }).count()) === 0)
  check('Beat 1 of 5, with Skip in reach', /1 of 5/.test(await kicker(A.page)) && (await A.page.getByRole('button', { name: 'Skip' }).isVisible()))
  await shot(A.page, '01-prologue-1')
  for (let i = 2; i <= 5; i++) {
    await A.page.keyboard.press('ArrowRight')
    await sleep(900)
    await shot(A.page, `01-prologue-${i}`)
  }
  check('→ walks the five beats; the last asks where to begin', /5 of 5/.test(await kicker(A.page)) && (await A.page.getByRole('button', { name: 'Start a team' }).count()) === 1 && (await A.page.getByRole('button', { name: 'I have an invitation' }).count()) === 1)
  check('The evening ahead: seven stars, none lit', (await A.page.locator('.evening-star').count()) === 7)
  await A.page.keyboard.press('ArrowLeft')
  check('← goes back', /4 of 5/.test(await kicker(A.page)))
  await A.page.keyboard.press('ArrowRight')
  await A.page.getByRole('button', { name: 'I have an invitation' }).click()
  check('"I have an invitation" says where invitations lead, without leaving', /invitation email/.test(await A.page.locator('.prologue-actions').innerText()))
  await A.page.getByRole('button', { name: 'Start a team instead' }).click()
  await A.page.getByRole('button', { name: 'Start a team' }).click()
  await A.page.getByRole('button', { name: 'Decide later' }).click()
  const wsDialog = A.page.getByRole('dialog', { name: 'New workspace' })
  await wsDialog.waitFor()
  check('"Start a team" → the chooser → the new-workspace dialog, opened by itself', await wsDialog.isVisible())
  check('The account’s guide is on', (await ana.req('GET', '/api/auth/me')).guide === 'on')
  await wsDialog.getByRole('textbox').fill(`Payments ${tag}`)
  await wsDialog.getByRole('button', { name: 'Create workspace' }).click()
  await A.page.waitForURL('**/workspaces/*')
  const wsId = new URL(A.page.url()).pathname.split('/')[2]

  // ── The firefly: one light, on the real control, a note beside it.
  check('No sprints yet: the firefly is on “Set up a sprint”', (await firefly(A.page, 'sprint')) === 'sprint')
  await sleep(1300)
  let at = await near(A.page, 'setup-sprint')
  check('One light, by the control and never over it, the note beside it', (await lights(A.page)) === 1 && at && at.light < 40 && !at.over && at.note !== null && at.note < 40, JSON.stringify(at))
  await shot(A.page, '02-firefly-sprint')
  await A.page.locator('[data-guide="setup-sprint"]').first().click()
  await A.page.waitForURL('**/sprints/new')
  check('Setup: the firefly is on “Create and open collection”', (await firefly(A.page, 'create-open')) === 'create-open')
  await shot(A.page, '03-firefly-setup')

  // The sprint itself comes from the API (setting one up in the form is sprint.mjs's work).
  const sprint = await ana.req('POST', `/api/workspaces/${wsId}/sprints`, { name: `Checkout ${tag}`, timezone: 'Asia/Manila', starts_on: d(-13), ends_on: d(0), retro_date: d(1), retro_time: '15:00', participant_ids: [ana.id], facilitator_id: ana.id, reminders_enabled: false })
  await A.page.goto(S(sprint.id))
  check('Alone in a draft: the firefly is on “Invite people”', (await firefly(A.page, 'invite')) === 'invite')
  await shot(A.page, '04-firefly-invite')
  await A.page.getByRole('button', { name: 'Later' }).click()
  check('“Later” moves on to opening collection', (await firefly(A.page, 'open')) === 'open')

  const ben = await account(`Ben Okafor ${tag}`)
  await ben.req('POST', '/api/join/request', { token: await joinLink(ana, wsId) })
  await ana.req('POST', `/api/sprints/${sprint.id}/participants`, { account_id: ben.id })
  await A.page.reload()
  check('With the team in: the firefly is on “Open collection”', (await firefly(A.page, 'open')) === 'open')
  await sleep(1300)
  at = await near(A.page, 'sprint-primary')
  check('…resting by the button, clear of it', at && at.light < 40 && !at.over, JSON.stringify(at))
  await shot(A.page, '05-firefly-open')
  await sleep(3000)
  check('The firefly comes to rest: nothing of the guide is still moving', (await A.page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.target?.closest?.('.guide-layer')).length)) === 0)
  await A.page.getByRole('button', { name: 'Open collection', exact: true }).click()
  await A.page.locator('.firefly').waitFor()
  await sleep(1400)
  // It flies from the button to the field: measured once it has landed.
  await A.page.waitForFunction(() => !document.querySelector('.guide-layer[data-glide]'))
  at = await near(A.page, 'writer')
  check('Collecting: the firefly waits by the writing field, as a light (the page already asks)', at && at.light < 40 && !at.over && (await A.page.locator('[data-guide-note]').count()) === 0, JSON.stringify(at))
  await A.page.locator('.firefly').click()
  check('…its note opens from the light', (await firefly(A.page, 'write')) === 'write')
  await shot(A.page, '06-firefly-write')
  await A.page.locator('[data-guide="writer"]').first().click()
  check('Typing in the field folds the note to its light', (await A.page.locator('[data-guide-note]').count()) === 0 && (await lights(A.page)) === 1)
  await A.page.locator('[data-guide="writer"]').first().fill('Pairing on the payment retries saved us a day.')
  await A.page.getByRole('button', { name: /Add to sprint/ }).first().click()
  // The sprint's last day is today: the next thing is closing collection.
  check('After writing, on the sprint’s last day: “Close collection…”', (await firefly(A.page, 'close', 9000)) === 'close')

  // The sky, from the account menu.
  await A.page.locator('[data-account-trigger]').click()
  await A.page.getByRole('button', { name: /The first evening/ }).click()
  const sky = A.page.getByRole('dialog', { name: /The first evening/ })
  await sky.locator('.sky-count').waitFor()
  check('The sky: 4 of 7 lit (team, sprint, people, a first thought)', (await sky.locator('.sky-count').innerText()).trim() === '4 of 7 lit')
  check('…and names the next star', /Everyone’s thoughts, revealed/.test(await sky.locator('li[data-next]').innerText()))
  await shot(A.page, '07-sky')
  await A.page.keyboard.press('Escape')

  await A.page.getByRole('button', { name: 'Close collection…', exact: true }).click()
  await A.page.getByRole('dialog').getByRole('button', { name: 'Close collection', exact: true }).click()
  check('Closed, no themes: the firefly is on “Group into themes”', (await firefly(A.page, 'themes', 9000)) === 'themes')
  await A.page.getByRole('button', { name: 'Later' }).click()
  check('Themes are optional: “Later” moves on to starting the retro', (await firefly(A.page, 'start')) === 'start')
  await shot(A.page, '08-firefly-start')
  await go(ana, sprint.id, 'live')
  await A.page.goto(S(sprint.id, '/stage'))
  await A.page.locator('.retro').first().waitFor()
  await sleep(1500)
  check('Never on the stage: the cue has it there', (await lights(A.page)) === 0)
  await go(ana, sprint.id, 'completed')
  await A.page.goto(S(sprint.id))
  await A.page.locator('.first-evening').waitFor()
  check('The first retro done: the closing, seven stars onto the mark', (await A.page.locator('.fe-star').count()) === 7)
  await sleep(4300)
  await shot(A.page, '09-closing')
  check('The guide is done for good', (await ana.req('GET', '/api/auth/me')).guide === 'done')
  await A.page.reload()
  await A.page.locator('section.sbar, .room').first().waitFor()
  await sleep(800)
  check('Once: not again after a reload', (await A.page.locator('.first-evening').count()) === 0)
  await A.page.locator('[data-account-trigger]').click()
  check('…and the account menu has no evening any more', (await A.page.getByRole('button', { name: /The first evening/ }).count()) === 0)
  await A.page.keyboard.press('Escape')
  check('Nothing loops (laptop)', (await endless(A.page)) === 0)
  check('No page errors (laptop)', A.errors.length === 0, A.errors.join(' | '))

  // ── An invited member, on a phone at night.
  const next = await ana.req('POST', `/api/workspaces/${wsId}/sprints`, { name: `Checkout, part two ${tag}`, timezone: 'Asia/Manila', starts_on: d(0), ends_on: d(13), retro_date: d(14), retro_time: '15:00', participant_ids: [ana.id, ben.id], facilitator_id: ana.id, reminders_enabled: false })
  await go(ana, next.id, 'collecting')
  const cleo = await account(`Cleo Park ${tag}`, { guide: 'prologue', intro: 'choose' })
  const C = await open(cleo, { phone: true, theme: 'dark' })
  const token = await joinLink(ana, wsId)
  await C.page.goto(`${BASE}/join#${token}`)
  await C.page.getByRole('button', { name: 'Join the team' }).click()
  await C.page.locator('.prologue').waitFor()
  check('Joining a team: the member’s prologue, three beats', /1 of 3/.test(await kicker(C.page)))
  await shot(C.page, '10-member-prologue-1')
  const box = await C.page.locator('.prologue-scene').boundingBox()
  await C.page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2)
  await C.page.mouse.down()
  await C.page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 6 })
  await C.page.mouse.up()
  check('A swipe goes on', /2 of 3/.test(await kicker(C.page)))
  await C.page.keyboard.press('ArrowRight')
  await sleep(900)
  await shot(C.page, '11-member-prologue-3')
  check('The member’s evening ahead: four stars', (await C.page.locator('.evening-star').count()) === 4)
  await ana.req('POST', `/api/sprints/${next.id}/participants`, { account_id: cleo.id })
  await C.page.getByRole('button', { name: /Write your first thought|Go to your team/ }).click()
  await C.page.locator('.prologue').waitFor({ state: 'detached' })
  check('The prologue ends where the invitation led', !C.page.url().includes('/join'))
  // (Added to the sprint after joining, so the prologue offered the team: open the sprint.)
  if (!C.page.url().includes(next.id)) await C.page.goto(S(next.id))
  await C.page.locator('.firefly').waitFor({ timeout: 9000 })
  await C.page.locator('.firefly').click()
  check('A member in a collecting sprint: the firefly is in the writing field', (await firefly(C.page, 'write', 9000)) === 'write')
  await sleep(500)
  at = await near(C.page, 'writer')
  check('On a phone the note docks at the bottom', at && at.noteBottom !== null && Math.abs(at.noteBottom - at.vh) < 2, JSON.stringify(at))
  await shot(C.page, '12-member-write')
  await C.page.locator('[data-guide="writer"]').first().focus()
  await sleep(200)
  check('…and folds away while they type', (await C.page.locator('[data-guide-note]').count()) === 0)
  await C.page.locator('[data-guide="writer"]').first().fill('The flaky checkout test cost us two mornings.')
  await C.page.getByRole('button', { name: /Add to sprint/ }).first().click()
  await sleep(2000)
  check('Written: silence while the team writes', (await lights(C.page)) === 0)
  await go(ana, next.id, 'preparing')
  await C.page.reload()
  await sleep(2000)
  check('Closed: still silence (the page says what to do)', (await lights(C.page)) === 0)
  await go(ana, next.id, 'live')
  await C.page.reload()
  check('Live: the firefly is on “Join the retro”', (await firefly(C.page, 'join', 9000)) === 'join')
  await shot(C.page, '13-member-join')
  await C.page.locator('[data-guide="join-retro"]').click()
  await C.page.waitForURL('**/room')
  await sleep(1500)
  check('Never in the phone’s room', (await lights(C.page)) === 0)
  await go(ana, next.id, 'completed')
  await C.page.goto(S(next.id))
  await C.page.locator('.first-evening').waitFor()
  check('A member’s closing: four stars', (await C.page.locator('.fe-star').count()) === 4)
  await sleep(4300)
  await shot(C.page, '14-member-closing', true)
  check('Nothing loops (phone)', (await endless(C.page)) === 0)
  check('No page errors (phone)', C.errors.length === 0, C.errors.join(' | '))

  // ── In a character's room: the firefly finds the room's own writer and bar.
  for (const [avatar, theme] of [['bola', 'light'], ['himig', 'dark']]) {
    const eli = await account(`Eli ${avatar} ${tag}`, { guide: 'on' })
    await eli.req('PATCH', '/api/auth/me', { avatar_id: avatar, avatar_theme: true })
    await eli.req('POST', '/api/join/request', { token: await joinLink(ana, wsId) })
    const room = await ana.req('POST', `/api/workspaces/${wsId}/sprints`, { name: `In ${avatar}’s room ${tag}`, timezone: 'Asia/Manila', starts_on: d(0), ends_on: d(13), retro_date: d(14), retro_time: '15:00', participant_ids: [ana.id, eli.id], facilitator_id: eli.id, reminders_enabled: false })
    const E = await open(eli, { theme })
    await E.page.goto(S(room.id))
    check(`${avatar}: a draft in the room points at “Open collection”`, (await firefly(E.page, 'open')) === 'open')
    await shot(E.page, `15-room-${avatar}-open`)
    await E.page.getByRole('button', { name: 'Open collection', exact: true }).click()
    await E.page.locator('.firefly').waitFor()
    await sleep(1400)
    await E.page.waitForFunction(() => !document.querySelector('.guide-layer[data-glide]'))
    at = await near(E.page, 'writer')
    check(`${avatar}: collecting, the light rests by the room’s own writer`, at && at.light < 40 && !at.over, JSON.stringify(at))
    await E.page.locator('.firefly').click()
    await firefly(E.page, 'write')
    await shot(E.page, `16-room-${avatar}-write`)
    check(`${avatar}: no page errors`, E.errors.length === 0, E.errors.join(' | '))
    await E.ctx.close()
  }

  // ── Someone who'd rather not: hidden everywhere, and back from the sky.
  const dev = await account(`Dev Ortiz ${tag}`, { guide: 'on' })
  const devWs = await dev.req('POST', '/api/workspaces', { name: `Platform ${tag}` })
  const D = await open(dev, { reduced: true })
  await D.page.goto(`${BASE}/workspaces/${devWs.id}`)
  check('Guide on, reduced motion: the firefly still shows the way', (await firefly(D.page, 'sprint')) === 'sprint')
  check('…without moving', (await D.page.evaluate(() => document.querySelector('.firefly')?.getAnimations({ subtree: true }).length ?? -1)) === 0)
  await D.page.getByRole('button', { name: 'The whole evening' }).click()
  await D.page.getByRole('button', { name: 'Watch the prologue again' }).click()
  await D.page.locator('.prologue-over').waitFor()
  check('The prologue can be watched again, over the page', /1 of 5/i.test(await kicker(D.page)))
  await D.page.keyboard.press('Escape')
  await D.page.locator('.prologue-over').waitFor({ state: 'detached' })
  check('…and Esc leaves it, changing nothing', (await dev.req('GET', '/api/auth/me')).guide === 'on' && (await firefly(D.page, 'sprint')) === 'sprint')
  await D.page.getByRole('button', { name: 'Hide the guide' }).click()
  await sleep(1200)
  check('“Hide the guide” takes it away', (await lights(D.page)) === 0 && (await dev.req('GET', '/api/auth/me')).guide === 'hidden')
  await D.page.reload()
  await D.page.locator('.ws-first').waitFor()
  await sleep(1200)
  check('…and it stays away', (await lights(D.page)) === 0)
  await D.page.locator('[data-account-trigger]').click()
  await D.page.getByRole('button', { name: /The first evening/ }).click()
  const sky2 = D.page.getByRole('dialog', { name: /The first evening/ })
  await sky2.getByRole('button', { name: 'Show the guide' }).click()
  check('The sky brings it back', (await firefly(D.page, 'sprint', 8000)) === 'sprint')
  check('No page errors (hidden)', D.errors.length === 0, D.errors.join(' | '))
} catch (e) {
  check('The script ran to the end', false, e.stack ?? String(e))
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
