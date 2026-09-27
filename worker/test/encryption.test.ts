/**
 * Participant-controlled encryption, end to end through the real Worker, D1 and room object —
 * with the real client cryptography (web/src/lib/e2ee/crypto.ts). Synthetic content only.
 *
 * What this establishes: the server stores only envelopes for encrypted sprints and refuses
 * plaintext; it never receives anything that opens them; key distribution follows the sealing
 * policy; clients detect tampering and substitution. What it can't establish: see docs/ENCRYPTION.md
 * ("What still needs independent review").
 */
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  b64u, fromB64u, newKeyPair, newRecoveryKey, newSprintSecret, openEntry, openField, parseEnvelope, sealEntry, sealField, sprintKeys,
  unwrapSprintSecret, unwrapWithRecovery, wrapForRecovery, wrapSprintSecret, type EntryEnvelope, type FieldEnvelope, type KeyPair,
} from '../../web/src/lib/e2ee/crypto'
import { command, get, go, patch, post, put, roomState, team, type User } from './harness'

const SYNTHETIC = ['Synthetic-7f3a: the staging database fell over on Wednesday', 'Synthetic-7f3a: pairing on refunds saved the release', 'Synthetic-7f3a theme: staging ownership', 'Synthetic-7f3a takeaway: name an owner', 'Synthetic-7f3a experiment: weekly staging rota', 'Synthetic-7f3a recap body']
const MARK = 'Synthetic-7f3a'

type Person = { user: User; keys: KeyPair; recovery: string }
async function withKeys(user: User): Promise<Person> {
  const keys = newKeyPair()
  const recovery = newRecoveryKey()
  const r = await put('/api/me/keys', user, { public_key: b64u(keys.pk), recovery_blob: wrapForRecovery(keys.sk, recovery, user.account_id) })
  expect(r.status).toBe(200)
  return { user, keys, recovery }
}

async function encryptedSprint(fac: Person, members: Person[], ws: string) {
  const secret = newSprintSecret()
  const k = sprintKeys(secret, 1)
  const id = crypto.randomUUID()
  const r = await post(`/api/workspaces/${ws}/sprints`, fac.user, {
    id, name: 'Sprint E', timezone: 'UTC', starts_on: '2026-09-14', ends_on: '2026-09-27', retro_date: '2026-09-28', retro_time: '14:00',
    participant_ids: members.map((m) => m.user.account_id), facilitator_id: fac.user.account_id, reminders_enabled: false, ai_processing: true,
    encryption: 'e1', sprint_key: { public_key: b64u(k.pk) },
    key_wraps: [{ account_id: fac.user.account_id, version: 1, recipient_public_key: b64u(fac.keys.pk), wrapped: wrapSprintSecret(fac.keys.pk, secret, { sprintId: id, version: 1, recipientId: fac.user.account_id }) }],
  })
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  return { id, secret, keys: k, detail: r.body }
}

async function writeThought(p: Person, sprintId: string, pk: Uint8Array, version: number, text: string) {
  const id = crypto.randomUUID()
  const body = sealEntry({ sprintId, recordId: id, version, sprintPk: pk, authorId: p.user.account_id, authorPk: p.keys.pk }, { body: text, impact: 'Synthetic-7f3a impact', might_help: null })
  const r = await post(`/api/sprints/${sprintId}/entries`, p.user, { id, idempotency_key: id, body, category: 'improve' })
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  return id
}

/** Every text value in every table, plus the room object's storage. */
async function everythingStored(sprintId: string): Promise<string> {
  const tables = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'").all<{ name: string }>()).results
  let dump = ''
  for (const t of tables) dump += JSON.stringify((await env.DB.prepare(`SELECT * FROM "${t.name}"`).all()).results)
  try {
    dump += JSON.stringify(await roomState(sprintId))
  } catch {
    /* no room yet */
  }
  return dump
}

