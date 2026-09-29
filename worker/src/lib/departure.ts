/**
 * Leaving: a member leaving a workspace (or being removed), and a person deleting their account.
 *
 * What stays and what goes follows one rule: what the team has already seen stays with the team,
 * and what nobody has seen yet goes with the person. Leaving (or being removed) keeps everything,
 * because they may come back; deleting an account removes what was never revealed (thoughts not
 * yet collected, votes in an open round, unshared check-in answers, additions not yet shared) and
 * cuts every remaining row loose from the account, with a fresh random id per row so even the
 * rows themselves can't be grouped as one person's.
 *
 * Nobody may leave a team stranded: the last owner of a workspace others still use, and the
 * facilitator of an unfinished sprint others are in (they hold its key while it collects), hand
 * over first. A workspace no one else is in goes with the person, when they say so.
 */
import type { WorkspaceStanding } from '../contract'
import { all, type Statement } from './db'
import { ACCOUNT_BUCKETS, accountBucket } from './ratelimit'

const UNFINISHED = "s.status NOT IN ('completed','archived')"
/** A per-row random stand-in for an account id, on rows kept after the account is deleted. */
const GONE = "'gone:' || lower(hex(randomblob(12)))"
/** The actor on workspace history left by a deleted account: someone, not Muni itself. */
export const GONE_ACTOR = 'gone'

export type Standing = WorkspaceStanding

/** Where someone stands in each workspace they belong to (or just one). */
export async function standing(db: D1Database, accountId: string, workspaceId?: string): Promise<Standing[]> {
  const scope = workspaceId ? 'AND m.workspace_id = ?' : ''
  const args = workspaceId ? [accountId, workspaceId] : [accountId]
  const [rows, fac] = await Promise.all([
    all<{ id: string; name: string; role: string; others: number; other_owners: number }>(
      db,
      `SELECT w.id, w.name, m.role,
              (SELECT count(*) FROM memberships o WHERE o.workspace_id = w.id AND o.account_id <> m.account_id AND o.revoked_at IS NULL) AS others,
              (SELECT count(*) FROM memberships o WHERE o.workspace_id = w.id AND o.account_id <> m.account_id AND o.revoked_at IS NULL AND o.role = 'owner') AS other_owners
         FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.account_id = ? AND m.revoked_at IS NULL ${scope} ORDER BY w.created_at`,
      ...args,
    ),
    facilitated(db, { accountId, workspaceId }),
  ])
  return rows.map((r) => ({
    workspace_id: r.id,
    workspace_name: r.name,
    sole: r.others === 0,
    last_owner: r.role === 'owner' && r.others > 0 && r.other_owners === 0,
    facilitating: fac.filter((f) => f.workspace_id === r.id).map((f) => ({ id: f.id, name: f.name })),
  }))
}

/**
 * Unfinished sprints someone facilitates that another current member takes part in: the team
 * depends on them there (in an encrypted sprint that's collecting, they hold its only key). By
 * person, by workspace, or both.
 */
export async function facilitated(db: D1Database, by: { accountId?: string; workspaceId?: string }) {
  const where = [by.accountId ? 'sp.account_id = ?' : '', by.workspaceId ? 's.workspace_id = ?' : ''].filter(Boolean)
  const args = [by.accountId, by.workspaceId].filter((v): v is string => !!v)
  return all<{ account_id: string; workspace_id: string; id: string; name: string }>(
    db,
    `SELECT sp.account_id, s.workspace_id, s.id, s.name FROM sprint_participants sp JOIN sprints s ON s.id = sp.sprint_id JOIN memberships m ON m.workspace_id = s.workspace_id AND m.account_id = sp.account_id
      WHERE sp.is_facilitator = 1 AND m.revoked_at IS NULL AND ${UNFINISHED}${where.map((w) => ` AND ${w}`).join('')}
        AND EXISTS (SELECT 1 FROM sprint_participants o JOIN memberships om ON om.workspace_id = s.workspace_id AND om.account_id = o.account_id AND om.revoked_at IS NULL
                     WHERE o.sprint_id = s.id AND o.account_id <> sp.account_id)
      ORDER BY s.starts_on`,
    ...args,
  )
}

/** Whether this standing lets them go (a sole workspace goes with them). */
export const free = (s: Standing) => !s.last_owner && s.facilitating.length === 0

/** Sprints whose rooms have held a retro — only those keep anything — by participant, or by workspace. */
export async function retroRooms(db: D1Database, by: { accountId: string } | { workspaceIds: string[] }): Promise<string[]> {
  const rows =
    'accountId' in by
      ? await all<{ id: string }>(db, 'SELECT s.id FROM sprint_participants sp JOIN sprints s ON s.id = sp.sprint_id WHERE sp.account_id = ? AND s.session_started_at IS NOT NULL', by.accountId)
      : by.workspaceIds.length
        ? await all<{ id: string }>(db, 'SELECT id FROM sprints WHERE workspace_id IN (SELECT value FROM json_each(?)) AND session_started_at IS NOT NULL', JSON.stringify(by.workspaceIds))
        : []
  return rows.map((r) => r.id)
}

