import { describe, expect, it } from 'vitest'
import { fairBudget, votePurse } from './votes'

const round = (budget: number, mine: string[]) => ({ budget, my_votes: mine, my_remaining: budget - mine.length })

describe('vote purse', () => {
  it('holds one vote per topic when the budget is bigger than the topics', () => {
    expect(votePurse(round(3, []), ['a', 'b'])).toEqual({ size: 2, used: 0, left: 2 })
    expect(votePurse(round(3, ['a']), ['a', 'b'])).toEqual({ size: 2, used: 1, left: 1 })
    expect(votePurse(round(3, ['a', 'b']), ['a', 'b'])).toEqual({ size: 2, used: 2, left: 0 })
  })

  it('is the budget when there are enough topics', () => {
    expect(votePurse(round(3, []), ['a', 'b', 'c', 'd'])).toEqual({ size: 3, used: 0, left: 3 })
    expect(votePurse(round(3, ['c', 'd']), ['a', 'b', 'c', 'd'])).toEqual({ size: 3, used: 2, left: 1 })
    expect(votePurse(round(1, []), ['a', 'b', 'c'])).toEqual({ size: 1, used: 0, left: 1 })
  })

  it('never says more are left than the server would take', () => {
    // A vote on a topic no longer listed still counts against the budget.
    expect(votePurse({ budget: 2, my_votes: ['gone'], my_remaining: 1 }, ['a', 'b', 'c'])).toEqual({ size: 2, used: 0, left: 1 })
    expect(votePurse(round(3, []), [])).toEqual({ size: 0, used: 0, left: 0 })
  })
})

describe('fair budget', () => {
  it('is never more than half the topics, so choosing always leaves something out', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 12].map((n) => fairBudget(3, n))).toEqual([1, 1, 1, 2, 2, 3, 3, 3])
    expect(fairBudget(5, 12)).toBe(5)
    expect(fairBudget(1, 9)).toBe(1)
  })
})
