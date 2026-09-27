/**
 * End-to-end: passkey-unlocked encryption — a new account writes without any key setup; signing
 * out and back in with the passkey reads old thoughts and sends new ones without a recovery key
 * (the original bug); cleared storage comes back with the same passkey (PRF); a passkey without
 * PRF still works on the same device, and cleared storage then honestly needs the recovery key;
 * signing out in one tab clears decrypted text in another; a key kept in plaintext by an older
 * build is moved into an envelope. Request bodies are captured to check that nothing secret
 * leaves the browser. Real Chromium against a local `wrangler dev` over HTTPS:
 *
 *   cd web && npm run build
 *   cd worker && npx wrangler dev --local-protocol https --port 8793 --var PUBLIC_ORIGIN:https://localhost:8793 --persist-to .wrangler/e2e-unlock
 *   cd web && MUNI_URL=https://localhost:8793 node e2e/unlock.mjs
 *
 * Passkeys use Chromium's CDP virtual authenticator (with and without its PRF support). That
 * exercises the browser's WebAuthn and PRF plumbing and the server, but it is NOT evidence of
 * behaviour on physical devices, password managers, iOS Safari or installed apps (docs/PASSKEYS.md §8).
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const OUT = new URL('../e2e-artifacts/unlock/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
const BASE = process.env.MUNI_URL ?? 'https://localhost:8793'
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const tag = () => crypto.randomUUID().slice(0, 8)
const BANNERS = ['doesn’t have the required key', 'can’t unlock it yet', 'Confirm with your passkey to unlock']

const browser = await chromium.launch()
const newCtx = () => browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } })

async function virtualAuthenticator(page, { prf }) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, defaultBackupEligibility: true, defaultBackupState: true, hasPrf: prf },
  })
  return { credentials: async () => (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials, add: (credential) => cdp.send('WebAuthn.addCredential', { authenticatorId, credential }) }
}
/** Every non-GET request body this context sends, and whether a key banner ever showed. */
async function watch(ctx) {
  const sent = []
  ctx.on('request', (r) => r.method() !== 'GET' && sent.push({ url: r.url(), body: r.postData() ?? '' }))
  await ctx.addInitScript((banners) => {
    window.__banners = []
    const look = () => {
      const t = document.body?.innerText ?? ''
      for (const b of banners) if (t.includes(b) && !window.__banners.includes(b)) window.__banners.push(b)
    }
    new MutationObserver(look).observe(document, { subtree: true, childList: true, characterData: true })
  }, BANNERS)
  return sent
}
const banners = (page) => page.evaluate(() => window.__banners ?? [])
const api = (page, method, path, body) =>
  page.evaluate(async ([m, p, b]) => {
    const csrf = document.cookie.match(/(?:^|; )__Host-muni_csrf=([^;]+)/)?.[1] ?? document.cookie.match(/(?:^|; )muni_csrf=([^;]+)/)?.[1]
    const r = await fetch(p, { method: m, headers: { 'content-type': 'application/json', 'x-csrf-token': csrf ?? '' }, body: b === undefined ? undefined : JSON.stringify(b) })
    return { status: r.status, body: await r.json().catch(() => null) }
  }, [method, path, body])
async function keys(page, until = (k) => !!k.public_key) {
  for (let i = 0; i < 40; i++) {
    const k = (await api(page, 'GET', '/api/me/keys')).body
    if (k && until(k)) return k
    await page.waitForTimeout(250)
  }
  return (await api(page, 'GET', '/api/me/keys')).body
}
async function createAccount(page, name) {
  await page.goto(`${BASE}/signin`)
  await page.click('button:has-text("Create an account")')
  await page.fill('input[autocomplete="name"]', name)
  await page.click('button:has-text("Create with a passkey")')
  await page.waitForSelector('text=Add a second passkey')
  await page.click('button:has-text("Not now")')
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'))
  await page.locator('button:has-text("Decide later")').click({ timeout: 5000 }).catch(() => {})
}
async function signInWithPasskey(page) {
  await page.goto(`${BASE}/signin`)
  await page.click('button:has-text("Continue with a passkey")')
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 15000 })
  // Unlocking finishes (and is kept for reloads) just after the page changes; a reload in that
  // moment would ask for the passkey once more, so let it settle before the test navigates.
  await page.waitForLoadState('networkidle').catch(() => {})
}
async function signOut(page) {
  // From the home page: Account lists other sessions, each with its own "Sign out" button.
  await page.goto(`${BASE}/`)
  await page.locator('header button').last().click()
  await page.locator('[data-radix-popper-content-wrapper] button:has-text("Sign out")').click()
  await page.getByRole('dialog').getByRole('button', { name: /^Sign out$/ }).click()
  await page.waitForURL(/\/signin/)
}
async function encryptedSprint(page) {
  const ws = (await api(page, 'POST', '/api/workspaces', { name: `Unlock team ${tag()}` })).body
  await page.goto(`${BASE}/workspaces/${ws.id}/sprints/new`)
  await page.fill('#f-name', `Sprint ${tag()}`)
  await page.click('button:has-text("Create and open collection")')
  await page.waitForURL(/\/sprints\/[0-9a-f-]+$/, { timeout: 15000 })
  return page.url().split('/').pop()
}
async function writeThought(page, sprint, text) {
  await page.goto(`${BASE}/?sprint=${sprint}`)
  await page.waitForSelector('textarea[name="thought"]')
  await page.fill('textarea[name="thought"]', text)
  await page.click('button:has-text("Add to sprint")')
  await page.waitForSelector('text=/^Added/', { timeout: 15000 })
}
const seesThought = async (page, sprint, text) => {
  await page.goto(`${BASE}/?sprint=${sprint}`)
  return page.waitForSelector(`text=${text}`, { timeout: 15000 }).then(() => true, () => false)
}
/** The PRF output this passkey gives Muni, read the way the app asks for it — to prove it's never sent. */
const prfOutput = (page, credentialId) =>
  page.evaluate(async (id) => {
    const input = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('muni:prf:account-key:v1')))
    const raw = Uint8Array.from(atob(id.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((id.length + 3) % 4)), (c) => c.charCodeAt(0))
    const c = await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), rpId: location.hostname, allowCredentials: [{ type: 'public-key', id: raw }], userVerification: 'required', extensions: { prf: { eval: { first: input } } } } })
    const first = c.getClientExtensionResults().prf?.results?.first
    if (!first) return null
    const b = new Uint8Array(first)
    return { hex: [...b].map((x) => x.toString(16).padStart(2, '0')).join(''), b64u: btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
  }, credentialId)
