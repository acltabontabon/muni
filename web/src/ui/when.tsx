/** Sprint times, readable at a glance: when, in whose time, and how soon. */
import { CalendarClock } from 'lucide-react'
import { clsx } from 'clsx'
import { describeRetro } from '@/lib/schedule'

export function RetroWhen({ s, className, icon = true, prefix = 'Retro' }: { s: { retro_at: string; timezone: string }; className?: string; icon?: boolean; prefix?: string }) {
  const r = describeRetro(s.retro_at, s.timezone)
  return (
    <span className={clsx('inline-flex min-w-0 flex-wrap items-center gap-x-1.5', className)}>
      {icon ? <CalendarClock className="size-4 shrink-0 self-center" aria-hidden /> : null}
      <span>
        {prefix} <span className="font-medium text-ink">{r.date}, {r.time}</span> <span title={r.offset}>{r.zone}</span>
      </span>
      <span className="text-ink-faint">· {r.relative}{r.yours ? ` · ${r.yours}` : ''}</span>
    </span>
  )
}
