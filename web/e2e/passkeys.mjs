/**
 * End-to-end: passkeys as the only way in (the entrance, a new account, the help, email sign-in
 * gone), invitations (team QR with approval, personal single-use links, emailed invitation
 * links), sign-out and sessions — in real Chromium, against a local
 * `wrangler dev` over HTTPS (so cookies carry the production `__Host-` prefix):
 *
 *   cd worker && npx wrangler dev --local-protocol https --port 8793 --var PUBLIC_ORIGIN:https://localhost:8793
 *   cd web && MUNI_URL=https://localhost:8793 node e2e/passkeys.mjs
 *
 * Passkeys use Chromium's CDP virtual authenticator. That exercises the real browser WebAuthn API
 * and the server, but it is NOT evidence of compatibility with physical devices, password managers
 * or installed-app modes. Synthetic names and addresses only. Screenshots: e2e-artifacts/passkeys/.
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
/** A new account: name, then a passkey (the page must have a virtual authenticator). */
async function createAccount(page, name, { protect = 'skip' } = {}) {
  await page.click('button:has-text("Create an account")')
  await page.fill('input[autocomplete="name"]', name)
  await page.click('button:has-text("Create with a passkey")')
  await page.waitForSelector('text=Add a second passkey')
  if (protect === 'skip') await page.click('button:has-text("Not now")')
}
async function virtualAuthenticator(page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    // Backup-eligible, like the synced passkeys of iCloud Keychain or Google Password Manager.
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, defaultBackupEligibility: true, defaultBackupState: true },
  })
  return {
    setVerified: (v) => cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: v }),
    credentials: async () => (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials,
    add: (credential) => cdp.send('WebAuthn.addCredential', { authenticatorId, credential }),
  }
}
const api = (page, method, path, body) =>
  page.evaluate(async ([m, p, b]) => {
    const csrf = document.cookie.match(/(?:^|; )__Host-muni_csrf=([^;]+)/)?.[1] ?? document.cookie.match(/(?:^|; )muni_csrf=([^;]+)/)?.[1]
    const r = await fetch(p, { method: m, headers: { 'content-type': 'application/json', 'x-csrf-token': csrf ?? '' }, body: b === undefined ? undefined : JSON.stringify(b) })
    return { status: r.status, body: await r.json().catch(() => null) }
  }, [method, path, body])
const out = (page) => page.waitForURL((u) => !u.pathname.startsWith('/signin'))
async function signOut(page) {
  await page.locator('header button').last().click()
  await page.click('button:has-text("Sign out")')
  await page.getByRole('dialog').getByRole('button', { name: /Sign out/ }).click()
}
async function teamWithSprint(page, name) {
  const me = await api(page, 'GET', '/api/auth/me')
  const ws = await api(page, 'POST', '/api/workspaces', { name })
  const d = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
  const sp = await api(page, 'POST', `/api/workspaces/${ws.body.id}/sprints`, { name: 'Sprint 12', timezone: 'UTC', starts_on: d(-3), ends_on: d(9), retro_date: d(10), retro_time: '10:00', participant_ids: [me.body.account_id], facilitator_id: me.body.account_id, reminders_enabled: false })
  await api(page, 'POST', `/api/sprints/${sp.body.id}/transition`, { to: 'collecting', confirm: true })
  return { ws: ws.body.id, sprint: sp.body.id, me: me.body }
}

// ------------------------------------------------------------------ 1. the entrance, a new account, signing out and back in

