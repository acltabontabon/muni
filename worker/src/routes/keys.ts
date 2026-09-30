/**
 * Public keys and wrapped keys. The server stores and forwards them; it can't use any of them.
 * Authorization here decides who may *receive* a wrapped sprint secret — defense in depth for the
 * sealing policy (only the facilitator holds a key version while it collects). It is not what
 * protects content from the server: the server never has an unwrapped key.
 *
 * The account's own private key reaches a device in one of three ways, none of which the server
 * can open (docs/encryption.md, "Keys"): a passkey wrap (the browser derives its key from the passkey's
 * PRF output, which never leaves the browser), a device envelope (kept only on that device; half
 * of its key is the `share` below, released only to the account's own sessions), or the recovery key.
 */
import { Hono } from 'hono'
import type { HonoEnv } from '../env'
import { config } from '../lib/config'
import { clientLabel, requireAuth, requireMember, requireParticipant, requireRecentAuth, requireSprint, securityEvent, type Auth, type SprintCtx } from '../lib/auth'
import { randomToken } from '../lib/crypto'
import { all, audit, count, one, run } from '../lib/db'
import { AppError, bad, conflict, forbidden, notFound } from '../lib/errors'
import { accountBucket, limit } from '../lib/ratelimit'
import { isEncrypted, passkeyWrap, publicKey, recoveryBlob, wrapped } from '../lib/sealed'
import { isObject, jsonBody } from '../lib/util'

export const keys = new Hono<HonoEnv>()

type KeyRow = { account_id: string; public_key: string; recovery_blob: string | null; recovery_confirmed_at: number | null; key_version: number; created_at: number; updated_at: number }
type DeviceRow = { id: string; account_id: string; share: string; key_version: number; requires_passkey: number; bound_at: number; label: string | null; created_at: number; last_used_at: number | null }
const iso = (n: number | null) => (n === null ? null : new Date(n).toISOString())
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** Devices an account can keep unlockable at once; the least recently used makes room. */
export const MAX_DEVICES = 50

/** This account's passkey wraps for its current key (older ones can't open it). */
async function passkeyWraps(db: D1Database, accountId: string, k: KeyRow | null) {
  if (!k) return []
  return all<{ credential: string; webauthn_id: string; key_version: number; wrapped: string }>(
    db,
    `SELECT w.credential_id AS credential, c.credential_id AS webauthn_id, w.key_version, w.wrapped
       FROM passkey_key_wraps w JOIN webauthn_credentials c ON c.id = w.credential_id AND c.account_id = w.account_id
      WHERE w.account_id = ? AND w.key_version = ? AND w.public_key = ? ORDER BY w.created_at`,
    accountId, k.key_version, k.public_key,
  )
}

keys.get('/api/me/keys', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  const k = await one<KeyRow>(c.env.DB, 'SELECT * FROM account_keys WHERE account_id = ?', a.account.id)
  const session = a.authMethod === 'passkey' && a.credentialRef ? await one<{ id: string; webauthn_id: string }>(c.env.DB, 'SELECT id, credential_id AS webauthn_id FROM webauthn_credentials WHERE id = ? AND account_id = ?', a.credentialRef, a.account.id) : null
  const common = { passkeys: await passkeyWraps(c.env.DB, a.account.id, k), session_passkey: session ?? null }
  if (!k) return c.json({ public_key: null, recovery_blob: null, recovery_confirmed_at: null, key_version: 0, created_at: null, ...common })
  return c.json({ public_key: k.public_key, recovery_blob: k.recovery_blob, recovery_confirmed_at: iso(k.recovery_confirmed_at), key_version: k.key_version, created_at: iso(k.created_at), ...common })
})

/** Validates a passkey wrap for one of this account's own passkeys; returns the statement storing it. */
async function passkeyWrapStatement(db: D1Database, a: Auth, input: unknown, k: { public_key: string; key_version: number }): Promise<[string, ...unknown[]]> {
  const w = (input ?? {}) as { credential?: unknown; wrapped?: unknown }
  const cred = typeof w.credential === 'string' ? await one<{ id: string }>(db, 'SELECT id FROM webauthn_credentials WHERE id = ? AND account_id = ?', w.credential, a.account.id) : null
  if (!cred) throw notFound('passkey not found')
  const now = Date.now()
  return [
    `INSERT INTO passkey_key_wraps (credential_id, account_id, key_version, public_key, wrapped, created_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(credential_id) DO UPDATE SET key_version = excluded.key_version, public_key = excluded.public_key, wrapped = excluded.wrapped, created_at = excluded.created_at, last_used_at = NULL`,
    cred.id, a.account.id, k.key_version, k.public_key, passkeyWrap(w.wrapped), now,
  ]
}

