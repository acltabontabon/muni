/**
 * The capture page, end to end: the journal scene, the open writing surface, passages and their
 * menus, states (empty, pending, failed, submitted), editing beside a draft, roles, unencrypted vs
 * encrypted guidance, keyboard and reduced motion. Synthetic accounts and text only.
 * Run from web/:  MUNI_URL=http://localhost:5173 node e2e/capture.mjs   (SHOTS=dir to save screenshots)
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
const tag = crypto.randomUUID().slice(0, 6)
const addr = (p) => `${p}-${tag}@example.test`
const d = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

/** A signed-in synthetic account, driven over HTTP (for setup) and usable as browser cookies. */
async function account(prefix, name) {
  const email = addr(prefix)
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
  // A signed-in account, made by the development-only endpoint (passkeys themselves: e2e/passkeys.mjs).
  const me = await req('POST', '/api/dev/session', { name })
  if (me.needs_name) await req('PATCH', '/api/auth/me', { display_name: name })
  return { email, name, id: me.account_id, req, cookies: () => [...jar].map(([n, value]) => ({ name: n, value, domain: new URL(BASE).hostname, path: '/' })) }
}

const browser = await chromium.launch()
async function pageFor(a, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport ?? { width: 1440, height: 900 }, colorScheme: opts.theme ?? 'light', reducedMotion: opts.reducedMotion ?? 'no-preference', hasTouch: (opts.viewport?.width ?? 1440) < 600 })
  await ctx.addCookies(a.cookies())
  if (opts.ws) await ctx.addInitScript((ws) => localStorage.setItem('muni.prefs', JSON.stringify({ lastWorkspace: ws })), opts.ws)
  const page = await ctx.newPage()
  return { ctx, page }
}
const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}
const entry = (a, sprint, body, category = null, extra = {}) => a.req('POST', `/api/sprints/${sprint}/entries`, { body, category, idempotency_key: crypto.randomUUID(), ...extra })

