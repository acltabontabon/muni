/**
 * Capture: the one composer (used everywhere a thought can be written) and "My thoughts", the
 * writer's own collection. Text comes first; a category is optional and context folds away.
 *
 * Every save goes through the device's send queue, so a dropped connection never costs the
 * thought, and the UI never says "submitted" until the server has it. Drafts belong to the sprint
 * they were started for (lib/drafts.ts).
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { clsx } from 'clsx'
import { Copy, CornerDownRight, Lightbulb, Pencil, Plus, Trash2 } from 'lucide-react'
import { ApiError, del, get, patch } from '@/api/client'
import type { Category, MyEntry, Period } from '@/api/types'
import { CATEGORIES, categoryMeta, MEMORY_PROMPTS, PERIODS } from '@/lib/categories'
import { setComposerDirty } from '@/lib/dirty'
import { draftKeeper } from '@/lib/drafts'
import { localGeneration, useLocal, type Destination } from '@/lib/local/LocalProvider'
import { emptyPayload, hasText, StorageError, type OutboxItem, type Payload } from '@/lib/local/store'
import { splitLinks } from '@/lib/text'
import { Button, ChipGroup, ErrorText, Kbd, Label, Textarea, useToast } from '@/ui'
import { StatusLabel, type ThoughtState } from '@/ui/status'
import { WAITING_KEY } from '@/lib/local/outbox'
import { isLocked } from '@/lib/e2ee/keyring'
import { useDeviceKeys } from '@/lib/e2ee/E2eeProvider'
import { Postcard } from '@/ui/art'

const isFinePointer = () => window.matchMedia('(pointer: fine)').matches
const periodOptions = PERIODS.map((p) => ({ id: p.id, label: p.label, color: 'var(--ink-faint)' }))
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'

type Notice = { tone: 'ok' | 'local' | 'warn'; text: string }

/**
 * The composer. Mount it with `key={sprintId}`: each destination has its own text, so switching
 * workspace or sprint never carries words somewhere else. Choosing another destination from the
 * composer's own "Saving to" list is the one explicit way to move them.
 */
