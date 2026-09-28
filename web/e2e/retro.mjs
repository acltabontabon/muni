/**
 * The live retro as a meeting: a facilitator sharing the stage from a laptop, a presenting screen,
 * three people on phones and two more answering from elsewhere. Four steps (look back → choose →
 * talk → agree), and inside the talk the optional ways in: check-ins, "Add to this discussion",
 * checking an idea. Scenarios from a real call:
 *   a quiet participant contributes with one tap · someone shares a different view without speaking
 *   · only a few answer, and the meeting moves on · nobody answers · a good conversation starts, so
 *   the check-in is skipped · a simple topic ends without a poll or an action · an idea draws a
 *   concern · someone joins late, reconnects, comes back to a backgrounded phone, opens a second tab ·
 *   someone is typing when the topic changes · a topic is revisited · three topics in a row.
 * It also counts what each thing costs: taps, typing, waits, facilitator operations. That measures
 * effort, not engagement: whether people *want* to answer needs real teams.
 *
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
const cost = []
const spend = (who, what, taps, typed = 0, waits = 0) => cost.push({ who, what, taps, typed, waits })
const d = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
const tag = crypto.randomUUID().slice(0, 5)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function account(name) {
  const jar = new Map()
  const req = async (method, path, body, { ok = true } = {}) => {
    const csrf = jar.get('muni_csrf')
    const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', origin: BASE, 'x-muni-client': '5', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(csrf ? { 'x-csrf-token': csrf } : {}) }, body: body ? JSON.stringify(body) : undefined })
    for (const c of r.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(';')
      const i = kv.indexOf('=')
      jar.set(kv.slice(0, i), kv.slice(i + 1))
    }
    const t = await r.text()
    if (ok && !r.ok) throw new Error(`${method} ${path} ${r.status} ${t.slice(0, 200)}`)
    return ok ? (t ? JSON.parse(t) : null) : { status: r.status, body: t ? JSON.parse(t) : null }
  }
  const me = await req('POST', '/api/dev/session', { name, intro: 'done' })
  return { id: me.account_id, name, req, cookies: () => [...jar].map(([n, value]) => ({ name: n, value, domain: new URL(BASE).hostname, path: '/' })) }
}
const join = async (owner, wsId, who) => {
  const { url } = await owner.req('POST', `/api/workspaces/${wsId}/join-links`, { mode: 'direct', expires_in_hours: 24 })
  await who.req('POST', '/api/join/request', { token: url.split('#')[1] })
}

const browser = await chromium.launch()
async function open(who, { phone = false, size } = {}) {
  const ctx = await browser.newContext({ viewport: size ?? (phone ? { width: 390, height: 844 } : { width: 1360, height: 860 }), isMobile: phone, hasTouch: phone, deviceScaleFactor: SHOTS ? 2 : 1 })
  await ctx.addCookies(who.cookies())
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
const flat = (s) => s.replace(/,\s/g, ' ').replace(/\s+/g, ' ').trim()

// ── A team of six; last sprint's experiment; this sprint's thoughts in three themes.
const mara = await account('Mara Santos')
const ben = await account('Ben Okafor')
const ines = await account('Ines Duarte')
const aiko = await account('Aiko Tanaka')
const tomas = await account('Tomás Ibarra')
const sam = await account('Sam O’Neill')
const people = [ben, ines, aiko, tomas, sam]
const ws = await mara.req('POST', '/api/workspaces', { name: `Payments ${tag}` })
for (const p of people) await join(mara, ws.id, p)
const team = { participant_ids: [mara.id, ...people.map((p) => p.id)], facilitator_id: mara.id, reminders_enabled: false, timezone: 'Asia/Manila' }
const last = await mara.req('POST', `/api/workspaces/${ws.id}/sprints`, { name: `Sprint 13 ${tag}`, starts_on: d(-24), ends_on: d(-11), retro_date: d(-10), retro_time: '15:00', ...team })
await mara.req('POST', `/api/sprints/${last.id}/transition`, { to: 'collecting' })
await ben.req('POST', `/api/sprints/${last.id}/entries`, { body: 'Reviews waited days', category: 'improve', idempotency_key: crypto.randomUUID() })
await mara.req('POST', `/api/sprints/${last.id}/transition`, { to: 'preparing', confirm: true })
await mara.req('POST', `/api/sprints/${last.id}/transition`, { to: 'live' })
await mara.req('POST', `/api/sprints/${last.id}/experiments`, { change_to_try: 'Pair on the release checklist before every Friday cut', success_signal: 'No release-day surprises', owner_account_id: ines.id })
const [past] = await mara.req('GET', `/api/sprints/${last.id}/experiments`)
await ines.req('POST', `/api/sprints/${last.id}/experiments/${past.id}/accept`, { accept: true })
await mara.req('POST', `/api/sprints/${last.id}/transition`, { to: 'completed' })

const sprint = await mara.req('POST', `/api/workspaces/${ws.id}/sprints`, { name: `Sprint 14 ${tag}`, starts_on: d(-10), ends_on: d(3), retro_date: d(4), retro_time: '15:00', ...team })
await mara.req('POST', `/api/sprints/${sprint.id}/transition`, { to: 'collecting' })
const THOUGHTS = [
  [ben, 'improve', 'Three PRs waited more than two days for a first review.'],
  [ines, 'keep', 'Small PRs were reviewed within the hour.'],
  [tomas, 'improve', 'Testing kept getting squeezed at the end of the sprint.'],
  [aiko, 'improve', 'Staging was down most of Wednesday, and nobody was sure who should bring it back.'],
  [sam, 'stop', 'We found the expired certificate by accident, two hours into the outage.'],
  [mara, 'proud', 'Pairing on the release checklist caught two gaps before Friday.'],
  [ben, 'keep', 'Writing the release notes as we went saved us an evening.'],
]
for (const [who, category, body] of THOUGHTS) await who.req('POST', `/api/sprints/${sprint.id}/entries`, { body, category, idempotency_key: crypto.randomUUID() })
await mara.req('POST', `/api/sprints/${sprint.id}/transition`, { to: 'preparing', confirm: true })
const loose = (await mara.req('GET', `/api/sprints/${sprint.id}/themes`)).ungrouped
const ids = (...starts) => loose.filter((e) => starts.some((s) => e.body.startsWith(s))).map((e) => e.id)
await mara.req('POST', `/api/sprints/${sprint.id}/themes`, { title: 'Reviews that wait', question: 'What would get a first review the same day?', entry_ids: ids('Three PRs', 'Small PRs', 'Testing kept') })
await mara.req('POST', `/api/sprints/${sprint.id}/themes`, { title: 'Who owns staging?', question: 'What would have made Wednesday’s outage shorter?', entry_ids: ids('Staging', 'We found') })
await mara.req('POST', `/api/sprints/${sprint.id}/themes`, { title: 'What helped us ship', question: 'What should we keep doing?', entry_ids: ids('Pairing', 'Writing') })
const T = Object.fromEntries((await mara.req('GET', `/api/sprints/${sprint.id}/themes`)).themes.map((t) => [t.title, t.id]))
await mara.req('POST', `/api/sprints/${sprint.id}/transition`, { to: 'live' })
const STAGE = `${BASE}/sprints/${sprint.id}/stage`
const ROOM = `${BASE}/sprints/${sprint.id}/room`
const checkinsOf = (who) => who.req('GET', `/api/sprints/${sprint.id}/checkins`)
const answerAs = (who, id, body) => who.req('PUT', `/api/sprints/${sprint.id}/checkins/${id}/response`, body, { ok: false })

let S = null
try {
  const F = await open(mara)
  const Pr = await open(mara, { size: { width: 1280, height: 800 } })
  const B = await open(ben, { phone: true })
  const I = await open(ines, { phone: true })
  const A = await open(aiko, { phone: true })
  const phones = [B, I, A]

  // ── Look back and choose, briefly.
  await F.page.goto(STAGE)
  await F.page.locator('.retro-steps').waitFor()
  for (const P of phones) await P.page.goto(ROOM)
  // The room fills: faces light up in the rail, and each arrival is said once.
  await F.page.locator('.retro-arrival').first().waitFor({ timeout: 8000 })
  check('Arrivals are announced on the stage, in a line, and leave on their own', /Ben|Ines|Aiko/.test(await F.page.locator('.retro-arrivals').innerText()))
  await sleep(600)
  check('The rail shows who’s connected as faces, with a count', (await F.page.locator('.retro-room .retro-face[data-state="on"]').count()) >= 3 && /4\/\d/.test(await F.page.locator('.retro-room-n').innerText()))
  await shot(F.page, '01-arrivals')
  check('Look back shows the whole retro at a glance: four steps, with their minutes', (await F.page.locator('.retro-map li').count()) === 4 && /min/.test(await F.page.locator('.retro-map').innerText()))
  await F.page.locator('.retro-verdict', { hasText: 'Helped' }).click()
  await F.page.locator('.retro-rail-end button', { hasText: 'Next: Choose' }).click()
  await B.page.locator('.retro-vote').first().waitFor()
  check('Choose says why we vote: time for about three topics, the most-voted first', /time for about three of these 3 topics/.test(flat(await F.page.locator('.retro-sub').innerText())) && /most-voted go first/.test(await F.page.locator('.retro-sub').innerText()))
  check('…and how voting works, in the margin', /How voting works/i.test(await F.page.locator('.retro-margin').innerText()) && /Private/.test(await F.page.locator('.retro-margin').innerText()))
  check('Phones say the same, and show the votes as a purse', /roughly 3 of these 3/.test(flat(await B.page.locator('.retro-sub').innerText())) && (await B.page.locator('.vote-purse-coins i').count()) === 3)
  const vote = (who, title) => who.req('POST', `/api/sprints/${sprint.id}/votes`, { theme_id: T[title], cast: true })
  for (const w of [ben, ines, aiko]) await vote(w, 'Reviews that wait')
  for (const w of [ben, tomas]) await vote(w, 'Who owns staging?')
  await vote(sam, 'What helped us ship')
  await F.page.locator('.rm-big', { hasText: /^5/ }).waitFor({ timeout: 8000 })
  check('The facilitator sees how many have voted — never who', /5 of \d+ people/.test(flat(await F.page.locator('.rm-big').innerText())))
  await shot(F.page, '05-choose')
  await shot(B.page, '05b-choose-phone')
  await F.page.locator('.rm-block--lead').waitFor()
  await F.page.locator('.retro-rail-end button', { hasText: 'Next: Talk' }).click()
  await F.page.locator('.retro-talk-title', { hasText: 'Reviews that wait' }).waitFor()
  await Pr.page.goto(`${STAGE}?mode=present`)
  await Pr.page.locator('.retro-talk-title').waitFor()

  // ── Topic 1 · Reviews that wait.
  await B.page.locator('h1', { hasText: 'Reviews that wait' }).waitFor()
  check('Phones: the active topic first, one obvious thing to do (add), no check-in until asked', (await B.page.locator('.ci-ask').count()) === 0 && (await B.page.locator('.ad-open').count()) === 1)
  check('The horizon marks the topic being discussed: the sun on stop 1, on the stage and every phone', (await F.page.locator('.horizon li[data-state="now"]').innerText()).includes('Reviews that wait') && (await F.page.locator('.horizon-sun').count()) === 1 && (await B.page.locator('.horizon[data-compact] li[data-state="now"]').count()) === 1)
  check('The facilitator’s margin is in the order it’s used: clock, ask the room, notes', /Ask the room[\s\S]*We’ll remember/i.test(await F.page.locator('.retro-margin').innerText()))
  await F.page.locator('.retro-asks button', { hasText: 'Ask how it showed up' }).click()
  spend('Facilitator', 'ask how a topic showed up', 1)
  await Promise.all(phones.map((P) => P.page.locator('.ci-ask').waitFor({ timeout: 8000 })))
  check('Asking reaches every phone without a refresh', (await B.page.locator('.ci-question').innerText()) === 'How did this show up for you?')
  check('The presenting screen says it’s been asked, and shows no count', (await Pr.page.locator('.ci-live').count()) === 1 && !/so far|answered/.test(await text(Pr.page, 'body')))
  check('Answers say what they mean; not being affected isn’t disagreeing', (await B.page.locator('.ci-choice').allInnerTexts()).map((s) => s.trim()).join(' | ') === 'I felt this | Not in my work | I’d need context')
  await shot(B.page, '10-ask-phone')

  // Ben, quiet on the call: one tap. "Saved" only once the server has it.
  await B.page.route('**/checkins/*/response', async (route) => { await sleep(1200); await route.continue() })
  await B.page.locator('.ci-choice', { hasText: 'I felt this' }).click()
  await sleep(300)
  const during = { status: await B.page.locator('.ci-status').innerText(), checked: await B.page.locator('.ci-choice[aria-checked="true"]').count(), pending: await B.page.locator('.ci-choice[data-pending]').count() }
  check('While saving: “Saving…”, marked pending, never “Saved” early', /Saving/.test(during.status) && during.checked === 0 && during.pending === 1, JSON.stringify(during))
  await B.page.locator('.ci-choice[aria-checked="true"]', { hasText: 'I felt this' }).waitFor()
  await B.page.unroute('**/checkins/*/response')
  check('Then “Saved”, changeable until shared, the topic still in view', /Saved/.test(await B.page.locator('.ci-status').innerText()) && (await B.page.locator('h1', { hasText: 'Reviews that wait' }).isVisible()))
  spend('Ben (quiet)', 'answer a check-in', 1)
  await shot(B.page, '11-answered-phone')

  // Ines: a different experience, written, never spoken.
  await I.page.locator('.ci-choice', { hasText: 'Not in my work' }).click()
  await I.page.locator('.ci-choice[aria-checked="true"]').waitFor()
  await I.page.locator('.ci-ask button', { hasText: 'Add a line' }).click()
  await I.page.fill('textarea[aria-label="Your line (optional)"]', 'Our smaller tickets reached QE earlier')
  await I.page.locator('button', { hasText: 'Save line' }).click()
  await I.page.locator('.ci-your-line', { hasText: 'smaller tickets' }).waitFor()
  spend('Ines', 'answer + a line', 3, 38)
  // Aiko changes her mind before it's shared.
  await A.page.locator('.ci-choice', { hasText: 'I felt this' }).click()
  await A.page.locator('.ci-choice[aria-checked="true"]', { hasText: 'I felt this' }).waitFor()
  await A.page.locator('.ci-choice', { hasText: 'I’d need context' }).click()
  await A.page.locator('.ci-choice[aria-checked="true"]', { hasText: 'I’d need context' }).waitFor()
  check('Changing an answer before it’s shared: one answer, the new one', (await A.page.locator('.ci-choice[aria-checked="true"]').count()) === 1)
  // Tomás answers from his laptop; Sam doesn't answer at all.
  const [c1] = (await checkinsOf(tomas)).filter((c) => c.theme_id === T['Reviews that wait'])
  await answerAs(tomas, c1.id, { choice: 'felt', note: 'Acceptance criteria changed after development started.' })
  // A second tab of Ines's follows her own answer.
  const I2 = await open(ines, { phone: true })
  await I2.page.goto(ROOM)
  await I2.page.locator('.ci-choice[aria-checked="true"]', { hasText: 'Not in my work' }).waitFor({ timeout: 8000 })
  await I.page.locator('.ci-choice', { hasText: 'I felt this' }).click()
  await I2.page.locator('.ci-choice[aria-checked="true"]', { hasText: 'I felt this' }).waitFor({ timeout: 8000 }).catch(() => {})
  check('A second tab follows your own answer', (await I2.page.locator('.ci-choice[aria-checked="true"]', { hasText: 'I felt this' }).count()) === 1)
  await I.page.locator('.ci-choice', { hasText: 'Not in my work' }).click()
  await I.page.locator('.ci-choice[aria-checked="true"]', { hasText: 'Not in my work' }).waitFor()
  await I2.ctx.close()
  // What the facilitator knows, and what nobody else does.
  await F.page.locator('.retro-asks .retro-asking-n', { hasText: '4 answers so far' }).waitFor({ timeout: 8000 }).catch(() => {})
  check('The facilitator sees how many have answered — no names, no total to reach', (await F.page.locator('.retro-asks .retro-asking-n').innerText()) === '4 answers so far' && !/ of \d/.test(await F.page.locator('.retro-asks').innerText()), await F.page.locator('.retro-asks .retro-asking-n').innerText())
  const peek = (await checkinsOf(sam)).find((c) => c.id === c1.id)
  check('Before sharing, a participant’s API sees no answers, not even a count', peek.answers === null && peek.results === null && !JSON.stringify(peek).includes('Acceptance'))
  check('Phones show no count of who has answered', !/answers so far|answered/i.test(await text(A.page)))
  await shot(F.page, '12-asking-facilitator')

  // Share: something to talk about, immediately.
  await F.page.locator('.retro-asks .retro-ask--share').click()
  spend('Facilitator', 'share the answers', 1)
  await Pr.page.locator('.ci-moment .ci-tally').waitFor({ timeout: 8000 })
  const tally = flat(await Pr.page.locator('.ci-moment .ci-tally').innerText())
  check('Shared: counts in words, only answers given, no percentages', tally === '2 felt this · 1 not in their work · 1 needs context' && !/%/.test(tally), tally)
  const lines = await Pr.page.locator('.ci-moment .ci-lines li').allInnerTexts()
  check('…with the lines people added, each beside its answer, and no names', lines.length === 2 && lines.some((l) => /Not in my work[\s\S]*smaller tickets/.test(l)) && lines.some((l) => /I felt this[\s\S]*Acceptance criteria/.test(l)) && !people.some((p) => lines.join(' ').includes(p.name.split(' ')[0])))
  check('The conversation carries on: no “continue”, nothing to dismiss', (await F.page.locator('button:has-text("Continue"), button:has-text("Dismiss"), [role=dialog]').count()) === 0)
  await B.page.locator('.ci-moment .ci-tally').waitFor({ timeout: 8000 })
  check('Phones show the same, plus your own answer, privately', /You answered “I felt this”/.test(await B.page.locator('.ci-moment').innerText()) && (await B.page.locator('.ci-ask').count()) === 0)
  const lateSam = await answerAs(sam, c1.id, { choice: 'felt', note: 'late' })
  check('An answer after sharing is refused, and says why', lateSam.status === 409 && lateSam.body.code === 'checkin_shared' && /still here/.test(lateSam.body.error))
  await shot(Pr.page, '13-shared-presenting')
  await shot(B.page, '13-shared-phone', true)

  // An idea from the talk, checked: a concern is not outvoted.
  await F.page.fill('textarea[aria-label="We could try"]', 'Keep twenty minutes after standup for first reviews')
  await F.page.keyboard.press('Enter')
  await F.page.locator('.retro-note-group button', { hasText: 'Check it with the room' }).click()
  spend('Facilitator', 'write an idea, then check it', 1, 52)
  await B.page.locator('.ci-ask .ci-question', { hasText: 'Would trying this next sprint help?' }).waitFor({ timeout: 8000 })
  check('The check shows the idea’s words on the phone', /Keep twenty minutes/.test(await B.page.locator('.ci-ask').innerText()))
  await B.page.locator('.ci-choice', { hasText: 'I have a concern' }).click()
  await B.page.locator('.ci-choice[aria-checked="true"]').waitFor()
  await B.page.locator('.ci-ask button', { hasText: 'Add a line' }).click()
  await B.page.fill('textarea[aria-label="Your line (optional)"]', 'That’s the only focus time before lunch')
  await B.page.locator('button', { hasText: 'Save line' }).click()
  await B.page.locator('.ci-your-line').waitFor()
  spend('Ben (quiet)', 'raise a concern, with a line', 3, 39)
  await I.page.locator('.ci-choice', { hasText: 'Worth trying' }).click()
  await A.page.locator('.ci-choice', { hasText: 'Worth trying' }).click()
  await A.page.locator('.ci-choice[aria-checked="true"]').waitFor()
  await I.page.locator('.ci-choice[aria-checked="true"]').waitFor()
  const [c2] = (await checkinsOf(tomas)).filter((c) => c.kind === 'action')
  await answerAs(tomas, c2.id, { choice: 'worth' })
  await F.page.locator('.retro-note-group .retro-asking-n', { hasText: '4 answers' }).waitFor({ timeout: 8000 }).catch(() => {})
  await F.page.locator('.retro-note-group .retro-ask--share').click()
  spend('Facilitator', 'share the idea’s answers', 1)
  await Pr.page.locator('.ci-moment[data-kind="action"] .ci-tally').waitFor({ timeout: 8000 })
  const act = flat(await Pr.page.locator('.ci-moment[data-kind="action"]').innerText())
  check('A concern stays visible beside the majority, its line first', /3 worth trying · 1 concern/.test(act) && (await Pr.page.locator('.ci-moment[data-kind="action"] .ci-lines li').first().innerText()).includes('focus time'), act.slice(0, 140))
  check('Nothing calls it “endorsed” or “agreed”', !/endorse|agreed by|approved/i.test(await text(Pr.page, 'body')))
  await shot(Pr.page, '14-idea-checked-presenting')

  // Aiko adds a question without taking the floor.
  await A.page.locator('.ad-open').click()
  await A.page.locator('.ad-kind', { hasText: 'A question' }).click()
  await A.page.fill('textarea[aria-label="Add to this discussion"]', 'Could the twenty minutes move to after lunch on Thursdays?')
  await A.page.locator('.ad button', { hasText: 'Send' }).click()
  await A.page.locator('.ad-mine li', { hasText: 'Waiting for the facilitator' }).waitFor()
  spend('Aiko', 'add a question to the discussion', 3, 58)
  check('Her phone says it’s waiting, not shown yet', /Waiting for the facilitator to share it · question/.test(await A.page.locator('.ad-mine').innerText()))
  await F.page.locator('.retro-waiting').waitFor({ timeout: 8000 })
  check('The facilitator learns something waits — not who', /without a name/.test(await F.page.locator('.retro-waiting').innerText()) && !/Aiko/.test(await F.page.locator('.retro-margin').innerText()))
  check('The shared screen doesn’t announce it', (await Pr.page.locator('.retro-waiting').count()) === 0 && !/Thursdays/.test(await text(Pr.page, 'body')))
  await F.page.locator('.retro-waiting').click()
  spend('Facilitator', 'share what was added', 1)
  await Pr.page.locator('.retro-added li', { hasText: 'Thursdays' }).waitFor({ timeout: 8000 })
  check('Shared under the topic, apart from the thoughts, marked as a question, no name', /question/.test(await Pr.page.locator('.retro-added li').first().innerText()) && !/Aiko/.test(await Pr.page.locator('.retro-added').innerText()))
  await A.page.locator('.retro-thought--added', { hasText: 'Thursdays' }).locator('.retro-yours').waitFor({ timeout: 8000 })
  check('Once shared, it reads once — in the room’s list, marked as hers on her phone only', (await A.page.locator('.ad-mine li', { hasText: 'Thursdays' }).count()) === 0 && (await Pr.page.locator('.retro-yours').count()) === 0)
  await shot(F.page, '15-topic1-facilitator')
  await shot(Pr.page, '15-topic1-presenting', true)
  await shot(A.page, '15-topic1-phone', true)

  // ── Topic 2 · Who owns staging? A good conversation starts at once: no check-in, no idea — a line to remember.
  await F.page.locator('.retro-rail-end button', { hasText: 'Next topic' }).click()
  spend('Facilitator', 'next topic', 1)
  await F.page.locator('.retro-talk-title', { hasText: 'Who owns staging?' }).waitFor()
  await B.page.locator('h1', { hasText: 'Who owns staging?' }).waitFor({ timeout: 8000 })
  check('The next topic starts clean: no check-in carried over, nothing to catch up on', (await B.page.locator('.ci-ask').count()) === 0 && (await B.page.locator('.ci-moment').count()) === 0)
  await F.page.fill('textarea[aria-label="We’ll remember"]', 'Staging needs a named owner, the way on-call has one')
  await F.page.keyboard.press('Enter')
  await F.page.locator('.retro-saved').first().waitFor()
  spend('Facilitator', 'note what the room will remember', 0, 50)
  // Ben starts adding something… and the room moves on mid-sentence.
  await B.page.locator('.ad-open').click()
  await B.page.fill('textarea[aria-label="Add to this discussion"]', 'The runbook still points at the old cluster, so whoever is on call')
  await F.page.locator('.horizon button', { hasText: 'What helped us ship' }).click()
  await B.page.locator('h1', { hasText: 'What helped us ship' }).waitFor({ timeout: 8000 })
  const kept = await B.page.inputValue('textarea[aria-label="Add to this discussion"]').catch(() => '')
  check('Typing when the topic changes: the words stay, and say where they were going', kept.startsWith('The runbook') && /For “Who owns staging\?”/.test(await B.page.locator('.ad-elsewhere').innerText().catch(() => '')))
  await B.page.fill('textarea[aria-label="Add to this discussion"]', `${kept} can't find it.`)
  await B.page.locator('.ad button', { hasText: 'Send' }).click()
  await B.page.locator('.ad-open').waitFor()
  const mineB = (await ben.req('GET', `/api/sprints/${sprint.id}/meeting`)).my_context
  check('…and they go to that topic, not the one on screen', mineB.some((m) => m.theme_id === T['Who owns staging?'] && m.body.startsWith('The runbook')))
  await shot(B.page, '16-moved-on-phone', true)

  // ── Topic 3 · What helped us ship. Asked; one answer; a line caught by the share.
  await F.page.locator('.retro-asks button', { hasText: 'Ask how it showed up' }).click()
  await I.page.locator('.ci-ask').waitFor({ timeout: 8000 })
  await I.page.locator('.ci-choice', { hasText: 'I felt this' }).click()
  await I.page.locator('.ci-choice[aria-checked="true"]').waitFor()
  await I.page.locator('.ci-ask button', { hasText: 'Add a line' }).click()
  await I.page.fill('textarea[aria-label="Your line (optional)"]', 'The checklist pairing only worked because Sam had time')
  // Sam joins late, mid-check-in: straight into the current topic and its question.
  S = await open(sam, { phone: true })
  await S.page.goto(ROOM)
  await S.page.locator('.ci-ask').waitFor({ timeout: 8000 })
  check('A late arrival lands on the current topic and its question — no earlier check-ins to do', (await S.page.locator('h1', { hasText: 'What helped us ship' }).count()) === 1 && (await S.page.locator('.ci-ask').count()) === 1)
  await F.page.locator('.retro-asks .retro-ask--share').click()
  await I.page.locator('.ci-leftover').waitFor({ timeout: 8000 })
  check('Shared while someone was writing: their line isn’t lost, and they’re told plainly', /before your line was saved/.test(await I.page.locator('.ci-leftover').innerText()))
  await I.page.locator('.ci-leftover button', { hasText: 'Add it to the discussion' }).click()
  check('…and can add it to the discussion instead, in one tap', (await I.page.inputValue('textarea[aria-label="Add to this discussion"]')).startsWith('The checklist pairing'))
  await I.page.locator('.ad button', { hasText: 'Send' }).click()
  await I.page.locator('.ad-mine li', { hasText: 'checklist pairing' }).waitFor()
  await Pr.page.locator('.ci-moment .ci-tally').waitFor({ timeout: 8000 })
  const oneTally = flat(await Pr.page.locator('.ci-moment .ci-tally').innerText())
  check('Sparse: one answer reads as one answer, not “the team”', oneTally === '1 felt this' && !/team|everyone|most/i.test(await Pr.page.locator('.ci-moment').innerText()), oneTally)

  // Reconnecting, and a phone put down and picked up again.
  await A.ctx.setOffline(true)
  await A.page.evaluate(() => window.dispatchEvent(new Event('offline')))
  await A.page.locator('text=Reconnecting to the retro').waitFor({ timeout: 15000 }).catch(() => {})
  await A.page.locator('.ad-open').click()
  await A.page.fill('textarea[aria-label="Add to this discussion"]', 'Draft written while offline')
  check('Offline: live actions pause, what you write stays', (await A.page.locator('.ad button', { hasText: 'Send' }).isDisabled()) && (await A.page.locator('text=Reconnecting to the retro').count()) === 1)
  await A.ctx.setOffline(false)
  await A.page.evaluate(() => window.dispatchEvent(new Event('online')))
  await A.page.waitForFunction(() => !document.body.innerText.includes('Reconnecting to the retro'), null, { timeout: 30000 }).catch(() => {})
  check('Back online: reconnected, the draft still there', (await A.page.inputValue('textarea[aria-label="Add to this discussion"]')) === 'Draft written while offline' && (await A.page.locator('text=Reconnecting to the retro').count()) === 0)
  // The facilitator revisits the first topic while Aiko's phone is in her pocket.
  await A.page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')) })
  await F.page.locator('.horizon button', { hasText: 'Reviews that wait' }).click()
  await F.page.locator('.retro-talk-title', { hasText: 'Reviews that wait' }).waitFor()
  check('Revisiting a topic: its answers are still there, nothing reset', (await F.page.locator('.ci-moment').count()) === 2 && /2 felt this/.test(await F.page.locator('.ci-moment').first().innerText()))
  await A.page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')) })
  await A.page.locator('h1', { hasText: 'Reviews that wait' }).waitFor({ timeout: 8000 })
  check('A phone picked up again shows where the room is now, and keeps the draft for where it was written', (await A.page.locator('.ad-elsewhere').count()) === 1 && (await A.page.inputValue('textarea[aria-label="Add to this discussion"]')) === 'Draft written while offline')
  await A.page.fill('textarea[aria-label="Add to this discussion"]', '')
  await A.page.locator('.ad-box button', { hasText: 'Not now' }).click()

  // Topic 2 again: a quick check-in nobody answers. The facilitator shares — and nothing awkward happens.
  await F.page.locator('.horizon button', { hasText: 'Who owns staging?' }).click()
  await F.page.locator('.retro-talk-title', { hasText: 'Who owns staging?' }).waitFor()
  await F.page.locator('.retro-asks button', { hasText: 'Ask how it showed up' }).click()
  await F.page.locator('.retro-asks .retro-asking-n', { hasText: 'no answers yet' }).waitFor()
  await F.page.locator('.retro-asks .retro-ask--share').click()
  await F.page.locator('.retro-asks .retro-ask-hint', { hasText: 'no answers came in' }).waitFor({ timeout: 8000 })
  await sleep(600)
  check('Nobody answers: no result block, no “0 responses” on the shared screen; one quiet line for the facilitator', (await Pr.page.locator('.ci-moment').count()) === 0 && !/0 (felt|responses|answers)/.test(await text(Pr.page, 'body')))
  for (const [n, P] of [['Ben', B], ['Ines', I], ['Aiko', A], ['Sam', S]]) check(`${n}: no sideways scroll on the phone`, (await overflow(P.page)) <= 0)

  // ── Agree: the checked idea, as it came back, becomes an experiment with a willing owner.
  await F.page.locator('.retro-steps button', { hasText: 'Agree' }).click()
  await F.page.locator('.retro-title', { hasText: 'What will we' }).waitFor()
  check('The idea shows what the room said — counts and the concern, not a verdict', /3 worth trying · 1 concern/.test(flat(await F.page.locator('.retro-ideas').innerText())) && /focus time/.test(await F.page.locator('.retro-ideas').innerText()))
  await F.page.locator('.retro-ideas li', { hasText: 'Reviews that wait' }).getByRole('button', { name: 'Use this idea' }).click()
  {
    const filled = await F.page.inputValue('#ex-change')
    const from = await F.page.locator('.exp-form-from').innerText().catch(() => '')
    const focused = await F.page.evaluate(() => document.activeElement?.id)
    check('Using an idea fills the form, names its theme, and puts the cursor there', filled.length > 0 && from.includes('Reviews that wait') && focused === 'ex-change', JSON.stringify({ filled, from, focused }))
  }
  await F.page.fill('#ex-signal', 'No PR waits more than a day for a first review')
  await F.page.selectOption('#ex-owner', { label: 'Ines Duarte' }).catch(async () => F.page.selectOption('#ex-owner', ines.id))
  await F.page.getByRole('button', { name: 'Add experiment' }).click()
  await I.page.locator('.retro-invite', { hasText: 'Will you own this?' }).waitFor({ timeout: 8000 })
  await I.page.getByRole('button', { name: 'I’ll own this' }).click()
  await F.page.locator('.retro-exp', { hasText: 'Ines Duarte owns this' }).waitFor({ timeout: 8000 })
  check('Only the owner is asked anything; everyone else fills in nothing', (await B.page.locator('.retro-invite, input:not([type=hidden]), select').count()) === 0)
  // A vague wording gets a suggestion, never a wall: the facilitator can keep it as written.
  await F.page.fill('#ex-change', 'For next sprint be better')
  await F.page.fill('#ex-signal', 'We feel it')
  await F.page.getByRole('button', { name: /^Add (another )?experiment$/ }).click()
  await F.page.locator('.exp-nudge').waitFor()
  check('A vague experiment is nudged, and the button offers to add it as it is', (await F.page.getByRole('button', { name: 'Add it as it is' }).count()) === 1)
  await F.page.getByRole('button', { name: 'Add it as it is' }).click()
  await F.page.locator('.retro-exp', { hasText: 'For next sprint be better' }).waitFor({ timeout: 8000 })
  check('…and it is added', true)
  check('The count says how far the room has got', /2 of up to 3/.test(await F.page.locator('.retro-col-title').first().innerText()))
  await shot(F.page, '17-agree', true)
  await shot(Pr.page, '17b-agree-presenting', true)
  await F.page.getByRole('button', { name: 'End the retro' }).click()
  await F.page.getByRole('dialog').getByRole('button', { name: 'End the retro' }).click()
  await F.page.waitForURL(`**/sprints/${sprint.id}`)
  await B.page.locator('text=The retro is').waitFor({ timeout: 10000 })
  check('Ending takes everyone to the outcomes', true)

  // ── The recap: who came, what we'll try, what we talked about — the same page for everyone.
  await F.page.locator('.recap-head').waitFor({ timeout: 10000 })
  const head = flat(await F.page.locator('.recap-head').innerText())
  check('The recap says when the retro was, how long it took, and who came — as faces', /minute/i.test(head) && /came/.test(head) && (await F.page.locator('.recap-people li[data-here]').count()) >= 4)
  check('What we’ll try comes first, each with its owner', (await F.page.locator('.recap-exp').count()) >= 1 && /owns this|Waiting for/.test(await F.page.locator('.recap-exp').first().innerText()))
  check('What we talked about: a line per topic, with votes and what the room kept', (await F.page.locator('.recap-topic').count()) === 3 && /we’ll remember|we could try/.test(await F.page.locator('.recap-topics').innerText()))
  check('The facilitator can write the recap in place', (await F.page.locator('textarea[aria-label="Recap (Markdown)"]').count()) === 1)
  await F.page.locator('textarea[aria-label="Recap (Markdown)"]').fill('# Sprint 14\n\nWe spent most of the hour on reviews.\n\n- Keep twenty minutes after standup\n- Name a staging owner')
  await F.page.getByRole('button', { name: 'Publish', exact: true }).click()
  await F.page.locator('.recap-letter h3', { hasText: 'Sprint 14' }).waitFor({ timeout: 8000 })
  check('Published, it reads as text — a heading, a paragraph, a list — not Markdown', (await F.page.locator('.recap-letter li').count()) === 2 && !/#/.test(await F.page.locator('.recap-letter').innerText()))
  await shot(F.page, '18-recap-facilitator', true)
  await B.page.goto(`${BASE}/sprints/${sprint.id}`)
  await B.page.locator('.recap-letter').waitFor({ timeout: 10000 })
  check('A participant sees the same recap, without the tools', (await B.page.locator('textarea[aria-label="Recap (Markdown)"]').count()) === 0 && (await B.page.locator('.recap-exp').count()) >= 1)
  check('Recap on a phone: no sideways scroll', (await overflow(B.page)) <= 0)
  await shot(B.page, '18b-recap-phone', true)

  for (const [who, P] of [['Facilitator', F], ['Presenting', Pr], ['Ben', B], ['Ines', I], ['Aiko', A], ['Sam', S]]) check(`${who}: no page errors`, P.errors.length === 0, P.errors.slice(0, 2).join(' | '))
} catch (e) {
  check('Run completed', false, String(e).split('\n').slice(0, 3).join(' '))
  if (SHOTS) for (const [i, pg] of browser.contexts().flatMap((c) => c.pages()).entries()) await pg.screenshot({ path: `${SHOTS}/failure-${i}.png` }).catch(() => {})
} finally {
  await browser.close()
}
console.log('\nWhat it cost (taps · characters typed · waits):')
for (const c of cost) console.log(`  ${c.who.padEnd(14)} ${c.what.padEnd(40)} ${c.taps} · ${c.typed} · ${c.waits}`)
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