try {
  // ── Setup: a facilitator, a participant, a sprint set up without encryption that's collecting.
  const fay = await account('fay', 'Fay Facilitator')
  const pia = await account('pia', 'Pia Participant')
  const ws = await fay.req('POST', '/api/workspaces', { name: `Journal team ${tag}` })
  await fay.req('POST', `/api/workspaces/${ws.id}/invitations`, { email: pia.email })
  await new Promise((r) => setTimeout(r, 1200))
  const mail = (await (await fetch(BASE + '/api/dev/inbox')).json()).find((m) => m.to === pia.email && /invited/.test(m.subject))
  await pia.req('POST', '/api/invitations/accept', { token: mail.body.split('\n').map((l) => l.trim()).find((l) => l.includes('/invite')).split('#')[1] })
  const sprint = await fay.req('POST', `/api/workspaces/${ws.id}/sprints`, { name: 'Cycle 9 — Synthetic sprint with a deliberately long name to test wrapping', timezone: 'Asia/Manila', starts_on: d(-5), ends_on: d(6), retro_date: d(7), retro_time: '14:00', participant_ids: [fay.id, pia.id], facilitator_id: fay.id, reminders_enabled: false })
  await fay.req('POST', `/api/sprints/${sprint.id}/transition`, { to: 'collecting' })

  // ── Empty collection.
  let { ctx, page } = await pageFor(pia, { ws: ws.id })
  await page.goto(`${BASE}/`)
  await page.waitForSelector('textarea[name="thought"]')
  check('The field has a persistent label (the heading)', (await page.locator('label[for="thought-field"]').innerText()).includes('What’s worth'))
  await page.waitForSelector('text=Nothing kept yet', { timeout: 20000 }).catch(() => {})
  check('Empty collection: one brief invitation', (await page.locator('text=Nothing kept yet').count()) === 1)
  check('Empty collection: the character shows its thought bubble', (await page.locator('.journal-scene .journal-bubble').count()) === 1)
  check('No cropped illustration tile or bubble cards', (await page.locator('.postcard, .bubble, .bubbles').count()) === 0)
  check('No “Not encrypted” badge on the capture page', (await page.locator('text=Not encrypted').count()) === 0)
  check('Participants see no facilitator controls on their sprint', (await page.locator('.sbar-control').count()) === 0 && (await page.locator('text=Sprint guide').count()) === 0)
  await shot(page, 'empty-1440-light')

  // ── Keyboard: write, choose a category with the keyboard, save with ⌘/Ctrl+Enter.
  await page.locator('textarea[name="thought"]').fill('Synthetic: the deploy queue was quiet all week.')
  // Visual order under the field: straight to the category choices (no privacy control in between).
  await page.keyboard.press('Tab')
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('role'))
  check('Tab from the field reaches the categories', focused === 'radio', `${focused}`)
  await page.keyboard.press('ArrowRight')
  await page.locator('textarea[name="thought"]').focus()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
  await page.waitForSelector('text=Added. Yours to edit until collection closes.', { timeout: 10000 }).catch(async (e) => {
    console.log('DEBUG notice:', await page.locator('form p[role=status], form [role=alert]').allInnerTexts(), await page.locator('textarea[name="thought"]').inputValue())
    throw e
  })
  check('Keyboard shortcut submits; the scene answers once', (await page.locator('.journal-rise').count()) === 1)
  await page.waitForTimeout(2500)
  check('…and nothing stays animated afterwards', (await page.locator('.journal-rise').count()) === 0)
  check('The new thought appears in the collection', (await page.locator('.passage .passage-text', { hasText: 'deploy queue was quiet' }).count()) === 1)

  // ── Several mixed-length thoughts, long context.
  await entry(pia, sprint.id, 'Synthetic: pairing on the refund state machine caught a double-refund bug before release.', 'proud')
  await entry(pia, sprint.id, 'Synthetic long one: '.concat('Planning ran long because we estimated before agreeing what done means, and afterwards nobody could say the goal from memory. '.repeat(5)), 'stop', { impact: 'Synthetic context: '.concat('the first two days went to re-planning, which pushed review later and later. '.repeat(3)), might_help: 'Synthetic: write acceptance criteria before estimating.' })
  await entry(pia, sprint.id, 'Synthetic: flaky test again.')
  await page.reload()
  await page.waitForSelector('.passage')
  check('Passages: no bubble tails or per-entry toolbars', (await page.locator('.passage .icon-btn').count()) === 4 && (await page.locator('.passage button[aria-label="Edit"]').count()) === 0)
  check('“Read more” only where text is actually cut off', (await page.locator('text=Read more').count()) === 1)
  await shot(page, 'several-1440-light')

  // ── Editing in place while a new draft is in the composer: the draft is untouched.
  await page.locator('textarea[name="thought"]').fill('Synthetic draft that must survive editing another thought')
  const flaky = page.locator('.passage', { hasText: 'flaky test again' })
  await flaky.locator('button[aria-label="Options for this thought"]').focus()
  await page.keyboard.press('Enter')
  await page.waitForSelector('[role=menu]')
  check('Entry actions open from the keyboard, named', (await page.locator('[role=menuitem]', { hasText: 'Edit' }).count()) === 1 && (await page.locator('[role=menuitem]', { hasText: 'Delete from the sprint' }).count()) === 1)
  await page.locator('[role=menuitem]', { hasText: 'Edit' }).click()
  const editor = flaky.locator('textarea')
  check('Editing opens in the thought’s own place, with its text', (await editor.inputValue()) === 'Synthetic: flaky test again.')
  await editor.fill('Synthetic: flaky test again — third time this week.')
  await shot(page, 'editing-1440-light')
  await flaky.locator('button:has-text("Save changes")').click()
  await page.waitForSelector('text=third time this week')
  check('The edit saved; the composer draft is intact', (await page.inputValue('textarea[name="thought"]')) === 'Synthetic draft that must survive editing another thought')
  await page.locator('textarea[name="thought"]').fill('')

  // ── Delete with undo.
  const quiet = page.locator('.passage', { hasText: 'deploy queue was quiet' })
  await quiet.locator('button[aria-label="Options for this thought"]').click()
  await page.locator('[role=menuitem]', { hasText: 'Delete from the sprint' }).click()
  await page.waitForSelector('text=Deleted from the sprint.')
  await page.locator('button:has-text("Undo")').click()
  check('Delete can be undone', (await page.locator('.passage .passage-text', { hasText: 'deploy queue was quiet' }).count()) === 1)

  // ── Privacy lives on its own page; the composer doesn't repeat it.
  check('No privacy note or control beside the composer', (await page.locator('button.privacy-mark').count()) === 0 && !/hidden from|until collection closes;/i.test(await page.locator('form[aria-label^="Write a thought"]').innerText()))

  // ── Pending, then failed: saved offline, then collection closes before it's sent.
  await ctx.setOffline(true)
  await page.locator('textarea[name="thought"]').fill('Synthetic: queued before close')
  await page.locator('button:has-text("Add to sprint")').click()
  await page.waitForSelector('.passage[data-state="queued"]')
  check('Pending: prominent “Waiting to send”, honest about where it is', (await page.locator('.passage[data-state="queued"] >> text=Waiting to send').count()) === 1 && (await page.locator('.passage[data-state="queued"] >> text=kept in this tab').count()) === 1)
  await shot(page, 'pending-1440-light')
  await fay.req('POST', `/api/sprints/${sprint.id}/transition`, { to: 'preparing', confirm: true })
  await ctx.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await page.waitForSelector('.passage[data-state="attention"]', { timeout: 15000 })
  check('Failed: “Needs attention” with the reason, text kept', (await page.locator('text=Collection closed before this reached the sprint').count()) === 1 && (await page.locator('.passage[data-state="attention"] >> text=queued before close').count()) === 1)
  await shot(page, 'failed-1440-light')
  await ctx.close()

  // ── A larger collection, the facilitator's view, sizes and themes.
  const big = await fay.req('POST', `/api/workspaces/${ws.id}/sprints`, { name: 'Cycle 10', timezone: 'Europe/Berlin', starts_on: d(-3), ends_on: d(9), retro_date: d(10), retro_time: '10:00', participant_ids: [fay.id, pia.id], facilitator_id: fay.id, reminders_enabled: false })
  await fay.req('POST', `/api/sprints/${big.id}/transition`, { to: 'collecting' })
  const cats = ['proud', 'keep', 'improve', 'stop', 'try', null]
  for (let i = 0; i < 20; i++) await entry(fay, big.id, `Synthetic note ${i + 1}: ${['review turnaround', 'on-call handoff', 'unclear tickets', 'the staging rota'][i % 4]} ${i % 3 ? 'slowed us down a little this week' : 'went better than expected'}.`, cats[i % 6])
  ;({ ctx, page } = await pageFor(fay, { ws: ws.id }))
  await page.goto(`${BASE}/`)
  await page.waitForSelector('.passage')
  check('Facilitator: the next change sits in the sprint bar, on the same page as writing', (await page.getByRole('button', { name: 'Close collection…' }).count()) === 1 && (await page.locator('textarea[name="thought"]').count()) === 1)
  check('Large collection: paged, with compact category filters', (await page.locator('text=Show 8 more').count()) === 1 && (await page.locator('[aria-label="Show one category"] [role=radio]').count()) >= 5)
  await ctx.close()

  const sizes = [
    ['1440', { width: 1440, height: 900 }],
    ['1280x720', { width: 1280, height: 720 }],
    ['820', { width: 820, height: 1180 }],
    ['390', { width: 390, height: 844 }],
  ]
  for (const [label, viewport] of sizes)
    for (const theme of ['light', 'dark']) {
      ;({ ctx, page } = await pageFor(fay, { ws: ws.id, viewport, theme }))
      await page.goto(`${BASE}/`)
      await page.waitForSelector('.passage')
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      if (theme === 'light') check(`${label}: no horizontal overflow`, overflow <= 0, `${overflow}px`)
      await shot(page, `collection-${label}-${theme}`)
      await ctx.close()
    }

  // ── Reduced motion: same composition; a save still answers, without movement.
  ;({ ctx, page } = await pageFor(fay, { ws: ws.id, reducedMotion: 'reduce' }))
  await page.goto(`${BASE}/`)
  await page.waitForSelector('textarea[name="thought"]')
  await page.locator('textarea[name="thought"]').fill('Synthetic: reduced-motion save')
  await page.locator('button:has-text("Add to sprint")').click()
  await page.waitForSelector('text=Added. Yours to edit until collection closes.')
  const anim = await page.locator('.journal-rise').evaluate((el) => getComputedStyle(el).animationName).catch(() => '')
  check('Reduced motion: the light fades in place instead of travelling', anim === 'journal-glow', anim)
  await ctx.close()
} catch (e) {
  check('Run completed', false, e.message.split('\n')[0])
} finally {
  await browser.close()
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
