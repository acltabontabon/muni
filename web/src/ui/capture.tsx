/**
 * Capture: the one composer (used everywhere a thought can be written) and "My thoughts", the
 * writer's own collection. Writing is an open surface on the page, not a form in a box; saved
 * thoughts are passages in a journal, not cards. Text comes first; a category is optional and
 * context folds away.
 *
 * Every save goes through the device's send queue, so a dropped connection never costs the
 * thought, and the UI never says "submitted" until the server has it. Drafts belong to the sprint
 * they were started for (lib/drafts.ts).
 */
import { createContext, Fragment, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { clsx } from 'clsx'
import * as Popover from '@radix-ui/react-popover'
import * as RadioGroup from '@radix-ui/react-radio-group'
import { Copy, CornerDownRight, Lightbulb, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { ApiError, del, get, patch } from '@/api/client'
import type { Category, MyEntry, Period } from '@/api/types'
import { CATEGORIES, categoryMeta, MEMORY_PROMPTS, PERIODS } from '@/lib/categories'
import { setComposerDirty } from '@/lib/dirty'
import { draftKeeper } from '@/lib/drafts'
import { useAuth } from '@/lib/auth'
import { announceKept } from '@/lib/kept'
import { localGeneration, useLocal, type Destination } from '@/lib/local/LocalProvider'
import { emptyPayload, hasText, StorageError, type OutboxItem, type Payload } from '@/lib/local/store'
import { WAITING_KEY } from '@/lib/local/outbox'
import { isLocked } from '@/lib/e2ee/keyring'
import { useKeysEpoch } from '@/lib/e2ee/E2eeProvider'
import { splitLinks } from '@/lib/text'
import { dayKey, dayLabel } from '@/lib/schedule'
import { Button, ErrorText, Kbd, useToast } from '@/ui'
import { StatusLabel, type ThoughtState } from '@/ui/status'
import { Hammock } from '@/ui/journal'
import { MUNI_WORDS } from '@/worlds/characters'

const isFinePointer = () => window.matchMedia('(pointer: fine)').matches
const periodOptions = PERIODS.map((p) => ({ id: p.id, label: p.label, color: 'var(--ink-faint)' }))
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'

/** What happened to a save: `submitted` (the sprint has it), `waiting` (kept here, sent later), `attention` (needs a decision). */
export type Notice = { tone: 'ok' | 'local' | 'warn'; kind: 'submitted' | 'waiting' | 'attention'; sprintName: string; text: string }

/**
 * Small word choices with a coloured marker (categories, periods, filters). A radio group; picking
 * the chosen one again clears it when `allowNone`.
 */
export function Choices<T extends string>({ value, onChange, options, label, allowNone }: { value: T | null; onChange: (v: T | null) => void; options: { id: T; label: ReactNode; hint?: string; color?: string }[]; label: string; allowNone?: boolean }) {
  return (
    <RadioGroup.Root value={value ?? ''} onValueChange={(v) => onChange((v || null) as T | null)} aria-label={label} className="cat-choices" orientation="horizontal">
      {options.map((o) => (
        <RadioGroup.Item
          key={o.id}
          value={o.id}
          title={o.hint}
          className="cat-choice"
          style={{ ['--c' as string]: o.color ?? 'var(--accent)' }}
          onClick={() => {
            if (allowNone && value === o.id) onChange(null)
          }}
        >
          {o.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  )
}

/**
 * What every composer does, whatever it looks like: the text and its draft on this device, moving
 * it to another sprint, and saving through the send queue. A world with its own layout (Guhit's
 * sketchbook) renders this same behaviour differently; nothing about drafts, queueing, encryption
 * or what "submitted" means changes with the look.
 *
 * Mount the component using it with `key={sprintId}`: each destination has its own text.
 */
export function useComposer({ dest, choices, onChoose, onSaved }: { dest: Destination | null; choices: Destination[]; onChoose: (d: Destination) => void; onSaved?: () => void }) {
  const local = useLocal()
  const uid = useId()
  const [p, setP] = useState<Payload>(emptyPayload)
  // The text as of the last keystroke, before React renders it. A draft restored from the device
  // checks this, so it can never replace something typed before it arrived.
  const latest = useRef<Payload>(p)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [restored, setRestored] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const savedRef = useRef(onSaved)
  useEffect(() => {
    savedRef.current = onSaved
  })
  const sprintId = dest?.sprintId ?? null

  // Always write through the current store (it changes when "keep drafts on this device" flips).
  const localRef = useRef(local)
  useEffect(() => {
    localRef.current = local
  }, [local])
  const keeper = useMemo(
    () => draftKeeper({ saveDraft: (s, x) => localRef.current.saveDraft(s, x), clearDraft: (s) => localRef.current.clearDraft(s) }, sprintId, { generation: localGeneration }),
    [sprintId],
  )
  // Going away (navigating, switching, collection closing): the last words typed are kept.
  useEffect(() => () => void keeper.dispose(), [keeper])

  // Restore this destination's draft, never over something already being typed.
  useEffect(() => {
    if (!sprintId) return
    let live = true
    local
      .loadDraft(sprintId)
      .then((d) => {
        if (!live || !d || !hasText(d.payload) || hasText(latest.current)) return
        latest.current = d.payload
        setP(d.payload)
        setRestored(true)
        if (d.payload.impact || d.payload.might_help || d.payload.period) setMore(true)
      })
      .catch(() => {})
    return () => {
      live = false
    }
    // Only when the destination changes; the store object changes on every queue update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprintId])

  useEffect(() => {
    setComposerDirty(hasText(p))
  }, [p])
  useEffect(() => () => setComposerDirty(false), [])
  useEffect(() => {
    if (isFinePointer()) area.current?.focus({ preventScroll: true })
  }, [])

  const set = (patch: Partial<Payload>) => {
    const next = { ...latest.current, ...patch }
    latest.current = next
    keeper.update(next)
    setP(next)
    setNotice(null)
    setError(null)
  }

  const choose = async (d: Destination) => {
    if (d.sprintId === sprintId) return
    if (hasText(p)) {
      // An explicit move. If the other sprint already has a draft, keep both.
      const there = await local.loadDraft(d.sprintId).catch(() => null)
      const merged = there && hasText(there.payload) ? { ...there.payload, body: [there.payload.body.trim(), p.body.trim()].filter(Boolean).join('\n\n') } : p
      await keeper.moveTo(d.sprintId, merged)
    }
    onChoose(d)
  }

  const submit = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault()
      if (!p.body.trim() || busy) return
      if (!dest) return setError('Choose where this thought should go.')
      setBusy(true)
      setError(null)
      try {
        keeper.discard()
        const { item, result } = await local.enqueue(dest, p)
        latest.current = emptyPayload()
        setP(latest.current)
        setMore(false)
        setRestored(false)
        savedRef.current?.()
        const where = choices.length > 1 ? ` to ${dest.sprintName}` : ''
        if (result?.submitted.some((s) => s.id === item.id)) {
          setNotice({ tone: 'ok', kind: 'submitted', sprintName: dest.sprintName, text: `Added${where}. Yours to edit until collection closes.` })
          announceKept()
        } else if (result?.attention.includes(item.id)) setNotice({ tone: 'warn', kind: 'attention', sprintName: dest.sprintName, text: 'This thought wasn’t submitted. It’s kept with your thoughts, with what to do next.' })
        else if (result?.state === 'signed_out') setNotice({ tone: 'local', kind: 'waiting', sprintName: dest.sprintName, text: local.kind === 'device' ? 'Saved on this device. Sign in again to send it.' : 'Kept in this tab. Sign in again to send it.' })
        else if (result?.state === 'upgrade') setNotice({ tone: 'local', kind: 'waiting', sprintName: dest.sprintName, text: 'Saved. Reload Muni to send it.' })
        else setNotice({ tone: 'local', kind: 'waiting', sprintName: dest.sprintName, text: local.kind === 'device' ? 'Saved on this device. We’ll send it when you reconnect.' : 'Kept in this tab. Keep Muni open until it’s sent — or turn on “Keep drafts on this device” in your account.' })
        if (isFinePointer()) area.current?.focus()
      } catch (err) {
        // Nothing was stored: the text stays exactly where it is, and so does its draft.
        keeper.update(p)
        setError(err instanceof StorageError ? `${err.message} Your text is still here.` : 'Couldn’t save. Your text is still here — try again.')
      } finally {
        setBusy(false)
      }
    },
    [busy, choices.length, dest, keeper, local, p],
  )

  useEffect(() => {
    if (notice?.tone !== 'ok') return
    const t = window.setTimeout(() => setNotice(null), 6000)
    return () => window.clearTimeout(t)
  }, [notice])

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  return { uid, p, set, submit, onKey, busy, error, notice, restored, typing: hasText(p), more, setMore, area, choose, storage: local.kind, dest }
}

export type ComposerState = ReturnType<typeof useComposer> & {
  /** The starting point on show (an index into MEMORY_PROMPTS), or null. Cleared by a save. */
  prompt: number | null
  setPrompt: (i: number | null | ((i: number | null) => number | null)) => void
}

/** The composer's state, held above whatever draws it (see WritingHost). */
export const Writing = createContext<ComposerState | null>(null)
export function useWriting(): ComposerState {
  const s = useContext(Writing)
  if (!s) throw new Error('useWriting outside WritingHost')
  return s
}

/**
 * Holds one destination's composer — the text, its draft, the open context, the starting point —
 * above the page that draws it. A person can change character (a different composition) or switch
 * the character theme off (Muni's journal) mid-sentence: the drawing is replaced, the writing isn't.
 * Mount it with `key={sprintId}`, like the composer itself.
 */
export function WritingHost({ dest, choices, onChoose, children }: { dest: Destination | null; choices: Destination[]; onChoose: (d: Destination) => void; children: ReactNode }) {
  const [prompt, setPrompt] = useState<number | null>(null)
  const state = useComposer({ dest, choices, onChoose, onSaved: () => setPrompt(null) })
  return <Writing.Provider value={{ ...state, prompt, setPrompt }}>{children}</Writing.Provider>
}

/**
 * The composer. Mount it with `key={sprintId}`: each destination has its own text, so switching
 * workspace or sprint never carries words somewhere else. Choosing another destination from the
 * composer's own "Saving to" list is the one explicit way to move them. Inside a WritingHost it
 * draws the host's state instead of keeping its own.
 *
 * `fieldId` lets a page put the field's label (the heading) elsewhere, such as on the scene's
 * horizon; without it, the composer shows its own heading.
 */
export function Composer(props: ComposerProps) {
  const hosted = useContext(Writing)
  return hosted ? <ComposerView {...props} s={hosted} /> : <OwnComposer {...props} />
}

type ComposerProps = {
  dest: Destination | null
  choices: Destination[]
  onChoose: (d: Destination) => void
  headingLevel?: 1 | 2
  fieldId?: string
  /** Shown when the destination stopped collecting while text was still here. */
  closed?: ReactNode
}

function OwnComposer(props: ComposerProps) {
  const [prompt, setPrompt] = useState<number | null>(null)
  const state = useComposer({ dest: props.dest, choices: props.choices, onChoose: props.onChoose, onSaved: () => setPrompt(null) })
  return <ComposerView {...props} s={{ ...state, prompt, setPrompt }} />
}

function ComposerView({ choices, headingLevel = 1, fieldId, closed, s }: ComposerProps & { s: ComposerState }) {
  const { uid, p, set, submit, onKey, busy, error, notice, restored, typing, more, setMore, area, choose, storage, dest, prompt, setPrompt } = s
  const nudge = prompt === null ? null : MEMORY_PROMPTS[prompt % MEMORY_PROMPTS.length]
  const setNudge = (x: string | null) => setPrompt(x === null ? null : MEMORY_PROMPTS.indexOf(x))
  const bodyId = fieldId ?? `${uid}-body`
  const H = headingLevel === 1 ? 'h1' : 'h2'
  return (
    <form onSubmit={submit} aria-label={dest ? `Write a thought for ${dest.sprintName}` : 'Write a thought'} className="scroll-mt-24">
      {fieldId ? null : (
        <H className="journal-title mb-4 text-[1.6rem] sm:text-[2rem]">
          <label htmlFor={bodyId}>
            What’s worth <em>remembering</em>?
          </label>
        </H>
      )}
      {choices.length > 1 ? (
        <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2 text-sm">
          <label htmlFor={`${uid}-dest`} className="shrink-0 text-ink-soft">Saving to</label>
          <select
            id={`${uid}-dest`}
            className="min-w-0 max-w-full truncate rounded-lg border border-line bg-card py-1.5 pl-2.5 pr-8 font-medium text-ink"
            value={dest?.sprintId ?? ''}
            onChange={(e) => {
              const d = choices.find((c) => c.sprintId === e.target.value)
              if (d) choose(d)
            }}
          >
            {!dest ? <option value="">Choose a sprint…</option> : null}
            {choices.map((c) => (
              <option key={c.sprintId} value={c.sprintId}>{c.sprintName}</option>
            ))}
          </select>
        </div>
      ) : null}
      {closed ? <div className="mb-3 rounded-xl bg-warn/10 px-3.5 py-2.5 text-sm">{closed}</div> : null}
      {nudge ? (
        <p className="mb-2.5 flex items-start gap-2 text-[15px] text-ink-soft" aria-live="polite">
          <Lightbulb className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden /> <span className="italic">{nudge}</span>
        </p>
      ) : null}

      <textarea
        ref={area}
        id={bodyId}
        name="thought"
        className="journal-field"
        value={p.body}
        onChange={(e) => set({ body: e.target.value })}
        onKeyDown={onKey}
        placeholder="Something that happened, helped, or got in the way…"
        aria-keyshortcuts="Meta+Enter Control+Enter"
        maxLength={2000}
        enterKeyHint="enter"
      />
      {/* Under the field: what's happening to these words. */}
      <div className="mt-1.5 flex min-h-6 flex-wrap items-center gap-x-4 gap-y-1">
        <p className="flex items-center gap-2 text-xs text-ink-faint" aria-live="polite">
          {typing && dest ? (
            <>
              <span className="dot dot--draft" aria-hidden /> {restored ? 'Draft restored · ' : 'Draft · '}
              {storage === 'device' ? 'kept on this device, not sent yet' : 'kept in this tab, not sent yet'}
            </>
          ) : null}
        </p>
      </div>

      <div className="mt-1">
        <Choices value={p.category} onChange={(c) => set({ category: c as Category | null })} options={CATEGORIES} label="Category (optional)" allowNone />
      </div>

      {more ? (
        <div id={`${uid}-more`} className="anim-rise mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${uid}-impact`} className="mb-1 block text-[13px] font-medium text-ink-soft">What was the impact?</label>
            <textarea id={`${uid}-impact`} className="journal-field journal-field--small" value={p.impact} onChange={(e) => set({ impact: e.target.value })} onKeyDown={onKey} maxLength={2000} />
          </div>
          <div>
            <label htmlFor={`${uid}-help`} className="mb-1 block text-[13px] font-medium text-ink-soft">What might help?</label>
            <textarea id={`${uid}-help`} className="journal-field journal-field--small" value={p.might_help} onChange={(e) => set({ might_help: e.target.value })} onKeyDown={onKey} maxLength={2000} />
          </div>
          <div className="sm:col-span-2">
            <span className="mb-1 block text-[13px] font-medium text-ink-soft">When in the sprint?</span>
            <Choices value={p.period} onChange={(v) => set({ period: v as Period | null })} options={periodOptions} label="When in the sprint (optional)" allowNone />
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-2">
        <button type="button" className="journal-tool" onClick={() => setMore((m) => !m)} aria-expanded={more} aria-controls={`${uid}-more`}>
          <Plus className={clsx('size-4 transition-transform', more && 'rotate-45')} aria-hidden /> {more ? 'Less context' : 'Context'}
        </button>
        <button type="button" className="journal-tool" onClick={() => setNudge(MEMORY_PROMPTS[(MEMORY_PROMPTS.indexOf(nudge ?? '') + 1) % MEMORY_PROMPTS.length])}>
          <Lightbulb className="size-4" aria-hidden /> {nudge ? 'Another prompt' : 'Prompt'}
        </button>
        <span className="ml-auto flex items-center gap-3">
          <span className="kbd-hint items-center gap-1 text-xs text-ink-faint" aria-hidden>
            <Kbd>{MOD}</Kbd> <Kbd>Enter</Kbd>
          </span>
          <Button type="submit" variant="primary" busy={busy} disabled={!p.body.trim() || !dest} className="min-w-36" aria-keyshortcuts="Meta+Enter Control+Enter">
            Add to sprint
          </Button>
        </span>
      </div>

      <ErrorText>{error}</ErrorText>
      {notice ? (
        <p role="status" className={clsx('mt-3 flex items-start gap-2 text-sm', notice.tone === 'ok' ? 'text-status-ink' : notice.tone === 'warn' ? 'rounded-xl bg-warn/12 px-3 py-2 text-warn' : 'text-ink')}>
          <span className={clsx('dot mt-1.5', notice.tone === 'ok' ? 'dot--submitted' : notice.tone === 'warn' ? 'dot--attention' : 'dot--queued')} aria-hidden />
          <span>{notice.text}</span>
        </p>
      ) : null}

    </form>
  )
}

// ------------------------------------------------------------------ one thought

/**
 * How a world shows the collection. `byDay`: thoughts sit under a heading per day, and each shows
 * only its time (Biyahe); otherwise each carries its own "Yesterday" or date.
 */
export const CollectionLook = createContext<{ byDay: boolean }>({ byDay: false })

/** "14:05" today, "Yesterday", "Mon", then "12 Sep". Personal views only. */
function when(t: string | number, timeOnly = false) {
  if (timeOnly) return new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const d = new Date(t)
  const now = new Date()
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((day(now) - day(d)) / 86_400_000)
  if (days <= 0) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (days === 1) return 'Yesterday'
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'short' })
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
const full = (t: string | number) => new Date(t).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })

function Linked({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((r, i) =>
        r.href ? (
          <a key={i} href={r.href} target="_blank" rel="noopener noreferrer nofollow">{r.text}</a>
        ) : (
          <span key={i}>{r.text}</span>
        ),
      )}
    </>
  )
}

/** The text, clamped; "Read more" appears only when something is actually hidden. */
function Body({ p }: { p: { body: string; impact: string | null; might_help: string | null } }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [open, setOpen] = useState(false)
  const [clamped, setClamped] = useState(false)
  const extra = !!(p.impact || p.might_help)
  const locked = isLocked(p.body)
  // A line or two reads better a little larger; long passages stay at reading size.
  const short = !locked && p.body.trim().length <= 90 && !p.body.includes('\n')
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || open) return
    const check = () => setClamped(el.scrollHeight > el.clientHeight + 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [p.body, open])
  const hidesExtra = extra && clamped
  return (
    <div>
      <p ref={ref} className={clsx('passage-text', !open && 'line-clamp-7', locked && 'italic text-ink-soft')} data-short={short || undefined}>
        {locked ? p.body.slice(1) : <Linked text={p.body} />}
      </p>
      {(!hidesExtra || open) && extra ? (
        <dl className="passage-context">
          {p.impact ? <div><dt>Impact · </dt><dd><Linked text={p.impact} /></dd></div> : null}
          {p.might_help ? <div><dt>Might help · </dt><dd><Linked text={p.might_help} /></dd></div> : null}
        </dl>
      ) : null}
      {clamped || open ? (
        <button type="button" className="mt-1.5 text-sm font-medium text-accent-ink underline-offset-2 hover:underline" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Show less' : 'Read more'}
        </button>
      ) : null}
    </div>
  )
}

/**
 * The margin: category as a note in the entrance's italic serif, the period, and the time.
 * `stamp` is decoration a character world may draw (a ticket, a jersey number, a track number):
 * hidden from assistive technology, which reads the <time> and the category instead. `n` is the
 * thought's place in the sprint, oldest first, so it never changes when the list is filtered.
 */
function Mark({ category, period, at, submitted, n }: { category: string | null; period: string | null; at: string | number; submitted?: boolean; n?: number }) {
  const meta = categoryMeta(category)
  const d = new Date(at)
  const { byDay } = useContext(CollectionLook)
  return (
    <div className="passage-mark">
      {category ? <span className="cat">{meta.label}</span> : null}
      {period ? <span className="period">{PERIODS.find((x) => x.id === period)?.label}</span> : null}
      {/* Submitted is the quiet, normal state: said out loud for screen readers, shown as the time. */}
      <span className="passage-when" title={submitted ? 'Submitted — the sprint has it' : undefined}>
        {submitted ? <span className="sr-only">Submitted, </span> : null}
        <time dateTime={d.toISOString()} title={full(at)}>{when(at, byDay)}</time>
      </span>
      <span
        className="passage-stamp"
        aria-hidden
        data-day={d.getDate()}
        data-mon={d.toLocaleDateString(undefined, { month: 'short' })}
        data-hm={d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        data-n={n}
        data-rn={n ? roman(n) : undefined}
      />
    </div>
  )
}

type MenuAction = { label: string; icon: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean }

/** One quiet control per thought, with every action named. Works by touch and keyboard. */
function EntryMenu({ actions, note, label }: { actions: MenuAction[]; note?: string | null; label: string }) {
  if (!actions.length) return null
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="icon-btn passage-menu" aria-label={label} aria-haspopup="menu">
          <MoreHorizontal className="size-[18px]" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={4} collisionPadding={12} className="menu-panel anim-rise" role="menu" aria-label={label}>
          {actions.map((a) => (
            <Popover.Close asChild key={a.label}>
              <button type="button" role="menuitem" className={clsx('menu-item', a.danger && 'menu-item--danger')} disabled={a.disabled} onClick={a.onSelect}>
                {a.icon} {a.label}
              </button>
            </Popover.Close>
          ))}
          {note ? <p className="menu-note">{note}</p> : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/**
 * How a category is chosen when a thought is edited in place. Muni's journal shows the five words;
 * a world with its own composer (Guhit's sketchbook) provides the same single, optional choice in
 * its own form, so editing looks like writing.
 */
export const CategoryField = createContext<((field: { value: Category | null; onChange: (c: Category | null) => void }) => ReactNode) | null>(null)

const toPayload = (e: MyEntry): Payload => ({ body: e.body, category: (e.category as Category) ?? null, impact: e.impact ?? '', might_help: e.might_help ?? '', period: (e.period as Period) ?? null })

/**
 * Edits a thought in its own place in the collection. Its own state: a draft in the composer is
 * never touched. A failed save keeps every word.
 */
function InlineEditor({ initial, onSave, onCancel, saveLabel = 'Save changes', note }: { initial: Payload; onSave: (p: Payload) => Promise<string | null>; onCancel: () => void; saveLabel?: string; note?: ReactNode }) {
  const uid = useId()
  const [p, setP] = useState(initial)
  const [more, setMore] = useState(!!(initial.impact || initial.might_help || initial.period))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const categoryField = useContext(CategoryField)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  const set = (x: Partial<Payload>) => setP((c) => ({ ...c, ...x }))
  const save = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!p.body.trim() || busy) return
    setBusy(true)
    setError('')
    const err = await onSave(p)
    setBusy(false)
    if (err) setError(err)
  }
  return (
    <form onSubmit={save} className="max-w-[34rem]" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel() } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save() } }}>
      <label htmlFor={`${uid}-b`} className="sr-only">Edit thought</label>
      <textarea ref={ref} id={`${uid}-b`} className="journal-field journal-field--edit" value={p.body} onChange={(e) => set({ body: e.target.value })} maxLength={2000} />
      {categoryField ? (
        // A world's own category control sits on one line with the context toggle.
        <div className="journal-edit-opts">
          {categoryField({ value: p.category, onChange: (c) => set({ category: c }) })}
          <button type="button" className="journal-tool" onClick={() => setMore((m) => !m)} aria-expanded={more}>
            <Plus className={clsx('size-4 transition-transform', more && 'rotate-45')} aria-hidden /> {more ? 'Less context' : 'Context'}
          </button>
        </div>
      ) : (
        <>
          <div className="mt-2">
            <Choices value={p.category} onChange={(v) => set({ category: v as Category | null })} options={CATEGORIES} label="Category (optional)" allowNone />
          </div>
          <button type="button" className="journal-tool mt-1" onClick={() => setMore((m) => !m)} aria-expanded={more}>
            <Plus className={clsx('size-4 transition-transform', more && 'rotate-45')} aria-hidden /> {more ? 'Less context' : 'Context'}
          </button>
        </>
      )}
      {more ? (
        <div className="mt-2 space-y-3">
          <div>
            <label htmlFor={`${uid}-i`} className="mb-1 block text-[13px] font-medium text-ink-soft">Impact</label>
            <textarea id={`${uid}-i`} className="journal-field journal-field--small" value={p.impact} onChange={(e) => set({ impact: e.target.value })} maxLength={2000} />
          </div>
          <div>
            <label htmlFor={`${uid}-h`} className="mb-1 block text-[13px] font-medium text-ink-soft">What might help</label>
            <textarea id={`${uid}-h`} className="journal-field journal-field--small" value={p.might_help} onChange={(e) => set({ might_help: e.target.value })} maxLength={2000} />
          </div>
          <Choices value={p.period} onChange={(v) => set({ period: v as Period | null })} options={periodOptions} label="When in the sprint (optional)" allowNone />
        </div>
      ) : null}
      {note ? <p className="mt-2 text-xs text-ink-soft">{note}</p> : null}
      <ErrorText>{error ? `${error} Your changes are still here.` : null}</ErrorText>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" variant="primary" busy={busy} disabled={!p.body.trim()}>{error ? 'Try again' : saveLabel}</Button>
      </div>
    </form>
  )
}