describe('encrypted sprints', () => {
  it('store only envelopes, refuse plaintext, and follow the sealing policy through reveal', async () => {
    const t = await team(2)
    const fac = await withKeys(t.owner)
    const [maya, priya] = await Promise.all(t.members.map(withKeys))
    const s = await encryptedSprint(fac, [maya, priya], t.ws)
    expect(s.detail.encryption).toBe('e1')
    expect(s.detail.ai_processing).toBe(false) // never sent to an AI provider
    expect((await go(fac.user, s.id, 'collecting')).status).toBe(200)

    // Plaintext is refused, whatever the client.
    const plain = await post(`/api/sprints/${s.id}/entries`, maya.user, { id: crypto.randomUUID(), body: SYNTHETIC[0] })
    expect(plain.status).toBe(400)
    const noId = await post(`/api/sprints/${s.id}/entries`, maya.user, { body: 'e1.abc' })
    expect(noId.status).toBe(400)

    const a = await writeThought(maya, s.id, s.keys.pk, 1, SYNTHETIC[0])
    const b = await writeThought(priya, s.id, s.keys.pk, 1, SYNTHETIC[1])

    // Authors read their own thought with their own key.
    const mine = (await get(`/api/sprints/${s.id}/entries/mine`, maya.user)).body as { id: string; body: string }[]
    expect(openEntry(parseEnvelope(mine[0].body) as EntryEnvelope, { sprintId: s.id, recordId: a }, { accountSk: maya.keys.sk }).body).toBe(SYNTHETIC[0])
    // Nobody else's key opens it.
    expect(() => openEntry(parseEnvelope(mine[0].body) as EntryEnvelope, { sprintId: s.id, recordId: a }, { accountSk: priya.keys.sk })).toThrow()

    // While collecting, only the facilitator holds the sprint's key — and can't hand it out early.
    expect(((await get(`/api/sprints/${s.id}/keys`, maya.user)).body as { my_wraps: unknown[] }).my_wraps).toHaveLength(0)
    const early = await post(`/api/sprints/${s.id}/keys/wraps`, fac.user, { wraps: [{ account_id: maya.user.account_id, version: 1, recipient_public_key: b64u(maya.keys.pk), wrapped: wrapSprintSecret(maya.keys.pk, s.secret, { sprintId: s.id, version: 1, recipientId: maya.user.account_id }) }] })
    expect(early.status).toBe(403)
    const self = await post(`/api/sprints/${s.id}/keys/wraps`, maya.user, { wraps: [{ account_id: maya.user.account_id, version: 1, recipient_public_key: b64u(maya.keys.pk), wrapped: 'w1.x' }] })
    expect(self.status).toBe(403)

    // Reveal: the facilitator's device seals the secret to each participant, with the status change.
    const wraps = [maya, priya].map((p) => ({ account_id: p.user.account_id, version: 1, recipient_public_key: b64u(p.keys.pk), wrapped: wrapSprintSecret(p.keys.pk, s.secret, { sprintId: s.id, version: 1, recipientId: p.user.account_id }) }))
    expect((await post(`/api/sprints/${s.id}/transition`, fac.user, { to: 'preparing', confirm: true, key_wraps: wraps })).status).toBe(200)
    const kv = (await get(`/api/sprints/${s.id}/keys`, priya.user)).body as { my_wraps: { version: number; wrapped: string }[] }
    const got = sprintKeys(unwrapSprintSecret(priya.keys.sk, kv.my_wraps[0].wrapped, { sprintId: s.id, version: 1, recipientId: priya.user.account_id }), 1)
    const shared = (await get(`/api/sprints/${s.id}/entries`, priya.user)).body as { id: string; body: string; impact: string | null }[]
    expect(shared.map((e) => openEntry(parseEnvelope(e.body) as EntryEnvelope, { sprintId: s.id, recordId: e.id }, { sprint: got }).body).sort()).toEqual([SYNTHETIC[0], SYNTHETIC[1]].sort())
    expect(shared.every((e) => e.impact === null)).toBe(true)

    // Derived content: plaintext refused; envelopes stored.
    expect((await post(`/api/sprints/${s.id}/themes`, fac.user, { title: SYNTHETIC[2] })).status).toBe(400)
    const theme = await post(`/api/sprints/${s.id}/themes`, fac.user, { title: sealField(s.keys, s.id, 'title', SYNTHETIC[2]), entry_ids: [a, b] })
    expect(theme.status).toBe(200)
    const tv = (theme.body as { themes: { id: string; title: string }[] }).themes[0]
    expect(openField(parseEnvelope(tv.title) as FieldEnvelope, got, { sprintId: s.id, field: 'title' })).toBe(SYNTHETIC[2])

    // Server-side processing is off for encrypted content.
    expect((await post(`/api/sprints/${s.id}/ai/grouping`, fac.user, {})).status).toBe(409)
    expect((await get(`/api/sprints/${s.id}/export.md`, fac.user)).status).toBe(409)

    // The live meeting: notes and outcomes are envelopes too, and the room stores nothing readable.
    expect((await go(fac.user, s.id, 'ready')).status).toBe(200)
    expect((await go(fac.user, s.id, 'live')).status).toBe(200)
    expect((await put(`/api/sprints/${s.id}/meeting/notes/${tv.id}`, fac.user, { takeaway: SYNTHETIC[3] })).status).toBe(400)
    expect((await put(`/api/sprints/${s.id}/meeting/notes/${tv.id}`, fac.user, { takeaway: sealField(s.keys, s.id, 'takeaway', SYNTHETIC[3]) })).status).toBe(200)
    expect((await post(`/api/sprints/${s.id}/meeting/context`, maya.user, { theme_id: tv.id, body: 'Synthetic-7f3a context' })).status).toBe(400)
    expect((await post(`/api/sprints/${s.id}/meeting/context`, maya.user, { theme_id: tv.id, body: sealField(got, s.id, 'body', 'Synthetic-7f3a context'), idempotency_key: crypto.randomUUID() })).status).toBe(200)
    await command(fac.user, s.id, { type: 'set_phase', phase: 'discover' })
    await command(fac.user, s.id, { type: 'set_topic', theme_id: tv.id })
    expect((await post(`/api/sprints/${s.id}/experiments`, fac.user, { change_to_try: SYNTHETIC[4], success_signal: 'x' })).status).toBe(400)
    const exp = await post(`/api/sprints/${s.id}/experiments`, fac.user, { change_to_try: sealField(s.keys, s.id, 'change_to_try', SYNTHETIC[4]), success_signal: sealField(s.keys, s.id, 'success_signal', 'Synthetic-7f3a signal'), theme_id: tv.id })
    expect(exp.status, JSON.stringify(exp.body)).toBe(200)
    expect((await put(`/api/sprints/${s.id}/recap`, fac.user, {})).status).toBe(409) // no server-drafted recap
    expect((await put(`/api/sprints/${s.id}/recap`, fac.user, { body: SYNTHETIC[5] })).status).toBe(400)
    expect((await put(`/api/sprints/${s.id}/recap`, fac.user, { body: sealField(s.keys, s.id, 'body', SYNTHETIC[5]) })).status).toBe(200)

    // Nothing the server keeps — any table, or the room object — contains the synthetic text,
    // a private key, or the sprint secret.
    const dump = await everythingStored(s.id)
    expect(dump).not.toContain(MARK)
    for (const secret of [fac.keys.sk, maya.keys.sk, priya.keys.sk, s.secret, s.keys.sk, s.keys.dk]) expect(dump).not.toContain(b64u(secret))
    // What the server does hold (public keys, recovery blobs, wraps) opens nothing without a person's secret.
    const blob = (await env.DB.prepare('SELECT recovery_blob FROM account_keys WHERE account_id = ?').bind(maya.user.account_id).first<{ recovery_blob: string }>())!.recovery_blob
    expect(() => unwrapWithRecovery(blob, newRecoveryKey(), maya.user.account_id)).toThrow()
  })

  it('refuse a thought sealed as someone else, or for another record (a tab still holding another account’s key)', async () => {
    const t = await team(2)
    const fac = await withKeys(t.owner)
    const [maya, priya] = await Promise.all(t.members.map(withKeys))
    const s = await encryptedSprint(fac, [maya, priya], t.ws)
    expect((await go(fac.user, s.id, 'collecting')).status).toBe(200)
    const id = crypto.randomUUID()
    // Sealed with Priya as the author, sent by Maya's session.
    const asPriya = sealEntry({ sprintId: s.id, recordId: id, version: 1, sprintPk: s.keys.pk, authorId: priya.user.account_id, authorPk: priya.keys.pk }, { body: 'Synthetic-7f3a wrong author', impact: null, might_help: null })
    const r = await post(`/api/sprints/${s.id}/entries`, maya.user, { id, idempotency_key: id, body: asPriya, category: 'improve' })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('account_mismatch')
    // Bound to another record id.
    const other = crypto.randomUUID()
    const elsewhere = sealEntry({ sprintId: s.id, recordId: other, version: 1, sprintPk: s.keys.pk, authorId: maya.user.account_id, authorPk: maya.keys.pk }, { body: 'Synthetic-7f3a wrong record', impact: null, might_help: null })
    expect((await post(`/api/sprints/${s.id}/entries`, maya.user, { id, idempotency_key: id, body: elsewhere, category: 'improve' })).body.code).toBe('encryption_required')
    // Editing is held to the same rule.
    const mine = await writeThought(maya, s.id, s.keys.pk, 1, 'Synthetic-7f3a mine')
    const swap = sealEntry({ sprintId: s.id, recordId: mine, version: 1, sprintPk: s.keys.pk, authorId: priya.user.account_id, authorPk: priya.keys.pk }, { body: 'Synthetic-7f3a swapped', impact: null, might_help: null })
    expect((await patch(`/api/sprints/${s.id}/entries/${mine}`, maya.user, { body: swap })).body.code).toBe('account_mismatch')
  })

  it('detect tampering and substitution by the server', async () => {
    const t = await team(1)
    const fac = await withKeys(t.owner)
    const maya = await withKeys(t.members[0])
    const s = await encryptedSprint(fac, [maya], t.ws)
    await go(fac.user, s.id, 'collecting')
    const a = await writeThought(maya, s.id, s.keys.pk, 1, SYNTHETIC[0])
    const b = await writeThought(maya, s.id, s.keys.pk, 1, SYNTHETIC[1])
    // A modified ciphertext.
    const row = (await env.DB.prepare('SELECT body FROM entries WHERE id = ?').bind(a).first<{ body: string }>())!
    const o = JSON.parse(new TextDecoder().decode(fromB64u(row.body.slice(3))))
    const c = fromB64u(o.c)
    c[0] ^= 1
    o.c = b64u(c)
    await env.DB.prepare('UPDATE entries SET body = ? WHERE id = ?').bind('e1.' + b64u(new TextEncoder().encode(JSON.stringify(o))), a).run()
    // One thought's envelope copied over another's.
    const other = (await env.DB.prepare('SELECT body FROM entries WHERE id = ?').bind(b).first<{ body: string }>())!
    await env.DB.prepare('UPDATE entries SET body = ? WHERE id = ?').bind(other.body, a).run()
    const mine = (await get(`/api/sprints/${s.id}/entries/mine`, maya.user)).body as { id: string; body: string }[]
    const swapped = mine.find((e) => e.id === a)!
    expect(() => openEntry(parseEnvelope(swapped.body) as EntryEnvelope, { sprintId: s.id, recordId: a }, { accountSk: maya.keys.sk })).toThrow(/wrong place/)
  })

  it('reopening seals new thoughts under a new key version; late participants get access from a holder', async () => {
    const t = await team(2)
    const fac = await withKeys(t.owner)
    const maya = await withKeys(t.members[0])
    const s = await encryptedSprint(fac, [maya], t.ws)
    await go(fac.user, s.id, 'collecting')
    await writeThought(maya, s.id, s.keys.pk, 1, SYNTHETIC[0])
    const wrap = (p: Person, secret: Uint8Array, version: number) => ({ account_id: p.user.account_id, version, recipient_public_key: b64u(p.keys.pk), wrapped: wrapSprintSecret(p.keys.pk, secret, { sprintId: s.id, version, recipientId: p.user.account_id }) })
    expect((await post(`/api/sprints/${s.id}/transition`, fac.user, { to: 'preparing', confirm: true, key_wraps: [wrap(maya, s.secret, 1)] })).status).toBe(200)

    // Reopening without a fresh key is refused; with one, only the facilitator holds it.
    expect((await post(`/api/sprints/${s.id}/transition`, fac.user, { to: 'collecting', confirm: true })).status).toBe(409)
    const s2 = newSprintSecret()
    const k2 = sprintKeys(s2, 2)
    const re = await post(`/api/sprints/${s.id}/transition`, fac.user, { to: 'collecting', confirm: true, sprint_key: { version: 2, public_key: b64u(k2.pk) }, key_wraps: [wrap(fac, s2, 2)] })
    expect(re.status, JSON.stringify(re.body)).toBe(200)
    const view = (await get(`/api/sprints/${s.id}/keys`, maya.user)).body as { my_wraps: { version: number }[]; sealed_version: number }
    expect(view.sealed_version).toBe(2)
    expect(view.my_wraps.map((w) => w.version)).toEqual([1]) // what she already had; not the new version
    expect((await post(`/api/sprints/${s.id}/keys/wraps`, fac.user, { wraps: [wrap(maya, s2, 2)] })).status).toBe(403)

    // A participant added after the reveal: a holder shares version 1 with them. Only with people in
    // the sprint, and only to their current key.
    const late = await withKeys(t.members[1])
    expect((await post(`/api/sprints/${s.id}/participants`, fac.user, { account_id: late.user.account_id })).status).toBe(200)
    const outsider = newKeyPair()
    expect((await post(`/api/sprints/${s.id}/keys/wraps`, maya.user, { wraps: [{ ...wrap(late, s.secret, 1), recipient_public_key: b64u(outsider.pk) }] })).status).toBe(409)
    expect((await post(`/api/sprints/${s.id}/keys/wraps`, maya.user, { wraps: [{ ...wrap(late, s.secret, 1), account_id: crypto.randomUUID() }] })).status).toBe(403)
    expect((await post(`/api/sprints/${s.id}/keys/wraps`, maya.user, { wraps: [wrap(late, s.secret, 1)] })).status).toBe(200)
    const lv = (await get(`/api/sprints/${s.id}/keys`, late.user)).body as { my_wraps: { version: number; wrapped: string }[] }
    expect(unwrapSprintSecret(late.keys.sk, lv.my_wraps[0].wrapped, { sprintId: s.id, version: 1, recipientId: late.user.account_id })).toEqual(s.secret)
  })

  it('recovery: a new device unlocks with the recovery key; signing in by email alone does not', async () => {
    const t = await team(0)
    const p = await withKeys(t.owner)
    const k = (await get('/api/me/keys', p.user)).body as { public_key: string; recovery_blob: string }
    expect(k.public_key).toBe(b64u(p.keys.pk))
    // Email sign-in on a new device yields only the blob…
    expect(() => unwrapWithRecovery(k.recovery_blob, newRecoveryKey(), p.user.account_id)).toThrow()
    // …which opens with the recovery key the person saved.
    expect(unwrapWithRecovery(k.recovery_blob, p.recovery, p.user.account_id)).toEqual(p.keys.sk)
    // Replacing a key needs explicit confirmation, and bumps its version (teammates are warned).
    const fresh = newKeyPair()
    expect((await put('/api/me/keys', p.user, { public_key: b64u(fresh.pk) })).status).toBe(409)
    const r = await put('/api/me/keys', p.user, { public_key: b64u(fresh.pk), replace: true })
    expect((r.body as { key_version: number }).key_version).toBe(2)
  })

  it('legacy sprints are untouched and labelled as not encrypted', async () => {
    const t = await team(1)
    const r = await post(`/api/workspaces/${t.ws}/sprints`, t.owner, { name: 'Legacy', timezone: 'UTC', starts_on: '2026-09-14', ends_on: '2026-09-27', retro_date: '2026-09-28', retro_time: '14:00', participant_ids: [t.members[0].account_id], facilitator_id: t.owner.account_id, reminders_enabled: false })
    expect(r.body.encryption).toBeNull()
    await go(t.owner, r.body.id, 'collecting')
    expect((await post(`/api/sprints/${r.body.id}/entries`, t.members[0], { body: 'plain text still works here' })).status).toBe(200)
    expect(((await get(`/api/sprints/${r.body.id}/keys`, t.members[0])).body as { encryption: null }).encryption).toBeNull()
  })

  it('an encrypted sprint needs its key sealed to the facilitator', async () => {
    const t = await team(1)
    const fac = await withKeys(t.owner)
    const r = await post(`/api/workspaces/${t.ws}/sprints`, fac.user, { id: crypto.randomUUID(), name: 'No wrap', timezone: 'UTC', starts_on: '2026-09-14', ends_on: '2026-09-27', retro_date: '2026-09-28', retro_time: '14:00', participant_ids: [], facilitator_id: fac.user.account_id, encryption: 'e1', sprint_key: { public_key: b64u(newKeyPair().pk) } })
    expect(r.status).toBe(400)
    expect(await env.DB.prepare("SELECT count(*) AS n FROM sprints WHERE name = 'No wrap'").first<{ n: number }>().then((x) => x?.n)).toBe(0)
  })
})

export { patch }
