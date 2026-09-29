/**
 * How the live retro reads again when the room says something changed. The room sends hints — a
 * resource's name, never content — and one action sends several (moving to Talk: the votes, the
 * themes twice, the meeting). Read hint by hint, every screen asked for the same things three times
 * over and the answers could land in any order. Here hints are gathered for a moment and each part
 * is read once; a part is never read twice at the same time (a hint during a read reads it once
 * more afterwards); and an answer to a read that a newer one overtook is dropped, not shown.
 */

/** What the stage and the companion read, each from its own endpoint. */
export type Part = 'sprint' | 'stage' | 'themes' | 'votes' | 'experiments' | 'checkins'
export const PARTS: readonly Part[] = ['sprint', 'stage', 'themes', 'votes', 'experiments', 'checkins']

/** How long hints are gathered before reading: one action on the server sends several at once. */
export const GATHER_MS = 150

/**
 * The parts a hint makes stale. Themes carry the room's notes and what's been talked about, which
 * the stage shows too. Closing a vote also sends `themes` (their order and totals), so a vote on
 * its own reads only the votes.
 */
export function partsFor(resource: string): Part[] {
  switch (resource) {
    case 'all':
      return [...PARTS]
    case 'sprint':
      return ['sprint', 'stage']
    case 'meeting':
      return ['stage']
    case 'themes':
    case 'entries':
      return ['themes', 'stage']
    case 'votes':
      return ['votes']
    case 'commitments':
      return ['experiments']
    case 'checkins':
      return ['checkins']
    default:
      return []
  }
}

/**
 * Whether a stage snapshot may replace the one on screen. The room's version orders a session's
 * changes, and hints go out before the room applies a command, so an answer built from the old
 * state can arrive after the command's own: an older version is never shown over a newer one. A
 * new session (the retro started again) replaces the old one; an old session's late answer doesn't.
 */
export function isNewer(next: { session_id: string; version: number; started_at: string }, shown: { session_id: string; version: number; started_at: string } | null): boolean {
  if (!shown) return true
  if (next.session_id === shown.session_id) return next.version >= shown.version
  return Date.parse(next.started_at) >= Date.parse(shown.started_at)
}

/**
 * Reads parts on request. `read(part, current)` fetches a part and shows it only while `current()`
 * is still true. `onResult` hears how each read went (null when it succeeded).
 */
export class Refresher<P extends string> {
  private seq = new Map<P, number>()
  private flights = new Map<P, Promise<boolean>>()
  private again = new Set<P>()
  private gathered = new Set<P>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = false

  constructor(
    private read: (part: P, current: () => boolean) => Promise<void>,
    private opts: { gather?: number; onResult?: (part: P, error: unknown) => void } = {},
  ) {}

  /** Read these soon: parts hinted within a moment of each other are read once. */
  hint(parts: Iterable<P>) {
    if (this.stopped) return
    for (const p of parts) this.gathered.add(p)
    if (this.timer !== null || !this.gathered.size) return
    this.timer = setTimeout(() => {
      this.timer = null
      const due = [...this.gathered]
      this.gathered.clear()
      for (const p of due) void this.run(p)
    }, this.opts.gather ?? GATHER_MS)
  }

  /** Read these now (a first load, a retry), joining a read already under way. True if every one succeeded. */
  async now(parts: Iterable<P>): Promise<boolean> {
    const results = await Promise.all([...new Set(parts)].map((p) => this.run(p)))
    return results.every(Boolean)
  }

  /**
   * A newer value was just shown another way (an action's own response). A read under way may have
   * been answered before that action took effect: its answer is dropped, and the part is read once
   * more after it, so a change from someone else in between isn't lost either.
   */
  supersede(part: P) {
    this.seq.set(part, (this.seq.get(part) ?? 0) + 1)
    if (this.flights.has(part)) this.again.add(part)
  }

  /** Nothing more is read or shown (the retro was left). */
  stop() {
    this.stopped = true
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    this.gathered.clear()
  }

  /** One read of a part at a time; asked again while it's under way, it reads once more after. */
  private run(part: P): Promise<boolean> {
    if (this.stopped) return Promise.resolve(false)
    const busy = this.flights.get(part)
    if (busy) {
      this.again.add(part)
      return busy
    }
    let settle!: (ok: boolean) => void
    const flight = new Promise<boolean>((r) => (settle = r))
    this.flights.set(part, flight)
    void (async () => {
      let ok = false
      try {
        do {
          this.again.delete(part)
          const mine = (this.seq.get(part) ?? 0) + 1
          this.seq.set(part, mine)
          try {
            await this.read(part, () => !this.stopped && this.seq.get(part) === mine)
            ok = true
            if (!this.stopped) this.opts.onResult?.(part, null)
          } catch (e) {
            ok = false
            if (!this.stopped) this.opts.onResult?.(part, e)
          }
        } while (this.again.has(part) && !this.stopped)
      } finally {
        // In the same step as the loop's last check: a request after this starts a read of its own.
        this.flights.delete(part)
        settle(ok)
      }
    })()
    return flight
  }
}
