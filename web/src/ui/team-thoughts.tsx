/**
 * Everything the team wrote, once collection has closed: the reveal. The same for everyone in the
 * sprint, the facilitator included — no names, and the order the server shuffled them into, never
 * the order they were written. Reading it before the retro is what lets the meeting be for talking.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, get } from '@/api/client'
import type { SharedEntry } from '@/api/types'
import { categoryMeta } from '@/lib/categories'
import { useKeysEpoch } from '@/lib/e2ee/E2eeProvider'
import { Button } from '@/ui'
import { Choices } from '@/ui/capture'
import { Thought } from '@/ui/retro'

const PAGE = 30

export function TeamThoughts({ sprintId, refresh = 0, lead }: { sprintId: string; /** Bumped when the sprint says something changed. */ refresh?: number; lead?: string }) {
  const [entries, setEntries] = useState<SharedEntry[] | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<string | null>(null)
  const [shown, setShown] = useState(PAGE)
  const keysEpoch = useKeysEpoch()
  // Reads overlap (hints, unlocking): only the newest one's answer is shown.
  const seq = useRef(0)
  const load = useCallback(async () => {
    const my = ++seq.current
    try {
      const list = await get<SharedEntry[]>(`/api/sprints/${sprintId}/entries`)
      if (my !== seq.current) return
      setEntries(list)
      setError('')
    } catch (e) {
      if (my === seq.current) setError(e instanceof ApiError && e.status === 0 ? 'You’re offline. The team’s thoughts show here when Muni can reach the server.' : 'Couldn’t show the team’s thoughts just now.')
    }
  }, [sprintId])
  useEffect(() => {
    load()
  }, [load, keysEpoch, refresh])

  const cats = useMemo(() => {
    const n = new Map<string, number>()
    for (const e of entries ?? []) n.set(e.category ?? 'unsorted', (n.get(e.category ?? 'unsorted') ?? 0) + 1)
    return [...n]
  }, [entries])
  const visible = (entries ?? []).filter((e) => !filter || (e.category ?? 'unsorted') === filter)

  return (
    <section className="team" aria-labelledby={`team-${sprintId}`}>
      <header className="team-head">
        <h2 id={`team-${sprintId}`} className="font-display text-lg leading-tight">
          Everyone’s thoughts{entries?.length ? <span className="ml-2 font-normal text-ink-faint">{entries.length}</span> : null}
        </h2>
        <p className="mt-0.5 text-sm text-ink-soft">{lead ?? 'In no particular order — yours are in here too.'}</p>
      </header>
      {error && !entries ? <p className="mt-3 text-sm text-ink-soft" role="status">{error}</p> : null}
      {entries && !entries.length ? <p className="mt-3 text-sm text-ink-soft">Nobody wrote anything in this sprint.</p> : null}
      {entries && entries.length > 8 && cats.length > 1 ? (
        <div className="mt-4">
          <Choices
            value={filter}
            onChange={(v) => { setFilter(v); setShown(PAGE) }}
            allowNone
            label="Show one category"
            options={cats.map(([c, n]) => ({ id: c, label: <>{categoryMeta(c === 'unsorted' ? null : c).label} <span className="count">{n}</span></>, color: categoryMeta(c === 'unsorted' ? null : c).color }))}
          />
        </div>
      ) : null}
      {visible.length ? <ul className="retro-thoughts team-list">{visible.slice(0, shown).map((e) => <Thought key={e.id} e={e} />)}</ul> : null}
      {visible.length > shown ? (
        <div className="mt-2">
          <Button size="sm" variant="ghost" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, visible.length - shown)} more</Button>
        </div>
      ) : null}
    </section>
  )
}
