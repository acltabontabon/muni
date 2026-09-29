import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/client'
import { softLimit } from './experiments'

describe('adding an experiment past a limit', () => {
  it('offers “Add it anyway” only for the limit that can be gone past', () => {
    expect(softLimit(new ApiError(409, 'conflict', 'three experiments is plenty for one sprint. Add another only if you’re sure the team can carry it — confirm to continue'))).toBe(true)
    expect(softLimit(new ApiError(409, 'conflict', 'ten experiments is the hard limit'))).toBe(false)
    expect(softLimit(new ApiError(409, 'conflict', 'experiments are agreed during or after the retro'))).toBe(false)
    expect(softLimit(new ApiError(0, 'network', 'Couldn’t reach Muni.'))).toBe(false)
  })
})