/**
 * Publish this account's public key (first device), or replace it (`replace: true`) after every
 * copy of the private key was lost. Replacing never touches content: what was sealed to the old
 * key stays sealed to it, and teammates' devices flag the change. Wraps and device unlocks of the
 * old key can't open the new one, so they go with it.
 */
keys.put('/api/me/keys', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  const db = c.env.DB
  const body = await jsonBody<{ public_key?: unknown; recovery_blob?: unknown; replace?: boolean; passkey_wrap?: unknown; device?: unknown }>(c)
  // The device that made this key and already keeps it (so a reload can't lose a published key).
  const device = typeof body.device === 'string' && UUID.test(body.device) ? body.device : ''
  const pk = publicKey(body.public_key)
  const blob = body.recovery_blob === undefined || body.recovery_blob === null ? null : recoveryBlob(body.recovery_blob)
  const now = Date.now()
  const existing = await one<KeyRow>(db, 'SELECT * FROM account_keys WHERE account_id = ?', a.account.id)
  if (existing && existing.public_key === pk) return c.json({ ok: true, key_version: existing.key_version })
  if (existing && body.replace !== true) throw conflict('this account already has a key — unlock it with your recovery key, or confirm replacing it')
  // Replacing the account key is destructive for content access: it needs a recent sign-in.
  if (existing) requireRecentAuth(a)
  const version = existing ? existing.key_version + 1 : 1
  const wrapStmt = body.passkey_wrap ? await passkeyWrapStatement(db, a, body.passkey_wrap, { public_key: pk, key_version: version }) : null
  if (existing) {
    await db.batch([
      db.prepare('UPDATE account_keys SET public_key = ?, recovery_blob = ?, recovery_confirmed_at = NULL, key_version = key_version + 1, updated_at = ? WHERE account_id = ? AND key_version = ?').bind(pk, blob, now, a.account.id, existing.key_version),
      db.prepare('DELETE FROM passkey_key_wraps WHERE account_id = ?').bind(a.account.id),
      db.prepare('DELETE FROM device_unlocks WHERE account_id = ? AND id <> ?').bind(a.account.id, device),
      db.prepare('UPDATE device_unlocks SET key_version = ? WHERE account_id = ? AND id = ?').bind(version, a.account.id, device),
    ])
    const ws = await all<{ workspace_id: string }>(db, 'SELECT workspace_id FROM memberships WHERE account_id = ? AND revoked_at IS NULL', a.account.id)
    for (const w of ws) await audit(db, w.workspace_id, null, a.account.id, 'keys.replaced')
    await securityEvent(db, a.account.id, 'keys.replaced')
  } else {
    // Two tabs setting up at once: the first insert wins; the second is told a key exists.
    const r = await run(db, 'INSERT INTO account_keys (account_id, public_key, recovery_blob, key_version, created_at, updated_at) VALUES (?,?,?,1,?,?) ON CONFLICT(account_id) DO NOTHING', a.account.id, pk, blob, now, now)
    if (!r.meta.changes) throw conflict('this account already has a key — unlock it with your recovery key, or confirm replacing it')
  }
  if (wrapStmt) {
    await run(db, ...wrapStmt)
    await securityEvent(db, a.account.id, 'keys.passkey_unlock_added', { passkey: String(wrapStmt[1]) })
  }
  const k = (await one<KeyRow>(db, 'SELECT * FROM account_keys WHERE account_id = ?', a.account.id))!
  return c.json({ ok: true, key_version: k.key_version })
})

/**
 * Let one of this account's passkeys unlock its key: the key wrapped under that passkey's PRF
 * output, made in a browser that already holds the key. Only for the current key, and only on a
 * recently authenticated session (a stolen cookie can't swap in a wrap that locks you out).
 */
