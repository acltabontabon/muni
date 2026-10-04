import { Search, X } from 'lucide-react'
import { useId, useRef } from 'react'

/** Search stays on this device and never changes the team's shuffled reading order. */
export function ThoughtSearch({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  return <div className="thought-search">
    <Search size={17} aria-hidden />
    <label htmlFor={id} className="sr-only">{label}</label>
    <input ref={input} id={id} type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={label} autoComplete="off" />
    {value ? <button type="button" aria-label="Clear search" onClick={() => { onChange(''); input.current?.focus() }}><X size={16} aria-hidden /></button> : null}
  </div>
}

export function matchesThought(thought: { body: string; impact?: string | null; might_help?: string | null }, query: string) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  const text = [thought.body, thought.impact, thought.might_help].filter(Boolean).join(' ').toLocaleLowerCase()
  return terms.every((term) => text.includes(term))
}
