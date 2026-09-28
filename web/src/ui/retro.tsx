import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import type { Experiment, SharedEntry } from '@/api/types'
import { OUTCOME_LABEL, PERIODS, categoryMeta } from '@/lib/categories'

/**
 * The retro's shared pieces: the stage (a shared screen) and the companion (each person's phone)
 * read the same thoughts and experiments in the same hand as the sorting table.
 */

/** A thought as the room reads it: its category a word in the margin, then the words, exactly as written. */
export function Thought({ e, compact }: { e: SharedEntry; compact?: boolean }) {
  const meta = categoryMeta(e.category)
  return (
    <li className="retro-thought" data-compact={compact || undefined}>
      <span className="retro-cat" style={{ ['--c' as string]: e.category ? meta.color : undefined }}>{e.category ? meta.label : ''}</span>
      <div className="retro-words">
        <p className="retro-text">{e.body}</p>
        {e.impact || e.might_help ? (
          <div className="retro-context">
            {e.impact ? <p><i>impact</i>{e.impact}</p> : null}
            {e.might_help ? <p><i>might help</i>{e.might_help}</p> : null}
          </div>
        ) : null}
        {e.period && !compact ? <span className="retro-period">{PERIODS.find((p) => p.id === e.period)?.label}</span> : null}
      </div>
    </li>
  )
}

/** Proud-of and keep thoughts: what the sprint wants to hold on to. */
export const worthKeeping = (entries: SharedEntry[]) => entries.filter((e) => e.category === 'proud' || e.category === 'keep')

export const VERDICTS = ['helped', 'did_not_help', 'inconclusive', 'not_tried'] as const

/** Last time's experiment, and what became of it. `onVerdict` makes the verdict a choice. */
export function PastExperiment({ e, onVerdict }: { e: Experiment; onVerdict?: (status: (typeof VERDICTS)[number]) => void }) {
  const decided = (VERDICTS as readonly string[]).includes(e.status)
  return (
    <li className="retro-exp">
      <p className="retro-exp-change">{e.change_to_try}</p>
      <p className="retro-exp-meta">
        {e.owner_name ? <span>{e.owner_name}</span> : null}
        {e.success_signal ? <span><i>we’d know by</i> {e.success_signal}</span> : null}
      </p>
      {onVerdict ? (
        <div className="retro-verdicts" role="group" aria-label="Did it help?">
          {VERDICTS.map((v) => (
            <button key={v} className="retro-verdict" aria-pressed={e.status === v} onClick={() => onVerdict(v)}>{OUTCOME_LABEL[v]}</button>
          ))}
        </div>
      ) : (
        <p className="retro-exp-verdict" data-open={!decided || undefined}>{decided ? OUTCOME_LABEL[e.status] : 'Not said yet'}</p>
      )}
    </li>
  )
}

/**
 * Text written where it's read, on the shared screen: Enter or leaving the field saves, Escape puts it
 * back. Lines wrap; a new line is never part of it.
 */
export function NoteField({ value, onSave, placeholder, label }: { value: string; onSave: (v: string) => Promise<void>; placeholder: string; label: string }) {
  const [text, setText] = useState(value)
  const [saved, setSaved] = useState(false)
  const skip = useRef(false)
  useEffect(() => setText(value), [value])
  useEffect(() => {
    if (!saved) return
    const t = window.setTimeout(() => setSaved(false), 1600)
    return () => window.clearTimeout(t)
  }, [saved])
  const save = async () => {
    if (skip.current) { skip.current = false; return }
    const v = text.trim()
    if (v === value.trim()) return
    await onSave(v)
    setSaved(true)
  }
  return (
    <div className="retro-note-field">
      <textarea
        className={clsx('retro-field')}
        rows={1}
        value={text}
        placeholder={placeholder}
        aria-label={label}
        maxLength={400}
        onChange={(e) => setText(e.target.value.replace(/\n/g, ' '))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
          else if (e.key === 'Escape') { skip.current = true; setText(value); e.currentTarget.blur() }
        }}
        onBlur={save}
      />
      {saved ? <span className="retro-saved" aria-live="polite">Saved</span> : null}
    </div>
  )
}