keys.put('/api/me/keys/passkeys/:credential', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  requireRecentAuth(a)
  const db = c.env.DB
  const body = await jsonBody<{ wrapped?: unknown; key_version?: unknown; public_key?: unknown }>(c)
  const k = await one<KeyRow>(db, 'SELECT * FROM account_keys WHERE account_id = ?', a.account.id)
  if (!k) throw conflict('set up encryption on a device first')
  if (body.public_key !== k.public_key || Number(body.key_version) !== k.key_version) throw new AppError(409, 'key_changed', 'your encryption key changed on another device — reload and try again')
  const stmt = await passkeyWrapStatement(db, a, { credential: c.req.param('credential'), wrapped: body.wrapped }, k)
  await run(db, ...stmt)
  await securityEvent(db, a.account.id, 'keys.passkey_unlock_added', { passkey: c.req.param('credential') })
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ devices

const deviceView = (d: DeviceRow) => ({ id: d.id, label: d.label, created_at: iso(d.created_at), last_used_at: iso(d.last_used_at), key_version: d.key_version, requires_passkey: d.requires_passkey === 1 })

/**
 * Keep this device unlockable after signing out. The device chooses its id (so a retried request
 * finds the same row) and gets a fresh random share, once: an existing id never returns its share
 * here, only through /unlock. `replaces` names this device's previous row, re-created after a
 * passkey or recovery-key unlock so passkeys added since then are counted. A device making a new
 * key keeps it *before* publishing it (`for_version`: 1 for a first key, the next version when
 * starting over), so no published key ever exists only in a tab's memory.
 */
keys.put('/api/me/devices/:id', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  const db = c.env.DB
  const id = c.req.param('id')
  if (!UUID.test(id)) throw bad('not a device id')
  const body = await jsonBody<{ replaces?: unknown; installed?: unknown; for_version?: unknown }>(c)
  const k = await one<KeyRow>(db, 'SELECT * FROM account_keys WHERE account_id = ?', a.account.id)
  if (!k && body.for_version === undefined) throw conflict('set up encryption on a device first')
  const current = k?.key_version ?? 0
  const version = body.for_version === undefined ? current : Number(body.for_version)
  if (!Number.isInteger(version) || version < 1 || (version !== current && version !== current + 1)) throw bad('not a key version this account has, or is about to have')
  const existing = await one<DeviceRow>(db, 'SELECT * FROM device_unlocks WHERE id = ?', id)
  if (existing && existing.account_id !== a.account.id) throw conflict('that device id is taken')
  if (existing) return c.json({ created: false, key_version: existing.key_version })
  await limit(db, accountBucket('device-add', a.account.id), 30, 60 * 60_000)
  const replaces = typeof body.replaces === 'string' && UUID.test(body.replaces) ? body.replaces : null
  const replaced = replaces ? await run(db, 'DELETE FROM device_unlocks WHERE id = ? AND account_id = ?', replaces, a.account.id) : null
  const held = await count(db, 'SELECT count(*) AS n FROM device_unlocks WHERE account_id = ?', a.account.id)
  if (held >= MAX_DEVICES)
    await run(db, 'DELETE FROM device_unlocks WHERE id IN (SELECT id FROM device_unlocks WHERE account_id = ? ORDER BY coalesce(last_used_at, created_at) LIMIT ?)', a.account.id, held - MAX_DEVICES + 1)
  const share = randomToken(32)
  const now = Date.now()
  await run(
    db,
    'INSERT INTO device_unlocks (id, account_id, share, key_version, requires_passkey, bound_at, label, created_at, last_used_at) VALUES (?,?,?,?,?,?,?,?,?)',
    id, a.account.id, share, version, 1, now, clientLabel(c.req.raw, body.installed === true), now, now,
  )
  if (!replaced?.meta.changes) await securityEvent(db, a.account.id, 'keys.device_added', { device: id })
  return c.json({ created: true, share, key_version: version, requires_passkey: true })
})

/**
 * The share for reopening this device's key: only to a session of the same account, started with a
 * passkey that already existed when the device was bound (a passkey added later never unlocks it).
 */
keys.post('/api/me/devices/:id/unlock', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  const db = c.env.DB
  await limit(db, accountBucket('device-unlock', a.account.id), 120, 10 * 60_000)
  const d = await one<DeviceRow>(db, 'SELECT * FROM device_unlocks WHERE id = ? AND account_id = ?', c.req.param('id'), a.account.id)
  if (!d) throw new AppError(404, 'device_unknown', 'this device can’t unlock your account any more')
  const ok = a.credentialRef ? await one(db, 'SELECT 1 AS x FROM webauthn_credentials WHERE id = ? AND account_id = ? AND created_at <= ?', a.credentialRef, a.account.id, d.bound_at) : null
  if (!ok) throw new AppError(403, 'passkey_required', 'sign in with your passkey to unlock your writing on this device')
  await run(db, 'UPDATE device_unlocks SET last_used_at = ? WHERE id = ?', Date.now(), d.id)
  return c.json({ share: d.share, key_version: d.key_version })
})

