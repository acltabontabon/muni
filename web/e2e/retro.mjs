/**
 * The live retro, end to end, in its four steps: look back → choose → talk → agree. The shared
 * stage (the facilitator's laptop, and a presenting screen) and two phones, following each other
 * without a refresh. The steps' housekeeping is checked where people see it: choosing opens the
 * vote, talking closes it and follows its order, opening the retro marks you here. Also: verdicts
 * on last time's experiment, invitations to speak and passing, adding without your name, notes
 * written on the screen, an idea from the talk becoming an experiment its owner accepts, ending the
 * retro, and phones. Synthetic accounts and text only.
 *
 * Run against a production build served by the Worker (the dev-only session endpoint must exist):
 *   MUNI_URL=http://localhost:8787 node e2e/retro.mjs      (SHOTS=dir to save screenshots)
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
  return { id: me.account_id, name, req, cookies: () => [...jar].map(([n, value]) => ({ name: n, value, domain: new URL(BASE).hostname, path: '/' })) }
}
const join = async (owner, wsId, who) => {
  const { url } = await owner.req('POST', `/api/workspaces/${wsId}/join-links`, { mode: 'direct', expires_in_hours: 24 })
  await who.req('POST', '/api/join/request', { token: url.split('#')[1] })
}

const browser = await chromium.launch()
async function open(who, { phone = false, ws } = {}) {
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1360, height: 860 }, isMobile: phone, hasTouch: phone, deviceScaleFactor: SHOTS ? 2 : 1 })
  await ctx.addCookies(who.cookies())
  if (ws) await ctx.addInitScript((w) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('muni.prefs', JSON.stringify({ lastWorkspace: w })); sessionStorage.setItem('seeded', '1') } }, ws)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  return { ctx, page, errors }
}
const shot = async (page, name, full = false) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full })
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
const text = (page, sel = 'main') => page.locator(sel).first().innerText()

// ── Setup: a team of three, last sprint's experiment (Ines owns it), and this sprint's thoughts in three themes.
const mara = await account('Mara Santos')
const ben = await account('Ben Okafor')
const ines = await account('Ines Duarte')
const ws = await mara.req('POST', '/api/workspaces', { name: `Payments ${tag}` })
await join(mara, ws.id, ben)
await join(mara, ws.id, ines)
const team = { participant_ids: [mara.id, ben.id, ines.id], facilitator_id: mara.id, reminders_enabled: false, timezone: 'Asia/Manila' }
const last = await mara.req('POST', `/api/workspaces/${ws.id}/sprints`, { name: `Sprint 13 ${tag}`, starts_on: d(-24), ends_on: d(-11), retro_date: d(-10), retro_time: '15:00', ...team })
await mara.req('POST', `/api/sprints/${last.id}/transition`, { to: 'collecting' })
await ben.req('POST', `/api/sprints/${last.id}/entries`, { body: 'Synthetic: reviews waited days', category: 'improve', idempotency_key: crypto.randomUUID() })
await mara.req('POST', `/api/sprints/${last.id}/transition`, { to: 'preparing', confirm: true })
await mara.req('POST', `/api/sprints/${last.id}/transition`, { to: 'live' })
await mara.req('POST', `/api/sprints/${last.id}/experiments`, { change_to_try: 'Keep twenty minutes after standup for first reviews, every day', success_signal: 'No PR waits more than a day for a first review', owner_account_id: ines.id })
const [past] = await mara.req('GET', `/api/sprints/${last.id}/experiments`)
await ines.req('POST', `/api/sprints/${last.id}/experiments/${past.id}/accept`, { accept: true })
await mara.req('POST', `/api/sprints/${last.id}/transition`, { to: 'completed' })

const sprint = await mara.req('POST', `/api/workspaces/${ws.id}/sprints`, { name: `Sprint 14 ${tag}`, starts_on: d(-10), ends_on: d(3), retro_date: d(4), retro_time: '15:00', ...team })
await mara.req('POST', `/api/sprints/${sprint.id}/transition`, { to: 'collecting' })
const THOUGHTS = [
  [ben, 'improve', 'Staging was down most of Wednesday, and nobody was sure who should bring it back.'],
  [ines, 'improve', 'The on-call runbook still pointed at the old staging cluster.'],
  [mara, 'stop', 'We found the expired certificate by accident, two hours into the outage.'],
  [ben, 'improve', 'Three PRs waited more than two days for a first review.'],
  [ines, 'keep', 'Small PRs were reviewed within the hour.'],
  [mara, 'proud', 'Pairing on the release checklist caught two gaps before Friday.'],
  [ben, 'keep', 'Writing the release notes as we went saved us an evening.'],
  [ines, null, 'Planning ran forty minutes over.'],
]
for (const [who, category, body] of THOUGHTS) await who.req('POST', `/api/sprints/${sprint.id}/entries`, { body: `${body}`, category, idempotency_key: crypto.randomUUID() })
await mara.req('POST', `/api/sprints/${sprint.id}/transition`, { to: 'preparing', confirm: true })
const all = (await mara.req('GET', `/api/sprints/${sprint.id}/themes`)).ungrouped
const ids = (...starts) => all.filter((e) => starts.some((s) => e.body.startsWith(s))).map((e) => e.id)
await mara.req('POST', `/api/sprints/${sprint.id}/themes`, { title: 'Who owns staging?', question: 'What would have made Wednesday’s outage shorter?', entry_ids: ids('Staging', 'The on-call', 'We found') })
await mara.req('POST', `/api/sprints/${sprint.id}/themes`, { title: 'Reviews that wait', question: 'What would get a first review the same day?', entry_ids: ids('Three PRs', 'Small PRs') })
await mara.req('POST', `/api/sprints/${sprint.id}/themes`, { title: 'What helped us ship', question: 'What should we make sure we keep doing?', entry_ids: ids('Pairing', 'Writing') })
await mara.req('POST', `/api/sprints/${sprint.id}/transition`, { to: 'live' })
const STAGE = `${BASE}/sprints/${sprint.id}/stage`
const ROOM = `${BASE}/sprints/${sprint.id}/room`

try {
  const F = await open(mara, { ws: ws.id })
  const B = await open(ben, { phone: true, ws: ws.id })
  const I = await open(ines, { phone: true, ws: ws.id })

  // ── 1 · Look back.
  await F.page.goto(STAGE)
  await F.page.locator('.retro-steps').waitFor()
  const steps = await F.page.locator('.retro-steps li').allInnerTexts()
  check('Four steps, each one question: Look back, Choose, Talk, Agree', steps.map((s) => s.replace(/\d/g, '').trim()).join('|') === 'Look back|Choose|Talk|Agree', steps.join(' · '))
  check('No reveal ceremony, no Discover, no Facilitate menu', (await F.page.locator('text=Open the sprint').count()) === 0 && !/Discover|Arrive|Remember/.test(await text(F.page, 'body')) && (await F.page.locator('button:has-text("Facilitate")').count()) === 0)
  check('Look back: last sprint’s experiment, with who owned it', /Keep twenty minutes after standup/.test(await text(F.page)) && /Ines Duarte/.test(await text(F.page)))
  await F.page.locator('.retro-two aside .retro-thought').first().waitFor()
  check('Look back: what this sprint is proud of and wants to keep', /Worth keeping/i.test(await text(F.page)) && /Pairing on the release checklist/.test(await text(F.page)) && /Small PRs were reviewed/.test(await text(F.page)) && !/Staging was down/.test(await F.page.locator('.retro-two aside').innerText()))
  await B.page.goto(ROOM)
  await I.page.goto(ROOM)
  await B.page.locator('.retro-title').waitFor()
  await I.page.locator('.retro-title').waitFor()
  await F.page.locator('.retro-here', { hasText: '3 here' }).waitFor({ timeout: 8000 }).catch(() => {})
  check('Opening the retro is being there: “3 here”, nobody ticked a box', /3 here/.test(await F.page.locator('.retro-rail-end').innerText()), await F.page.locator('.retro-rail-end').innerText())
  await F.page.locator('.retro-verdict', { hasText: 'Helped' }).click()
  await F.page.locator('.retro-verdict[aria-pressed="true"]', { hasText: 'Helped' }).waitFor()
  await I.page.locator('.retro-exp-verdict', { hasText: 'Helped' }).waitFor({ timeout: 8000 }).catch(() => {})
  check('A verdict on the stage reaches the phones', /Helped/.test(await I.page.locator('.retro-exps').innerText()))
  check('Phone, look back: one column, no sideways scroll', (await overflow(I.page)) <= 0)
  await shot(F.page, '01-look-back')
  await shot(I.page, '01-look-back-phone')

  // ── 2 · Choose: moving there opens the vote.
  await F.page.locator('.retro-rail-end button', { hasText: 'Next: Choose' }).click()
  await F.page.locator('.retro-title', { hasText: 'What matters' }).waitFor()
  await B.page.locator('.retro-vote').first().waitFor({ timeout: 8000 })
  check('Choosing opens the vote by itself: no Open voting button', (await F.page.locator('button:has-text("Open voting")').count()) === 0 && /Vote on your phone/.test(await text(F.page)))
  check('Phone: votes left, private, one per topic', /3 of 3 votes left/.test(await text(B.page)) || /of \d votes left/.test(await text(B.page)), (await B.page.locator('.retro-sub').innerText()))
  const voteFor = async (P, title) => P.page.locator('.retro-topic', { hasText: title }).locator('.retro-vote').click()
  await voteFor(B, 'Reviews that wait')
  await voteFor(B, 'Who owns staging?')
  await voteFor(I, 'Reviews that wait')
  await B.page.locator('.retro-topic', { hasText: 'Reviews that wait' }).locator('.retro-vote[aria-pressed="true"]').waitFor()
  await I.page.locator('.retro-topic', { hasText: 'Reviews that wait' }).locator('.retro-vote[aria-pressed="true"]').waitFor()
  check('No counts while the vote is open', (await F.page.locator('.retro-tally').count()) === 0)
  await B.page.locator('.retro-peek summary').first().click()
  check('Phone: a topic’s thoughts open under it, to read before voting', (await B.page.locator('.retro-peek[open] .retro-thought').count()) > 0)
  await shot(F.page, '02-choose')
  await shot(B.page, '02-choose-phone')

  // ── 3 · Talk: moving there closes the vote and opens the most-voted topic.
  await F.page.locator('.retro-rail-end button', { hasText: 'Next: Talk' }).click()
  await F.page.locator('.retro-talk-title').waitFor()
  check('Talking starts with the most-voted topic', (await F.page.locator('.retro-talk-title').innerText()) === 'Reviews that wait')
  check('…its question, and its thoughts exactly as written', /first review the same day/.test(await text(F.page)) && /Three PRs waited/.test(await text(F.page)))
  check('A clock for the topic is running', /for this topic/.test(await F.page.locator('.retro-clock').innerText()))
  await B.page.locator('h1', { hasText: 'Reviews that wait' }).waitFor({ timeout: 8000 })
  check('Phones follow to the same topic', (await I.page.locator('h1', { hasText: 'Reviews that wait' }).count()) === 1)
  const order = await F.page.locator('.retro-topicbar li').allInnerTexts()
  check('Topics in the vote’s order, then what isn’t in a theme', order.length === 4 && /Reviews/.test(order[0]) && /staging/.test(order[1]) && /Not in a theme/.test(order[3]), order.join(' · '))
  // Notes, written where they're read.
  await F.page.fill('textarea[aria-label="We’ll remember"]', 'A first review waits on whoever is free, so it waits on nobody')
  await F.page.keyboard.press('Enter')
  await F.page.locator('.retro-saved').first().waitFor()
  await F.page.fill('textarea[aria-label="We could try"]', 'Keep twenty minutes after standup for first reviews, every day')
  await F.page.locator('.retro-talk-title').click()
  await F.page.locator('.retro-saved').first().waitFor()
  await B.page.locator('.retro-phone-notes', { hasText: 'we could try' }).waitFor({ timeout: 8000 }).catch(() => {})
  check('Notes written on the stage reach the phones', /we’ll remember/.test(await B.page.locator('.retro-phone-notes').innerText()) && /we could try/.test(await B.page.locator('.retro-phone-notes').innerText()))
  // Voices: an invitation, and passing.
  await F.page.locator('.retro-voice-do button', { hasText: 'Invite someone' }).click()
  await F.page.locator('.retro-voice strong').waitFor()
  const invited = (await F.page.locator('.retro-voice strong').innerText()).trim()
  const inv = invited === 'Ben' ? B : I
  const other = invited === 'Ben' ? I : B
  await inv.page.locator('.retro-invite', { hasText: 'You’re invited' }).waitFor({ timeout: 8000 })
  check('The invited phone says so, and that passing is fine', (await inv.page.locator('button:has-text("Pass for now")').count()) === 1 && (await other.page.locator('.retro-invite').count()) === 0, invited)
  await shot(inv.page, '03-talk-invited-phone')
  await inv.page.locator('button:has-text("Pass for now")').click()
  await F.page.locator('.retro-voice strong', { hasText: invited === 'Ben' ? 'Ines' : 'Ben' }).waitFor({ timeout: 8000 }).catch(() => {})
  check('Passing moves the invitation on', !(await F.page.locator('.retro-voice').innerText()).includes(invited))
  await inv.page.locator('.retro-ready input').click()
  await inv.page.locator('.retro-ready input:checked').waitFor()
  // Adding without a name: waits for the facilitator, then shows without one.
  await I.page.fill('textarea[aria-label="Add something, without your name"]', 'Synthetic: I stopped asking for reviews because nobody seemed free')
  await I.page.getByRole('button', { name: 'Send' }).click()
  await F.page.locator('.retro-waiting').waitFor({ timeout: 8000 })
  check('The facilitator learns something waits, not who wrote it', /without their name/.test(await F.page.locator('.retro-waiting').innerText()) && !/Ines/.test(await F.page.locator('.retro-waiting').innerText()))
  await F.page.locator('.retro-waiting').click()
  await F.page.locator('.retro-added li', { hasText: 'stopped asking' }).waitFor()
  await B.page.locator('.retro-added-list li', { hasText: 'stopped asking' }).waitFor({ timeout: 8000 }).catch(() => {})
  check('Shown to the room without a name', (await B.page.locator('.retro-added-list li', { hasText: 'stopped asking' }).count()) === 1)
  await shot(F.page, '03-talk')
  await shot(B.page, '03-talk-phone', true)
  check('Phone, talk: no sideways scroll', (await overflow(B.page)) <= 0)
  // The next topic.
  await F.page.locator('.retro-rail-end button', { hasText: 'Next topic' }).click()
  await F.page.locator('.retro-talk-title', { hasText: 'Who owns staging?' }).waitFor()
  await F.page.locator('.retro-voice--quiet').waitFor({ timeout: 8000 }).catch(() => {})
  check('A new topic starts without anyone invited: the last topic’s invitation ends', (await B.page.locator('.retro-invite').count()) === 0 && (await I.page.locator('.retro-invite').count()) === 0 && (await F.page.locator('.retro-voice--quiet').count()) === 1)
  check('Next topic follows the order; the one before counts as discussed', (await F.page.locator('.retro-topicbar li[data-done]').count()) === 1 && /Reviews/.test(await F.page.locator('.retro-topicbar li[data-done]').innerText()))
  await F.page.fill('textarea[aria-label="We could try"]', 'Name a staging owner in every on-call handover')
  await F.page.keyboard.press('Enter')
  await F.page.locator('.retro-saved').first().waitFor()
  // A presenting screen: the same topic, no controls.
  const Pr = await open(mara)
  await Pr.page.goto(`${STAGE}?mode=present`)
  await Pr.page.locator('.retro-talk-title', { hasText: 'Who owns staging?' }).waitFor()
  check('Presenting: the same topic, and no controls at all', (await Pr.page.locator('.retro-rail-end button, .retro-clock-do, .retro-voice-do, textarea').count()) === 0 && /Name a staging owner/.test(await Pr.page.locator('.retro-margin').innerText()))
  await shot(Pr.page, '03-talk-presenting')
  await Pr.ctx.close()
  const Fp = await open(mara, { phone: true })
  await Fp.page.goto(STAGE)
  await Fp.page.locator('.retro-talk-title').waitFor()
  check('Facilitating from a phone: the stage fits, the controls stay in reach', (await overflow(Fp.page)) <= 0 && (await Fp.page.locator('.retro-rail-end button', { hasText: 'Next topic' }).isVisible()), `${await overflow(Fp.page)}px`)
  await shot(Fp.page, '03-talk-facilitator-phone', true)
  await Fp.ctx.close()

  // ── 4 · Agree: the ideas from the talk become experiments.
  await F.page.locator('.retro-steps button', { hasText: 'Agree' }).click()
  await F.page.locator('.retro-title', { hasText: 'What will we' }).waitFor()
  check('Agree: the ideas the talk left, by topic', (await F.page.locator('.retro-ideas li').count()) === 2 && /Name a staging owner/.test(await F.page.locator('.retro-ideas').innerText()))
  check('The clock stops outside the talk', (await F.page.locator('.retro-clock').count()) === 0)
  await F.page.locator('.retro-ideas li', { hasText: 'Name a staging owner' }).getByRole('button', { name: 'Make it an experiment' }).click()
  check('An idea seeds the experiment', (await F.page.inputValue('#ex-change')) === 'Name a staging owner in every on-call handover')
  await F.page.fill('#ex-change', 'Name a staging owner in every on-call handover, starting this sprint')
  await F.page.fill('#ex-signal', 'A staging incident has someone on it within fifteen minutes')
  await F.page.selectOption('#ex-owner', { label: 'Ben Okafor' }).catch(async () => F.page.selectOption('#ex-owner', ben.id))
  await F.page.getByRole('button', { name: 'Propose this experiment' }).click()
  await F.page.locator('.retro-exp', { hasText: 'Waiting for Ben Okafor' }).waitFor()
  await B.page.locator('.retro-invite', { hasText: 'Will you own this?' }).waitFor({ timeout: 8000 })
  await shot(B.page, '04-agree-owner-phone')
  await B.page.getByRole('button', { name: 'I’ll own this' }).click()
  await F.page.locator('.retro-exp', { hasText: 'Ben Okafor owns this' }).waitFor({ timeout: 8000 })
  check('The owner says yes on their phone; the stage shows it', true)
  check('The idea it came from says it’s now an experiment', /Experiment 1/.test(await F.page.locator('.retro-ideas li', { hasText: 'Who owns staging?' }).innerText()) && (await F.page.locator('.retro-ideas li', { hasText: 'Who owns staging?' }).getByRole('button').count()) === 0)
  await shot(F.page, '04-agree', true)

  // ── End the retro: everyone to the outcomes.
  await F.page.getByRole('button', { name: 'End the retro' }).click()
  await F.page.getByRole('dialog').getByRole('button', { name: 'End the retro' }).click()
  await F.page.waitForURL(`**/sprints/${sprint.id}`)
  await I.page.locator('text=The retro is').waitFor({ timeout: 10000 })
  check('Ending takes the facilitator to the outcomes; phones say it’s done', (await I.page.getByRole('button', { name: 'See the outcomes' }).count()) === 1)
  const stAfter = await mara.req('GET', `/api/sprints/${sprint.id}`)
  check('The sprint is done', stAfter.status === 'completed')
  const g = await mara.req('GET', `/api/sprints/${sprint.id}/themes`)
  check('Both topics talked about count as discussed; the third, not reached, doesn’t', g.themes.filter((t) => t.discussed).length === 2 && !g.themes.find((t) => t.title === 'What helped us ship').discussed)

  for (const [who, P] of [['Facilitator', F], ['Ben', B], ['Ines', I]]) check(`${who}: no page errors`, P.errors.length === 0, P.errors.slice(0, 2).join(' | '))
} catch (e) {
  check('Run completed', false, String(e).split('\n')[0])
} finally {
  await browser.close()
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
