import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { clsx } from 'clsx'
import { Check, Plus } from 'lucide-react'
import { ApiError, del, newKey, post, put } from '@/api/client'
import type { AdditionKind, CheckinView, MyContext, StageSnapshot } from '@/api/types'
import { useRetroDraft } from '@/lib/retro-drafts'
import { Button } from '@/ui'

/**
 * The retro's quiet ways in. A check-in asks one question the whole room can answer in a tap —
 * how a topic showed up for you, or whether an idea would help — and keeps every answer private
 * until the facilitator shares them. "Add to this discussion" lets someone put an example, another
 * view or a question into the topic without taking the floor. Both are optional; neither blocks
 * anything; neither ever carries a name.
 */

export const ASK = {
  topic: {
    question: 'How did this show up for you?',
    choices: [
      { id: 'felt', label: 'I felt this' },
      { id: 'not_mine', label: 'Not in my work' },
      { id: 'context', label: 'I’d need context' },
    ],
  },
  action: {
    question: 'Would trying this next sprint help?',
    choices: [
      { id: 'worth', label: 'Worth trying' },
      { id: 'concern', label: 'I have a concern' },
      { id: 'unsure', label: 'Not sure' },
    ],
  },
} as const

const TALLY: Record<string, (n: number) => string> = {
  felt: (n) => `${n} felt this`,
  not_mine: (n) => `${n} not in their work`,
  context: (n) => `${n} ${n === 1 ? 'needs' : 'need'} context`,
  worth: (n) => `${n} worth trying`,
  concern: (n) => `${n} ${n === 1 ? 'concern' : 'concerns'}`,
  unsure: (n) => `${n} not sure`,
}
const LABEL: Record<string, string> = Object.fromEntries([...ASK.topic.choices, ...ASK.action.choices].map((c) => [c.id, c.label]))
export const choiceLabel = (id: string) => LABEL[id] ?? id

export const KINDS: { id: AdditionKind; label: string; word: string }[] = [
  { id: 'example', label: 'An example', word: 'example' },
  { id: 'view', label: 'Another view', word: 'another view' },
  { id: 'question', label: 'A question', word: 'question' },
]
export const kindWord = (k: string | null | undefined) => KINDS.find((x) => x.id === k)?.word ?? ''

/**
 * What the room answered: a count per answer, in the answers' own order and only those given, then
 * the lines people added, each with the answer it came with. No percentages, no ranking, no summary
 * written for them. A concern about an idea comes first: it's not outvoted by the rest.
 */
export function CheckinResult({ c, you }: { c: CheckinView; you?: boolean }) {
  const r = c.results
  if (!r) return null
  if (!r.responded) return <p className="ci-none">No answers came in.</p>
  const ids = ASK[c.kind].choices.map((x) => x.id as string).filter((id) => r.counts[id])
  const notes = c.kind === 'action' ? [...r.notes].sort((a, b) => Number(b.choice === 'concern') - Number(a.choice === 'concern')) : r.notes
  return (
    <div className="ci-result">
      <p className="ci-tally">
        {ids.map((id, i) => (
          <span key={id} className="ci-count">
            <span data-choice={id}>{TALLY[id](r.counts[id])}</span>
            {i < ids.length - 1 ? <><span className="sr-only">, </span><span className="ci-sep" aria-hidden>·</span></> : null}
          </span>
        ))}
      </p>
      {notes.length ? (
        <ul className="ci-lines">
          {notes.map((n, i) => (
            <li key={i} data-choice={n.choice}>
              <span className="ci-line-choice">{choiceLabel(n.choice)}</span>
              <p>{n.note}</p>
            </li>
          ))}
        </ul>
      ) : null}
      {you && c.mine ? <p className="ci-you">You answered “{choiceLabel(c.mine.choice)}”.</p> : null}
    </div>
  )
}

// The privacy line is said once per visit, not on every check-in.
const privacy = { explained: false }
const markExplained = () => {
  privacy.explained = true
}

/**
 * Your answer to an open check-in. One tap is a complete answer; a line is optional and comes
 * after. "Saved" only once the server has it; a failure says so and keeps what you wrote.
 */