keys.get('/api/me/devices', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  const rows = await all<DeviceRow>(c.env.DB, 'SELECT * FROM device_unlocks WHERE account_id = ? ORDER BY coalesce(last_used_at, created_at) DESC', a.account.id)
  return c.json(rows.map(deviceView))
})

/** Stop a device being able to reopen the key ("Forget this device", or a lost one, from Account). */
keys.delete('/api/me/devices/:id', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  const r = await run(c.env.DB, 'DELETE FROM device_unlocks WHERE id = ? AND account_id = ?', c.req.param('id'), a.account.id)
  if (r.meta.changes) await securityEvent(c.env.DB, a.account.id, 'keys.device_removed', { device: c.req.param('id') })
  return c.json({ ok: true, removed: !!r.meta.changes })
})

/** A new recovery key (the old one stops working), and/or "I've saved it". */
keys.post('/api/me/keys/recovery', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  const body = await jsonBody<{ recovery_blob?: unknown; confirmed?: boolean }>(c)
  const k = await one<KeyRow>(c.env.DB, 'SELECT * FROM account_keys WHERE account_id = ?', a.account.id)
  if (!k) throw conflict('set up encryption on a device first')
  // A new recovery key replaces the old one (a recovery setting): it needs a recent sign-in.
  if (body.recovery_blob !== undefined) requireRecentAuth(a)
  if (body.recovery_blob !== undefined) await securityEvent(c.env.DB, a.account.id, 'keys.recovery_replaced')
  if (body.recovery_blob !== undefined) await run(c.env.DB, 'UPDATE account_keys SET recovery_blob = ?, recovery_confirmed_at = NULL, updated_at = ? WHERE account_id = ?', recoveryBlob(body.recovery_blob), Date.now(), a.account.id)
  if (body.confirmed === true) await run(c.env.DB, 'UPDATE account_keys SET recovery_confirmed_at = ? WHERE account_id = ?', Date.now(), a.account.id)
  return c.json({ ok: true })
})

export type WrapInput = { account_id?: unknown; version?: unknown; wrapped?: unknown; recipient_public_key?: unknown }

/**
 * Validates and stores wrapped sprint secrets. Each must be for a participant, sealed to their
 * current public key, for an existing version. While `sealedVersion` collects, only the
 * facilitator may receive it — `facilitator` when the role is moving in the same transaction.
 */
export async function wrapStatements(db: D1Database, sprintId: string, actorId: string, input: unknown, opts: { sealedVersion: number | null; facilitator?: string }) {
  if (!Array.isArray(input)) return []
  if (input.length > 70) throw bad('too many keys at once')
  if (!input.every(isObject)) throw bad('not a wrapped key')
  const participants = await all<{ account_id: string; is_facilitator: number; public_key: string | null }>(
    db,
    'SELECT sp.account_id, sp.is_facilitator, k.public_key FROM sprint_participants sp LEFT JOIN account_keys k ON k.account_id = sp.account_id WHERE sp.sprint_id = ?',
    sprintId,
  )
  const versions = new Set((await all<{ version: number }>(db, 'SELECT version FROM sprint_keys WHERE sprint_id = ?', sprintId)).map((v) => v.version))
  const stmts: [string, ...unknown[]][] = []
  for (const w of input as WrapInput[]) {
    const id = String(w.account_id ?? '')
    const version = Number(w.version)
    const p = participants.find((x) => x.account_id === id)
    if (!p) throw forbidden('keys can only be shared with people in this sprint')
    if (!versions.has(version)) throw bad('unknown key version')
    const pk = publicKey(w.recipient_public_key)
    if (p.public_key !== pk) throw conflict('that person’s key changed — reload and try again')
    const facilitates = opts.facilitator === undefined ? !!p.is_facilitator : p.account_id === opts.facilitator
    if (opts.sealedVersion === version && !facilitates) throw forbidden('while collection is open, only the facilitator holds the sprint’s key')
    stmts.push([
      `INSERT INTO sprint_key_wraps (sprint_id, version, account_id, recipient_public_key, wrapped, created_by, created_at) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(sprint_id, version, account_id) DO UPDATE SET recipient_public_key = excluded.recipient_public_key, wrapped = excluded.wrapped, created_by = excluded.created_by, created_at = excluded.created_at
       WHERE sprint_key_wraps.recipient_public_key <> excluded.recipient_public_key`,
      sprintId, version, id, pk, wrapped(w.wrapped), actorId, Date.now(),
    ])
  }
  return stmts
}

