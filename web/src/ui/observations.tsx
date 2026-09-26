import { useState } from 'react'
import { clsx } from 'clsx'
import { ChevronDown } from 'lucide-react'
import type { SharedEntry } from '@/api/types'
import { categoryMeta, PERIODS } from '@/lib/categories'
import { Button } from '@/ui'

/**
 * An observation as the room reads it: original wording, small category
 * marker, impact and suggestion behind one expander. Short and long entries
 * sit side by side without stretching each other.
 */
export function Observation({ e, size = 'md' }: { e: SharedEntry; size?: 'sm' | 'md' | 'lg' }) {
  const meta = categoryMeta(e.category)
  const [open, setOpen] = useState(false)
  const long = e.body.length > 320
  const hasMore = !!(e.impact || e.might_help)
  return (
    <article className="card flex flex-col gap-2 self-start p-4" style={{ borderLeft: `3px solid ${meta.color}` }}>
      <div className="flex items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: meta.color }}>
          <span aria-hidden className="size-1.5 rounded-full" style={{ background: meta.color }} />
          {meta.label}
        </span>
        {e.period ? <span className="text-ink-faint">· {PERIODS.find((p) => p.id === e.period)?.label}</span> : null}
      </div>
      <p className={clsx('whitespace-pre-wrap leading-relaxed', size === 'lg' ? 'text-lg' : size === 'sm' ? 'text-sm' : 'text-[15px]', long && !open && 'line-clamp-6')}>{e.body}</p>
      {open ? (
        <div className="space-y-1 text-sm text-ink-soft">
          {e.impact ? <p><span className="text-ink-faint">Impact — </span>{e.impact}</p> : null}
          {e.might_help ? <p><span className="text-ink-faint">Might help — </span>{e.might_help}</p> : null}
        </div>
      ) : null}
      {hasMore || long ? (
        <button className="inline-flex w-fit items-center gap-1 text-xs text-ink-soft hover:text-ink" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <ChevronDown className={clsx('size-3.5 transition-transform', open && 'rotate-180')} /> {open ? 'Less' : hasMore ? 'Impact and what might help' : 'Read more'}
        </button>
      ) : null}
    </article>
  )
}

/** Paged list: readable text, never shrunk to fit. */
export function ObservationList({ entries, pageSize = 8, size }: { entries: SharedEntry[]; pageSize?: number; size?: 'sm' | 'md' | 'lg' }) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(entries.length / pageSize))
  const p = Math.min(page, pages - 1)
  const slice = entries.slice(p * pageSize, p * pageSize + pageSize)
  if (!entries.length) return <p className="text-ink-soft">No observations here.</p>
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2" style={{ alignItems: 'start' }}>
        {slice.map((e) => <Observation key={e.id} e={e} size={size} />)}
      </div>
      {pages > 1 ? (
        <div className="mt-3 flex items-center justify-between text-sm text-ink-soft">
          <span>{p * pageSize + 1}–{Math.min(entries.length, (p + 1) * pageSize)} of {entries.length}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={p === 0} onClick={() => setPage(p - 1)}>Previous</Button>
            <Button size="sm" variant="ghost" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>Next</Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function CategoryMarks({ mix }: { mix: Record<string, number> }) {
  const parts = Object.entries(mix).filter(([, n]) => n > 0)
  if (!parts.length) return null
  return (
    <span className="inline-flex items-center gap-1.5" aria-label={parts.map(([c, n]) => `${n} ${categoryMeta(c).label}`).join(', ')}>
      {parts.map(([c, n]) => (
        <span key={c} className="inline-flex items-center gap-0.5 text-[11px] text-ink-faint" title={`${n} ${categoryMeta(c).label}`}>
          <span aria-hidden className="size-1.5 rounded-full" style={{ background: categoryMeta(c).color }} />
          {n}
        </span>
      ))}
    </span>
  )
}