async function clearSiteStorage(page) {
  await page.evaluate(async () => {
    localStorage.clear()
    for (const db of (await indexedDB.databases?.()) ?? [{ name: 'muni-unlock' }, { name: 'muni-keys' }, { name: 'muni-device' }])
      await new Promise((r) => {
        const q = indexedDB.deleteDatabase(db.name)
        q.onsuccess = q.onerror = q.onblocked = () => r(null)
      })
  })
}

// ------------------------------------------------------------------ with and without PRF

for (const prf of [true, false]) {
  const L = prf ? '[PRF]' : '[no PRF]'
  const ctx = await newCtx()
  const sent = await watch(ctx)
  const page = await ctx.newPage()
  const va = await virtualAuthenticator(page, { prf })
  const SECRET = `Synthetic-${tag()}: the staging database fell over`
  try {
    await createAccount(page, `Unlock ${prf ? 'Prf' : 'Plain'}`)
    const k0 = await keys(page)
    check(`${L} new account: its key is set up with no setup step`, !!k0?.public_key)
    const sprint = await encryptedSprint(page)
    await writeThought(page, sprint, SECRET)
    check(`${L} new account writes to an encrypted sprint without any key dialog`, (await banners(page)).length === 0, JSON.stringify(await banners(page)))

    // The original bug: sign out, sign back in with the passkey.
    await signOut(page)
    await signInWithPasskey(page)
    check(`${L} after signing out and in: the old thought reads, no recovery key asked`, await seesThought(page, sprint, SECRET))
    await writeThought(page, sprint, `${SECRET} (again)`)
    check(`${L} …and a new thought is sent`, true)
    check(`${L} no “missing key” banner at any point`, (await banners(page)).length === 0, JSON.stringify(await banners(page)))
    const k1 = await keys(page, (k) => !prf || k.passkeys?.length > 0)
    check(`${L} passkey ${prf ? 'can' : 'can’t'} unlock (wrap stored for it: ${k1.passkeys?.length ?? 0})`, prf ? k1.passkeys?.length === 1 : k1.passkeys?.length === 0)

    // Reload and a new tab: no prompt.
    await page.reload()
    check(`${L} a reload stays unlocked`, await seesThought(page, sprint, SECRET))

    // Cleared site data but still signed in (cookie kept).
    await clearSiteStorage(page)
    await page.goto(`${BASE}/?sprint=${sprint}`)
    if (prf) {
      await page.waitForSelector('text=Confirm with your passkey to unlock', { timeout: 15000 })
      await page.click('button:has-text("Unlock with passkey")')
      check(`${L} cleared storage: one passkey confirmation restores access`, await page.waitForSelector(`text=${SECRET}`, { timeout: 15000 }).then(() => true, () => false))
      // Cleared cookies too: sign in with the same passkey.
      await clearSiteStorage(page)
      await ctx.clearCookies()
      await signInWithPasskey(page)
      check(`${L} cleared storage and cookies: signing in with the passkey restores access`, await seesThought(page, sprint, SECRET))
    } else {
      check(`${L} cleared storage: honestly locked (recovery key or an unlocking passkey needed)`, await page.waitForSelector('text=can’t unlock it yet', { timeout: 15000 }).then(() => true, () => false))
      check(`${L} …and never shows ciphertext or a new key`, !(await page.content()).includes('e1.') && (await keys(page)).public_key === k0.public_key)
    }

    // Two tabs: signing out in one clears the other.
    if (prf) {
      const other = await ctx.newPage()
      check(`${L} a second tab opens unlocked`, await seesThought(other, sprint, SECRET))
      await signOut(page)
      await other.waitForURL(/\/signin/, { timeout: 10000 }).catch(() => {})
      await other.waitForTimeout(500)
      check(`${L} signing out in one tab leaves no decrypted text in the other`, !(await other.content()).includes(SECRET))
      await other.close()
    }

    // Nothing secret left the browser.
    const bodies = sent.map((s) => s.body).join('\n')
    check(`${L} no request body contains the thought`, !bodies.includes('staging database'))
    check(`${L} no request body carries PRF results`, !/"results"\s*:/.test(bodies))
    if (prf) {
      const cred = (await va.credentials())[0]
      const out = await prfOutput(page, cred.credentialId)
      check(`${L} the passkey’s PRF output appears in no request`, !!out && !bodies.includes(out.hex) && !bodies.includes(out.b64u), out ? '' : 'no PRF output')
    }
  } catch (e) {
    check(`${L} run completed`, false, e.message.split('\n')[0])
    await page.screenshot({ path: `${OUT}${prf ? 'prf' : 'plain'}-failure.png` }).catch(() => {})
  } finally {
    await ctx.close()
  }
}

