/**
 * Who may bring people in. Into the workspace — an email invitation or invite link without a
 * sprint, deciding the requests such a link collects, and the list of pending invitations with
 * their addresses — only its owners. Into a sprint (which also makes someone a member): that
 * sprint's facilitator, while it's unfinished. Facilitating one sprint grants nothing beyond it;
 * any member can set up a draft and facilitate it.
 *
 * A grant is re-checked when it's used, not only when it's made: an invitation or personal link
 * stops working once the person who made it may no longer invite into that scope.
 */
import { count } from './db'

/** `role` is the account's role in the workspace, or null when it isn't a member. */
export async function mayGrant(db: D1Database, workspaceId: string, sprintId: string | null, accountId: string, role: string | null): Promise<boolean> {
  if (!role) return false
  if (!sprintId) return role === 'owner'
  return (
    (await count(
      db,
      `SELECT count(*) AS n FROM sprint_participants sp JOIN sprints s ON s.id = sp.sprint_id
        WHERE sp.sprint_id = ? AND s.workspace_id = ? AND sp.account_id = ? AND sp.is_facilitator = 1 AND s.status NOT IN ('completed','archived')`,
      sprintId,
      workspaceId,
      accountId,
    )) > 0
  )
}

/** Turning an invitation or a link off never lets anyone in, so owners may do it for any scope. */
export async function mayRevoke(db: D1Database, workspaceId: string, sprintId: string | null, accountId: string, role: string | null): Promise<boolean> {
  return role === 'owner' || mayGrant(db, workspaceId, sprintId, accountId, role)
}

/** `mayGrant` for many rows of one request: each scope (the workspace, or one sprint) is asked once. */
export function grantChecker(db: D1Database, workspaceId: string, accountId: string, role: string, check = mayGrant) {
  const seen = new Map<string, Promise<boolean>>()
  return (sprintId: string | null) => {
    const k = sprintId ?? ''
    if (!seen.has(k)) seen.set(k, check(db, workspaceId, sprintId, accountId, role))
    return seen.get(k)!
  }
}