/** Unfinished sprints they're in, whose live connections close once they've gone. */
export async function openSprints(db: D1Database, accountId: string, workspaceId?: string): Promise<string[]> {
  const rows = await all<{ id: string }>(
    db,
    `SELECT s.id FROM sprints s JOIN sprint_participants sp ON sp.sprint_id = s.id WHERE sp.account_id = ? AND ${UNFINISHED}${workspaceId ? ' AND s.workspace_id = ?' : ''}`,
    ...(workspaceId ? [accountId, workspaceId] : [accountId]),
  )
  return rows.map((r) => r.id)
}

/**
 * SQL for "this account facilitates an unfinished sprint another current member is in" — `facilitated`
 * as a condition, for the account bound to the one `?` (and, with `inWorkspace`, the workspace
 * bound to a second).
 */
const facilitatingSql = (inWorkspace: boolean) =>
  `EXISTS (SELECT 1 FROM sprint_participants sp JOIN sprints s ON s.id = sp.sprint_id JOIN memberships fm ON fm.workspace_id = s.workspace_id AND fm.account_id = sp.account_id AND fm.revoked_at IS NULL
     WHERE sp.account_id = ? AND sp.is_facilitator = 1 AND ${UNFINISHED}${inWorkspace ? ' AND s.workspace_id = ?' : ''}
       AND EXISTS (SELECT 1 FROM sprint_participants o JOIN memberships om ON om.workspace_id = s.workspace_id AND om.account_id = o.account_id AND om.revoked_at IS NULL
                    WHERE o.sprint_id = s.id AND o.account_id <> sp.account_id))`

/**
 * A member leaves a workspace (or an owner removes them): later requests fail, unfinished sprints
 * lose them, and what they submitted stays in its sprints, without their name as always.
 */
export function revokeMembership(workspaceId: string, accountId: string, actorId: string, action: 'membership.revoked' | 'membership.left'): Statement[] {
  const now = Date.now()
  // Within the one transaction: an owner goes only while another owner stays (two owners leaving
  // at once can't leave a team with none), nobody goes while facilitating a sprint others are in
  // (a handover to them can land after they were checked), and nothing else happens unless the
  // membership ended.
  const revoked = `EXISTS (SELECT 1 FROM memberships WHERE workspace_id = ? AND account_id = ? AND revoked_at = ${now})`
  return [
    [
      `UPDATE memberships SET revoked_at = ? WHERE workspace_id = ? AND account_id = ? AND revoked_at IS NULL
         AND (role <> 'owner' OR EXISTS (SELECT 1 FROM memberships o WHERE o.workspace_id = memberships.workspace_id AND o.account_id <> memberships.account_id AND o.role = 'owner' AND o.revoked_at IS NULL))
         AND NOT ${facilitatingSql(true)}`,
      now,
      workspaceId,
      accountId,
      accountId,
      workspaceId,
    ],
    [`DELETE FROM sprint_participants WHERE account_id = ? AND sprint_id IN (SELECT id FROM sprints s WHERE s.workspace_id = ? AND ${UNFINISHED}) AND ${revoked}`, accountId, workspaceId, workspaceId, accountId],
    [`INSERT INTO audit_events (workspace_id, actor_id, action, meta, created_at) SELECT ?,?,?,?,? WHERE ${revoked}`, workspaceId, actorId, action, action === 'membership.revoked' ? JSON.stringify({ account_id: accountId }) : '{}', now, workspaceId, accountId],
  ]
}

/** A whole workspace and everything in it. Rows that point at it without a foreign key go first. */
/**
 * `aloneFor`: delete only while that account is still the only active member — someone joining at
 * the same moment keeps the workspace (it's checked inside the same transaction).
 */
export function deleteWorkspaces(ids: string[], aloneFor?: string): Statement[] {
  if (!ids.length) return []
  // The workspaces going: those listed, and — with `aloneFor` — still with no one else in them.
  const going = `SELECT w.id FROM workspaces w WHERE w.id IN (SELECT value FROM json_each(?))${aloneFor ? ' AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.workspace_id = w.id AND m.revoked_at IS NULL AND m.account_id <> ?)' : ''}`
  const args = [JSON.stringify(ids), ...(aloneFor ? [aloneFor] : [])]
  return [
    [`DELETE FROM jobs WHERE status IN ('queued','running') AND json_extract(payload, '$.sprint_id') IN (SELECT id FROM sprints WHERE workspace_id IN (${going}))`, ...args],
    [`DELETE FROM audit_events WHERE workspace_id IN (${going})`, ...args],
    // Sprints, entries, themes, votes, keys, invitations, links… cascade.
    [`DELETE FROM workspaces WHERE id IN (${going})`, ...args],
  ]
}

/** SQL for "this account (the one `?`) is the only owner of a workspace someone else is in". */
const LAST_OWNER = `EXISTS (SELECT 1 FROM memberships lm WHERE lm.account_id = ? AND lm.revoked_at IS NULL AND lm.role = 'owner'
    AND EXISTS (SELECT 1 FROM memberships o WHERE o.workspace_id = lm.workspace_id AND o.account_id <> lm.account_id AND o.revoked_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM memberships o WHERE o.workspace_id = lm.workspace_id AND o.account_id <> lm.account_id AND o.revoked_at IS NULL AND o.role = 'owner'))`

