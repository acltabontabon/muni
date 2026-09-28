import { useEffect, useRef, useState, type ReactNode } from 'react'
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

const MAP: { id: string; label: string; what: string }[] = [
  { id: 'look_back', label: 'Look back', what: 'Did last time’s experiments help?' },
  { id: 'choose', label: 'Choose', what: 'Vote privately on what to talk about first.' },
  { id: 'talk', label: 'Talk', what: 'One topic at a time. Add from your phone, without a name.' },
  { id: 'agree', label: 'Agree', what: 'One to three changes to try, each with an owner.' },
]

/** The retro at a glance: its steps, what each is for, and roughly how long — so nobody wonders what's next. */
export function RetroMap({ phases, plan, now }: { phases: string[]; plan: Record<string, number>; now: string }) {
  const steps = MAP.filter((m) => phases.includes(m.id))
  return (
    <ol className="retro-map" aria-label="Today’s retro">
      {steps.map((m, i) => (
        <li key={m.id} data-now={m.id === now || undefined}>
          <span className="retro-map-n">{i + 1}</span>
          <span className="retro-map-label">{m.label}{plan[m.id] ? <em>~{plan[m.id]} min</em> : null}</span>
          <span className="retro-map-what">{m.what}</span>
        </li>
      ))}
    </ol>
  )
}

/**
 * The talk's topics as a horizon: a stop for each, the sun resting on the one being discussed,
 * those already talked about behind it and the rest ahead. The facilitator can move the sun by
 * choosing a stop; everyone else just sees where the room is. `compact` (the phone) names only
 * the current stop.
 */
export function TopicHorizon({ topics, current, discussed, titleOf, onPick, compact }: { topics: string[]; current: string | null; discussed: string[]; titleOf: (id: string) => string; onPick?: (id: string) => void; compact?: boolean }) {
  const at = current ? topics.indexOf(current) : -1
  if (topics.length < 2) return null
  return (
    <nav className="horizon" data-compact={compact || undefined} aria-label="Topics" style={{ ['--n' as string]: topics.length, ['--at' as string]: Math.max(0, at) }}>
      <ol>
        {topics.map((id, i) => {
          const state = id === current ? 'now' : discussed.includes(id) || (at >= 0 && i < at) ? 'past' : 'ahead'
          const label: ReactNode = (
            <>
              <i className="horizon-stop" aria-hidden />
              <span className="horizon-label"><span className="horizon-n">{i + 1}</span><span className="horizon-title">{titleOf(id)}</span></span>
            </>
          )
          return (
            <li key={id} data-state={state}>
              {onPick && state !== 'now' ? (
                <button onClick={() => onPick(id)} title={`Talk about “${titleOf(id)}”`}>{label}</button>
              ) : (
                <span aria-current={state === 'now' ? 'step' : undefined}>{label}</span>
              )}
            </li>
          )
        })}
      </ol>
      {at >= 0 ? <span className="horizon-sun" key={current} aria-hidden /> : null}
    </nav>
  )
}