/** The version that is sealed right now (collecting), if any. */
export async function sealedVersion(db: D1Database, sprintId: string, status: string): Promise<number | null> {
  if (status !== 'draft' && status !== 'collecting') return null
  return (await one<{ v: number | null }>(db, 'SELECT MAX(version) AS v FROM sprint_keys WHERE sprint_id = ?', sprintId))?.v ?? null
}

async function keyView(db: D1Database, ctx: SprintCtx) {
  const sid = ctx.sprint.id
  const versions = await all<{ version: number; public_key: string; created_at: number }>(db, 'SELECT version, public_key, created_at FROM sprint_keys WHERE sprint_id = ? ORDER BY version', sid)
  const mine = await all<{ version: number; wrapped: string }>(db, 'SELECT version, wrapped FROM sprint_key_wraps WHERE sprint_id = ? AND account_id = ? ORDER BY version', sid, ctx.auth.account.id)
  const latest = versions.at(-1)?.version ?? 0
  const people = await all<{ account_id: string; display_name: string; is_facilitator: number; public_key: string | null; key_version: number | null; held: string | null }>(
    db,
    `SELECT sp.account_id, a.display_name, sp.is_facilitator, k.public_key, k.key_version,
            (SELECT group_concat(w.version) FROM sprint_key_wraps w WHERE w.sprint_id = sp.sprint_id AND w.account_id = sp.account_id AND w.recipient_public_key = k.public_key) AS held
       FROM sprint_participants sp JOIN accounts a ON a.id = sp.account_id LEFT JOIN account_keys k ON k.account_id = sp.account_id
      WHERE sp.sprint_id = ? ORDER BY sp.is_facilitator DESC, a.display_name`,
    sid,
  )
  return {
    encryption: 'e1' as const,
    sealed_version: await sealedVersion(db, sid, ctx.sprint.status),
    versions: versions.map((v) => ({ version: v.version, public_key: v.public_key })),
    my_wraps: mine,
    participants: people.map((p) => {
      const held = (p.held ?? '').split(',').filter(Boolean).map(Number).sort((x, y) => x - y)
      return { account_id: p.account_id, display_name: p.display_name, is_facilitator: !!p.is_facilitator, public_key: p.public_key, key_version: p.key_version ?? 0, versions_held: held, has_latest: held.includes(latest) }
    }),
  }
}

keys.get('/api/sprints/:sprintId/keys', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  if (!isEncrypted(ctx.sprint)) return c.json({ encryption: null })
  // Owners who aren't in the sprint see that it's encrypted, and nothing that would let them in.
  if (!ctx.isParticipant) return c.json({ encryption: 'e1', sealed_version: null, versions: [], my_wraps: [], participants: [] })
  return c.json(await keyView(c.env.DB, ctx))
})

/** A participant who holds a version shares it with others in the sprint who don't have it yet. */
keys.post('/api/sprints/:sprintId/keys/wraps', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireParticipant(ctx)
  const db = c.env.DB
  if (!isEncrypted(ctx.sprint)) throw conflict('this sprint isn’t encrypted')
  const body = await jsonBody<{ wraps?: unknown }>(c)
  const list = Array.isArray(body.wraps) ? (body.wraps as WrapInput[]) : []
  if (!list.every(isObject)) throw bad('not a wrapped key')
  for (const v of new Set(list.map((w) => Number(w.version))))
    if (!(await count(db, 'SELECT count(*) AS n FROM sprint_key_wraps WHERE sprint_id = ? AND version = ? AND account_id = ?', ctx.sprint.id, v, ctx.auth.account.id)))
      throw forbidden('you can only share a key you hold')
  const stmts = await wrapStatements(db, ctx.sprint.id, ctx.auth.account.id, list, { sealedVersion: await sealedVersion(db, ctx.sprint.id, ctx.sprint.status) })
  if (stmts.length) await db.batch(stmts.map(([sql, ...args]) => db.prepare(sql).bind(...args)))
  return c.json(await keyView(db, ctx))
})

/** Members' public keys, for sealing a new sprint's secret to the facilitator someone chose. */
keys.get('/api/workspaces/:workspaceId/member-keys', async (c) => {
  const m = await requireMember(c, config(c.env), c.env.DB, c.req.param('workspaceId'))
  const rows = await all<{ account_id: string; public_key: string; key_version: number }>(
    c.env.DB,
    'SELECT k.account_id, k.public_key, k.key_version FROM account_keys k JOIN memberships ms ON ms.account_id = k.account_id WHERE ms.workspace_id = ? AND ms.revoked_at IS NULL',
    m.workspaceId,
  )
  return c.json(rows)
})