let firstCredential
{
  const ctx = await newCtx()
  const page = await ctx.newPage()
  const va = await virtualAuthenticator(page)
  const starts = []
  page.on('request', (r) => r.url().includes('/api/auth/passkey/') && starts.push(r.url()))
  await page.goto(`${BASE}/signin`)
  await page.waitForSelector('button:has-text("Continue with a passkey")')
  check('sign-in: one primary action, no email or username field', (await page.locator('input[type=email], input[autocomplete~="username"]').count()) === 0)
  check('sign-in: nothing starts a passkey prompt by itself', starts.length === 0)
  check('sign-in: no email path anywhere', (await page.locator('text=/email/i').count()) === 0)
  await page.click('summary:has-text("Need help signing in?")')
  check('help explains passkeys, other devices, cancelling, accounts and losing a passkey', (await page.locator('text=use a phone or tablet').count()) > 0 && (await page.locator('text=More than one account?').count()) === 1 && (await page.locator('text=Lost your passkey?').count()) === 1)
  await shot(page, '01-signin-desktop-help')

  await page.click('button:has-text("Create an account")')
  await page.waitForSelector('text=Create your account.')
  check('create account: asks only for a name — no email', (await page.locator('input[type=email]').count()) === 0)
  await shot(page, '02-create-account')
  await page.fill('input[autocomplete="name"]', 'Pia Passkey')
  await page.click('button:has-text("Create with a passkey")')
  await page.waitForSelector('text=Welcome, Pia Passkey.')
  await shot(page, '03-second-passkey')
  const me = await api(page, 'GET', '/api/auth/me')
  check('new account has no email, one passkey, the chosen name', me.body.email === null && me.body.passkeys === 1 && me.body.display_name === 'Pia Passkey')
  check('onboarding offers a second passkey, never an email', (await page.locator('button:has-text("Add a second passkey")').count()) === 1 && (await page.locator('input[type=email]').count()) === 0)
  await page.click('button:has-text("Not now")')
  await out(page)
  // A new account's first page: choose a character (web/e2e/worlds.mjs covers the chooser itself).
  await page.waitForSelector('.w-chooser')
  check('a new account meets the character chooser once', (await page.locator('.w-tile').count()) === 8)
  await page.click('button:has-text("Choose Kape")')
  await page.waitForSelector('header button')
  firstCredential = (await va.credentials())[0]

  // Sign out; the page must not sign the account straight back in.
  await signOut(page)
  await page.waitForSelector('text=Welcome back.')
  const before = starts.length
  await page.waitForTimeout(1500)
  check('after sign-out, no passkey prompt starts and the old account stays signed out', starts.length === before && new URL(page.url()).pathname === '/signin' && (await api(page, 'GET', '/api/auth/me')).status === 401)
  await shot(page, '04-welcome-back')
  await va.setVerified(false)
  await page.click('button:has-text("Continue with a passkey")')
  await page.waitForSelector('text=No passkey was used')
  await shot(page, '05-passkey-cancelled')
  check('a cancelled ceremony gets calm copy that mentions the phone option', (await page.locator('text=use a phone or tablet').count()) > 0)
  await va.setVerified(true)
  await page.click('button:has-text("Continue with a passkey")')
  await out(page)
  check('returning with a passkey signs in to the same account', (await api(page, 'GET', '/api/auth/me')).body.account_id === me.body.account_id)

  // Settings: one passkey is flagged, and it can't be removed.
  await page.goto(`${BASE}/account#sign-in`)
  await page.waitForSelector('text=One passkey.')
  check('account: one passkey is flagged, with no email alternative offered', (await page.locator('text=/recovery email/i').count()) === 0)
  await shot(page, '06-account-security')
  await page.click('[aria-label^="Manage"]')
  await page.click('button:has-text("Remove…")')
  await page.getByRole('dialog').getByRole('button', { name: 'Remove passkey' }).click()
  await page.waitForSelector('text=This is your only passkey')
  check('the last passkey can’t be removed', (await va.credentials()).length === 1)
  await page.keyboard.press('Escape')
  await page.setViewportSize(MOBILE.viewport)
  await page.goto(`${BASE}/account#sign-in`)
  await page.waitForSelector('text=One passkey.')
  await shot(page, '07-account-security-mobile')
  await page.setViewportSize(DESKTOP)

  // A synced passkey on a second device ends this session; the draft survives signing back in.
  const t = await teamWithSprint(page, 'Draft team')
  await page.goto(`${BASE}/`)
  const box = page.locator('textarea').first()
  await box.waitFor()
  await box.fill('Synthetic draft: pairing on refunds helped')
  const other = await newCtx()
  const op = await other.newPage()
  await op.goto(`${BASE}/signin`)
  const va2 = await virtualAuthenticator(op)
  await va2.add(firstCredential)
  await op.click('button:has-text("Continue with a passkey")')
  await out(op)
  check('the same (synced) passkey signs in on another device', (await api(op, 'GET', '/api/auth/me')).body.account_id === t.me.account_id)
  await api(op, 'POST', '/api/auth/logout-others')
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await page.waitForSelector('text=Your session ended')
  await page.click('button:has-text("Sign in")')
  await page.click('button:has-text("Continue with a passkey")')
  await out(page)
  // The composer restores the draft once it knows the sprint (a moment after landing): wait for it.
  await page.waitForFunction(() => document.querySelector('textarea')?.value.includes('pairing on refunds'), null, { timeout: 5000 }).catch(() => {})
  const kept = await page.locator('textarea').first().inputValue()
  check('a draft survives the session ending and a passkey sign-in', kept.includes('pairing on refunds'), kept.slice(0, 40))
  await Promise.all([ctx.close(), other.close()])
}

// ------------------------------------------------------------------ 2. email sign-in is gone

