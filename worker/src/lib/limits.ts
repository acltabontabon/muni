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

/** SQL for a statement that seats someone in a sprint, with `sprints` in scope: true while it has room. */
export const HAS_SEAT = `(SELECT count(*) FROM sprint_participants seat WHERE seat.sprint_id = sprints.id) < ${MAX_PARTICIPANTS}`
