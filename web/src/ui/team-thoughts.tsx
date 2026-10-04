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
import { matchesThought, ThoughtSearch } from '@/ui/thought-search'

const PAGE = 30

export function TeamThoughts({ sprintId, refresh = 0, lead }: { sprintId: string; /** Bumped when the sprint says something changed. */ refresh?: number; lead?: string }) {
  const [entries, setEntries] = useState<SharedEntry[] | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<string | null>(null)
  const [shown, setShown] = useState(PAGE)
  const [query, setQuery] = useState('')
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
    const pending = seq
    return () => { pending.current++ }
  }, [load, keysEpoch, refresh])

  const cats = useMemo(() => {
    const n = new Map<string, number>()
    for (const e of entries ?? []) n.set(e.category ?? 'unsorted', (n.get(e.category ?? 'unsorted') ?? 0) + 1)
    return [...n]
  }, [entries])
  const filtering = !!entries && entries.length > 8 && cats.length > 1
  const active = filtering && filter && cats.some(([category]) => category === filter) ? filter : null
  const visible = (entries ?? []).filter((e) => (!active || (e.category ?? 'unsorted') === active) && matchesThought(e, query))

  return (
    <section className="team" aria-labelledby={`team-${sprintId}`}>
      <header className="team-head">
        <h2 id={`team-${sprintId}`} className="font-display text-lg leading-tight">
          Everyone’s thoughts{entries?.length ? <span className="ml-2 font-normal text-ink-faint">{entries.length}</span> : null}
        </h2>
        <p className="mt-0.5 text-sm text-ink-soft">{lead ?? 'In no particular order — yours are in here too.'}</p>
      </header>
      {error && !entries ? <p className="mt-3 text-sm text-ink-soft" role="status">{error}</p> : null}
      {!entries && !error ? <p className="mt-3 text-sm text-ink-faint" role="status">Gathering the team’s thoughts…</p> : null}
      {error && !entries ? <Button size="sm" variant="quiet" onClick={load}>Try again</Button> : null}
      {entries && !entries.length ? <p className="mt-3 text-sm text-ink-soft">Nobody wrote anything in this sprint.</p> : null}
      {(entries && entries.length > 6) || query ? <div className="thought-search-wrap"><ThoughtSearch value={query} onChange={(value) => { setQuery(value); setShown(PAGE) }} label="Find in the team’s thoughts" /></div> : null}
      {filtering ? (
        <div className="mt-4">
          <Choices
            value={active}
            onChange={(v) => { setFilter(v); setShown(PAGE) }}
            allowNone
            label="Show one category"
            options={cats.map(([c, n]) => ({ id: c, label: <>{categoryMeta(c === 'unsorted' ? null : c).label} <span className="count">{n}</span></>, color: categoryMeta(c === 'unsorted' ? null : c).color }))}
          />
        </div>
      ) : null}
      {visible.length ? <ul className="retro-thoughts team-list">{visible.slice(0, shown).map((e) => <Thought key={e.id} e={e} />)}</ul> : null}
      {query.trim() ? <p className="thought-results" role="status">{visible.length} {visible.length === 1 ? 'thought matches' : 'thoughts match'} your search.</p> : null}
      {entries && (active || query.trim()) && !visible.length ? <p className="mt-3 text-sm text-ink-soft">Try another word or category. <button type="button" className="underline underline-offset-4" onClick={() => { setQuery(''); setFilter(null); setShown(PAGE) }}>Clear filters</button></p> : null}
      {visible.length > shown ? (
        <div className="mt-2">
          <Button size="sm" variant="ghost" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, visible.length - shown)} more</Button>
        </div>
      ) : null}
    </section>
  )
}
