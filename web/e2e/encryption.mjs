/**
 * End-to-end: an encrypted sprint from key setup to reveal, through the real UI, against a local
 * `wrangler dev` (console email) or the Vite dev server in front of it. Synthetic content only.
 * Run from web/:  MUNI_URL=http://localhost:5173 node e2e/encryption.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.MUNI_URL ?? 'http://localhost:5173'
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const tag = crypto.randomUUID().slice(0, 8)
const addr = (p) => `${p}-${tag}@example.test`
const SECRET = `Synthetic-${tag}: the staging database fell over on Wednesday`

async function api(page, method, path, body) {
  return page.evaluate(async ([m, p, b]) => {
    const csrf = document.cookie.match(/muni_csrf=([^;]+)/)?.[1] ?? ''
    const r = await fetch(p, { method: m, headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: b ? JSON.stringify(b) : undefined })
    return { status: r.status, body: await r.json().catch(() => null) }
  }, [method, path, body])
}
/**
 * A virtual authenticator (Chromium CDP) holding synced passkeys, as a password manager would.
 * Without PRF, so a passkey signs in but can't open encrypted writing on its own: that's what the
 * new-device step below needs (with PRF, e2e/unlock.mjs covers passkey unlocking).
 */
async function authenticator(page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, defaultBackupEligibility: true, defaultBackupState: true, hasPrf: false },
  })
  return { credentials: async () => (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials, add: (credential) => cdp.send('WebAuthn.addCredential', { authenticatorId, credential }) }
}
/** A new account, made through the entrance with a passkey. */
async function signIn(ctx, _email, name) {
  const page = await ctx.newPage()
  page.passkeys = await authenticator(page)
  await page.goto(`${BASE}/signin`)
  await page.click('button:has-text("Create an account")')
  await page.fill('input[autocomplete="name"]', name)
  await page.click('button:has-text("Create with a passkey")')
  await page.waitForSelector('text=Add a second passkey')
  await page.click('button:has-text("Not now")')
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'))
  await page.locator('button:has-text("Decide later")').click({ timeout: 3000 }).catch(() => {})
  return page
}
/** Keys are set up without asking; a recovery key is optional (made here for the new-device step). */
async function setUpKeys(page) {
  await page.goto(`${BASE}/account#encryption`)
  await page.waitForSelector('text=Your encrypted writing is unlocked on this device.', { timeout: 10000 })
  await page.click('button:has-text("Make a recovery key")')
  await page.click('[role=dialog] button:has-text("Make a recovery key")')
  const key = (await page.locator('[aria-label="Your recovery key"]').innerText()).trim()
  await page.check('text=I’ve saved it somewhere safe')
  await page.click('[role=dialog] button:has-text("Done")')
  await page.waitForSelector('text=Recovery key: saved.', { timeout: 10000 }).catch(() => page.waitForSelector('text=saved.'))
  return key
}

