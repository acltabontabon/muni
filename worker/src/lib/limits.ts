/**
 * How much a sprint holds. Each cap is enforced where the data is written, so whatever exists is
 * always read back whole: nothing is cut off when it's shown.
 */

/** People taking part in one sprint. */
export const MAX_PARTICIPANTS = 60
/** Thoughts one person saves in one sprint (so a sprint holds MAX_PARTICIPANTS times as many). */
export const MAX_ENTRIES_EACH = 200
/** Themes in one sprint. */
export const MAX_THEMES = 40
/** Additions one person makes to the topics during one sprint's retro. */
export const MAX_NOTES_EACH = 100

/**
 * Sprints one account may create a day, across its workspaces. Every sprint can queue reminder
 * emails, so this is a brake on spending the deployment's daily email allowance; no real team
 * starts twenty sprints in a day.
 */
export const SPRINTS_DAILY = 20
/**
 * Reminder emails one workspace sends a day, per active member. A reminder goes at most once per
 * sprint and moment to each participant, so a team gets far fewer; a workspace that queues more
 * (many overlapping sprints) can't use up the deployment's allowance and block invitations.
 */
export const REMINDER_EMAILS_PER_MEMBER_DAILY = 3

/** SQL for a statement that seats someone in a sprint, with `sprints` in scope: true while it has room. */
export const HAS_SEAT = `(SELECT count(*) FROM sprint_participants seat WHERE seat.sprint_id = sprints.id) < ${MAX_PARTICIPANTS}`