{
  const ctx = await newCtx()
  const page = await ctx.newPage()
  // Old links to the email path land on the passkey sign-in.
  await page.goto(`${BASE}/signin?method=email`)
  await page.waitForSelector('button:has-text("Continue with a passkey")')
  check('an old “?method=email” link opens the passkey sign-in, with no email field', (await page.locator('input[type=email]').count()) === 0)
  const tried = await page.evaluate(async () => {
    const out = {}
    for (const p of ['/api/auth/request-code', '/api/auth/verify']) {
      const r = await fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'someone@example.test', code: '123456' }) })
      out[p] = r.status
    }
    out.me = (await fetch('/api/auth/me')).status
    return out
  })
  check('the email endpoints are gone and sign no one in', tried['/api/auth/request-code'] === 404 && tried['/api/auth/verify'] === 404 && tried.me === 401, JSON.stringify(tried))
  await ctx.close()
}

// ------------------------------------------------------------------ 3. no WebAuthn in this browser

{
  const ctx = await newCtx()
  await ctx.addInitScript(() => {
    delete window.PublicKeyCredential
  })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/signin`)
  await page.waitForSelector('text=This browser can’t use passkeys.')
  check('unsupported browser: says so plainly and offers no other way in', (await page.locator('button:has-text("Continue with a passkey")').count()) === 0 && (await page.locator('text=/email/i').count()) === 0)
  await shot(page, '09-unsupported-browser')
  await ctx.close()
}

// ------------------------------------------------------------------ 4. invitations

{
  const owner = await newCtx()
  const op = await owner.newPage()
  await virtualAuthenticator(op)
  await op.goto(`${BASE}/signin`)
  await createAccount(op, 'Olivia Owner')
  await out(op)
  const { ws, sprint } = await teamWithSprint(op, 'Falcon team')

  // Team QR (approval).
  await op.goto(`${BASE}/workspaces/${ws}/people`)
  await op.click('.ws-actions button:has-text("Invite")')
  await op.click('button:has-text("With a link or QR")')
  await op.waitForSelector('text=Kind of invite')
  await op.selectOption('select >> nth=0', { label: 'Sprint 12 (sprint)' })
  await shot(op, '10-invite-kinds')
  const [created] = await Promise.all([op.waitForResponse((r) => r.url().endsWith('/join-links') && r.request().method() === 'POST'), op.click('button:has-text("Show team QR")')])
  const { url } = await created.json()
  await op.waitForSelector('svg[aria-label^="Invite QR code"]')
  await shot(op, '11-team-qr')
  check('the QR encodes an ordinary https link with the token in the fragment', new RegExp(`^${BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/join#[A-Za-z0-9_-]{43}$`).test(url))

  const joiner = await newCtx(MOBILE)
  const jp = await joiner.newPage()
  await virtualAuthenticator(jp)
  const referrers = []
  jp.on('request', (r) => r.headers().referer && referrers.push(r.headers().referer))
  await jp.goto(url)
  await jp.waitForSelector('text=You’re invited to a team.')
  await shot(jp, '12-join-mobile')
  await createAccount(jp, 'Jo Joiner')
  await jp.waitForSelector('text=Join Falcon team?')
  check('joining needs no email address', (await api(jp, 'GET', '/api/auth/me')).body.email === null)
  await jp.click('button:has-text("Request to join")')
  await jp.waitForSelector('text=Waiting for approval.')
  await shot(jp, '13-waiting-mobile')
  check('the token never appears in a Referer header', !referrers.some((r) => r.includes(url.split('#')[1])))
  check('no access before approval', (await api(jp, 'GET', `/api/sprints/${sprint}`)).status >= 403)
  await op.waitForSelector('text=Jo Joiner', { timeout: 30_000 })
  check('the approver is told when an account has no email', (await op.locator('text=No email on this account').count()) > 0)
  await shot(op, '14-approve')
  await op.click('button:has-text("Approve")')
  await jp.waitForSelector('text=You’re in.', { timeout: 30_000 })
  await jp.click('button:has-text("Continue")')
  await jp.waitForURL(new RegExp(`/sprints/${sprint}`))
  check('approved: straight on to the sprint', true)
  await op.keyboard.press('Escape')

  // Personal single-use link.
  await op.click('.ws-actions button:has-text("Invite")')
  await op.click('button:has-text("With a link or QR")')
  // The team QR shown earlier comes back first; switch to a personal link from there.
  await op.click('button:has-text("Personal link instead")')
  await op.waitForSelector('label:has-text("Personal link") input:checked')
  const [made] = await Promise.all([op.waitForResponse((r) => r.url().endsWith('/join-links') && r.request().method() === 'POST'), op.click('button:has-text("Make a personal link")')])
  const personal = (await made.json()).url
  await op.waitForSelector('text=Personal invite to')
  await shot(op, '15-personal-link')
  const guest = await newCtx(MOBILE)
  const gp = await guest.newPage()
  await virtualAuthenticator(gp)
  await gp.goto(personal)
  await createAccount(gp, 'Gus Guest')
  await gp.waitForSelector('button:has-text("Join the team")')
  await gp.click('button:has-text("Join the team")')
  await gp.waitForURL((u) => u.pathname.startsWith('/workspaces/') || u.pathname.startsWith('/sprints/'))
  check('a personal link joins its first user directly', (await api(gp, 'GET', '/api/auth/me')).body.workspaces.some((w) => w.id === ws))
  const late = await newCtx()
  const lp = await late.newPage()
  await virtualAuthenticator(lp)
  await lp.goto(personal)
  const lateOk = await lp.waitForSelector('text=This invite code can’t be used.', { timeout: 8000 }).then(() => true).catch(() => false)
  check('…and only once', lateOk)

  // An emailed invitation to a new person: create an account with a passkey, then join.
  const invited = addr('invited')
  await api(op, 'POST', `/api/workspaces/${ws}/invitations`, { email: invited, sprint_id: sprint })
  await op.waitForTimeout(1200)
  const link = (await inbox(op, invited, /invited/)).body.split('\n').map((l) => l.trim()).find((l) => l.includes('/invite#')).replace(/^https?:\/\/[^/]+/, BASE)
  const ictx = await newCtx(MOBILE)
  const ip = await ictx.newPage()
  await virtualAuthenticator(ip)
  await ip.goto(link)
  await ip.waitForSelector('text=You’re invited to Falcon team.')
  await shot(ip, '16-invited-mobile')
  await createAccount(ip, 'Ines Invited')
  await ip.waitForSelector('text=Join Falcon team?')
  await ip.click('button:has-text("Join the workspace")')
  await ip.waitForURL(new RegExp(`/sprints/${sprint}`))
  check('an emailed invitation joins a new passkey account; the address is kept for mail only', (await api(ip, 'GET', '/api/auth/me')).body.email === invited)
  await Promise.all([owner.close(), joiner.close(), guest.close(), late.close(), ictx.close()])
}

// ------------------------------------------------------------------ 5. sign-out and sessions

{
  const ctx = await newCtx()
  const page = await ctx.newPage()
  const va = await virtualAuthenticator(page)
  await page.goto(`${BASE}/signin`)
  await createAccount(page, 'Sam Signout')
  await out(page)
  await page.locator('button:has-text("Decide later")').click({ timeout: 5000 }).catch(() => {})
  // The same synced passkey on another device: a second session.
  const other = await newCtx()
  const op = await other.newPage()
  const va2 = await virtualAuthenticator(op)
  await va2.add((await va.credentials())[0])
  await op.goto(`${BASE}/signin`)
  await op.click('button:has-text("Continue with a passkey")')
  await out(op)
  await page.goto(`${BASE}/account#sessions`)
  await page.waitForSelector('button:has-text("Sign out everywhere else")')
  await page.click('button:has-text("Sign out everywhere else")')
  await page.waitForFunction(() => document.querySelectorAll('#sessions li').length === 1)
  check('“Sign out everywhere else” ends the others, from server state', (await api(op, 'GET', '/api/auth/me')).status === 401)
  // Offline: sign out on this device only; stays signed out; finished once online.
  const session = (await ctx.cookies()).find((c) => c.name === '__Host-muni_session').value
  await ctx.setOffline(true)
  await signOut(page)
  await page.waitForSelector('text=can’t be reached')
  await shot(page, '17-signout-offline')
  await page.click('button:has-text("Sign out on this device")')
  await page.waitForURL(/\/signin/)
  await ctx.setOffline(false)
  const fresh = await ctx.newPage()
  await fresh.goto(`${BASE}/`)
  await fresh.waitForURL(/\/signin/)
  await fresh.waitForTimeout(1000)
  const probeCtx = await newCtx()
  await probeCtx.addCookies([{ name: '__Host-muni_session', value: session, domain: 'localhost', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }])
  const pp = await probeCtx.newPage()
  await pp.goto(`${BASE}/privacy`)
  check('offline sign-out stays signed out and reaches the server once online', (await pp.evaluate(() => fetch('/api/auth/me').then((r) => r.status))) === 401)
  await Promise.all([ctx.close(), other.close(), probeCtx.close()])
}

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map((f) => f.name).join('; ')}` : ''}`)
process.exit(failed.length ? 1 : 0)
