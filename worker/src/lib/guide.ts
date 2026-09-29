/**
 * The first evening (web/src/lib/guide.ts has its steps and words). A new account is shown a
 * prologue once, then guided until its first retro is done; the person can hide the guide and bring
 * it back, and once done it stays done. What the guide knows is only ever about the person asking.
 */
import type { GuideStage, GuideView, Milestone } from '../contract'

export const GUIDE = { prologue: 0, on: 1, hidden: 2, done: 3 } as const
export const guideName = (n: number | null | undefined): GuideStage => {
  for (const [k, v] of Object.entries(GUIDE)) if (v === n) return k as GuideStage
  return 'done'
}
/** What the person may set: the prologue is only ever a new account's. */
export const isGuideChoice = (v: unknown): v is Exclude<GuideStage, 'prologue'> => v === 'on' || v === 'hidden' || v === 'done'

const REAL = 'JOIN workspaces w ON w.id = s.workspace_id AND w.is_demo = 0'
const MINE = `FROM sprint_participants p JOIN sprints s ON s.id = p.sprint_id ${REAL} WHERE p.account_id = ?1`

/**
 * Which of the evening's milestones the person has reached, in one statement. Demo workspaces
 * don't count. `track`: someone who started a team or facilitates a sprint walks the starter's
 * evening; everyone else, a member's.
 */
export async function guideView(db: D1Database, accountId: string): Promise<GuideView> {
  const row = await db
    .prepare(
      `SELECT
         EXISTS (SELECT 1 FROM memberships m JOIN workspaces w ON w.id = m.workspace_id AND w.is_demo = 0
                  WHERE m.account_id = ?1 AND m.role = 'owner' AND m.revoked_at IS NULL) AS team,
         EXISTS (SELECT 1 ${MINE} AND p.is_facilitator = 1) AS sprint,
         EXISTS (SELECT 1 ${MINE} AND p.is_facilitator = 1
                  AND (SELECT count(*) FROM sprint_participants o WHERE o.sprint_id = s.id) > 1) AS people,
         EXISTS (SELECT 1 FROM entries e JOIN sprints s ON s.id = e.sprint_id ${REAL} WHERE e.author_account_id = ?1) AS thought,
         EXISTS (SELECT 1 ${MINE} AND s.collection_closed_at IS NOT NULL) AS reveal,
         EXISTS (SELECT 1 ${MINE} AND s.session_started_at IS NOT NULL) AS retro,
         EXISTS (SELECT 1 ${MINE} AND s.status IN ('completed','archived')) AS agreed`,
    )
    .bind(accountId)
    .first<Record<Milestone, number>>()
  const reached = (['team', 'sprint', 'people', 'thought', 'reveal', 'retro', 'agreed'] as const).filter((k) => row?.[k] === 1)
  return { track: reached.includes('team') || reached.includes('sprint') ? 'starter' : 'member', reached }
}
