/**
 * End-to-end checks of the entrance (email → code → name → destination) and invitations, against
 * a local `wrangler dev` with the console email provider. Synthetic addresses only.
 * Run from web/:  MUNI_URL=http://localhost:8787 node e2e/entrance.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.MUNI_URL ?? 'http://localhost:8787'
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const addr = (p) => `${p}-${crypto.randomUUID().slice(0, 8)}@example.test`
const codeFor = (page, email) => page.evaluate(async (e) => (await fetch('/api/dev/inbox').then((r) => r.json())).filter((m) => m.to === e && /sign-in code/.test(m.subject))[0]?.subject.split(' ')[0], email)
const inviteLink = (page, email) => page.evaluate(async (e) => (await fetch('/api/dev/inbox').then((r) => r.json())).find((m) => m.to === e && /invited/.test(m.subject))?.body.split('\n').map((l) => l.trim()).find((l) => l.includes('/invite')), email)

/** Signs in through the UI; `name` is typed only if the name step appears. */
async function signIn(page, email, name) {
  await page.fill('input[type=email]', email)
  await page.click('button:has-text("Send me a code")')
  await page.waitForSelector('text=Check your inbox.')
  await page.fill('input[autocomplete="one-time-code"]', await codeFor(page, email))
  await page.click('button:has-text("Continue")')
  if (name) {
    await page.waitForSelector('text=What should we call you?')
    await page.fill('input[autocomplete="name"]', name)
    await page.click('button:has-text("Continue")')
  }
}

/** A named account created through the API, plus a workspace and a collecting sprint it facilitates. */
async function owner(browser) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(`${BASE}/signin`)
  const email = addr('owner')
  await signIn(page, email, 'Olivia Owner')
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'))
  const info = await page.evaluate(async () => {
    const csrf = document.cookie.match(/muni_csrf=([^;]+)/)[1]
    const post = (u, b) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(b) }).then((r) => r.json())
    const me = await fetch('/api/auth/me').then((r) => r.json())
    const ws = await post('/api/workspaces', { name: 'Synthetic team' })
    const d = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
    const s = await post(`/api/workspaces/${ws.id}/sprints`, { name: 'Sprint 7', timezone: 'UTC', starts_on: d(-3), ends_on: d(9), retro_date: d(10), retro_time: '10:00', participant_ids: [me.account_id], facilitator_id: me.account_id, reminders_enabled: false })
    await post(`/api/sprints/${s.id}/transition`, { to: 'collecting', confirm: true })
    return { ws: ws.id, sprint: s.id }
  })
  const invite = async (email, sprint = true) => {
    await page.evaluate(async ([ws, e, s]) => {
      const csrf = document.cookie.match(/muni_csrf=([^;]+)/)[1]
      await fetch(`/api/workspaces/${ws}/invitations`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ email: e, sprint_id: s ?? undefined }) })
    }, [info.ws, email, sprint ? info.sprint : null])
    await page.waitForTimeout(1200) // the email job runs after the response
    return inviteLink(page, email)
  }
  return { page, email, ...info, invite }
}

