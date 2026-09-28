/** Experiments, ownership, recap and exports after the retro. */
import { describe, expect, it } from 'vitest'
import { endSentence } from '../src/routes/commitments'
import { closeCollection, del, entry, get, go, ids, patch, post, put, req, sprint, team, type User } from './harness'

const CHANGE = 'For the next sprint, reserve a 15-minute daily review window'
const SIGNAL = 'PRs spend less time waiting'

async function liveSprint(owner: User, members: User[], ws: string) {
  const s = await sprint(owner, members, ws, 'collecting')
  await entry(members[0], s, 'improve', 'reviews take days')
  const entries = await closeCollection(owner, s)
  const g = await post(`/api/sprints/${s}/themes`, owner, { title: 'Review turnaround', entry_ids: ids(entries) })
  const theme = g.body.themes[0].id as string
  await go(owner, s, 'ready')
  await go(owner, s, 'live')
  return { s, theme }
}
const propose = (u: User, s: string, body: Record<string, unknown>) => post(`/api/sprints/${s}/experiments`, u, { change_to_try: CHANGE, success_signal: SIGNAL, ...body })

describe('commitments', () => {
  it('nudges vague experiments towards a concrete change, and keeps them when the facilitator says so', async () => {
    const { owner, members, ws } = await team(1)
    const { s, theme } = await liveSprint(owner, members, ws)
    for (const change of ['communicate better', 'We should try harder next time', 'be more careful', 'Improve communication across the team', 'Fix it']) {
      const r = await propose(owner, s, { change_to_try: change })
      expect(r.status, change).toBe(422)
      expect(r.body.code).toBe('vague')
      expect(r.body.error).toContain('reads as an intention rather than a change')
      expect(r.body.error).toContain('For example')
    }
    expect((await propose(owner, s, { success_signal: '' })).status).toBe(400)
    expect((await propose(members[0], s, {})).status).toBe(403)
    const ok = await propose(owner, s, { theme_id: theme })
    expect(ok.status).toBe(200)
    expect(ok.body).toHaveLength(1)
    expect(ok.body[0]).toMatchObject({ change_to_try: CHANGE, success_signal: SIGNAL, theme_id: theme, theme_title: 'Review turnaround', status: 'proposed', owner_account_id: null, owner_name: null, owner_accepted: false, review_on: '2026-10-11' })
    // Editing into vagueness is nudged the same way.
    expect((await patch(`/api/sprints/${s}/experiments/${ok.body[0].id}`, owner, { change_to_try: 'do better' })).status).toBe(422)
    // Advice, not a gate: the room keeps its own words when it says so.
    const kept = await propose(owner, s, { change_to_try: 'For next sprint be better', accept_vague: true })
    expect(kept.status).toBe(200)
    expect(kept.body.map((e: { change_to_try: string }) => e.change_to_try)).toContain('For next sprint be better')
    expect((await patch(`/api/sprints/${s}/experiments/${ok.body[0].id}`, owner, { change_to_try: 'do better', accept_vague: true })).status).toBe(200)
    // Not before the retro.
    const early = await sprint(owner, members, ws, 'collecting')
    expect((await propose(owner, early, {})).status).toBe(409)
  })

  it('applies a soft limit of three experiments with an explicit override', async () => {
    const { owner, members, ws } = await team(1)
    const { s } = await liveSprint(owner, members, ws)
    for (let i = 0; i < 3; i++) expect((await propose(owner, s, { change_to_try: `${CHANGE} ${i}` })).status).toBe(200)
    const fourth = await propose(owner, s, { change_to_try: `${CHANGE} 4` })
    expect(fourth.status).toBe(409)
    expect(fourth.body.error).toContain('three experiments is plenty')
    expect((await get(`/api/sprints/${s}/experiments`, members[0])).body).toHaveLength(3)
    const forced = await propose(owner, s, { change_to_try: `${CHANGE} 4`, override_limit: true })
    expect(forced.status).toBe(200)
    expect(forced.body).toHaveLength(4)
    // The facilitator can drop an unreviewed one.
    expect((await del(`/api/sprints/${s}/experiments/${forced.body[3].id}`, owner)).status).toBe(200)
    expect((await get(`/api/sprints/${s}/experiments`, owner)).body).toHaveLength(3)
    expect((await del(`/api/sprints/${s}/experiments/${forced.body[0].id}`, members[0])).status).toBe(403)
  })

  it('needs the named owner to accept, and a decline clears the nomination', async () => {
    const { owner, members, ws } = await team(2)
    const { s } = await liveSprint(owner, members, ws)
    expect((await propose(owner, s, { owner_account_id: crypto.randomUUID() })).status).toBe(400)
    const r = await propose(owner, s, { owner_account_id: members[0].account_id })
    expect(r.status).toBe(200)
    const id = r.body[0].id as string
    expect(r.body[0]).toMatchObject({ status: 'proposed', owner_account_id: members[0].account_id, owner_name: 'Member 0', owner_accepted: false })
    // Nobody but the nominee accepts; status can't be forced to accepted.
    expect((await post(`/api/sprints/${s}/experiments/${id}/accept`, members[1], { accept: true })).status).toBe(409)
    expect((await post(`/api/sprints/${s}/experiments/${id}/accept`, owner, { accept: true })).status).toBe(409)
    expect((await patch(`/api/sprints/${s}/experiments/${id}`, owner, { status: 'accepted' })).status).toBe(400)
    const accepted = await post(`/api/sprints/${s}/experiments/${id}/accept`, members[0], { accept: true })
    expect(accepted.status).toBe(200)
    expect(accepted.body[0]).toMatchObject({ status: 'accepted', owner_accepted: true })
    expect((await post(`/api/sprints/${s}/experiments/${id}/accept`, members[0], { accept: true })).status).toBe(409)
    // Renominating resets acceptance; declining clears the owner.
    const renom = await patch(`/api/sprints/${s}/experiments/${id}`, owner, { owner_account_id: members[1].account_id })
    expect(renom.body[0]).toMatchObject({ status: 'proposed', owner_account_id: members[1].account_id, owner_accepted: false })
    expect((await patch(`/api/sprints/${s}/experiments/${id}`, members[1], { owner_account_id: members[0].account_id })).status).toBe(403)
    const declined = await post(`/api/sprints/${s}/experiments/${id}/accept`, members[1], { accept: false })
    expect(declined.status).toBe(200)
    expect(declined.body[0]).toMatchObject({ status: 'proposed', owner_account_id: null, owner_name: null, owner_accepted: false })
    // The owner may edit their own experiment's wording; other participants may not.
    await patch(`/api/sprints/${s}/experiments/${id}`, owner, { owner_account_id: members[0].account_id })
    expect((await patch(`/api/sprints/${s}/experiments/${id}`, members[0], { success_signal: 'fewer reopened PRs' })).status).toBe(200)
    expect((await patch(`/api/sprints/${s}/experiments/${id}`, members[1], { success_signal: 'x' })).status).toBe(403)
  })

  it('brings previous experiments back for the next sprint, with their outcomes', async () => {
    const { owner, members, ws } = await team(2)
    const { s } = await liveSprint(owner, members, ws)
    const r = await propose(owner, s, { owner_account_id: members[0].account_id })
    const id = r.body[0].id as string
    const unowned = await propose(owner, s, { change_to_try: `${CHANGE} (never picked up)` })
    void unowned
    await post(`/api/sprints/${s}/experiments/${id}/accept`, members[0], { accept: true })
    await go(owner, s, 'completed')
    // Review the outcome after the sprint.
    const reviewed = await patch(`/api/sprints/${s}/experiments/${id}`, members[0], { status: 'helped', outcome_note: 'review time halved' })
    expect(reviewed.status).toBe(200)
    expect(reviewed.body[0]).toMatchObject({ status: 'helped', outcome_note: 'review time halved' })
    expect(reviewed.body[0].reviewed_at).not.toBeNull()
    // A reviewed experiment can no longer be deleted.
    await del(`/api/sprints/${s}/experiments/${id}`, owner)
    expect((await get(`/api/sprints/${s}/experiments`, owner)).body).toHaveLength(2)
    const next = await sprint(owner, members, ws, 'collecting', { starts_on: '2026-09-28', ends_on: '2026-10-11', retro_date: '2026-10-12' })
    const prev = await get(`/api/sprints/${next}/experiments/previous`, members[1])
    expect(prev.status).toBe(200)
    expect(prev.body).toHaveLength(1) // the never-accepted proposal stays behind
    expect(prev.body[0]).toMatchObject({ id, sprint_id: s, sprint_name: 'Sprint T', status: 'helped', owner_name: 'Member 0' })
    expect((await get(`/api/sprints/${next}`, owner)).body.previous_sprint_id).toBe(s)
    expect((await get(`/api/sprints/${s}/experiments/previous`, owner)).body).toHaveLength(0)
    // Workspace-wide list for members.
    expect((await get(`/api/workspaces/${ws}/experiments`, members[1])).body).toHaveLength(2)
  })

  it('generates a recap that participants see only once it is published', async () => {
    const { owner, members, ws } = await team(1)
    const ready = await sprint(owner, members, ws, 'ready')
    expect((await put(`/api/sprints/${ready}/recap`, owner, {})).status).toBe(409)
    const { s, theme } = await liveSprint(owner, members, ws)
    await put(`/api/sprints/${s}/meeting/notes/${theme}`, owner, { takeaway: 'Pair on big reviews' })
    await post(`/api/sprints/${s}/meeting/command`, owner, { expected_version: 1, command: { type: 'mark_discussed', theme_id: theme, discussed: true } })
    await propose(owner, s, { owner_account_id: members[0].account_id })
    expect((await put(`/api/sprints/${s}/recap`, members[0], {})).status).toBe(403)
    const draft = await put(`/api/sprints/${s}/recap`, owner, {})
    expect(draft.status).toBe(200)
    expect(draft.body).toMatchObject({ exists: true, draft_source: 'generated', published_at: null })
    expect(draft.body.body).toContain('# Sprint T — retro recap')
    expect(draft.body.body).toContain('1 observations were captured during the sprint and grouped into 1 themes')
    expect(draft.body.body).toContain('### Review turnaround')
    expect(draft.body.body).toContain('**Takeaway:** Pair on big reviews')
    expect(draft.body.body).toContain(`- **${CHANGE}** — success signal: ${SIGNAL}. Review on 2026-10-11. (proposed owner: Member 0 (not yet accepted))`)
    expect(draft.body.body).not.toContain('reviews take days')
    // Participants see nothing yet.
    const hidden = await get(`/api/sprints/${s}/recap`, members[0])
    expect(hidden.body).toMatchObject({ exists: false, body: '' })
    expect((await get(`/api/sprints/${s}/recap`, owner)).body.exists).toBe(true)
    const published = await put(`/api/sprints/${s}/recap`, owner, { body: 'Edited recap: we will pair on big reviews.', publish: true })
    expect(published.body).toMatchObject({ draft_source: 'manual' })
    expect(published.body.published_at).not.toBeNull()
    const visible = await get(`/api/sprints/${s}/recap`, members[0])
    expect(visible.body.exists).toBe(true)
    expect(visible.body.body).toBe('Edited recap: we will pair on big reviews.')
    // The published recap heads the summary export for everyone.
    await go(owner, s, 'completed')
    const md = await req<string>('GET', `/api/sprints/${s}/export.md`, members[0])
    expect(md.status).toBe(200)
    expect(md.body.startsWith('Edited recap: we will pair on big reviews.')).toBe(true)
  })

  it('drafts the recap without doubling punctuation the team already wrote', async () => {
    expect(endSentence('PRs spend less time waiting')).toBe('PRs spend less time waiting.')
    expect(endSentence('Do PRs wait less than a day?')).toBe('Do PRs wait less than a day?')
    expect(endSentence('No reverts!')).toBe('No reverts!')
    expect(endSentence('Fewer pings.  ')).toBe('Fewer pings.')
    const { owner, members, ws } = await team(1)
    const { s } = await liveSprint(owner, members, ws)
    await propose(owner, s, { success_signal: 'Do PRs wait less than a day?' })
    const draft = await put(`/api/sprints/${s}/recap`, owner, {})
    expect(draft.body.body).toContain('success signal: Do PRs wait less than a day? Review on')
    expect(draft.body.body).not.toMatch(/[?!.]\./)
  })

  it('exports summary and raw views after completion', async () => {
    const { owner, members, ws } = await team(1)
    const { s, theme } = await liveSprint(owner, members, ws)
    await propose(owner, s, { theme_id: theme, owner_account_id: members[0].account_id })
    await post(`/api/sprints/${s}/experiments/${(await get(`/api/sprints/${s}/experiments`, owner)).body[0].id}/accept`, members[0], { accept: true })
    await put(`/api/sprints/${s}/recap`, owner, { publish: true })
    expect((await go(owner, s, 'completed')).status).toBe(200)
    expect((await get(`/api/sprints/${s}`, owner)).body.completed_at).not.toBeNull()
    const md = await req<string>('GET', `/api/sprints/${s}/export.md`, members[0])
    expect(md.status).toBe(200)
    expect(md.headers.get('content-type')).toContain('text/markdown')
    expect(md.headers.get('content-disposition')).toContain('sprint-t-retro.md')
    expect(md.body).toContain('## Themes')
    expect(md.body).toContain('### Review turnaround')
    expect(md.body).toContain('1 entries')
    expect(md.body).toContain('owner: Member 0')
    expect(md.body).not.toContain('reviews take days')
    expect(md.body).not.toContain(members[0].email)
    const raw = await req<string>('GET', `/api/sprints/${s}/export.md?scope=raw`, owner)
    expect(raw.status).toBe(200)
    expect(raw.body).toContain('- [improve] reviews take days')
    const csv = await req<string>('GET', `/api/sprints/${s}/export.csv`, members[0])
    expect(csv.status).toBe(200)
    expect(csv.headers.get('content-type')).toContain('text/csv')
    const lines = csv.body.split('\r\n').filter(Boolean)
    expect(lines[0]).toBe('"theme","summary","entries","votes","parked","needs_attention"')
    expect(lines[1]).toBe('"Review turnaround","","1","","false","false"')
    expect(lines).toContain('"experiment","success_signal","owner","review_on","status","outcome"')
    expect(lines.at(-1)).toBe(`"${CHANGE}","${SIGNAL}","Member 0","2026-10-11","accepted",""`)
    expect(csv.body).not.toContain('reviews take days')
    const rawCsv = await req<string>('GET', `/api/sprints/${s}/export.csv?scope=raw`, owner)
    expect(rawCsv.body).toContain('"Review turnaround","improve","reviews take days","","",""')
    // Finished sprints can't be edited, but archived ones still export.
    expect((await patch(`/api/sprints/${s}`, owner, { name: 'x' })).status).toBe(409)
    await go(owner, s, 'archived')
    expect((await req<string>('GET', `/api/sprints/${s}/export.md`, members[0])).status).toBe(200)
  })
})
