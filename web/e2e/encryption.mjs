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
    const r = await fetch(p, { method: m, headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, 'x-muni-client': '4' }, body: b ? JSON.stringify(b) : undefined })
    return { status: r.status, body: await r.json().catch(() => null) }
  }, [method, path, body])
}
async function signIn(ctx, email, name) {
  const page = await ctx.newPage()
  // The "Used Muni before?" path, for an account as made before passkeys (dev-only endpoint).
  await page.goto(`${BASE}/signin?method=email`)
  await page.evaluate((e) => fetch('/api/dev/legacy-account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: e }) }), email)
  await page.fill('input[type=email]', email)
  await page.click('button:has-text("Send me a code")')
  await page.waitForSelector('text=Check your inbox.')
  const code = await page.evaluate(async (e) => (await fetch('/api/dev/inbox').then((r) => r.json())).filter((m) => m.to === e && /sign-in code/.test(m.subject))[0]?.subject.split(' ')[0], email)
  await page.fill('input[autocomplete="one-time-code"]', code)
  await page.click('button:has-text("Continue")')
  await page.waitForSelector('text=What should we call you?')
  await page.fill('input[autocomplete="name"]', name)
  await page.click('button:has-text("Continue")')
  await page.waitForSelector('text=Add a passkey to your account.')
  await page.click('button:has-text("Not now")')
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'))
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
  check('AI is off for the encrypted sprint', detail.ai_processing === false)

  // Maya writes. What leaves her browser must not contain the text.
  const sent = []
  maya.on('request', (r) => { if (r.method() !== 'GET') sent.push(r.postData() ?? '') })
  await maya.goto(`${BASE}/?sprint=${sprintId}`)
  await maya.waitForSelector('textarea[name="thought"]')
  check('Composer says it encrypts on the device', (await maya.locator('button.privacy-mark', { hasText: 'encrypted' }).count()) === 1)
  await maya.fill('textarea[name="thought"]', SECRET)
  await maya.click('button:has-text("Save thought")')
  await maya.waitForSelector('text=Submitted', { timeout: 10000 })
  check('No request body contains the thought’s text', sent.length > 0 && sent.every((b) => !b.includes('staging database')), `${sent.length} requests`)
  const raw = await maya.evaluate(async (id) => (await fetch(`/api/sprints/${id}/entries/mine`, { headers: { 'x-muni-client': '4' } }).then((r) => r.json())), sprintId)
  check('The server returns only an envelope', raw.length === 1 && raw[0].body.startsWith('e1.') && !raw[0].body.includes('staging') && raw[0].impact === null)
  check('Maya sees her own thought, decrypted', (await maya.locator(`text=${SECRET}`).count()) === 1)

  // Before the reveal, Maya holds no sprint key; the owner can't see her thoughts.
  const mk = (await api(maya, 'GET', `/api/sprints/${sprintId}/keys`)).body
  check('While collecting, Maya can’t open the sprint', mk.my_wraps.length === 0)
  check('While collecting, shared thoughts are refused', (await api(owner, 'GET', `/api/sprints/${sprintId}/entries`)).status === 409)

  // Owner closes collection from the sprint guide: the reveal happens on their device.
  await owner.goto(`${BASE}/sprints/${sprintId}`)
  await owner.click('button:has-text("Close collection")')
  await owner.click('[role=dialog] button:has-text("Close and reveal")')
  await owner.waitForURL(/prepare$/)
  await owner.waitForSelector(`text=${SECRET}`, { timeout: 10000 })
  check('After the reveal, the facilitator reads the thought', true)
  const mk2 = (await api(maya, 'GET', `/api/sprints/${sprintId}/keys`)).body
  check('After the reveal, Maya can open the sprint', mk2.my_wraps.length === 1)

  // A theme created in preparation is sealed too.
  await owner.fill('input[aria-label="New theme title"]', `Synthetic-${tag} staging ownership`)
  await owner.click('button:has-text("Add")')
  await owner.waitForTimeout(800)
  const themes = (await owner.evaluate(async (id) => (await fetch(`/api/sprints/${id}/themes`, { headers: { 'x-muni-client': '4' } }).then((r) => r.json())), sprintId)).themes
  check('Theme titles are stored as envelopes', themes.length === 1 && themes[0].title.startsWith('e1.'))
  check('…and shown decrypted', (await owner.locator(`input[value="Synthetic-${tag} staging ownership"]`).count()) === 1)

  // Maya on a new device: signing in by email doesn't unlock anything; the recovery key does.
  await maya.waitForTimeout(31_000) // the sign-in code resend cooldown for her address
  const newDevice = await browser.newContext()
  const maya2 = await newDevice.newPage()
  await maya2.goto(`${BASE}/signin?method=email`)
  await maya2.fill('input[type=email]', addr('maya'))
  await maya2.click('button:has-text("Send me a code")')
  await maya2.waitForSelector('text=Check your inbox.')
  await maya2.waitForTimeout(400)
  const code = await maya2.evaluate(async (e) => (await fetch('/api/dev/inbox').then((r) => r.json())).filter((m) => m.to === e && /sign-in code/.test(m.subject))[0]?.subject.split(' ')[0], addr('maya'))
  await maya2.fill('input[autocomplete="one-time-code"]', code)
  await maya2.click('button:has-text("Continue")')
  await maya2.waitForSelector('text=Add a passkey to your account.')
  await maya2.click('button:has-text("Not now")')
  await maya2.waitForURL((u) => !u.pathname.startsWith('/signin'))
  await maya2.goto(`${BASE}/sprints/${sprintId}`)
  await maya2.waitForSelector('text=this device can’t unlock it yet', { timeout: 10000 })
  check('New device: email sign-in alone doesn’t unlock content', (await maya2.locator(`text=${SECRET}`).count()) === 0)
  await maya2.click('button:has-text("Use recovery key")')
  await maya2.fill('[role=dialog] input', mayaRecovery)
  await maya2.click('[role=dialog] button[type=submit]')
  await maya2.waitForSelector(`text=${SECRET}`, { timeout: 10000 })
  check('New device: the recovery key unlocks her content', true)
} catch (e) {
  check('Run completed', false, e.message.split('\n')[0])
} finally {
  await browser.close()
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