export function CheckinAsk({ c, sprintId, accountId, paused, onSaved, heading }: { c: CheckinView; sprintId: string; accountId: string | null; paused: boolean; onSaved: (c: CheckinView) => void; heading?: string }) {
  const ask = ASK[c.kind]
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [note, setNote] = useRetroDraft(`note:${c.id}`, accountId)
  const [writing, setWriting] = useState(() => !!note)
  const [noteState, setNoteState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [showPrivacy] = useState(() => !privacy.explained && !c.mine)
  const mine = c.mine
  const choices = useRef<HTMLDivElement>(null)
  const send = async (body: Record<string, unknown>) => onSaved(await put<CheckinView>(`/api/sprints/${sprintId}/checkins/${c.id}/response`, body))
  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : 'Didn’t save — check your connection and try again.')
  const choose = async (choice: string) => {
    if (pending || paused || choice === mine?.choice) return
    setPending(choice)
    setError('')
    try {
      await send({ choice })
      markExplained()
    } catch (e) {
      fail(e)
    } finally {
      setPending(null)
    }
  }
  // The answers are one stop for Tab (the one given, else the first); arrows move between them and
  // choose, as radio buttons do. While an answer is saving, arrows wait for it.
  const stop = mine?.choice ?? ask.choices[0].id
  const onArrow = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    if (pending || paused) return
    const to = (i + step + ask.choices.length) % ask.choices.length
    choices.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[to]?.focus()
    void choose(ask.choices[to].id)
  }
  const saveNote = async () => {
    setNoteState('saving')
    setError('')
    try {
      await send({ note: note.trim() })
      setNote('')
      setWriting(false)
      setNoteState('saved')
    } catch (e) {
      setNoteState('idle')
      fail(e)
    }
  }
  const status = error ? (
    <span className="ci-status-error">{error}</span>
  ) : pending ? (
    'Saving…'
  ) : noteState === 'saving' ? (
    'Saving your line…'
  ) : mine ? (
    <>
      Saved{noteState === 'saved' && mine.note ? ', with your line' : ''}. You can change it until the answers are shared.{' '}
      <button className="retro-link" disabled={paused} onClick={async () => { try { onSaved(await del<CheckinView>(`/api/sprints/${sprintId}/checkins/${c.id}/response`)) } catch (e) { fail(e) } }}>Take it back</button>
    </>
  ) : showPrivacy ? (
    'Only you see your answer until the facilitator shares everyone’s — without names.'
  ) : null
  return (
    <section className="ci-ask" aria-label={ask.question}>
      {heading ? <p className="ci-for">{heading}</p> : null}
      <p className="ci-question">{ask.question}</p>
      {c.kind === 'action' && c.could_try ? <p className="ci-subject">“{c.could_try}”</p> : null}
      <div ref={choices} className="ci-choices" role="radiogroup" aria-label={ask.question}>
        {ask.choices.map((x, i) => {
          const on = mine?.choice === x.id
          return (
            <button key={x.id} role="radio" aria-checked={on} tabIndex={x.id === stop ? 0 : -1} className="ci-choice" data-pending={pending === x.id || undefined} disabled={paused || (!!pending && pending !== x.id)} onClick={() => choose(x.id)} onKeyDown={(e) => onArrow(e, i)}>
              <span className="ci-mark" aria-hidden>{on ? <Check className="size-4" strokeWidth={2.5} /> : null}</span>
              {x.label}
            </button>
          )
        })}
      </div>
      <p className="ci-status" aria-live="polite">{status}</p>
      {mine ? (
        writing ? (
          <div className="ci-note">
            <textarea className="ci-note-field" rows={2} maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything you’d add? A different view is welcome." aria-label="Your line (optional)" autoFocus={!note} />
            <div className="ci-note-foot">
              <button className="retro-link" onClick={() => { setNote(''); setWriting(false) }}>Not now</button>
              <Button size="sm" variant="primary" disabled={!note.trim() || paused || noteState === 'saving'} onClick={saveNote}>Save line</Button>
            </div>
          </div>
        ) : (
          <p className="ci-note-line">
            {mine.note ? <><span className="ci-your-line">“{mine.note}”</span> <button className="retro-link" onClick={() => { setNote(mine.note ?? ''); setWriting(true) }}>Edit</button></> : <button className="retro-link" onClick={() => setWriting(true)}>Add a line</button>}
          </p>
        )
      ) : null}
    </section>
  )
}

/**
 * A line written for a check-in whose answers were shared before it was saved: never silently
 * dropped. A line that only reopened what was already saved lost nothing, so it says nothing.
 * Moving it is offered only where "Add to this discussion" is on screen to take it.
 */
export function LeftoverLine({ checkinId, accountId, saved, onMove }: { checkinId: string; accountId: string | null; saved?: string | null; onMove?: (text: string) => void }) {
  const [note, setNote] = useRetroDraft(`note:${checkinId}`, accountId)
  const unsaved = !!note.trim() && note.trim() !== (saved ?? '').trim()
  useEffect(() => {
    if (note && !unsaved) setNote('')
  }, [note, unsaved, setNote])
  if (!unsaved) return null
  return (
    <p className="ci-leftover">
      The answers were shared before your line was saved: “{note.trim()}”{' '}
      {onMove ? <><button className="retro-link" onClick={() => { onMove(note.trim()); setNote('') }}>Add it to the discussion</button> · </> : null}
      <button className="retro-link" onClick={() => setNote('')}>Let it go</button>
    </p>
  )
}

interface AddDraft {
  themeId: string
  kind: AdditionKind | null
  text: string
  key: string
}