/**
 * An account and what's theirs. Run only once `standing` shows they're free everywhere; the
 * workspaces only they were in are passed as `soleWorkspaces` and go too. Every statement holds only
 * while they're still free — a handover to them, or someone joining a workspace only they own,
 * landing meanwhile stops all of it, never some of it. Nothing it reads changes before the last
 * statement, so the check comes out the same each time; the caller sees whether that last one
 * deleted the account.
 */
export function deleteAccount(accountId: string, email: string | null, soleWorkspaces: string[]): Statement[] {
  const a = accountId
  const free = `NOT ${LAST_OWNER} AND NOT ${facilitatingSql(false)}`
  return accountStatements(a, email, soleWorkspaces).map(([sql, ...args]): Statement => [`${sql} AND ${free}`, ...args, a, a])
}

/** Each statement ends with its WHERE clause, so the caller can add a condition to all of them. */
function accountStatements(accountId: string, email: string | null, soleWorkspaces: string[]): Statement[] {
  const now = Date.now()
  const a = accountId
  return [
    ...deleteWorkspaces(soleWorkspaces, a),
    // What nobody has seen yet goes with them.
    ['DELETE FROM entries WHERE author_account_id = ? AND reveal_order IS NULL', a],
    ['DELETE FROM context_additions WHERE author_account_id = ? AND released_batch IS NULL', a],
    ["DELETE FROM votes WHERE account_id = ? AND round_id IN (SELECT id FROM vote_rounds WHERE status <> 'closed')", a],
    ["DELETE FROM checkin_responses WHERE account_id = ? AND checkin_id IN (SELECT id FROM checkins WHERE status <> 'shared')", a],
    // What the team has seen stays, tied to no one.
    [`UPDATE entries SET author_account_id = ${GONE}, idempotency_key = NULL WHERE author_account_id = ?`, a],
    [`UPDATE context_additions SET author_account_id = ${GONE}, idempotency_key = NULL WHERE author_account_id = ?`, a],
    [`UPDATE votes SET account_id = ${GONE} WHERE account_id = ?`, a],
    [`UPDATE checkin_responses SET account_id = ${GONE} WHERE account_id = ?`, a],
    ['UPDATE experiments SET owner_account_id = NULL, owner_accepted_at = NULL WHERE owner_account_id = ?', a],
    // Things they started, kept for the team but no longer theirs.
    ["UPDATE sprints SET created_by = '' WHERE created_by = ?", a],
    ["UPDATE checkins SET opened_by = '' WHERE opened_by = ?", a],
    ['UPDATE sprint_keys SET created_by = NULL WHERE created_by = ?', a],
    ['UPDATE sprint_key_wraps SET created_by = NULL WHERE created_by = ?', a],
    ['DELETE FROM invitations WHERE (invited_by = ? OR accepted_by = ?)', a, a],
    ...(email ? ([['DELETE FROM invitations WHERE email = ? AND accepted_at IS NULL', email]] as Statement[]) : []),
    ["UPDATE join_links SET revoked_at = COALESCE(revoked_at, ?), created_by = '' WHERE created_by = ?", now, a],
    ['UPDATE join_links SET redeemed_by = NULL WHERE redeemed_by = ?', a],
    ['UPDATE join_requests SET decided_by = NULL WHERE decided_by = ?', a],
    // Workspace history keeps what happened, by "someone" (GONE_ACTOR, not Muni) — and says they left.
    ['UPDATE audit_events SET actor_id = ? WHERE actor_id = ?', GONE_ACTOR, a],
    ["UPDATE audit_events SET meta = '{}' WHERE json_extract(meta, '$.account_id') = ?", a],
    [
      "INSERT INTO audit_events (workspace_id, actor_id, action, meta, created_at) SELECT workspace_id, ?, 'account.deleted', '{}', ? FROM memberships WHERE account_id = ? AND revoked_at IS NULL",
      GONE_ACTOR,
      now,
      a,
    ],
    // Their own records, and mail not yet sent to them.
    ['DELETE FROM security_events WHERE account_id = ?', a],
    ['DELETE FROM webauthn_challenges WHERE account_id = ?', a],
    [`DELETE FROM rate_events WHERE bucket IN (${ACCOUNT_BUCKETS.map(() => '?').join(',')})`, ...ACCOUNT_BUCKETS.map((k) => accountBucket(k, a))],
    ...(email
      ? ([
          ["DELETE FROM jobs WHERE status IN ('queued','running') AND json_extract(payload, '$.to') = ?", email],
          ['DELETE FROM dev_mail WHERE to_addr = ?', email],
        ] as Statement[])
      : []),
    // Memberships, participation, sessions, passkeys, keys, key wraps, address… cascade.
    ['DELETE FROM accounts WHERE id = ?', a],
  ]
}