// ------------------------------------------------------------------ a key kept by an older build

{
  const ctx = await newCtx()
  const page = await ctx.newPage()
  try {
    // An account set up by an older build: a key in plaintext in IndexedDB `muni-keys` (v1).
    // Its passkey is made straight through the API (as that build did), so this build's own key set-up doesn't run.
    await virtualAuthenticator(page, { prf: false })
    await page.goto(`${BASE}/privacy`)
    const seeded = await page.evaluate(async () => {
      const dec = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0))
      const enc = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      const json = { 'content-type': 'application/json' }
      const o = await (await fetch('/api/auth/passkey/signup/options', { method: 'POST', headers: json, body: JSON.stringify({ display_name: 'Legacy Lee' }) })).json()
      const cred = await navigator.credentials.create({ publicKey: { ...o, challenge: dec(o.challenge), user: { ...o.user, id: dec(o.user.id) }, excludeCredentials: (o.excludeCredentials ?? []).map((c) => ({ ...c, id: dec(c.id) })) } })
      const response = { id: cred.id, rawId: enc(cred.rawId), type: cred.type, clientExtensionResults: {}, authenticatorAttachment: cred.authenticatorAttachment, response: { clientDataJSON: enc(cred.response.clientDataJSON), attestationObject: enc(cred.response.attestationObject), transports: cred.response.getTransports?.() ?? [] } }
      const me = await (await fetch('/api/auth/passkey/signup/verify', { method: 'POST', headers: json, body: JSON.stringify({ response, name: 'Old laptop' }) })).json()
      const csrf = document.cookie.match(/(?:^|; )(?:__Host-)?muni_csrf=([^;]+)/)?.[1]
      const kp = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])
      const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey)
      await fetch('/api/me/keys', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ public_key: jwk.x }) })
      await new Promise((resolve, reject) => {
        const r = indexedDB.open('muni-keys', 1)
        r.onupgradeneeded = () => {
          r.result.createObjectStore('keys', { keyPath: 'accountId' })
          r.result.createObjectStore('pins')
        }
        r.onsuccess = () => {
          const t = r.result.transaction('keys', 'readwrite')
          t.objectStore('keys').put({ accountId: me.account_id, sk: jwk.d, pk: jwk.x, savedAt: Date.now() })
          t.oncomplete = () => (r.result.close(), resolve(null))
          t.onerror = () => reject(t.error)
        }
      })
      return { account: me.account_id, sk: jwk.d }
    })
    await page.goto(`${BASE}/account#encryption`)
    await page.locator('button:has-text("Decide later")').click({ timeout: 3000 }).catch(() => {})
    await page.locator('button:has-text("Not now")').click({ timeout: 3000 }).catch(() => {})
    check('[older build] the kept key opens here without asking', await page.waitForSelector('text=Your encrypted writing is unlocked on this device.', { timeout: 15000 }).then(() => true, () => false))
    const stored = await page.evaluate(async (account) => {
      const read = (name, store) =>
        new Promise((resolve) => {
          const r = indexedDB.open(name)
          r.onsuccess = () => {
            if (!r.result.objectStoreNames.contains(store)) return resolve(null)
            const q = r.result.transaction(store).objectStore(store).get(account)
            q.onsuccess = () => (r.result.close(), resolve(q.result ?? null))
          }
          r.onerror = () => resolve(null)
        })
      for (let i = 0; i < 40; i++) {
        const legacy = await read('muni-keys', 'keys')
        const device = await read('muni-unlock', 'devices')
        if (!legacy && device) return { legacy, device }
        await new Promise((r) => setTimeout(r, 250))
      }
      return { legacy: await read('muni-keys', 'keys'), device: await read('muni-unlock', 'devices') }
    }, seeded.account)
    check('[older build] it’s moved into an envelope and the plaintext copy is deleted', !stored.legacy && !!stored.device?.envelope && !JSON.stringify(stored.device).includes(seeded.sk))
  } catch (e) {
    check('[older build] run completed', false, e.message.split('\n')[0])
  } finally {
    await ctx.close()
  }
}

await browser.close()
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