/**
 * "Add to this discussion": one quiet entry point, inside the topic in hand. What you write stays
 * with the topic you started it for — if the room moves on, it says so and lets you choose — and
 * it's kept through reconnects. Sent additions wait until the facilitator shares them, and say so.
 */
export function AddToDiscussion({ sprintId, accountId, topic, titleOf, mine, paused, onSent, seed, onSeedUsed }: { sprintId: string; accountId: string | null; topic: string; titleOf: (id: string) => string; mine: MyContext[]; paused: boolean; onSent: (stage: StageSnapshot) => void; seed?: string | null; onSeedUsed?: () => void }) {
  const [raw, setRaw] = useRetroDraft(`add:${sprintId}`, accountId)
  const draft: AddDraft = (() => {
    try {
      const d = JSON.parse(raw) as AddDraft
      if (d && typeof d.text === 'string') return d
    } catch {
      /* none yet */
    }
    return { themeId: topic, kind: null, text: '', key: newKey() }
  })()
  const [open, setOpen] = useState(() => !!draft.text)
  const [state, setState] = useState<'idle' | 'sending'>('idle')
  const [error, setError] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  const write = (d: Partial<AddDraft>) => {
    const next = { ...draft, ...d }
    setRaw(next.text || next.kind ? JSON.stringify(next) : '')
  }
  // Words moved here from elsewhere (a line that missed a check-in) open the composer with them,
  // once: after what's already being written, never over it.
  useEffect(() => {
    if (!seed) return
    onSeedUsed?.()
    const current = (() => {
      try {
        return raw ? (JSON.parse(raw) as AddDraft) : null
      } catch {
        return null
      }
    })()
    const text = current?.text.trim() ? `${current.text.trimEnd()}\n\n${seed}` : seed
    setRaw(JSON.stringify({ themeId: current?.text.trim() ? current.themeId : topic, kind: current?.kind ?? null, text, key: newKey() } satisfies AddDraft))
    setOpen(true)
  }, [seed, onSeedUsed, raw, topic, setRaw])
  const target = draft.text.trim() ? draft.themeId : topic
  const elsewhere = !!draft.text.trim() && draft.themeId !== topic
  const send = async () => {
    setState('sending')
    setError('')
    try {
      // The answer is the stage with this addition among yours: shown as it is, nothing read again.
      const stage = await post<StageSnapshot>(`/api/sprints/${sprintId}/meeting/context`, { theme_id: target, body: draft.text.trim(), kind: draft.kind, idempotency_key: draft.key })
      setRaw('')
      setOpen(false)
      onSent(stage)
    } catch (e) {
      setError(e instanceof ApiError ? `${e.message}. Your words are still here.` : 'Didn’t send — check your connection. Your words are still here.')
    } finally {
      setState('idle')
    }
  }
  // Once shared, what you added reads in the room's list (marked as yours there); here, only what's still waiting.
  const here = mine.filter((m) => m.theme_id === topic && !m.released)
  return (
    <section className="ad">
      {open ? (
        <div className="ad-box">
          {elsewhere ? (
            <p className="ad-elsewhere">
              For “{titleOf(draft.themeId)}”, where you started writing.{' '}
              <button className="retro-link" onClick={() => write({ themeId: topic })}>Move it to this topic</button>
            </p>
          ) : null}
          <div className="ad-kinds" role="group" aria-label="What is it? Optional">
            {KINDS.map((k) => (
              <button key={k.id} className="ad-kind" aria-pressed={draft.kind === k.id} onClick={() => write({ kind: draft.kind === k.id ? null : k.id, themeId: draft.text.trim() ? draft.themeId : topic })}>{k.label}</button>
            ))}
          </div>
          <textarea ref={box} className="ad-field" rows={3} maxLength={2000} value={draft.text} onChange={(e) => write({ text: e.target.value, themeId: draft.text.trim() ? draft.themeId : topic })} placeholder="Something the room should hear…" aria-label="Add to this discussion" autoFocus />
          {error ? <p className="ci-status ci-status-error" role="alert">{error}</p> : null}
          <div className="ad-foot">
            <span className="ad-hint">The facilitator shares it, without your name.</span>
            <span className="ad-actions">
              {!draft.text.trim() ? <button className="retro-link" onClick={() => { setRaw(''); setOpen(false) }}>Not now</button> : null}
              <Button size="sm" variant="primary" disabled={!draft.text.trim() || paused || state === 'sending'} busy={state === 'sending'} onClick={send}>Send</Button>
            </span>
          </div>
        </div>
      ) : (
        <button className="ad-open" onClick={() => setOpen(true)}><Plus className="size-4" aria-hidden /> Add to this discussion</button>
      )}
      {here.length ? (
        <ul className="ad-mine" aria-label="What you added">
          {here.map((m) => (
            <li key={m.id} data-shared={m.released || undefined}>
              <span className="ad-mine-state">Waiting for the facilitator to share it{m.kind ? ` · ${kindWord(m.kind)}` : ''}</span>
              <p className={clsx('ad-mine-text')}>{m.body}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
