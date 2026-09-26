/**
 * Keeps one sprint's draft as it's written. A draft belongs to the sprint it was started for:
 * it's saved under that sprint, restored only there, and moves to another sprint only when the
 * writer explicitly picks a different destination. Nothing here ever submits anything.
 *
 * - Edits are saved after a short pause, and immediately when the composer goes away (navigating,
 *   switching workspace or sprint, collection closing), so the last words typed are never lost.
 * - Once local data has been cleared (the generation changed), nothing is written back.
 */
import { hasText, type Payload } from '@/lib/local/store'

export interface DraftSink {
  saveDraft(sprintId: string, payload: Payload): Promise<void>
  clearDraft(sprintId: string): Promise<void>
}

export interface DraftKeeper {
  readonly sprintId: string | null
  /** The text changed. Saved after `delay` ms (or cleared, when empty). */
  update(p: Payload): void
  /** Save anything pending now. */
  flush(): Promise<void>
  /** Forget anything pending (the thought was just saved and its draft removed). */
  discard(): void
  /** The writer chose another destination for this text: it goes there, and leaves here. */
  moveTo(sprintId: string, p: Payload): Promise<void>
  /** The composer is going away: save what's pending, then stop. */
  dispose(): Promise<void>
}

export function draftKeeper(sink: DraftSink, sprintId: string | null, opts: { delay?: number; generation?: () => number } = {}): DraftKeeper {
  const delay = opts.delay ?? 400
  const born = opts.generation?.()
  const stale = () => !!opts.generation && opts.generation() !== born
  let pending: Payload | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const stop = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }
  const write = async (p: Payload) => {
    if (!sprintId || stale()) return
    try {
      if (hasText(p)) await sink.saveDraft(sprintId, p)
      else await sink.clearDraft(sprintId)
    } catch {
      /* the text is still on screen; storage errors surface when saving the thought */
    }
  }
  const flush = async () => {
    stop()
    const p = pending
    pending = null
    if (p) await write(p)
  }
  return {
    sprintId,
    update(p) {
      if (disposed) return
      pending = p
      stop()
      timer = setTimeout(() => void flush(), delay)
    },
    flush,
    discard() {
      stop()
      pending = null
    },
    async moveTo(to, p) {
      stop()
      pending = null
      if (stale()) return
      try {
        if (hasText(p)) await sink.saveDraft(to, p)
        if (sprintId && sprintId !== to) await sink.clearDraft(sprintId)
      } catch {
        /* as above */
      }
    },
    async dispose() {
      if (disposed) return
      await flush()
      disposed = true
    },
  }
}
