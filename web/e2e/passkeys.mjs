/**
 * End-to-end: sign-out, sessions, passkeys and QR team invitations in real Chromium, against a
 * local `wrangler dev` over HTTPS (so cookies carry the production `__Host-` prefix):
 *
 *   cd worker && npx wrangler dev --local-protocol https --port 8793 --var PUBLIC_ORIGIN:https://localhost:8793
 *   cd web && MUNI_URL=https://localhost:8793 node e2e/passkeys.mjs
 *
 * Passkeys use Chromium's CDP virtual authenticator. That exercises the real browser WebAuthn API
 * and the server, but it is NOT evidence of compatibility with physical devices or password
 * managers. Synthetic addresses only. Screenshots go to e2e-artifacts/passkeys/.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.MUNI_URL ?? 'https://localhost:8793'
const OUT = new URL('../e2e-artifacts/passkeys/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const addr = (p) => `${p}-${crypto.randomUUID().slice(0, 8)}@example.test`
// Steps fade in; let them settle before capturing.
const shot = async (page, name) => { await page.waitForTimeout(900); await page.screenshot({ path: `${OUT}${name}.png` }) }
const DESKTOP = { width: 1280, height: 800 }
const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }

const browser = await chromium.launch()
const newCtx = (opts = {}) => browser.newContext({ ignoreHTTPSErrors: true, viewport: DESKTOP, ...opts })

async function inbox(page, email, re) {
  for (let i = 0; i < 20; i++) {
    const m = await page.evaluate(async ([e, r]) => (await fetch('/api/dev/inbox').then((x) => x.json())).find((x) => x.to === e && new RegExp(r).test(x.subject)), [email, re.source])
    if (m) return m
    await page.waitForTimeout(250)
  }
  throw new Error(`no mail for ${email}`)
}
/** Email → code (→ name), through the UI. */
async function emailSignIn(page, email, name) {
  await page.fill('input[type=email]', email)
  await page.click('button:has-text("Send me a code")')
  await page.waitForSelector('text=Check your inbox.')
  await page.fill('input[autocomplete="one-time-code"]', (await inbox(page, email, /sign-in code/)).subject.split(' ')[0])
  await page.click('button:has-text("Continue")')
  if (name) {
    await page.waitForSelector('text=What should we call you?')
    await page.fill('input[autocomplete="name"]', name)
    await page.click('button:has-text("Continue")')
  }
}
async function virtualAuthenticator(page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  })
  return { cdp, id: authenticatorId, setVerified: (v) => cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: v }), credentials: async () => (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials }
}
const api = (page, method, path, body) =>
  page.evaluate(async ([m, p, b]) => {
    const csrf = document.cookie.match(/(?:^|; )__Host-muni_csrf=([^;]+)/)?.[1] ?? document.cookie.match(/(?:^|; )muni_csrf=([^;]+)/)?.[1]
    const r = await fetch(p, { method: m, headers: { 'content-type': 'application/json', 'x-csrf-token': csrf ?? '' }, body: b === undefined ? undefined : JSON.stringify(b) })
    return { status: r.status, body: await r.json().catch(() => null) }
  }, [method, path, body])

// ------------------------------------------------------------------ 1. sign-out with a leftover pre-prefix cookie

{
  const ctx = await newCtx()
  // A pilot browser: the readable CSRF cookie from before the __Host- prefix is still there.
  await ctx.addCookies([{ name: 'muni_csrf', value: 'LEGACYstaleToken', domain: 'localhost', path: '/', secure: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 86400 * 20 }])
  const page = await ctx.newPage()
  await page.goto(`${BASE}/signin`)
  const email = addr('signout')
  await emailSignIn(page, email, 'Sam Signout')
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'))
  const cookies = (await ctx.cookies()).map((c) => c.name)
  check('legacy cookie is expired by the server on the next response', !cookies.includes('muni_csrf'), cookies.join(','))
  // A second and third device on the same account.
  const other = await newCtx()
  const op = await other.newPage()
  await op.goto(`${BASE}/signin`)
  await page.waitForTimeout(31_000) // resend cooldown for the same address
  await emailSignIn(op, email)
  await op.waitForURL((u) => !u.pathname.startsWith('/signin'))
  const third = await newCtx()
  const tp = await third.newPage()
  await tp.goto(`${BASE}/signin`)
  await page.waitForTimeout(31_000) // resend cooldown for the same address
  await emailSignIn(tp, email)
  await tp.waitForURL((u) => !u.pathname.startsWith('/signin'))

  await page.goto(`${BASE}/account#sessions`)
  await page.waitForSelector('text=Signed-in sessions')
  await page.waitForSelector('button:has-text("Sign out everywhere else")')
  const listed = await page.locator('#sessions li').count()
  await shot(page, '01-sessions-before')
  await page.click('button:has-text("Sign out everywhere else")')
  await page.waitForSelector('text=Signed out everywhere else')
  await page.waitForFunction(() => document.querySelectorAll('#sessions li').length === 1)
  check('“Sign out everywhere else” ends the others and the list reloads from the server', listed === 3, `listed ${listed} before, 1 after`)
  check('a signed-out device is refused by the server', (await api(op, 'GET', '/api/auth/me')).status === 401)
  await shot(page, '02-sessions-after')

  // Sign out of this device from the account menu.
  await page.goto(`${BASE}/account`)
  await page.locator('header button').last().click()
  await page.click('button:has-text("Sign out")')
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out' }).click()
  await page.waitForURL(/\/signin/)
  check('sign-out works with a leftover legacy cookie present', true)
  await page.reload()
  await page.waitForSelector('text=A moment to reflect.')
  const another = await ctx.newPage()
  await another.goto(`${BASE}/`)
  await another.waitForURL(/\/signin/)
  check('refreshing and opening another tab stay signed out', true)
  await Promise.all([ctx.close(), other.close(), third.close()])
}

