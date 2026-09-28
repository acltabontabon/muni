/**
 * What the retro's talk has time for. Its minutes are shared across the first three topics (the
 * room's timebox for each), so about that many get a proper conversation — which is why the team
 * votes: to choose which come first.
 */
export function talkTime(plan: Record<string, number>, topics: number) {
  const reach = Math.max(1, Math.min(3, topics))
  const minutes = plan.talk ?? 28
  return { reach, minutes, per: Math.max(1, Math.floor(minutes / reach)) }
}
