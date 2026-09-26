import { describe, expect, it } from 'vitest'
import { pickDestination } from './destination'

const a = { id: 'a' }
const b = { id: 'b' }

describe('pickDestination', () => {
  it('opens the only collecting sprint directly', () => {
    expect(pickDestination([a], null)).toBe(a)
    expect(pickDestination([a], 'stale-id')).toBe(a)
  })
  it('asks when several are collecting, unless one was chosen', () => {
    expect(pickDestination([a, b], null)).toBeNull()
    expect(pickDestination([a, b], 'gone')).toBeNull()
    expect(pickDestination([a, b], 'b')).toBe(b)
  })
  it('has nowhere to go when nothing is collecting', () => {
    expect(pickDestination([], 'a')).toBeNull()
  })
})
