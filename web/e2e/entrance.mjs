/**
 * The entrance, end to end: the sign-in panel (one action, account creation beside it, help only
 * when asked), keyboard and focus, loading and error states, creating an account, signing out and
 * back in, old email links, invitations, reduced motion, unsupported browsers and offline — on
 * desktop and a phone, light and dark. Passkeys use Chromium's CDP virtual authenticator: real
 * WebAuthn and server, not evidence about physical devices. Synthetic names only.
 *
 * Run from web/ against a production build (`npm run build`, then wrangler dev):
 *   MUNI_URL=http://localhost:8799 node e2e/entrance.mjs     (SHOTS=dir saves screenshots)
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.MUNI_URL ?? 'http://localhost:8799'
const SHOTS = process.env.SHOTS ?? null
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const DESKTOP = { viewport: { width: 1280, height: 800 } }
const PHONE = { viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
const shot = async (page, name) => {
  if (!SHOTS) return
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${SHOTS}/${name}.png` })
}
const api = (page, method, path, body) =>
  page.evaluate(async ([m, p, b]) => {
    const csrf = document.cookie.match(/(?:^|; )(?:__Host-)?muni_csrf=([^;]+)/)?.[1] ?? ''
    const r = await fetch(p, { method: m, headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: b === undefined ? undefined : JSON.stringify(b) })
    return { status: r.status, body: await r.json().catch(() => null) }
  }, [method, path, body])

async function authenticator(page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, defaultBackupEligibility: true, defaultBackupState: true },
  })
  return {
    setVerified: (v) => cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: v }),
    credentials: async () => (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials,
    add: (credential) => cdp.send('WebAuthn.addCredential', { authenticatorId, credential }),
  }
}
async function signOut(page) {
  await page.goto(`${BASE}/`)
  await page.locator('header button').last().click()
  await page.locator('[data-radix-popper-content-wrapper] button:has-text("Sign out")').click()
  await page.getByRole('dialog').getByRole('button', { name: /^Sign out$/ }).click()
  await page.waitForURL(/\/signin/)
}
const panelText = (page) => page.locator('.entrance-side').innerText()

const browser = await chromium.launch()
try {
  // ── The panel: hierarchy, restraint, width, keyboard, focus (desktop, light).
  {
    const ctx = await browser.newContext(DESKTOP)
    const page = await ctx.newPage()
    await page.goto(`${BASE}/signin`)
    const cta = page.getByRole('button', { name: 'Continue with a passkey' })
    await cta.waitFor()
    check('Heading: “Welcome back.”', (await page.locator('.entrance-step h1').innerText()) === 'Welcome back.')
    const text = await panelText(page)
    check('No introductory paragraph, email, password or biometric explanation by default', !/email|password|fingerprint|biometric/i.test(text), text.replace(/\s+/g, ' ').slice(0, 160))
    check('“New to Muni? Create an account” is visible', await page.getByRole('button', { name: 'Create an account' }).isVisible())
    check('“Need help signing in?” is present and closed', (await page.locator('details.entrance-help').evaluate((d) => !d.open)) && (await page.locator('summary', { hasText: 'Need help signing in?' }).isVisible()))
    check('Footer: only “Privacy & data” and “What is Muni?”', (await page.locator('.entrance-footer').innerText()).replace(/\s+/g, ' ').trim() === 'Privacy & data What is Muni?')
    const step = await page.locator('.entrance-auth > .entrance-step').boundingBox()
    const side = await page.locator('.entrance-side').boundingBox()
    check('Comfortable reading width (≤ 420 px), centred in the panel', step.width <= 420 && Math.abs(step.x + step.width / 2 - (side.x + side.width / 2)) < 40, `${Math.round(step.width)} px`)
    const help = await page.locator('summary', { hasText: 'Need help signing in?' }).evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    const create = await page.locator('.entrance-new').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    check('Help is visually secondary to “Create an account”', help < create, `${help}px vs ${create}px`)
    await shot(page, 'signin-desktop-light')
    // Keyboard: the primary action first, then account creation, then help; focus is visible.
    await page.keyboard.press('Tab')
    const order = []
    for (let i = 0; i < 6; i++) {
      const f = await page.evaluate(() => ({ text: document.activeElement?.textContent?.trim() ?? '', outline: getComputedStyle(document.activeElement).outlineStyle }))
      order.push(f)
      await page.keyboard.press('Tab')
    }
    const labels = order.map((o) => o.text)
    const iCta = labels.findIndex((t) => t === 'Continue with a passkey')
    const iNew = labels.findIndex((t) => t === 'Create an account')
    const iHelp = labels.findIndex((t) => t === 'Need help signing in?')
    check('Tab order: passkey → create an account → help', iCta >= 0 && iCta < iNew && iNew < iHelp, labels.slice(0, 4).join(' | '))
    const focused = order.filter((o) => ['Continue with a passkey', 'Create an account', 'Need help signing in?'].includes(o.text))
    check('Focus is visible on each', focused.length === 3 && focused.every((o) => o.outline !== 'none'))
    await page.locator('summary', { hasText: 'Need help signing in?' }).focus()
    await page.keyboard.press('Enter')
    const openText = await page.locator('details.entrance-help').innerText()
    check('Help opens from the keyboard and covers passkeys, other devices, cancelling, accounts, losing a passkey, browsers', ['What’s a passkey?', 'Passkey on your phone?', 'Cancelled', 'More than one account?', 'Lost your passkey?', 'Which browsers?'].every((t) => openText.includes(t)))
    check('Help promises no recovery that doesn’t exist', !/email|reset|support will/i.test(openText))
    await shot(page, 'signin-desktop-help')
    await ctx.close()
  }

  // ── Dark, and a phone: the primary action in reach without scrolling.
  for (const [name, opts] of [['signin-desktop-dark', { ...DESKTOP, colorScheme: 'dark' }], ['signin-phone-light', { ...PHONE }], ['signin-phone-dark', { ...PHONE, colorScheme: 'dark' }]]) {
    const ctx = await browser.newContext(opts)
    const page = await ctx.newPage()
    await page.goto(`${BASE}/signin`)
    await page.getByRole('button', { name: 'Continue with a passkey' }).waitFor()
    if (name.includes('phone')) {
      const b = await page.getByRole('button', { name: 'Continue with a passkey' }).boundingBox()
      check(`${name}: the passkey button is on screen without scrolling, and ≥ 44 px tall`, b.y + b.height <= 740 && b.height >= 44, JSON.stringify(b))
      check(`${name}: no sideways scroll`, (await page.evaluate(() => document.documentElement.scrollWidth)) <= 375)
    }
    await shot(page, name)
    await ctx.close()
  }

  // ── The phone page: the line, the evening and the action together on the first screen, from a
  // small phone to an upright tablet and a phone on its side (emulated viewports, not devices).
  for (const [w, h] of [[320, 568], [360, 640], [390, 664], [390, 844], [430, 932], [768, 1024], [844, 390], [667, 375]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    await page.goto(`${BASE}/signin`)
    const cta = page.getByRole('button', { name: 'Continue with a passkey' })
    await cta.waitFor()
    const b = await cta.boundingBox()
    const line = await page.locator('.entrance-headline').boundingBox()
    const scene = await page.locator('.entrance-scene').boundingBox()
    // Upright the evening sits between the line and the action; on its side, beside them.
    const order = h > w ? scene.y + scene.height <= b.y + 1 : scene.x + scene.width <= b.x + 1
    check(`${w}×${h}: headline, evening and passkey button all on the first screen`, line.y >= 0 && scene.height >= 120 && scene.y + scene.height <= h + 1 && order && b.y + b.height <= h, `scene ${Math.round(scene.height)} px, button ends at ${Math.round(b.y + b.height)}`)
    check(`${w}×${h}: no sideways scroll`, (await page.evaluate(() => document.documentElement.scrollWidth)) <= w)
    await ctx.close()
  }

  // ── The phone page, closely (390×844): one composition, not a card; full-size targets; nothing
  // above moves when help opens or feedback appears; the evening comes to rest.
  {
    const ctx = await browser.newContext(PHONE)
    const page = await ctx.newPage()
    await authenticator(page)
    await page.goto(`${BASE}/signin`)
    const cta = page.getByRole('button', { name: 'Continue with a passkey' })
    await cta.waitFor()
    const greeting = page.getByRole('heading', { name: 'Welcome back.' })
    check('Phone: “Welcome back.” is the page’s heading for screen readers, not shown', (await greeting.count()) === 1 && (await greeting.boundingBox()).width <= 1)
    const panel = await page.locator('.entrance-auth').evaluate((el) => { const s = getComputedStyle(el); return { border: s.borderTopWidth, bg: s.backgroundColor } })
    check('Phone: no card around the actions', panel.border === '0px' && panel.bg === 'rgba(0, 0, 0, 0)', JSON.stringify(panel))
    const sizes = await page.evaluate(() => ({ line: parseFloat(getComputedStyle(document.querySelector('.entrance-headline')).fontSize), soft: parseFloat(getComputedStyle(document.querySelector('.entrance-headline .soft')).fontSize) }))
    check('Phone: one headline, the second sentence as its subtitle', sizes.line >= 2 * sizes.soft, `${sizes.line}px / ${sizes.soft}px`)
    const targets = await page.evaluate(() => [...document.querySelectorAll('.entrance-new .entrance-link, .entrance-help summary, .entrance-footer a')].map((el) => [el.textContent.trim(), Math.round(el.getBoundingClientRect().height)]))
    check('Phone: “Create an account”, help and footer links are ≥ 44 px tall targets', targets.length === 4 && targets.every(([, hgt]) => hgt >= 44), targets.map(([t, hgt]) => `${t} ${hgt}`).join(', '))
    const art = await page.evaluate(() => ({ upright: !!document.querySelector('.entrance svg.scene--upright[aria-hidden]'), filters: document.querySelectorAll('.entrance feTurbulence, .entrance feDisplacementMap').length, uses: document.querySelectorAll('.entrance svg.scene use').length }))
    check('Phone: its own composition, decorative, with no filters and no <use> copies', art.upright && art.filters === 0 && art.uses === 0, JSON.stringify(art))
    // Positions on the page, not in the window: clicking may scroll. After the step's own 260 ms rise.
    await page.waitForTimeout(400)
    const top = () => cta.evaluate((el) => Math.round(el.getBoundingClientRect().top + window.scrollY))
    const y0 = await top()
    await page.locator('summary', { hasText: 'Need help signing in?' }).click()
    const y1 = await top()
    await page.locator('summary', { hasText: 'Need help signing in?' }).click()
    await cta.click()
    await page.waitForSelector('text=No passkey was used')
    const y2 = await top()
    check('Phone: opening help or a message moves nothing above it', y0 === y1 && y0 === y2, `${y0} → ${y1} → ${y2}`)
    await shot(page, 'signin-phone-cancelled')
    await page.waitForTimeout(8500)
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').map((a) => a.animationName))
    check('Phone: the evening comes to rest (one rock of the duyan, then nothing moves)', running.length === 0, running.join(', '))
    await ctx.close()
  }

  // ── Create an account, then sign out and back in (desktop): loading, cancel, retry, next.
  {
    const ctx = await browser.newContext(DESKTOP)
    const page = await ctx.newPage()
    const va = await authenticator(page)
    await page.goto(`${BASE}/signin?next=%2Faccount`)
    await page.getByRole('button', { name: 'Create an account' }).click()
    await page.waitForSelector('text=Create your account.')
    check('Create account: concise — a name, one action, no email', (await page.locator('input[type=email]').count()) === 0 && (await page.locator('.entrance-step').innerText()).length < 260)
    await shot(page, 'create-account')
    await page.getByRole('button', { name: 'Create with a passkey' }).click()
    check('An empty name gets a clear message, focus stays in the field', (await page.locator('[role=alert]').innerText()).includes('Enter the name') && (await page.evaluate(() => document.activeElement?.getAttribute('autocomplete'))) === 'name')
    await page.fill('input[autocomplete="name"]', 'Nia Newcomer')
    await page.getByRole('button', { name: 'Create with a passkey' }).click()
    await page.waitForSelector('text=Welcome, Nia Newcomer.')
    check('After creating: a second passkey is offered, “Not now” available', await page.getByRole('button', { name: 'Not now' }).isVisible())
    await shot(page, 'second-passkey')
    await page.getByRole('button', { name: 'Not now' }).click()
    await page.waitForURL((u) => !u.pathname.startsWith('/signin'))
    // A new account meets the character chooser first (e2e/worlds.mjs covers it).
    // A new account's first evening: past the prologue, and the guide hidden (e2e/firstrun.mjs covers it).
    await page.locator('.prologue-skip').click({ timeout: 8000 }).catch(() => {})
    await page.locator('button:has-text("Decide later")').click({ timeout: 5000 }).catch(() => {})
    await page.evaluate(() => fetch('/api/auth/me', { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-csrf-token': decodeURIComponent((document.cookie.match(/__Host-muni_csrf=([^;]+)/) ?? document.cookie.match(/muni_csrf=([^;]+)/))?.[1] ?? '') }, body: JSON.stringify({ guide: 'hidden' }) })).catch(() => {})
    await page.reload()
    const me = (await api(page, 'GET', '/api/auth/me')).body
    check('The account exists with one passkey and no email', me.passkeys === 1 && me.email === null)

    await signOut(page)
    await page.getByRole('button', { name: 'Continue with a passkey' }).waitFor()
    // Loading: the button says it's busy while the ceremony runs.
    await page.route('**/api/auth/passkey/login/options', async (r) => {
      await new Promise((res) => setTimeout(res, 800))
      await r.continue()
    })
    await va.setVerified(false)
    await page.getByRole('button', { name: 'Continue with a passkey' }).click()
    check('Loading: the passkey button is busy while it waits', (await page.getByRole('button', { name: 'Continue with a passkey' }).getAttribute('aria-busy')) === 'true')
    await page.waitForSelector('text=No passkey was used')
    check('Cancelled: calm guidance, not an error', (await page.locator('[role=alert]').count()) === 0 && (await page.locator('[role=status]', { hasText: 'No passkey was used' }).count()) === 1)
    await shot(page, 'signin-cancelled')
    await page.unroute('**/api/auth/passkey/login/options')
    await va.setVerified(true)
    await page.goto(`${BASE}/signin?next=%2Faccount`)
    await page.getByRole('button', { name: 'Continue with a passkey' }).click()
    await page.waitForURL((u) => u.pathname === '/account', { timeout: 15000 })
    check('Retry signs in to the same account and goes on to “next”', (await api(page, 'GET', '/api/auth/me')).body.account_id === me.account_id)
    check('A signed-in visit to /signin goes straight on', await page.goto(`${BASE}/signin`).then(() => page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 5000 }).then(() => true, () => false)))

    // A passkey Muni no longer knows: a specific message, as an error.
    await signOut(page)
    const creds = await va.credentials()
    const ghost = await browser.newContext(DESKTOP)
    const gp = await ghost.newPage()
    const gva = await authenticator(gp)
    await gva.add({ ...creds[0], credentialId: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'), userHandle: Buffer.from('nobody-here').toString('base64') })
    await gp.goto(`${BASE}/signin`)
    await gp.getByRole('button', { name: 'Continue with a passkey' }).click()
    await gp.waitForSelector('[role=alert]')
    check('Unknown passkey: says so, and what to do', /isn’t linked to a Muni account|couldn’t be verified/.test(await gp.locator('[role=alert]').innerText()), await gp.locator('[role=alert]').innerText())
    await ghost.close()
    await ctx.close()
  }

  // ── Signing in is a passkey, never an address; invitations.
  {
    const ctx = await browser.newContext(DESKTOP)
    const page = await ctx.newPage()
    await page.goto(`${BASE}/signin`)
    await page.getByRole('button', { name: 'Continue with a passkey' }).waitFor()
    check('Sign-in asks for a passkey, never an email address', (await page.locator('input[type=email]').count()) === 0)
    await page.goto(`${BASE}/invite#not-a-real-token`)
    await page.waitForSelector('text=This invitation can’t be used.')
    check('Unknown invitation: a clear outcome', true)
    await ctx.close()
  }

  // ── Reduced motion, unsupported browser, offline.
  {
    const ctx = await browser.newContext({ ...DESKTOP, reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await page.goto(`${BASE}/signin`)
    await page.getByRole('button', { name: 'Continue with a passkey' }).waitFor()
    check('Reduced motion: the step doesn’t animate, the scene is still', (await page.locator('.entrance-step').evaluate((el) => getComputedStyle(el).animationName)) === 'none' && (await page.locator('.scene-duyan').evaluate((el) => getComputedStyle(el).animationName)) === 'none')
    await ctx.close()

    const u = await browser.newContext(DESKTOP)
    await u.addInitScript(() => {
      delete window.PublicKeyCredential
    })
    const up = await u.newPage()
    await up.goto(`${BASE}/signin`)
    await up.waitForSelector('text=This browser can’t use passkeys.')
    check('Unsupported browser: says so plainly, points to supported browsers, no other way in', (await up.getByRole('button', { name: 'Continue with a passkey' }).count()) === 0 && !/email/i.test(await panelText(up)))
    await shot(up, 'signin-unsupported')
    await u.close()

    const o = await browser.newContext(DESKTOP)
    const op = await o.newPage()
    await authenticator(op)
    await op.goto(`${BASE}/signin`)
    await op.getByRole('button', { name: 'Continue with a passkey' }).waitFor()
    await o.setOffline(true)
    await op.getByRole('button', { name: 'Continue with a passkey' }).click()
    await op.waitForSelector('[role=alert]')
    check('Offline: an honest message', /offline/i.test(await op.locator('[role=alert]').innerText()))
    await o.close()
  }
} catch (e) {
  check('run completed', false, String(e?.stack ?? e).split('\n').slice(0, 3).join(' '))
} finally {
  await browser.close()
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