// ------------------------------------------------------------------ 2. signing out while Muni can't be reached

{
  const ctx = await newCtx()
  const page = await ctx.newPage()
  await page.goto(`${BASE}/signin`)
  await emailSignIn(page, addr('offline'), 'Olive Offline')
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'))
  await page.waitForTimeout(500)
  const session = (await ctx.cookies()).find((c) => c.name === '__Host-muni_session').value
  const second = await ctx.newPage()
  await second.goto(`${BASE}/account`)
  await second.waitForSelector('text=Signed-in sessions')
  await ctx.setOffline(true)
  await page.locator('header button').last().click()
  await page.click('button:has-text("Sign out")')
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out' }).click()
  await page.waitForSelector('text=can’t be reached')
  await shot(page, '03-signout-offline')
  check('offline sign-out explains what happened and removes nothing yet', await page.locator('button:has-text("Sign out on this device")').isVisible())
  await page.click('button:has-text("Sign out on this device")')
  await page.waitForURL(/\/signin/)
  await second.waitForSelector('text=Your session ended', { timeout: 5000 }).then(() => check('other open tabs stop acting as the account (unsent text kept)', true)).catch(() => check('other open tabs stop acting as the account (unsent text kept)', false))
  await ctx.setOffline(false)
  const fresh = await ctx.newPage()
  await fresh.goto(`${BASE}/`)
  await fresh.waitForURL(/\/signin/)
  check('back online, a new tab stays signed out', true)
  await fresh.waitForTimeout(1000)
  // Present the old session cookie from a fresh browser: the server must refuse it now.
  const probeCtx = await newCtx()
  await probeCtx.addCookies([{ name: '__Host-muni_session', value: session, domain: 'localhost', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }])
  const pp = await probeCtx.newPage()
  await pp.goto(`${BASE}/privacy`)
  const probe = await pp.evaluate(() => fetch('/api/auth/me').then((r) => r.status))
  check('the pending sign-out reached the server (the old session is revoked)', probe === 401, String(probe))
  await probeCtx.close()
  await ctx.close()
}

// ------------------------------------------------------------------ 3. passkeys

