import { describe, expect, it } from 'vitest'
import { matchesThought } from './thought-search'

describe('finding a thought', () => {
  const thought = { body: 'Pairing caught the staging bug.', impact: 'A same-day review.', might_help: 'Keep a review buddy.' }
  it('searches both the observation and its context, without changing the text', () => {
    expect(matchesThought(thought, 'STAGING buddy')).toBe(true)
    expect(matchesThought(thought, 'review outage')).toBe(false)
    expect(thought.body).toBe('Pairing caught the staging bug.')
  })
  it('treats empty searches and repeated spaces as people expect', () => {
    expect(matchesThought(thought, '   ')).toBe(true)
    expect(matchesThought(thought, '  pairing   REVIEW  ')).toBe(true)
  })
  it('handles uncategorized thoughts without optional context', () => {
    expect(matchesThought({ body: 'A quiet Friday.' }, 'friday')).toBe(true)
  })
})