const browser = await chromium.launch()
try {
  // ── New account: name step, then the intended (validated) destination ──────────────────────
  {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto(`${BASE}/signin?next=${encodeURIComponent('/account')}`)
    check('No name field before verification', (await page.locator('input[autocomplete="name"]').count()) === 0)
    const email = addr('new')
    await page.fill('input[type=email]', email)
    await page.click('button:has-text("Send me a code")')
    await page.waitForSelector('text=Check your inbox.')
    check('Code step shows the address and a Change email action', (await page.locator(`text=${email}`).count()) > 0 && (await page.locator('button:has-text("Change email")').count()) === 1)
    const code = page.locator('input[autocomplete="one-time-code"]')
    check('Focus moves to the code input', await code.evaluate((el) => el === document.activeElement))
    check('Code input: numeric keyboard, one-time-code autofill, labelled', (await code.getAttribute('inputmode')) === 'numeric' && (await code.getAttribute('autocomplete')) === 'one-time-code' && (await page.locator('label:has-text("Code")').count()) === 1)
    check('Expiry comes from the server', (await page.locator('text=The code works once, for 10 minutes.').count()) === 1)
    const resend = page.locator('button:has-text("Send a new code")')
    check('Resend is visible but waits for the cooldown', (await resend.isDisabled()) && /in \d+s/.test(await resend.innerText()))

    // Paste with spaces and text: only the digits stay; leading zeros are kept when typed.
    await code.fill('')
    await code.pressSequentially('012 345')
    check('Leading zero kept, spaces dropped', (await code.inputValue()) === '012345')
    const real = await codeFor(page, email)
    const wrong = real === '000000' ? '111111' : '000000'
    await code.fill(wrong)
    await code.press('Enter')
    await page.waitForSelector('[role=alert]')
    const alert = await page.locator('[role=alert]').innerText()
    check('Wrong code: specific message with tries left, code kept', /doesn’t match/.test(alert) && /4 tries left/.test(alert) && (await code.inputValue()) === wrong, alert)

    // Double submission: Enter twice quickly sends one verification.
    let verifies = 0
    page.on('request', (r) => r.url().endsWith('/api/auth/verify') && verifies++)
    await code.fill(await codeFor(page, email))
    await code.press('Enter')
    await code.press('Enter').catch(() => {})
    await page.waitForSelector('text=What should we call you?')
    check('One verification request for a double Enter', verifies === 1, `requests=${verifies}`)
    check('New account is asked for a name (empty, not taken from the address)', (await page.locator('input[autocomplete="name"]').inputValue()) === '')
    check('Focus moves to the name input', await page.locator('input[autocomplete="name"]').evaluate((el) => el === document.activeElement))
    await page.fill('input[autocomplete="name"]', 'Nadia New')
    await page.click('button:has-text("Continue")')
    await page.waitForURL('**/account')
    check('After the name, continues to the intended destination', new URL(page.url()).pathname === '/account')
    const stored = await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage))
    check('Nothing about the code is kept in browser storage', !stored.includes(real))
    await ctx.close()
  }

  // ── Returning account skips the name; an unsafe next is ignored ─────────────────────────────
  {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto(`${BASE}/signin`)
    const email = addr('back')
    await signIn(page, email, 'Rosa Returning')
    await page.waitForURL((u) => !u.pathname.startsWith('/signin'))
    await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', headers: { 'x-csrf-token': document.cookie.match(/muni_csrf=([^;]+)/)[1] } }))
    // Wait out the resend cooldown for this address before asking again.
    await page.waitForTimeout(31_000)
    await page.goto(`${BASE}/signin?next=${encodeURIComponent('//evil.example/x')}`)
    await signIn(page, email, null)
    await page.waitForURL((u) => !u.pathname.startsWith('/signin'))
    check('Returning account goes straight in (no name step)', (await page.locator('text=What should we call you?').count()) === 0)
    check('Unsafe next is replaced by home', new URL(page.url()).origin === BASE && new URL(page.url()).pathname === '/', page.url())
    await page.goto(`${BASE}/signin`)
    await page.waitForURL((u) => !u.pathname.startsWith('/signin'))
    check('A signed-in visit to the entrance goes straight on', new URL(page.url()).pathname === '/')
    const me = await page.evaluate(() => fetch('/api/auth/me').then((r) => r.json()))
    check('The existing name was not overwritten', me.display_name === 'Rosa Returning')
    await ctx.close()
  }

  // ── Interrupted name step resumes on the same URL ─────────────────────────────────────────
  {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto(`${BASE}/signin`)
    const email = addr('resume')
    await page.fill('input[type=email]', email)
    await page.click('button:has-text("Send me a code")')
    await page.waitForSelector('text=Check your inbox.')
    await page.fill('input[autocomplete="one-time-code"]', await codeFor(page, email))
    await page.click('button:has-text("Continue")')
    await page.waitForSelector('text=What should we call you?')
    await page.goto(`${BASE}/account`) // closed the tab, came back to a deep link
    await page.waitForSelector('text=What should we call you?')
    check('Name step resumes on a deep link, URL kept', new URL(page.url()).pathname === '/account')
    await page.fill('input[autocomplete="name"]', 'Remy Resumed')
    await page.click('button:has-text("Continue")')
    await page.waitForSelector('h1:text-is("Account")')
    check('…and then the deep link opens', new URL(page.url()).pathname === '/account')
    const n = await page.evaluate(async (e) => (await fetch('/api/auth/me').then((r) => r.json())).email === e, email)
    check('Same account throughout', n)
    await ctx.close()
  }

  // ── Invitation: context kept through email, code, name and join ─────────────────────────────
  const o = await owner(browser)
  {
    const email = addr('invitee')
    const link = await o.invite(email)
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto(link.replace('http://localhost:8787', BASE))
    await page.waitForSelector('text=You’re invited.')
    const hash = new URL(page.url()).hash
    check('Invitation page names the invited address (masked)', (await page.locator('text=This invitation is for').innerText()).includes('•••'))
    // Joining asks first whether this person already uses Muni (so nobody starts a second account by accident).
    await page.click('button:has-text("I’m new to Muni")')
    await signIn(page, email, 'Ivy Invitee')
    await page.waitForSelector('text=Join Synthetic team?')
    check('Invitation kept through email, code and name', new URL(page.url()).hash === hash && new URL(page.url()).pathname === '/invite')
    await page.click('button:has-text("Join the workspace")')
    await page.waitForURL(`**/sprints/${o.sprint}`)
    check('Joining opens the sprint it was for', new URL(page.url()).pathname === `/sprints/${o.sprint}`)
    await ctx.close()
  }
  {
    // Signed in as someone else: a clear way out, no workspace name shown.
    const email = addr('meant')
    const link = await o.invite(email, false)
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto(`${BASE}/signin`)
    await signIn(page, addr('other'), 'Otto Other')
    await page.waitForURL((u) => !u.pathname.startsWith('/signin'))
    await page.goto(link.replace('http://localhost:8787', BASE))
    await page.waitForSelector('text=This invitation is for another address.')
    check('Wrong account: explained, workspace not named', (await page.locator('text=Synthetic team').count()) === 0)
    await page.goto(`${BASE}/invite#not-a-real-token`)
    await page.waitForSelector('text=This invitation can’t be used.')
    check('Unknown or expired invitation: clear outcome', true)
    await ctx.close()
  }

  // ── Resend after the cooldown; offline honesty; reduced motion; change email ────────────────
  {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await page.goto(`${BASE}/signin`)
    check('Reduced motion: no step animation', (await page.locator('.entrance-step').evaluate((el) => getComputedStyle(el).animationName)) === 'none')
    const email = addr('offline')
    await page.fill('input[type=email]', email)
    await ctx.setOffline(true)
    await page.click('button:has-text("Send me a code")')
    await page.waitForSelector('[role=alert]')
    check('Offline: honest message, nothing claimed sent', /offline/.test(await page.locator('[role=alert]').innerText()) && (await page.locator('text=Check your inbox.').count()) === 0)
    await ctx.setOffline(false)
    await page.click('button:has-text("Send me a code")')
    await page.waitForSelector('text=Check your inbox.')
    check('Retry works once back online', true)
    await page.click('button:has-text("Change email")')
    await page.waitForSelector('text=A moment to reflect.')
    check('Change email keeps the address and focuses it', (await page.locator('input[type=email]').inputValue()) === email && (await page.locator('input[type=email]').evaluate((el) => el === document.activeElement)))
    await page.click('button:has-text("Send me a code")')
    await page.waitForSelector('text=Check your inbox.')
    check('Asking again within the cooldown goes on to the code already sent', (await page.locator('text=a moment ago').count()) === 1)
    const first = await codeFor(page, email)
    await page.waitForTimeout(31_000)
    const resend = page.locator('button:has-text("Send a new code")')
    check('Resend becomes available after the cooldown', !(await resend.isDisabled()))
    await resend.click()
    await page.waitForSelector('text=A new code is on its way')
    const second = await codeFor(page, email)
    check('A new code was sent', !!second)
    if (second !== first) {
      await page.fill('input[autocomplete="one-time-code"]', first)
      await page.click('button:has-text("Continue")')
      await page.waitForSelector('[role=alert]')
      check('The older code no longer works', /doesn’t match/.test(await page.locator('[role=alert]').innerText()))
    }
    await ctx.close()
  }
} finally {
  await browser.close()
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
