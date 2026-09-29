/**
 * What a person can actually cast in a vote. The server allows the round's budget, and at most one
 * vote per topic (worker/src/routes/voting.ts), so with fewer topics than votes a person holds one
 * vote per topic: three votes and two topics is two votes to cast, never "3 of 2 left".
 */
export function votePurse(round: { budget: number; my_remaining: number; my_votes: string[] }, topics: string[]) {
  const size = Math.max(0, Math.min(round.budget, topics.length))
  const used = Math.min(size, round.my_votes.filter((id) => topics.includes(id)).length)
  const left = Math.max(0, Math.min(round.my_remaining, size - used))
  return { size, used, left }
}