const browser = await chromium.launch()
try {
  const ownerCtx = await browser.newContext()
  const owner = await signIn(ownerCtx, addr('olivia'), 'Olivia Owner')
  const ws = (await api(owner, 'POST', '/api/workspaces', { name: `Encrypted team ${tag}` })).body
  await api(owner, 'POST', `/api/workspaces/${ws.id}/invitations`, { email: addr('maya') })
  await owner.waitForTimeout(1200)
  await setUpKeys(owner)
  check('Owner’s key was set up without any setup step', true)

  const mayaCtx = await browser.newContext()
  const maya = await signIn(mayaCtx, addr('maya'), 'Maya Member')
  const link = await maya.evaluate(async (e) => (await fetch('/api/dev/inbox').then((r) => r.json())).find((m) => m.to === e && /invited/.test(m.subject))?.body.split('\n').map((l) => l.trim()).find((l) => l.includes('/invite')), addr('maya'))
  const token = link.split('#')[1]
  check('Maya joins the workspace', (await api(maya, 'POST', '/api/invitations/accept', { token })).status === 200)
  const mayaRecovery = await setUpKeys(maya)

  // Owner creates an encrypted sprint through the setup page (encrypted by default).
  await owner.goto(`${BASE}/workspaces/${ws.id}/sprints/new`)
  await owner.fill('#f-name', `Sprint ${tag}`)
  check('Encryption is on by default for new sprints', await owner.isChecked('#f-encrypt'))
  await owner.click('button:has-text("Create and open collection")')
  await owner.waitForURL(/\/sprints\/[0-9a-f-]+$/)
  const sprintId = owner.url().split('/').pop()
  const detail = (await api(owner, 'GET', `/api/sprints/${sprintId}`)).body
  check('Sprint is encrypted and collecting', detail.encryption === 'e1' && detail.status === 'collecting', `${detail.encryption} ${detail.status}`)

  // Maya writes. What leaves her browser must not contain the text.
  const sent = []
  maya.on('request', (r) => { if (r.method() !== 'GET') sent.push(r.postData() ?? '') })
  await maya.goto(`${BASE}/?sprint=${sprintId}`)
  await maya.waitForSelector('textarea[name="thought"]')
  check('The composer carries no repeated privacy note (Privacy explains it)', (await maya.locator('button.privacy-mark, .room-fine').count()) === 0)
  await maya.fill('textarea[name="thought"]', SECRET)
  await maya.click('button:has-text("Add to sprint")')
  await maya.waitForSelector('text=/^Added/', { timeout: 10000 })
  check('No request body contains the thought’s text', sent.length > 0 && sent.every((b) => !b.includes('staging database')), `${sent.length} requests`)
  const raw = await maya.evaluate(async (id) => (await fetch(`/api/sprints/${id}/entries/mine`).then((r) => r.json())), sprintId)
  check('The server returns only an envelope', raw.length === 1 && raw[0].body.startsWith('e1.') && !raw[0].body.includes('staging') && raw[0].impact === null)
  check('Maya sees her own thought, decrypted', (await maya.locator(`text=${SECRET}`).count()) === 1)

  // Maya edits it — in Muni's journal, then in a character's room. The new words and their context
  // are sealed on her device like a new thought; nothing readable leaves it.
  const editIn = async (label, words, impact) => {
    sent.length = 0
    await maya.locator('.passage .passage-menu').first().click()
    await maya.locator('[role=menuitem]', { hasText: 'Edit' }).click()
    await maya.locator('.passage form textarea').first().fill(words)
    // A thought that already has context opens with it showing.
    if (!(await maya.locator('.passage form textarea[id$="-i"]').count())) await maya.locator('.passage form button', { hasText: 'Context' }).click()
    await maya.locator('.passage form textarea[id$="-i"]').fill(impact)
    await maya.locator('.passage form button[type=submit]').click()
    const saved = await maya.locator('.passage form').waitFor({ state: 'detached', timeout: 10000 }).then(() => true).catch(() => false)
    const error = saved ? null : await maya.locator('.passage form [role=alert]').innerText().catch(() => null)
    check(`${label}: editing a thought in an encrypted sprint saves`, saved && (await maya.locator(`text=${words}`).count()) === 1, error ?? '')
    check(`${label}: …and no request carries the edited words`, sent.length > 0 && sent.every((b) => !b.includes(words.slice(-24)) && !b.includes(impact)), `${sent.length} requests`)
    const stored = await maya.evaluate(async (id) => (await fetch(`/api/sprints/${id}/entries/mine`).then((r) => r.json())), sprintId)
    check(`${label}: …stored as one envelope, the context inside it`, stored.length === 1 && stored[0].body.startsWith('e1.') && stored[0].impact === null && (await maya.locator('.passage .passage-context', { hasText: impact }).count()) === 1)
  }
  await editIn('Journal', `Synthetic-${tag}: edited, the staging database recovered on Thursday`, 'Synthetic impact: one lost morning')
  const SHOWN = `Synthetic-${tag}: edited again, from the balcony`
  await api(maya, 'PATCH', '/api/auth/me', { avatar_id: 'sibol', avatar_theme: true })
  await maya.goto(`${BASE}/?sprint=${sprintId}`)
  await maya.locator('.room-writer').waitFor()
  await maya.locator('.passage').first().waitFor()
  await editIn('Sibol’s room', SHOWN, 'Synthetic impact: two lost mornings')
  await api(maya, 'PATCH', '/api/auth/me', { avatar_id: null })

  // Before the reveal, Maya holds no sprint key; the owner can't see her thoughts.
  const mk = (await api(maya, 'GET', `/api/sprints/${sprintId}/keys`)).body
  check('While collecting, Maya can’t open the sprint', mk.my_wraps.length === 0)
  check('While collecting, shared thoughts are refused', (await api(owner, 'GET', `/api/sprints/${sprintId}/entries`)).status === 409)

  // Owner closes collection from the sprint's page: the reveal happens on their device. Then, on
  // to the optional themes.
  await owner.goto(`${BASE}/sprints/${sprintId}`)
  await owner.click('button:has-text("Close collection…")')
  await owner.click('[role=dialog] button:text-is("Close collection")')
  await owner.waitForSelector('.sbar-state:has-text("Collection closed")')
  await owner.click('a:has-text("Group into themes")')
  await owner.waitForURL(/prepare$/)
  await owner.waitForSelector(`text=${SHOWN}`, { timeout: 10000 })
  check('After the reveal, the facilitator reads the thought', true)
  const mk2 = (await api(maya, 'GET', `/api/sprints/${sprintId}/keys`)).body
  check('After the reveal, Maya can open the sprint', mk2.my_wraps.length === 1)

  // A theme created in preparation is sealed too.
  await owner.fill('.sort-pile--ghost input[aria-label="New theme title"]', `Synthetic-${tag} staging ownership`)
  await owner.click('.sort-pile--ghost button:has-text("Create")')
  await owner.waitForTimeout(800)
  const themes = (await owner.evaluate(async (id) => (await fetch(`/api/sprints/${id}/themes`).then((r) => r.json())), sprintId)).themes
  check('Theme titles are stored as envelopes', themes.length === 1 && themes[0].title.startsWith('e1.'))
  check('…and shown decrypted', (await owner.locator('textarea[aria-label="Theme title"]').first().inputValue().catch(() => '')) === `Synthetic-${tag} staging ownership`)

  // The live retro: a line with a check-in answer, and something added to the discussion, are sealed
  // on Maya's device; the facilitator reads them once they're shared.
  check('The retro goes live', (await api(owner, 'POST', `/api/sprints/${sprintId}/transition`, { to: 'live' })).status === 200)
  const version = (await api(owner, 'GET', `/api/sprints/${sprintId}/meeting`)).body.version
  await api(owner, 'POST', `/api/sprints/${sprintId}/meeting/command`, { expected_version: version, command: { type: 'set_phase', phase: 'talk' } })
  const ci = (await api(owner, 'POST', `/api/sprints/${sprintId}/checkins`, { theme_id: themes[0].id, kind: 'topic' })).body
  sent.length = 0
  const LINE = `Synthetic-${tag} line about the cluster`
  const ADDED = `Synthetic-${tag} added about the pager`
  await maya.goto(`${BASE}/sprints/${sprintId}/room`)
  await maya.locator('.ci-choice', { hasText: 'I felt this' }).click()
  await maya.locator('.ci-choice[aria-checked="true"]').waitFor()
  await maya.click('.ci-ask button:has-text("Add a line")')
  await maya.fill('textarea[aria-label="Your line (optional)"]', LINE)
  await maya.click('button:has-text("Save line")')
  await maya.locator('.ci-your-line', { hasText: 'line about' }).waitFor()
  await maya.click('.ad-open')
  await maya.fill('textarea[aria-label="Add to this discussion"]', ADDED)
  await maya.click('.ad button:has-text("Send")')
  await maya.locator('.ad-mine li', { hasText: 'added about' }).waitFor()
  check('No request carries a check-in line or an addition', sent.length > 0 && sent.every((b) => !b.includes('line about') && !b.includes('added about')), `${sent.length} requests`)
  const mineRaw = (await api(maya, 'GET', `/api/sprints/${sprintId}/checkins`)).body.find((c) => c.id === ci.id)
  const addedRaw = (await api(maya, 'GET', `/api/sprints/${sprintId}/meeting`)).body.my_context
  check('…the server holds envelopes for both', mineRaw.mine.note.startsWith('e1.') && addedRaw.length === 1 && addedRaw[0].body.startsWith('e1.'))
  await api(owner, 'POST', `/api/sprints/${sprintId}/checkins/${ci.id}/share`)
  await owner.goto(`${BASE}/sprints/${sprintId}/stage`)
  await owner.locator('.ci-lines li', { hasText: 'line about' }).waitFor({ timeout: 10000 })
  check('Once shared, the facilitator reads the line, decrypted', true)

  // Maya on a new device, with her synced passkey (one that can't unlock): signed in, but her
  // writing stays locked until the recovery key opens it.
  const newDevice = await browser.newContext()
  const maya2 = await newDevice.newPage()
  const synced = await authenticator(maya2)
  await synced.add((await maya.passkeys.credentials())[0])
  await maya2.goto(`${BASE}/signin`)
  await maya2.click('button:has-text("Continue with a passkey")')
  await maya2.waitForURL((u) => !u.pathname.startsWith('/signin'))
  await maya2.goto(`${BASE}/sprints/${sprintId}`)
  await maya2.waitForSelector('text=this device can’t unlock it yet', { timeout: 10000 })
  check('New device: a passkey that can’t unlock signs in, but the content stays locked', (await maya2.locator(`text=${SHOWN}`).count()) === 0)
  await maya2.click('button:has-text("Use recovery key")')
  await maya2.fill('[role=dialog] input', mayaRecovery)
  await maya2.click('[role=dialog] button[type=submit]')
  await maya2.waitForSelector(`text=${SHOWN}`, { timeout: 10000 })
  check('New device: the recovery key unlocks her content', true)
} catch (e) {
  if (process.env.SHOTS) for (const [i, pg] of browser.contexts().flatMap((c) => c.pages()).entries()) await pg.screenshot({ path: `${process.env.SHOTS}/encryption-failure-${i}.png` }).catch(() => {})
  check('Run completed', false, e.message.split('\n')[0])
} finally {
  await browser.close()
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
