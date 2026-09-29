import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PARTS, Refresher, isNewer, partsFor, type Part } from './stage-reads'

function deferred() {
  let resolve!: () => void
  let reject!: (e: unknown) => void
  const promise = new Promise<void>((a, b) => ((resolve = a), (reject = b)))
  return { promise, resolve, reject }
}
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

/** A refresher whose reads the test answers by hand; `shown` records what each read was allowed to show. */
function setup() {
  const reads: { part: Part; d: ReturnType<typeof deferred>; current: () => boolean }[] = []
  const shown: Part[] = []
  const results: [Part, unknown][] = []
  const r = new Refresher<Part>(
    async (part, current) => {
      const d = deferred()
      reads.push({ part, d, current })
      await d.promise
      if (current()) shown.push(part)
    },
    { gather: 150, onResult: (p, e) => results.push([p, e]) },
  )
  const open = (part: Part) => reads.filter((x) => x.part === part)
  return { r, reads, shown, results, open }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('which parts a hint reads', () => {
  it('reads the votes alone for a vote: closing a round sends themes as well', () => {
    expect(partsFor('votes')).toEqual(['votes'])
    expect(partsFor('themes')).toEqual(['themes', 'stage'])
    expect(partsFor('meeting')).toEqual(['stage'])
    expect(partsFor('sprint')).toEqual(['sprint', 'stage'])
    expect(partsFor('all')).toEqual([...PARTS])
    expect(partsFor('something-new')).toEqual([])
  })
})

describe('which stage snapshot is shown', () => {
  const at = (session: string, version: number, started = '2026-09-29T08:00:00Z') => ({ session_id: session, version, started_at: started })
  it('never an older version of the same session over a newer one', () => {
    expect(isNewer(at('a', 4), at('a', 5))).toBe(false)
    expect(isNewer(at('a', 5), at('a', 5))).toBe(true)
    expect(isNewer(at('a', 6), at('a', 5))).toBe(true)
    expect(isNewer(at('a', 1), null)).toBe(true)
  })
  it('a retro started again replaces the old session; the old one’s late answer doesn’t come back', () => {
    const old = at('a', 9, '2026-09-29T08:00:00Z')
    const again = at('b', 1, '2026-09-29T09:00:00Z')
    expect(isNewer(again, old)).toBe(true)
    expect(isNewer(old, again)).toBe(false)
  })
})

describe('refresher', () => {
  it('reads each part once for hints that arrive together (moving to Talk sends four)', async () => {
    const t = setup()
    t.r.hint(partsFor('votes'))
    t.r.hint(partsFor('themes'))
    t.r.hint(partsFor('themes'))
    t.r.hint(partsFor('meeting'))
    expect(t.reads).toHaveLength(0)
    vi.advanceTimersByTime(150)
    expect(t.reads.map((x) => x.part).sort()).toEqual(['stage', 'themes', 'votes'])
  })

  it('never reads a part twice at once; a hint during a read reads it once more afterwards', async () => {
    const t = setup()
    void t.r.now(['stage'])
    t.r.hint(['stage'])
    vi.advanceTimersByTime(150)
    t.r.hint(['stage'])
    vi.advanceTimersByTime(150)
    expect(t.open('stage')).toHaveLength(1)
    t.reads[0].d.resolve()
    await flush()
    expect(t.open('stage')).toHaveLength(2)
    t.reads[1].d.resolve()
    await flush()
    expect(t.open('stage')).toHaveLength(2)
    expect(t.shown).toEqual(['stage', 'stage'])
  })

  it('drops a read overtaken by an action’s own answer, and reads once more', async () => {
    const t = setup()
    void t.r.now(['votes'])
    t.r.supersede('votes')
    t.reads[0].d.resolve()
    await flush()
    expect(t.shown).toEqual([])
    expect(t.open('votes')).toHaveLength(2)
    t.reads[1].d.resolve()
    await flush()
    expect(t.shown).toEqual(['votes'])
  })

  it('an answer shown another way with nothing under way costs no read', async () => {
    const t = setup()
    t.r.supersede('votes')
    vi.advanceTimersByTime(1000)
    await flush()
    expect(t.reads).toHaveLength(0)
  })

  it('says whether a read worked, and a failed part is read again on the next hint', async () => {
    const t = setup()
    const first = t.r.now(['sprint', 'stage'])
    t.open('sprint')[0].d.resolve()
    t.open('stage')[0].d.reject(new Error('offline'))
    expect(await first).toBe(false)
    expect(t.results.map(([p, e]) => [p, e ? 'failed' : 'ok'])).toEqual([['sprint', 'ok'], ['stage', 'failed']])
    t.r.hint(['stage'])
    vi.advanceTimersByTime(150)
    t.open('stage')[1].d.resolve()
    await flush()
    expect(t.results.at(-1)).toEqual(['stage', null])
    expect(t.shown).toEqual(['sprint', 'stage'])
  })

  it('a read joined while under way resolves when the part is read', async () => {
    const t = setup()
    void t.r.now(['checkins'])
    const joined = t.r.now(['checkins'])
    t.reads[0].d.resolve()
    await flush()
    t.reads[1].d.resolve()
    expect(await joined).toBe(true)
  })

  it('after leaving, nothing gathered is read and nothing under way is shown', async () => {
    const t = setup()
    void t.r.now(['themes'])
    t.r.hint(['votes'])
    t.r.stop()
    vi.advanceTimersByTime(1000)
    t.reads[0].d.resolve()
    await flush()
    expect(t.reads).toHaveLength(1)
    expect(t.shown).toEqual([])
    expect(await t.r.now(['sprint'])).toBe(false)
    expect(t.reads).toHaveLength(1)
  })
})