/** Removal with a short undo window: the thought is only deleted once the window passes. */
function useUndoableRemove(commit: (id: string) => Promise<void>, onFail: (id: string, message: string) => void) {
  const [pending, setPending] = useState<Set<string>>(new Set())
  const timers = useRef(new Map<string, number>())
  const commitRef = useRef(commit)
  const failRef = useRef(onFail)
  useEffect(() => {
    commitRef.current = commit
    failRef.current = onFail
  })
  const finish = useCallback(async (id: string) => {
    timers.current.delete(id)
    try {
      await commitRef.current(id)
    } catch (e) {
      failRef.current(id, e instanceof ApiError || e instanceof Error ? e.message : 'Couldn’t delete it.')
    } finally {
      setPending((s) => {
        const n = new Set(s)
        n.delete(id)
        return n
      })
    }
  }, [])
  // Leaving the page doesn't cancel what was asked for.
  useEffect(() => {
    const t = timers.current
    return () => {
      for (const [id, h] of t) {
        window.clearTimeout(h)
        void commitRef.current(id).catch(() => {})
      }
      t.clear()
    }
  }, [])
  return {
    pending,
    remove(id: string) {
      setPending((s) => new Set(s).add(id))
      timers.current.set(id, window.setTimeout(() => finish(id), 6000))
    },
    undo(id: string) {
      window.clearTimeout(timers.current.get(id))
      timers.current.delete(id)
      setPending((s) => {
        const n = new Set(s)
        n.delete(id)
        return n
      })
    },
  }
}