let passkeyEmail
{
  const ctx = await newCtx()
  const page = await ctx.newPage()
  const va = await virtualAuthenticator(page)
  await page.goto(`${BASE}/signin`)
  check('email field offers passkey autofill (conditional UI)', (await page.getAttribute('input[type=email]', 'autocomplete')) === 'username webauthn')
  await shot(page, '04-entrance-desktop')
  passkeyEmail = addr('pk')
  await emailSignIn(page, passkeyEmail, 'Pat Passkey')
  await page.waitForSelector('text=Skip the code next time?')
  await shot(page, '05-offer-passkey')
  await page.click('button:has-text("Add a passkey")')
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'))
  const creds = await va.credentials()
  check('existing account adds a passkey after an email sign-in', creds.length === 1 && creds[0].isResidentCredential)
  const me = await api(page, 'GET', '/api/auth/me')
  check('same account, one passkey', me.body.passkeys === 1)
  // The user handle the authenticator stored is opaque: not the email, not the account id.
  const handle = Buffer.from(creds[0].userHandle, 'base64').toString('utf8')
  check('user handle holds no email or account id', !handle.includes('@') && !handle.includes(me.body.account_id))

  // Sign out, then return with the passkey.
  await page.locator('header button').last().click()
  await page.click('button:has-text("Sign out")')
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out' }).click()
  await page.waitForSelector('text=Welcome back.')
  await shot(page, '06-return-passkey-first')
  // Cancelled (the authenticator refuses verification, as when someone dismisses the prompt).
  await va.setVerified(false)
  await page.click('button:has-text("Continue with a passkey")')
  await page.waitForSelector('text=No passkey was used')
  await shot(page, '07-passkey-cancelled')
  check('a cancelled ceremony gets calm, actionable copy', true)
  await va.setVerified(true)
  await page.click('button:has-text("Continue with a passkey")')
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'))
  check('returning with a passkey signs in', (await api(page, 'GET', '/api/auth/me')).body.auth_method === 'passkey')

  // Account security area.
  await page.goto(`${BASE}/account#sign-in`)
  await page.waitForSelector('text=Passkeys')
  await page.waitForSelector('#sign-in li')
  await shot(page, '08-account-security')
  await page.click('button:has-text("Add another passkey")')
  await page.waitForSelector('text=already has a passkey for your account')
  check('adding the same authenticator twice is refused kindly', (await va.credentials()).length === 1)
  await page.click('[aria-label^="Manage"]')
  await page.click('button:has-text("Rename")')
  await page.fill('#pk-name', 'Work laptop')
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await page.waitForSelector('text=Work laptop')
  check('rename a passkey', true)
  await page.setViewportSize(MOBILE.viewport)
  await page.goto(`${BASE}/account#sign-in`)
  await page.waitForSelector('text=Work laptop')
  await shot(page, '09-account-security-mobile')
  await page.setViewportSize(DESKTOP)

  // Draft kept through a session ending and a passkey sign-in.
  const ws = await api(page, 'POST', '/api/workspaces', { name: 'Draft team' })
  const d = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
  const sp = await api(page, 'POST', `/api/workspaces/${ws.body.id}/sprints`, { name: 'Sprint D', timezone: 'UTC', starts_on: d(-3), ends_on: d(9), retro_date: d(10), retro_time: '10:00', participant_ids: [me.body.account_id], facilitator_id: me.body.account_id, reminders_enabled: false })
  await api(page, 'POST', `/api/sprints/${sp.body.id}/transition`, { to: 'collecting', confirm: true })
  await page.goto(`${BASE}/`)
  const box = page.locator('textarea').first()
  await box.waitFor()
  await box.fill('Synthetic draft: pairing on refunds helped')
  // The session ends elsewhere (another device signs everything else out).
  const other = await newCtx()
  const op = await other.newPage()
  await op.goto(`${BASE}/signin`)
  const va2 = await virtualAuthenticator(op)
  void va2
  await page.waitForTimeout(31_000)
  await emailSignIn(op, passkeyEmail)
  await op.waitForURL((u) => !u.pathname.startsWith('/signin'))
  await api(op, 'POST', '/api/auth/logout-others')
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await page.waitForSelector('text=Your session ended')
  await page.click('button:has-text("Sign in")')
  await page.click('button:has-text("Continue with a passkey")')
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'))
  const kept = await page.locator('textarea').first().inputValue()
  check('a draft survives the session ending and a passkey sign-in', kept.includes('pairing on refunds'), kept.slice(0, 40))
  await Promise.all([ctx.close(), other.close()])
}

// ------------------------------------------------------------------ 4. no WebAuthn in this browser

