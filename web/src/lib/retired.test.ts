import { describe, expect, it } from 'vitest'
import { dropRetiredCaches, RETIRED_CACHES } from './retired'

describe('retired caches', () => {
  it('deletes only the caches voice used, and never the shell, fonts or anything else', async () => {
    const names = new Set(['muni-shell-abc123', 'muni-fonts', ...RETIRED_CACHES, 'something-else'])
    await dropRetiredCaches({ delete: async (n: string) => names.delete(n) })
    expect([...names].sort()).toEqual(['muni-fonts', 'muni-shell-abc123', 'something-else'])
  })

  it('shrugs off a browser that refuses (private windows) or has no Cache API', async () => {
    await expect(dropRetiredCaches({ delete: async () => Promise.reject(new Error('SecurityError')) })).resolves.toBeUndefined()
    await expect(dropRetiredCaches(null)).resolves.toBeUndefined()
  })
})
