/**
 * Public keys and wrapped keys. The server stores and forwards them; it can't use any of them.
 * Authorization here decides who may *receive* a wrapped sprint secret — defense in depth for the
 * sealing policy (only the facilitator holds a key version while it collects). It is not what
 * protects content from the server: the server never has an unwrapped key.
 */
import { Hono } from 'hono'
import type { HonoEnv } from '../env'
import { config } from '../lib/config'
import { requireAuth, requireMember, requireParticipant, requireSprint, type SprintCtx } from '../lib/auth'
import { all, audit, count, one, run } from '../lib/db'
import { bad, conflict, forbidden } from '../lib/errors'
import { isEncrypted, publicKey, recoveryBlob, wrapped } from '../lib/sealed'

export const keys = new Hono<HonoEnv>()

type KeyRow = { account_id: string; public_key: string; recovery_blob: string | null; recovery_confirmed_at: number | null; key_version: number; created_at: number; updated_at: number }
const iso = (n: number | null) => (n === null ? null : new Date(n).toISOString())

keys.get('/api/me/keys', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  const k = await one<KeyRow>(c.env.DB, 'SELECT * FROM account_keys WHERE account_id = ?', a.account.id)
  if (!k) return c.json({ public_key: null, recovery_blob: null, recovery_confirmed_at: null, key_version: 0, created_at: null })
  return c.json({ public_key: k.public_key, recovery_blob: k.recovery_blob, recovery_confirmed_at: iso(k.recovery_confirmed_at), key_version: k.key_version, created_at: iso(k.created_at) })
})

/**
 * Publish this account's public key (first device), or replace it (`replace: true`) after every
 * copy of the private key was lost. Replacing never touches content: what was sealed to the old
 * key stays sealed to it, and teammates' devices flag the change.
 */
keys.put('/api/me/keys', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  const body = (await c.req.json().catch(() => ({}))) as { public_key?: unknown; recovery_blob?: unknown; replace?: boolean }
  const pk = publicKey(body.public_key)
  const blob = body.recovery_blob === undefined || body.recovery_blob === null ? null : recoveryBlob(body.recovery_blob)
  const now = Date.now()
  const existing = await one<KeyRow>(c.env.DB, 'SELECT * FROM account_keys WHERE account_id = ?', a.account.id)
  if (existing && existing.public_key === pk) return c.json({ ok: true, key_version: existing.key_version })
  if (existing && body.replace !== true) throw conflict('this account already has a key — unlock it with your recovery key, or confirm replacing it')
  if (existing) {
    await run(c.env.DB, 'UPDATE account_keys SET public_key = ?, recovery_blob = ?, recovery_confirmed_at = NULL, key_version = key_version + 1, updated_at = ? WHERE account_id = ?', pk, blob, now, a.account.id)
    const ws = await all<{ workspace_id: string }>(c.env.DB, 'SELECT workspace_id FROM memberships WHERE account_id = ? AND revoked_at IS NULL', a.account.id)
    for (const w of ws) await audit(c.env.DB, w.workspace_id, null, a.account.id, 'keys.replaced')
  } else {
    await run(c.env.DB, 'INSERT INTO account_keys (account_id, public_key, recovery_blob, key_version, created_at, updated_at) VALUES (?,?,?,1,?,?)', a.account.id, pk, blob, now, now)
  }
  const k = (await one<KeyRow>(c.env.DB, 'SELECT * FROM account_keys WHERE account_id = ?', a.account.id))!
  return c.json({ ok: true, key_version: k.key_version })
})

/** A new recovery key (the old one stops working), and/or "I've saved it". */
keys.post('/api/me/keys/recovery', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  const body = (await c.req.json().catch(() => ({}))) as { recovery_blob?: unknown; confirmed?: boolean }
  const k = await one<KeyRow>(c.env.DB, 'SELECT * FROM account_keys WHERE account_id = ?', a.account.id)
  if (!k) throw conflict('set up encryption on a device first')
  if (body.recovery_blob !== undefined) await run(c.env.DB, 'UPDATE account_keys SET recovery_blob = ?, recovery_confirmed_at = NULL, updated_at = ? WHERE account_id = ?', recoveryBlob(body.recovery_blob), Date.now(), a.account.id)
  if (body.confirmed === true) await run(c.env.DB, 'UPDATE account_keys SET recovery_confirmed_at = ? WHERE account_id = ?', Date.now(), a.account.id)
  return c.json({ ok: true })
})

export type WrapInput = { account_id?: unknown; version?: unknown; wrapped?: unknown; recipient_public_key?: unknown }

/**
 * Validates and stores wrapped sprint secrets. Each must be for a participant, sealed to their
 * current public key, for an existing version. While `sealedVersion` collects, only the
 * facilitator may receive it.
 */
export async function wrapStatements(db: D1Database, sprintId: string, actorId: string, input: unknown, opts: { sealedVersion: number | null }) {
  if (!Array.isArray(input)) return []
  if (input.length > 70) throw bad('too many keys at once')
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
    if (opts.sealedVersion === version && !p.is_facilitator) throw forbidden('while collection is open, only the facilitator holds the sprint’s key')
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
  const enc = await one<{ encryption: string | null }>(c.env.DB, 'SELECT encryption FROM sprints WHERE id = ?', ctx.sprint.id)
  if (!isEncrypted(enc ?? {})) return c.json({ encryption: null })
  // Owners who aren't in the sprint see that it's encrypted, and nothing that would let them in.
  if (!ctx.isParticipant) return c.json({ encryption: 'e1', sealed_version: null, versions: [], my_wraps: [], participants: [] })
  return c.json(await keyView(c.env.DB, ctx))
})

/** A participant who holds a version shares it with others in the sprint who don't have it yet. */
keys.post('/api/sprints/:sprintId/keys/wraps', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  requireParticipant(ctx)
  const db = c.env.DB
  const enc = await one<{ encryption: string | null; status: string }>(db, 'SELECT encryption, status FROM sprints WHERE id = ?', ctx.sprint.id)
  if (!isEncrypted(enc ?? {})) throw conflict('this sprint isn’t encrypted')
  const body = (await c.req.json().catch(() => ({}))) as { wraps?: unknown }
  const list = Array.isArray(body.wraps) ? (body.wraps as WrapInput[]) : []
  for (const v of new Set(list.map((w) => Number(w.version))))
    if (!(await count(db, 'SELECT count(*) AS n FROM sprint_key_wraps WHERE sprint_id = ? AND version = ? AND account_id = ?', ctx.sprint.id, v, ctx.auth.account.id)))
      throw forbidden('you can only share a key you hold')
  const stmts = await wrapStatements(db, ctx.sprint.id, ctx.auth.account.id, list, { sealedVersion: await sealedVersion(db, ctx.sprint.id, enc!.status) })
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