{
  const ctx = await newCtx()
  await ctx.addInitScript(() => {
    delete window.PublicKeyCredential
  })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/signin`)
  await page.waitForSelector('text=A moment to reflect.')
  check('without WebAuthn there is no passkey button; email still works', (await page.locator('button:has-text("Continue with a passkey")').count()) === 0)
  await ctx.close()
}

// ------------------------------------------------------------------ 5. QR invitations with approval

{
  const owner = await newCtx()
  const op = await owner.newPage()
  await op.goto(`${BASE}/signin`)
  await emailSignIn(op, addr('qr-owner'), 'Olivia Owner')
  await op.waitForURL((u) => !u.pathname.startsWith('/signin'))
  const me = await api(op, 'GET', '/api/auth/me')
  const ws = await api(op, 'POST', '/api/workspaces', { name: 'Falcon team' })
  const d = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
  const sp = await api(op, 'POST', `/api/workspaces/${ws.body.id}/sprints`, { name: 'Sprint 12', timezone: 'UTC', starts_on: d(-3), ends_on: d(9), retro_date: d(10), retro_time: '10:00', participant_ids: [me.body.account_id], facilitator_id: me.body.account_id, reminders_enabled: false })
  await api(op, 'POST', `/api/sprints/${sp.body.id}/transition`, { to: 'collecting', confirm: true })
  await op.goto(`${BASE}/workspaces/${ws.body.id}/people`)
  await op.click('button:has-text("Show invite QR")')
  await op.waitForSelector('text=Who can join?')
  await op.selectOption('select >> nth=0', { label: 'Sprint 12 (sprint)' })
  await shot(op, '10-qr-options')
  const [created] = await Promise.all([op.waitForResponse((r) => r.url().endsWith('/join-links') && r.request().method() === 'POST'), op.click('button:has-text("Show invite QR")>>nth=-1')])
  const { url } = await created.json()
  await op.waitForSelector('svg[aria-label^="Invite QR code"]')
  await shot(op, '11-qr-shown')
  check('the QR encodes an ordinary https link with the token in the fragment', /^https:\/\/localhost:8793\/join#[A-Za-z0-9_-]{43}$/.test(url))

  // A new person scans it on a phone.
  const joiner = await newCtx(MOBILE)
  const jp = await joiner.newPage()
  const jva = await virtualAuthenticator(jp)
  void jva
  await jp.goto(url)
  await jp.waitForSelector('text=You’re invited to a team.')
  await shot(jp, '12-join-doors-mobile')
  const referrers = []
  jp.on('request', (r) => r.headers().referer && referrers.push(r.headers().referer))
  await jp.click('button:has-text("I’m new to Muni")')
  await emailSignIn(jp, addr('qr-joiner'), 'Jo Joiner')
  await jp.waitForSelector('text=Skip the code next time?')
  await jp.click('button:has-text("Add a passkey")')
  await jp.waitForSelector('text=Join Falcon team?')
  await shot(jp, '13-request-mobile')
  await jp.click('button:has-text("Request to join")')
  await jp.waitForSelector('text=Waiting for approval.')
  await shot(jp, '14-waiting-mobile')
  check('the token never appears in a Referer header', !referrers.some((r) => r.includes('#') || r.includes(url.split('#')[1])))
  // No access before approval.
  check('no access before approval', (await api(jp, 'GET', `/api/sprints/${sp.body.id}`)).status >= 403)

  // The request appears in the owner's open QR dialog; they approve.
  await op.waitForSelector('text=Jo Joiner', { timeout: 30_000 })
  await shot(op, '15-approve-desktop')
  await op.click('button:has-text("Approve")')
  await op.waitForSelector('text=Jo Joiner joined')
  await jp.waitForSelector('text=You’re in.', { timeout: 30_000 })
  await shot(jp, '16-approved-mobile')
  await jp.click('button:has-text("Continue")')
  await jp.waitForURL(new RegExp(`/sprints/${sp.body.id}`))
  check('approved: straight on to the sprint', true)

  // Someone else asks; the owner declines.
  const other = await newCtx()
  const xp = await other.newPage()
  await xp.goto(url)
  await xp.click('button:has-text("I’m new to Muni")')
  await emailSignIn(xp, addr('qr-screenshot'), 'Screenshot Sam')
  await xp.waitForSelector('text=Skip the code next time?').then(() => xp.click('button:has-text("Not now")')).catch(() => {})
  await xp.click('button:has-text("Request to join")')
  await xp.waitForSelector('text=Waiting for approval.')
  await op.waitForSelector('text=Screenshot Sam', { timeout: 30_000 })
  await op.locator('li', { hasText: 'Screenshot Sam' }).locator('button:has-text("Decline")').click()
  await xp.waitForSelector('text=wasn’t approved', { timeout: 30_000 })
  check('a declined request says so, and grants nothing', (await api(xp, 'GET', '/api/auth/me')).body.workspaces.length === 0)

  // An existing member of Muni scans with “I already use Muni” and a passkey.
  const back = await newCtx()
  const bp = await back.newPage()
  const bva = await virtualAuthenticator(bp)
  await bp.goto(`${BASE}/signin`)
  const bEmail = addr('qr-existing')
  await emailSignIn(bp, bEmail, 'Eve Existing')
  await bp.waitForSelector('text=Skip the code next time?')
  await bp.click('button:has-text("Add a passkey")')
  await bp.waitForURL((u) => !u.pathname.startsWith('/signin'))
  await bp.evaluate(async () => { const csrf = document.cookie.match(/__Host-muni_csrf=([^;]+)/)[1]; await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-csrf-token': csrf } }) })
  await bp.goto(url)
  await bp.click('button:has-text("I already use Muni")')
  await bp.waitForSelector('text=Welcome back.')
  await bp.click('button:has-text("Continue with a passkey")')
  await bp.waitForSelector('text=Join Falcon team?')
  check('an existing account joins via “I already use Muni” with a passkey — no second account', (await bva.credentials()).length === 1)
  await Promise.all([owner.close(), joiner.close(), other.close(), back.close()])
}

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map((f) => f.name).join('; ')}` : ''}`)
process.exit(failed.length ? 1 : 0)