export function Composer({
  dest,
  choices,
  onChoose,
  headingLevel = 1,
  closed,
}: {
  dest: Destination | null
  choices: Destination[]
  onChoose: (d: Destination) => void
  headingLevel?: 1 | 2
  /** Shown when the destination stopped collecting while text was still here. */
  closed?: ReactNode
}) {
  const local = useLocal()
  const uid = useId()
  const [p, setP] = useState<Payload>(emptyPayload)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [restored, setRestored] = useState(false)
  const [nudge, setNudge] = useState<string | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
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
        if (!live || !d || !hasText(d.payload)) return
        setP((cur) => (hasText(cur) ? cur : d.payload))
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
    setP((cur) => {
      const next = { ...cur, ...patch }
      keeper.update(next)
      return next
    })
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
        setP(emptyPayload())
        setMore(false)
        setRestored(false)
        setNudge(null)
        const where = choices.length > 1 ? ` to ${dest.sprintName}` : ''
        if (result?.submitted.some((s) => s.id === item.id)) setNotice({ tone: 'ok', text: `Submitted${where}. It stays hidden from your team until collection closes.` })
        else if (result?.attention.includes(item.id)) setNotice({ tone: 'warn', text: 'This thought wasn’t submitted. It’s kept with your thoughts, with what to do next.' })
        else if (result?.state === 'signed_out') setNotice({ tone: 'local', text: local.kind === 'device' ? 'Saved on this device. Sign in again to send it.' : 'Kept in this tab. Sign in again to send it.' })
        else if (result?.state === 'upgrade') setNotice({ tone: 'local', text: 'Saved. Reload Muni to send it.' })
        else setNotice({ tone: 'local', text: local.kind === 'device' ? 'Saved on this device. We’ll send it when you reconnect.' : 'Kept in this tab. Keep Muni open until it’s sent — or turn on “Keep drafts on this device” in your account.' })
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

  const H = headingLevel === 1 ? 'h1' : 'h2'
  const typing = hasText(p)
  return (
    <form onSubmit={submit} className="composer scroll-mt-20" aria-label={dest ? `Write a thought for ${dest.sprintName}` : 'Write a thought'}>
      <div className="px-5 pt-5 sm:px-7 sm:pt-6">
        <H className="composer-title font-display text-[1.65rem] leading-[1.1] tracking-[-0.025em] sm:text-[2rem]">
          <label htmlFor={`${uid}-body`}>
            What’s worth <em>remembering</em>?
          </label>
        </H>
        {choices.length > 1 ? (
          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2 text-sm">
            <label htmlFor={`${uid}-dest`} className="shrink-0 text-ink-soft">Saving to</label>
            <select
              id={`${uid}-dest`}
              className="min-w-0 max-w-full truncate rounded-full border border-line bg-card py-1.5 pl-3 pr-8 font-medium text-ink"
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
        {closed ? <div className="mt-3 rounded-2xl bg-warn/10 px-4 py-3 text-sm">{closed}</div> : null}
        {nudge ? (
          <p className="mt-3 flex items-start gap-2 text-[15px] text-ink-soft" aria-live="polite">
            <Lightbulb className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden /> <span className="italic">{nudge}</span>
          </p>
        ) : null}
        <textarea
          ref={area}
          id={`${uid}-body`}
          name="thought"
          className="writing mt-3"
          value={p.body}
          onChange={(e) => set({ body: e.target.value })}
          onKeyDown={onKey}
          placeholder="Something that happened, helped, or got in the way…"
          aria-describedby={`${uid}-privacy`}
          aria-keyshortcuts="Meta+Enter Control+Enter"
          maxLength={2000}
          enterKeyHint="enter"
        />
        <p className="mt-1 flex min-h-5 items-center gap-2 text-xs text-ink-faint" aria-live="polite">
          {typing && dest ? (
            <>
              <span className="dot dot--draft" aria-hidden /> {restored ? 'Draft restored · ' : 'Draft · '}
              {local.kind === 'device' ? 'kept on this device, not sent' : 'kept in this tab, not sent'}
            </>
          ) : null}
        </p>
      </div>

      <div className="px-5 pt-2 sm:px-7">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-xs font-medium text-ink-faint" id={`${uid}-cat`}>Category <span className="font-normal">· optional</span></span>
          <ChipGroup value={p.category} onChange={(c) => set({ category: c as Category | null })} options={CATEGORIES} label="Category (optional)" allowNone />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <button type="button" className="inline-flex items-center gap-1.5 text-ink-soft hover:text-ink" onClick={() => setMore((m) => !m)} aria-expanded={more} aria-controls={`${uid}-more`}>
            <Plus className={clsx('size-4 transition-transform', more && 'rotate-45')} aria-hidden /> {more ? 'Hide context' : 'Add context'}
          </button>
          <button type="button" className="inline-flex items-center gap-1.5 text-ink-soft hover:text-ink" onClick={() => setNudge(MEMORY_PROMPTS[(MEMORY_PROMPTS.indexOf(nudge ?? '') + 1) % MEMORY_PROMPTS.length])}>
            <Lightbulb className="size-4" aria-hidden /> {nudge ? 'Another prompt' : 'Need a prompt?'}
          </button>
        </div>
        {more ? (
          <div id={`${uid}-more`} className="anim-rise mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor={`${uid}-impact`}>What was the impact?</Label>
              <Textarea id={`${uid}-impact`} rows={2} className="min-h-0" value={p.impact} onChange={(e) => set({ impact: e.target.value })} onKeyDown={onKey} maxLength={2000} />
            </div>
            <div>
              <Label htmlFor={`${uid}-help`}>What might help?</Label>
              <Textarea id={`${uid}-help`} rows={2} className="min-h-0" value={p.might_help} onChange={(e) => set({ might_help: e.target.value })} onKeyDown={onKey} maxLength={2000} />
            </div>
            <div className="sm:col-span-2">
              <span className="mb-1.5 block text-sm font-medium">When in the sprint?</span>
              <ChipGroup value={p.period} onChange={(v) => set({ period: v as Period | null })} options={periodOptions} label="When in the sprint (optional)" allowNone />
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-5 border-t border-line/70 px-5 pb-5 pt-4 sm:px-7">
        <ErrorText>{error}</ErrorText>
        {notice ? (
          <p role="status" className={clsx('mb-3 flex items-start gap-2 rounded-2xl px-3.5 py-2.5 text-sm', notice.tone === 'ok' ? 'bg-accent-soft text-accent-ink' : notice.tone === 'warn' ? 'bg-warn/12 text-warn' : 'bg-ink/5 text-ink')}>
            <span className={clsx('dot mt-1.5', notice.tone === 'ok' ? 'dot--submitted' : notice.tone === 'warn' ? 'dot--attention' : 'dot--queued')} aria-hidden />
            <span>{notice.text}</span>
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p id={`${uid}-privacy`} className="text-[13px] leading-snug text-ink-soft sm:max-w-sm">
            Hidden from your team — the facilitator too — until collection closes. Then shared with the sprint, without your name.{dest?.encrypted ? ' Encrypted before it leaves this device.' : ''}{' '}
            <Link to="/privacy#visibility" className="whitespace-nowrap text-ink underline decoration-line-strong underline-offset-2 hover:decoration-accent">Privacy</Link>
          </p>
          <div className="flex items-center gap-3">
            <span className="kbd-hint items-center gap-1 text-xs text-ink-faint" aria-hidden>
              <Kbd>{MOD}</Kbd> <Kbd>Enter</Kbd>
            </span>
            <Button type="submit" variant="primary" busy={busy} disabled={!p.body.trim() || !dest} className="w-full sm:w-auto sm:min-w-36" aria-keyshortcuts="Meta+Enter Control+Enter">
              Save thought
            </Button>
          </div>
        </div>
      </div>
    </form>
  )
}

// ------------------------------------------------------------------ one thought

/** "14:05" today, "Yesterday", "Mon", then "12 Sep". Personal views only. */
function when(t: string | number) {
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
      <p ref={ref} className={clsx('bubble-text', !open && 'line-clamp-7', isLocked(p.body) && 'italic text-ink-soft')}>
        {isLocked(p.body) ? p.body.slice(1) : <Linked text={p.body} />}
      </p>
      {(!hidesExtra || open) && p.impact ? <p className="mt-2 text-sm text-ink-soft [overflow-wrap:anywhere]"><span className="text-ink-faint">Impact · </span><Linked text={p.impact} /></p> : null}
      {(!hidesExtra || open) && p.might_help ? <p className="mt-1 text-sm text-ink-soft [overflow-wrap:anywhere]"><span className="text-ink-faint">Might help · </span><Linked text={p.might_help} /></p> : null}
      {clamped || open ? (
        <button type="button" className="mt-1.5 text-sm font-medium text-accent-ink underline-offset-2 hover:underline" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Show less' : 'Read more'}
        </button>
      ) : null}
    </div>
  )
}

function CategoryTag({ category, period }: { category: string | null; period: string | null }) {
  if (!category && !period) return null
  const meta = categoryMeta(category)
  return (
    <span className="inline-flex min-w-0 items-center gap-2 text-xs text-ink-soft">
      {category ? (
        <span className="inline-flex items-center rounded-full px-2 py-0.5 font-medium" style={{ color: meta.color, background: `color-mix(in oklab, ${meta.color} 11%, transparent)` }}>
          {meta.label}
        </span>
      ) : null}
      {period ? <span className="text-ink-faint">{PERIODS.find((x) => x.id === period)?.label}</span> : null}
    </span>
  )
}

const toPayload = (e: MyEntry): Payload => ({ body: e.body, category: (e.category as Category) ?? null, impact: e.impact ?? '', might_help: e.might_help ?? '', period: (e.period as Period) ?? null })

/** Edits a thought in its own place in the collection. A failed save keeps every word. */
function InlineEditor({ initial, onSave, onCancel, saveLabel = 'Save changes', note }: { initial: Payload; onSave: (p: Payload) => Promise<string | null>; onCancel: () => void; saveLabel?: string; note?: ReactNode }) {
  const uid = useId()
  const [p, setP] = useState(initial)
  const [more, setMore] = useState(!!(initial.impact || initial.might_help || initial.period))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
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
    <form onSubmit={save} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel() } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save() } }}>
      <label htmlFor={`${uid}-b`} className="sr-only">Edit thought</label>
      <textarea ref={ref} id={`${uid}-b`} className="writing min-h-24 text-[0.98rem]" value={p.body} onChange={(e) => set({ body: e.target.value })} maxLength={2000} />
      <div className="mt-2">
        <ChipGroup value={p.category} onChange={(v) => set({ category: v as Category | null })} options={CATEGORIES} label="Category (optional)" allowNone />
      </div>
      <button type="button" className="mt-2 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink" onClick={() => setMore((m) => !m)} aria-expanded={more}>
        <Plus className={clsx('size-4 transition-transform', more && 'rotate-45')} aria-hidden /> {more ? 'Hide context' : 'Context'}
      </button>
      {more ? (
        <div className="mt-2 space-y-3">
          <div>
            <Label htmlFor={`${uid}-i`}>Impact</Label>
            <Textarea id={`${uid}-i`} rows={2} className="min-h-0 text-sm" value={p.impact} onChange={(e) => set({ impact: e.target.value })} maxLength={2000} />
          </div>
          <div>
            <Label htmlFor={`${uid}-h`}>What might help</Label>
            <Textarea id={`${uid}-h`} rows={2} className="min-h-0 text-sm" value={p.might_help} onChange={(e) => set({ might_help: e.target.value })} maxLength={2000} />
          </div>
          <ChipGroup value={p.period} onChange={(v) => set({ period: v as Period | null })} options={periodOptions} label="When in the sprint (optional)" allowNone />
        </div>
      ) : null}
      {note ? <p className="mt-2 text-xs text-ink-soft">{note}</p> : null}
      <ErrorText>{error ? `${error} Your changes are still here.` : null}</ErrorText>
      <div className="mt-3 flex flex-wrap justify-end gap-2 pb-1">
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
    <li className="bubble-gone flex flex-wrap items-center justify-between gap-2 text-sm text-ink-soft" role="status">
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
  const tone = categoryMeta(item.payload.category).color
  return (
    <li className="bubble" data-state={state} data-editing={editing || undefined} style={{ ['--tone' as string]: item.payload.category ? tone : undefined }}>
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
        <>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <StatusLabel state={state}>{item.status === 'queued' && item.message === WAITING_KEY ? 'Saved here · waiting for this device’s key' : undefined}</StatusLabel>
            {showDestination ? <span className="min-w-0 truncate text-xs text-ink-faint">{item.sprintName ?? 'a sprint you can’t open any more'}</span> : null}
          </div>
          <Body p={item.payload} />
          {why ? (
            <div className="mt-3 rounded-2xl bg-warn/10 px-3 py-2.5 text-sm">
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
          <div className="mt-2 flex items-center gap-2">
            <CategoryTag category={item.payload.category} period={item.payload.period} />
            <span className="ml-auto flex items-center">
              <time className="mr-1 text-xs text-ink-faint" dateTime={new Date(item.createdAt).toISOString()} title={full(item.createdAt)}>{when(item.createdAt)}</time>
              {canEdit ? (
                <button className="icon-btn" aria-label="Edit" disabled={item.status === 'sending'} title={item.status === 'sending' ? 'Being sent right now' : 'Edit'} onClick={() => setEditing(true)}>
                  <Pencil className="size-4" />
                </button>
              ) : null}
              {item.status === 'attention' ? (
                <button className="icon-btn" aria-label="Copy text" title="Copy text" onClick={copy}>
                  <Copy className="size-4" />
                </button>
              ) : null}
              <button className="icon-btn icon-btn--danger" aria-label={item.status === 'attention' ? 'Discard' : 'Delete from this device'} title={item.status === 'attention' ? 'Discard' : 'Delete from this device'} disabled={item.status === 'sending'} onClick={() => onRemove?.(item.id)}>
                <Trash2 className="size-4" />
              </button>
            </span>
          </div>
        </>
      )}
    </li>
  )
}

/** Unsent thoughts shown on their own (for sprints not on screen), with the same undo. */
export function LocalThoughtList({ items, moveChoices, showDestination }: { items: OutboxItem[]; moveChoices: Destination[]; showDestination?: boolean }) {
  const local = useLocal()
  const toast = useToast()
  const removal = useUndoableRemove((id) => local.remove(id), (_, m) => toast(m, 'danger'))
  return (
    <ul className="bubbles">
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

function EntryThought({ e, sprintId, editable, online, fresh, onRemove, onSaved }: { e: MyEntry; sprintId: string; editable: boolean; online: boolean; fresh: boolean; onRemove: (id: string) => void; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const tone = categoryMeta(e.category).color
  const canChange = editable && e.editable !== false
  return (
    <li className={clsx('bubble', fresh && 'anim-reflect')} data-state="submitted" data-editing={editing || undefined} style={{ ['--tone' as string]: e.category ? tone : undefined }}>
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
        <>
          <Body p={e} />
          <div className="mt-2 flex items-center gap-2">
            <CategoryTag category={e.category} period={e.period} />
            <span className="ml-auto flex items-center">
              {/* Submitted is the quiet, normal state: the filled dot, said out loud for screen readers. */}
              <span className="mr-2 inline-flex items-center gap-1.5 text-xs text-ink-faint" title="Submitted — the sprint has it">
                <span className="dot dot--submitted opacity-70" style={{ width: 6, height: 6 }} aria-hidden />
                <span className="sr-only">Submitted</span>
                <time dateTime={e.created_at} title={full(e.created_at)}>{when(e.created_at)}</time>
              </span>
              {canChange ? (
                <>
                  <button className="icon-btn" aria-label="Edit" disabled={!online} title={online ? 'Edit' : 'Editing a submitted thought needs a connection'} onClick={() => setEditing(true)}>
                    <Pencil className="size-4" />
                  </button>
                  <button className="icon-btn icon-btn--danger" aria-label="Delete" disabled={!online} title={online ? 'Delete from the sprint' : 'Deleting needs a connection'} onClick={() => onRemove(e.id)}>
                    <Trash2 className="size-4" />
                  </button>
                </>
              ) : null}
            </span>
          </div>
        </>
      )}
    </li>
  )
}

const PAGE = 12

/**
 * Your thoughts for one sprint: what's still on this device first, then what reached the sprint.
 * Only you see this view; the times and "yours" here never appear in shared, anonymous views.
 */
export function MyThoughts({ sprintId, editable, moveChoices, online, className }: { sprintId: string; editable: boolean; moveChoices: Destination[]; online: boolean; className?: string }) {
  const local = useLocal()
  const toast = useToast()
  const [entries, setEntries] = useState<MyEntry[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [shown, setShown] = useState(PAGE)
  const [filter, setFilter] = useState<string | null>(null)
  const seen = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  // Unlocking (or setting up) this device changes what can be shown: read the list again.
  const keyState = useDeviceKeys().state.kind
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
    seen.current = null
    setEntries(null)
    load()
  }, [load, keyState])
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
  const status = editable ? 'Yours to edit until collection closes.' : online ? 'Collection closed · read-only.' : 'Offline · changing a submitted thought needs a connection.'

  return (
    <section aria-labelledby={`mine-${sprintId}`} className={className}>
      <div className="flex items-end gap-4">
        {count ? <Postcard framing="close" className="h-[64px] w-[98px] shrink-0 sm:h-[72px] sm:w-[110px]" /> : null}
        <div className="min-w-0 pb-0.5">
          <h2 id={`mine-${sprintId}`} className="font-display text-xl leading-tight">
            My thoughts{count ? <span className="ml-2 text-base font-normal text-ink-faint">{count}</span> : null}
          </h2>
          {count ? <p className="mt-0.5 text-sm text-ink-soft">{status}</p> : null}
        </div>
      </div>

      {entries && count === 0 ? (
        <div className="mt-2 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <Postcard framing="close" className="aspect-[3/2] w-full max-w-[15rem]" />
          <p className="max-w-xs text-[15px] text-ink-soft">Nothing saved yet. What you write gathers here, in your own words.</p>
        </div>
      ) : null}
      {failed && !entries ? <p className="mt-3 text-sm text-ink-soft">{mine.length ? 'Your submitted thoughts show here when Muni can reach the server.' : 'Your thoughts show here when Muni can reach the server.'}</p> : null}

      {filtering ? (
        <div className="mt-5">
          <ChipGroup
            value={filter}
            onChange={(v) => { setFilter(v); setShown(PAGE) }}
            allowNone
            label="Show one category"
            options={cats.map((c) => ({ id: c, label: `${categoryMeta(c === 'unsorted' ? null : c).label} ${all.filter((e) => (e.category ?? 'unsorted') === c).length}`, color: categoryMeta(c === 'unsorted' ? null : c).color }))}
          />
        </div>
      ) : null}

      {count ? (
        <ul className="bubbles mt-6 pb-6">
          {mine.map((i) =>
            localRemoval.pending.has(i.id) ? (
              <Removed key={i.id} what="Removed from this device." onUndo={() => localRemoval.undo(i.id)} />
            ) : (
              <LocalThought key={i.id} item={i} moveChoices={moveChoices} onRemove={localRemoval.remove} />
            ),
          )}
          {visible.slice(0, shown).map((e) =>
            entryRemoval.pending.has(e.id) ? (
              <Removed key={e.id} what="Deleted from the sprint." onUndo={() => entryRemoval.undo(e.id)} />
            ) : (
              <EntryThought key={e.id} e={e} sprintId={sprintId} editable={editable} online={online} fresh={fresh.has(e.id)} onRemove={entryRemoval.remove} onSaved={load} />
            ),
          )}
        </ul>
      ) : null}
      {visible.length > shown ? (
        <div className="flex justify-center">
          <Button size="sm" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, visible.length - shown)} more</Button>
        </div>
      ) : null}
    </section>
  )
}

/** Server messages are lower-case fragments; show them as sentences. */
function sentence(m: string) {
  const t = m.trim()
  return t ? t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.') : t
}
