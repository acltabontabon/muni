import { describe, expect, it } from 'vitest'
import { serialPasses } from './passes'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

describe('send passes', () => {
  it('a saved thought waits for the pass under way, then gets its own (and its result)', async () => {
    const gates: ReturnType<typeof deferred>[] = []
    const log: string[] = []
    const run = serialPasses(async (force) => {
      const g = deferred()
      gates.push(g)
      log.push(`start ${force}`)
      await g.promise
      log.push(`end ${force}`)
      return `pass ${gates.length}`
    })
    const opening = run() // e.g. the pass when the page opens
    const saved = run(true) // the person saves a thought meanwhile
    await Promise.resolve()
    expect(log).toEqual(['start false'])
    gates[0].resolve()
    expect(await opening).toBe('pass 1')
    await new Promise((r) => setTimeout(r, 0))
    expect(log).toEqual(['start false', 'end false', 'start true'])
    gates[1].resolve()
    expect(await saved).toBe('pass 2')
  })

  it('routine triggers join the pass under way instead of piling up', async () => {
    let n = 0
    const g = deferred()
    const run = serialPasses(async () => {
      n++
      await g.promise
      return n
    })
    const a = run()
    const b = run()
    const c = run()
    g.resolve()
    expect(await Promise.all([a, b, c])).toEqual([1, 1, 1])
    expect(n).toBe(1)
  })

  it('a failed pass doesn’t block the next', async () => {
    let fail = true
    const run = serialPasses(async () => {
      if (fail) throw new Error('offline')
      return 'ok'
    })
    await expect(run()).rejects.toThrow('offline')
    fail = false
    expect(await run(true)).toBe('ok')
  })
})