function Removed({ onUndo, what }: { onUndo: () => void; what: string }) {
  return (
    <li className="passage-gone" role="status">
      <span>{what}</span>
      <Button size="sm" variant="secondary" onClick={onUndo}>Undo</Button>
    </li>
  )
}

/** A thought that exists only on this device (waiting, sending, or needing a decision). */
export function LocalThought({ item, moveChoices, showDestination, onRemove }: { item: OutboxItem; moveChoices: Destination[]; showDestination?: boolean; onRemove?: (id: string) => void }) {
  const local = useLocal()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const state: ThoughtState = item.status === 'attention' ? 'attention' : item.status === 'sending' ? 'sending' : 'queued'
  const why =
    item.reason === 'closed' ? 'Collection closed before this reached the sprint. It wasn’t submitted.'
    : item.reason === 'no_access' ? 'You no longer have access to this sprint. It wasn’t submitted.'
    : item.reason === 'account' ? 'This was written while signed in as someone else. It wasn’t submitted.'
    : item.status === 'attention' ? item.message ?? 'It wasn’t submitted.'
    : null
  const others = moveChoices.filter((c) => c.sprintId !== item.sprintId)
  const canEdit = item.status !== 'attention' || (item.reason !== 'closed' && item.reason !== 'no_access')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText([item.payload.body, item.payload.impact && `Impact: ${item.payload.impact}`, item.payload.might_help && `Might help: ${item.payload.might_help}`].filter(Boolean).join('\n\n'))
      toast('Copied')
    } catch {
      toast('Couldn’t copy — select the text instead', 'danger')
    }
  }
  const sending = item.status === 'sending'
  const actions: MenuAction[] = [
    ...(canEdit ? [{ label: 'Edit', icon: <Pencil className="size-4" aria-hidden />, onSelect: () => setEditing(true), disabled: sending }] : []),
    { label: 'Copy text', icon: <Copy className="size-4" aria-hidden />, onSelect: copy },
    { label: item.status === 'attention' ? 'Discard' : 'Delete from this device', icon: <Trash2 className="size-4" aria-hidden />, onSelect: () => onRemove?.(item.id), danger: true, disabled: sending },
  ]
  return (
    <li className="passage" data-state={state} data-editing={editing || undefined} style={{ ['--tone' as string]: item.payload.category ? categoryMeta(item.payload.category).color : undefined }}>
      <Mark category={item.payload.category} period={item.payload.period} at={item.createdAt} />
      <div className="passage-body">
        <div className="passage-status">
          <StatusLabel state={state}>{item.status === 'queued' && item.message === WAITING_KEY ? 'Saved here · waiting for this device’s key' : undefined}</StatusLabel>
          {state === 'queued' && item.message !== WAITING_KEY ? <span className="font-normal text-ink-soft">· {local.kind === 'device' ? 'saved on this device' : 'kept in this tab'}</span> : null}
          {showDestination ? <span className="min-w-0 truncate font-normal text-ink-faint">· {item.sprintName ?? 'a sprint you can’t open any more'}</span> : null}
        </div>
        {editing ? (
          <InlineEditor
            initial={item.payload}
            note="Not sent yet, so the change stays on this device until it is."
            onCancel={() => setEditing(false)}
            onSave={async (p) => {
              const ok = await local.edit(item.id, p).catch(() => false)
              if (ok) {
                setEditing(false)
                return null
              }
              return 'It started sending before your change was saved. Check the list, then edit the submitted thought.'
            }}
          />
        ) : (
          <Body p={item.payload} />
        )}
        {why ? (
          <div className="mt-3 max-w-[34rem] rounded-xl bg-warn/10 px-3.5 py-2.5 text-sm">
            <p>{why}</p>
            {item.reason === 'closed' && others.length ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <CornerDownRight className="size-4 text-ink-faint" aria-hidden />
                {others.map((o) => (
                  <Button key={o.sprintId} size="sm" onClick={() => local.moveTo(item.id, o)}>Send to {o.sprintName} instead</Button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {editing ? null : <EntryMenu label="Options for this unsent thought" actions={actions} note={sending ? 'Being sent right now.' : null} />}
    </li>
  )
}

/** Unsent thoughts shown on their own (for sprints not on screen), with the same undo. */
export function LocalThoughtList({ items, moveChoices, showDestination }: { items: OutboxItem[]; moveChoices: Destination[]; showDestination?: boolean }) {
  const local = useLocal()
  const toast = useToast()
  const removal = useUndoableRemove((id) => local.remove(id), (_, m) => toast(m, 'danger'))
  return (
    <ul className="passages">
      {items.map((i) =>
        removal.pending.has(i.id) ? (
          <Removed key={i.id} what="Removed from this device." onUndo={() => removal.undo(i.id)} />
        ) : (
          <LocalThought key={i.id} item={i} moveChoices={moveChoices} showDestination={showDestination} onRemove={removal.remove} />
        ),
      )}
    </ul>
  )
}

function EntryThought({ e, n, sprintId, editable, online, fresh, onRemove, onSaved }: { e: MyEntry; n: number; sprintId: string; editable: boolean; online: boolean; fresh: boolean; onRemove: (id: string) => void; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const canChange = editable && e.editable !== false && !isLocked(e.body)
  const actions: MenuAction[] = canChange
    ? [
        { label: 'Edit', icon: <Pencil className="size-4" aria-hidden />, onSelect: () => setEditing(true), disabled: !online },
        { label: 'Delete from the sprint', icon: <Trash2 className="size-4" aria-hidden />, onSelect: () => onRemove(e.id), danger: true, disabled: !online },
      ]
    : []
  return (
    <li className={clsx('passage', fresh && 'anim-reflect')} data-state="submitted" data-editing={editing || undefined} style={{ ['--tone' as string]: e.category ? categoryMeta(e.category).color : undefined }}>
      <Mark category={e.category} period={e.period} at={e.created_at} submitted n={n} />
      <div className="passage-body">
        {editing ? (
          <InlineEditor
            initial={toPayload(e)}
            onCancel={() => setEditing(false)}
            onSave={async (p) => {
              try {
                await patch(`/api/sprints/${sprintId}/entries/${e.id}`, { category: p.category, body: p.body, impact: p.impact || undefined, might_help: p.might_help || undefined, period: p.period })
                setEditing(false)
                onSaved()
                return null
              } catch (err) {
                if (err instanceof ApiError && err.status === 0) return 'You’re offline, so the change wasn’t saved.'
                return err instanceof ApiError ? sentence(err.message) : 'Couldn’t save the change.'
              }
            }}
          />
        ) : (
          <Body p={e} />
        )}
      </div>
      {editing ? null : <EntryMenu label="Options for this thought" actions={actions} note={canChange && !online ? 'Changing a submitted thought needs a connection.' : null} />}
    </li>
  )
}

const PAGE = 12
/**
 * The category someone is viewing in each sprint's collection, for this visit. Changing character
 * can swap the whole page (a world with its own layout), which remounts the list; the filter stays.
 */
const filters = new Map<string, string | null>()

/**
 * A collection's list, handed from one mount to the next when a change of character redraws the
 * page, so it doesn't blink empty while it's fetched again. Taken back straight away or dropped
 * after a moment: a person's thoughts never linger in memory once their list has left the screen.
 */
const handoff = new Map<string, { list: MyEntry[]; timer: number }>()
function takeHandoff(key: string) {
  const h = handoff.get(key)
  if (!h) return null
  window.clearTimeout(h.timer)
  handoff.delete(key)
  return h.list
}
function giveHandoff(key: string, list: MyEntry[]) {
  const prev = handoff.get(key)
  if (prev) window.clearTimeout(prev.timer)
  handoff.set(key, { list, timer: window.setTimeout(() => handoff.delete(key), 3000) })
}

/**
 * Your thoughts for one sprint: what's still on this device first, then what reached the sprint.
 * Only you see this view; the times and "yours" here never appear in shared, anonymous views.
 */
export function MyThoughts({ sprintId, editable, moveChoices, online, className, onCount, empty: emptyArt }: { sprintId: string; editable: boolean; moveChoices: Destination[]; online: boolean; className?: string; onCount?: (n: number | null) => void; /** A character's own empty collection, in place of Muni's picture and line. */ empty?: ReactNode }) {
  const local = useLocal()
  const toast = useToast()
  const { me } = useAuth()
  const { byDay } = useContext(CollectionLook)
  const key = `${me?.account_id ?? ''}:${sprintId}`
  const handed = useRef<MyEntry[] | null>(null)
  const [entries, setEntries] = useState<MyEntry[] | null>(() => (handed.current = takeHandoff(key)))
  const [failed, setFailed] = useState(false)
  const [shown, setShown] = useState(PAGE)
  const [filter, setFilterState] = useState<string | null>(() => filters.get(sprintId) ?? null)
  const setFilter = (v: string | null) => {
    filters.set(sprintId, v)
    setFilterState(v)
  }
  const seen = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  // Unlocking this device changes what can be shown: read the list again (quietly, keeping it on screen).
  const keysEpoch = useKeysEpoch()
  const load = useCallback(async () => {
    try {
      const list = await get<MyEntry[]>(`/api/sprints/${sprintId}/entries/mine`)
      const prev = seen.current
      if (prev) setFresh(new Set(list.filter((e) => !prev.has(e.id)).map((e) => e.id)))
      seen.current = new Set(list.map((e) => e.id))
      setEntries(list.slice().reverse())
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [sprintId])
  useEffect(() => {
    // A list handed over from the page this one replaced counts as already seen (nothing is "new").
    seen.current = handed.current ? new Set(handed.current.map((e) => e.id)) : null
    if (!handed.current) setEntries(null)
    handed.current = null
    load()
  }, [load])
  const shownList = useRef(entries)
  useEffect(() => {
    shownList.current = entries
  }, [entries])
  useEffect(() => () => void (shownList.current && giveHandoff(key, shownList.current)), [key])
  const unlockedAt = useRef(keysEpoch)
  useEffect(() => {
    if (keysEpoch === unlockedAt.current) return
    unlockedAt.current = keysEpoch
    void load()
  }, [keysEpoch, load])
  // Something was accepted (or the queue changed): show the confirmed list.
  useEffect(() => {
    if (local.recentlySubmitted.length) load()
  }, [local.recentlySubmitted.length, load])

  const entryRemoval = useUndoableRemove(
    async (id) => {
      await del(`/api/sprints/${sprintId}/entries/${id}`)
      setEntries((l) => l?.filter((x) => x.id !== id) ?? l)
    },
    (_, m) => {
      toast(`Couldn’t delete: ${sentence(m)} It’s back in your thoughts.`, 'danger')
      load()
    },
  )
  const localRemoval = useUndoableRemove((id) => local.remove(id), (_, m) => toast(m, 'danger'))

  const mine = local.items.filter((i) => i.sprintId === sprintId).slice().reverse()
  const all = entries ?? []
  const count = all.length + mine.length
  const cats = [...new Set(all.map((e) => e.category ?? 'unsorted'))]
  const filtering = count > 8 && cats.length > 1
  const visible = all.filter((e) => !filter || (e.category ?? 'unsorted') === filter)
  // Each thought's place in the sprint, oldest first: stable whatever is filtered or paged.
  const place = useMemo(() => new Map((entries ?? []).map((e, i, l) => [e.id, l.length - i])), [entries])
  // Tell the page how full the collection is (it shapes the scene); null until it's known.
  useEffect(() => {
    onCount?.(entries ? count : failed && mine.length ? mine.length : null)
  }, [onCount, entries, count, failed, mine.length])
  const status = editable ? 'Yours to edit until collection closes.' : online ? 'Collection closed — read-only now.' : 'Offline · changing a submitted thought needs a connection.'

  return (
    <section aria-labelledby={`mine-${sprintId}`} className={clsx('mine', className)}>
      <header className="mine-head mark-indent">
        <h2 id={`mine-${sprintId}`} className="mine-title font-display text-lg leading-tight">
          My thoughts{count ? <span className="ml-2 font-normal text-ink-faint">{count}</span> : null}
        </h2>
        {count ? <p className="mt-0.5 text-sm text-ink-soft">{status}</p> : null}
      </header>

      {entries && count === 0 ? (
        emptyArt ? (
          <div className="mine-empty">{emptyArt}</div>
        ) : (
        <div className="mine-empty mt-3 flex items-end gap-4 mark-indent">
          <Hammock className="block w-24 shrink-0 lg:hidden" />
          <p className="mine-empty-text max-w-[20rem] text-[15px] leading-relaxed text-ink-soft">{MUNI_WORDS.empty}</p>
        </div>
        )
      ) : null}
      {failed && !entries ? <p className="mt-3 text-sm text-ink-soft mark-indent">{mine.length ? 'Your submitted thoughts show here when Muni can reach the server.' : 'Your thoughts show here when Muni can reach the server.'}</p> : null}

      {filtering ? (
        <div className="mt-4 mark-indent">
          <Choices
            value={filter}
            onChange={(v) => { setFilter(v); setShown(PAGE) }}
            allowNone
            label="Show one category"
            options={cats.map((c) => ({ id: c, label: <>{categoryMeta(c === 'unsorted' ? null : c).label} <span className="count">{all.filter((e) => (e.category ?? 'unsorted') === c).length}</span></>, color: categoryMeta(c === 'unsorted' ? null : c).color }))}
          />
        </div>
      ) : null}

      {count ? (
        <ul className="passages mt-4">
          {mine.map((i) =>
            localRemoval.pending.has(i.id) ? (
              <Removed key={i.id} what="Removed from this device." onUndo={() => localRemoval.undo(i.id)} />
            ) : (
              <LocalThought key={i.id} item={i} moveChoices={moveChoices} onRemove={localRemoval.remove} />
            ),
          )}
          {visible.slice(0, shown).map((e, i, list) => (
            <Fragment key={e.id}>
              {/* A day's heading, when this world groups by day (the order is unchanged: newest first). */}
              {byDay && (i === 0 || dayKey(list[i - 1].created_at) !== dayKey(e.created_at)) ? (
                <li className="passages-day" role="presentation" data-day={new Date(e.created_at).getDate()} data-mon={new Date(e.created_at).toLocaleDateString(undefined, { month: 'short' })}>
                  <h3>{dayLabel(e.created_at)}</h3>
                </li>
              ) : null}
              {entryRemoval.pending.has(e.id) ? (
                <Removed what="Deleted from the sprint." onUndo={() => entryRemoval.undo(e.id)} />
              ) : (
                <EntryThought e={e} n={place.get(e.id) ?? 0} sprintId={sprintId} editable={editable} online={online} fresh={fresh.has(e.id)} onRemove={entryRemoval.remove} onSaved={load} />
              )}
            </Fragment>
          ))}
        </ul>
      ) : null}
      {visible.length > shown ? (
        <div className="mt-2 mark-indent">
          <Button size="sm" variant="ghost" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, visible.length - shown)} more</Button>
        </div>
      ) : null}
    </section>
  )
}

/** 1 → "i", 14 → "xiv": a numeral for a world that sets thoughts like chapters. */
function roman(n: number): string {
  const r: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
  let out = ''
  for (const [v, s] of r)
    while (n >= v) {
      out += s
      n -= v
    }
  return out
}

/** Server messages are lower-case fragments; show them as sentences. */
function sentence(m: string) {
  const t = m.trim()
  return t ? t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.') : t
}
