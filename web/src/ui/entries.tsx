import { clsx } from 'clsx'
import type { SharedEntry } from '@/api/types'
import { categoryMeta, PERIODS } from '@/lib/categories'
import { CategoryDot } from '@/ui'

/** One anonymous entry as everyone sees it. No author, no time. */
export function EntryCard({ e, className, dense, children, draggable, onDragStart, selected, onSelect }: { e: SharedEntry; className?: string; dense?: boolean; children?: React.ReactNode; draggable?: boolean; onDragStart?: (ev: React.DragEvent) => void; selected?: boolean; onSelect?: () => void }) {
  const meta = categoryMeta(e.category)
  return (
    <div
      className={clsx('rounded-xl border bg-card transition-colors', dense ? 'p-3' : 'p-4', selected ? 'border-sinag ring-2 ring-sinag/25' : 'border-line', draggable && 'cursor-grab active:cursor-grabbing', className)}
      draggable={draggable}
      onDragStart={onDragStart}
      style={{ borderLeftWidth: 3, borderLeftColor: meta.color }}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          {onSelect ? <input type="checkbox" className="size-4 accent-[var(--sinag)]" checked={!!selected} onChange={onSelect} aria-label="Select entry" /> : null}
          <CategoryDot color={meta.color} label={meta.label} small />
          {e.period ? <span className="text-xs text-ink-faint">{PERIODS.find((p) => p.id === e.period)?.label}</span> : null}
        </div>
        {children}
      </div>
      <p className={clsx('whitespace-pre-wrap leading-relaxed', dense ? 'text-sm' : 'text-[15px]')}>{e.body}</p>
      {e.impact ? <p className="mt-1 text-sm text-ink-soft"><span className="text-ink-faint">Impact:</span> {e.impact}</p> : null}
      {e.might_help ? <p className="mt-1 text-sm text-ink-soft"><span className="text-ink-faint">Might help:</span> {e.might_help}</p> : null}
    </div>
  )
}

export function CategoryMix({ mix }: { mix: Record<string, number> }) {
  const entries = Object.entries(mix).filter(([, n]) => n > 0)
  if (!entries.length) return null
  return (
    <span className="inline-flex items-center gap-2 text-xs text-ink-soft">
      {entries.map(([c, n]) => {
        const m = categoryMeta(c)
        return (
          <span key={c} className="inline-flex items-center gap-1" title={m.label}>
            <span aria-hidden className="size-2 rounded-full" style={{ background: m.color }} /> {n}
          </span>
        )
      })}
    </span>
  )
}
