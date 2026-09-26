import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { clsx } from 'clsx'
import { ChevronDown, Copy, CornerDownRight, Lightbulb, Pencil, Trash2 } from 'lucide-react'
import { ApiError, del, get, patch } from '@/api/client'
import type { Category, MyEntry, Period } from '@/api/types'
import { CATEGORIES, categoryMeta, MEMORY_PROMPTS, PERIODS } from '@/lib/categories'
import { setComposerDirty } from '@/lib/dirty'
import { useLocal, type Destination } from '@/lib/local/LocalProvider'
import { emptyPayload, hasText, StorageError, type OutboxItem, type Payload } from '@/lib/local/store'
import { Button, ChipGroup, Dialog, ErrorText, Kbd, Label, Textarea, useToast } from '@/ui'
import { StatusLabel, type ThoughtState } from '@/ui/status'

const isFinePointer = () => window.matchMedia('(pointer: fine)').matches
const periodOptions = PERIODS.map((p) => ({ id: p.id, label: p.label, color: 'var(--ink-faint)' }))

type Notice = { tone: 'ok' | 'local' | 'warn'; text: string }

/**
 * The composer. Text first; category optional; context folded away. Drafts are kept as you type
 * (on this device if you chose that, otherwise for this tab), and every save goes through the
 * send queue, so a dropped connection never costs the thought.
 */
export function Composer({ dest, choices, onChoose }: { dest: Destination | null; choices: Destination[]; onChoose: (d: Destination) => void }) {
  const local = useLocal()
  const [p, setP] = useState<Payload>(emptyPayload)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [restored, setRestored] = useState(false)
  const [nudge, setNudge] = useState<string | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const loadedFor = useRef<string | null>(null)
  const sprintId = dest?.sprintId ?? null

  // Restore this destination's draft (never over something already being typed).
  useEffect(() => {
    if (!sprintId || loadedFor.current === sprintId) return
    loadedFor.current = sprintId
    local.loadDraft(sprintId).then((d) => {
      if (d && hasText(d.payload)) {
        setP((cur) => (hasText(cur) ? cur : d.payload))
        setRestored(true)
        if (d.payload.impact || d.payload.might_help || d.payload.period) setMore(true)
      }
    }).catch(() => {})
  }, [sprintId, local])

  // Keep the draft as it's written. Local only; saving a draft never submits it. Runs on edits
  // only — not whenever the local store changes — so clearing local data can't write it back.
  const saveRef = useRef(local)
  useEffect(() => {
    saveRef.current = local
  }, [local])
  useEffect(() => {
    setComposerDirty(hasText(p))
    if (!sprintId) return
    const t = window.setTimeout(() => {
      if (hasText(p)) saveRef.current.saveDraft(sprintId, p).catch(() => {})
      else saveRef.current.clearDraft(sprintId).catch(() => {})
    }, 400)
    return () => window.clearTimeout(t)
  }, [p, sprintId])
  useEffect(() => () => setComposerDirty(false), [])

  useEffect(() => {
    if (isFinePointer()) area.current?.focus()
  }, [])

  const set = (patch: Partial<Payload>) => {
    setP((cur) => ({ ...cur, ...patch }))
    setNotice(null)
    setError(null)
  }

  const submit = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault()
      if (!p.body.trim() || busy) return
      if (!dest) return setError('Choose where this thought should go.')
      setBusy(true)
      setError(null)
      try {
        const { item, result } = await local.enqueue(dest, p)
        setP(emptyPayload())
        setMore(false)
        setRestored(false)
        if (result?.submitted.some((s) => s.id === item.id)) setNotice({ tone: 'ok', text: `Submitted to ${dest.sprintName}.` })
        else if (result?.attention.includes(item.id)) setNotice({ tone: 'warn', text: 'This thought wasn’t submitted. It’s kept below with what to do next.' })
        else if (result?.state === 'signed_out') setNotice({ tone: 'local', text: local.kind === 'device' ? 'Saved on this device. Sign in again to send it.' : 'Kept in this tab. Sign in again to send it.' })
        else if (result?.state === 'upgrade') setNotice({ tone: 'local', text: 'Saved. Reload Muni to send it.' })
        else setNotice({ tone: 'local', text: local.kind === 'device' ? 'Saved on this device. We’ll send it when you reconnect.' : 'Kept in this tab. Keep Muni open until it’s sent — or turn on “Keep drafts on this device” in your account menu.' })
        if (isFinePointer()) area.current?.focus()
      } catch (err) {
        // Nothing was stored: the text stays exactly where it is.
        setError(err instanceof StorageError ? `${err.message} Your text is still here.` : 'Couldn’t save. Your text is still here — try again.')
      } finally {
        setBusy(false)
      }
    },
    [busy, dest, local, p],
  )

  useEffect(() => {
    if (notice?.tone !== 'ok') return
    const t = window.setTimeout(() => setNotice(null), 5000)
    return () => window.clearTimeout(t)
  }, [notice])

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  return (
    <form onSubmit={submit} className="card relative overflow-hidden" aria-label={dest ? `Write a thought for ${dest.sprintName}` : 'Write a thought'}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line/70 px-5 py-3 text-sm sm:px-6">
        {choices.length > 1 ? (
          <label className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-ink-soft">Saving to</span>
            <select
              className="min-w-0 max-w-full truncate rounded-lg border border-line bg-card py-1 pl-2 pr-7 font-medium text-ink"
              value={dest?.sprintId ?? ''}
              onChange={(e) => {
                const d = choices.find((c) => c.sprintId === e.target.value)
                if (d) onChoose(d)
              }}
              aria-label="Destination sprint"
            >
              {!dest ? <option value="">Choose a sprint…</option> : null}
              {choices.map((c) => (
                <option key={c.sprintId} value={c.sprintId}>{c.sprintName}</option>
              ))}
            </select>
          </label>
        ) : dest ? (
          <span className="min-w-0 truncate text-ink-soft">
            Saving to <span className="font-medium text-ink">{dest.sprintName}</span>
          </span>
        ) : null}
        {restored ? <span className="text-xs text-ink-faint">· draft restored</span> : null}
      </div>

      <div className="px-5 pt-4 sm:px-6">
        {nudge ? <p className="mb-2 text-sm italic text-ink-soft">{nudge}</p> : null}
        <textarea
          ref={area}
          className="writing"
          value={p.body}
          onChange={(e) => set({ body: e.target.value })}
          onKeyDown={onKey}
          placeholder="What’s worth remembering?"
          aria-label="Your thought"
          maxLength={2000}
          enterKeyHint="enter"
        />
        <div className="mt-3">
          <ChipGroup value={p.category} onChange={(c) => set({ category: c as Category | null })} options={CATEGORIES} label="Category (optional)" allowNone />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <button type="button" className="inline-flex items-center gap-1 text-ink-soft hover:text-ink" onClick={() => setMore((m) => !m)} aria-expanded={more}>
            <ChevronDown className={clsx('size-4 transition-transform', more && 'rotate-180')} /> {more ? 'Less context' : 'Add context'}
          </button>
          <button type="button" className="inline-flex items-center gap-1 text-ink-soft hover:text-ink" onClick={() => setNudge(MEMORY_PROMPTS[(MEMORY_PROMPTS.indexOf(nudge ?? '') + 1) % MEMORY_PROMPTS.length])}>
            <Lightbulb className="size-4" /> {nudge ? 'Another prompt' : 'Need a prompt?'}
          </button>
        </div>
        {more ? (
          <div className="anim-rise mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="impact">What was the impact?</Label>
              <Textarea id="impact" rows={2} className="min-h-0" value={p.impact} onChange={(e) => set({ impact: e.target.value })} onKeyDown={onKey} maxLength={2000} />
            </div>
            <div>
              <Label htmlFor="help">What might help?</Label>
              <Textarea id="help" rows={2} className="min-h-0" value={p.might_help} onChange={(e) => set({ might_help: e.target.value })} onKeyDown={onKey} maxLength={2000} />
            </div>
            <div className="sm:col-span-2">
              <Label>When in the sprint?</Label>
              <ChipGroup value={p.period} onChange={(v) => set({ period: v as Period | null })} options={periodOptions} label="Period (optional)" allowNone />
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-4 px-5 pb-5 sm:px-6">
        <ErrorText>{error}</ErrorText>
        {notice ? (
          <p role="status" className={clsx('mb-3 flex items-start gap-2 rounded-xl px-3 py-2 text-sm', notice.tone === 'ok' ? 'bg-accent-soft text-accent-ink' : notice.tone === 'warn' ? 'bg-warn/12 text-warn' : 'bg-ink/5 text-ink')}>
            <span className={clsx('dot mt-1.5', notice.tone === 'ok' ? 'dot--submitted' : notice.tone === 'warn' ? 'dot--attention' : 'dot--queued')} aria-hidden />
            <span>{notice.text}</span>
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-faint">
            Hidden from teammates until collection closes. <Link to="/about" className="underline underline-offset-2 hover:text-ink">How anonymity works</Link>
            <span className="hidden whitespace-nowrap lg:inline"> · <Kbd>{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}</Kbd> <Kbd>Enter</Kbd> to save</span>
          </p>
          <Button type="submit" variant="primary" busy={busy} disabled={!p.body.trim() || !dest} className="w-full sm:w-auto sm:min-w-36">
            Save thought
          </Button>
        </div>
      </div>
    </form>
  )
}

// ------------------------------------------------------------------ the list

const fmtWhen = (t: string | number) => new Date(t).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
const fmtFull = (t: string | number) => new Date(t).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })

function Body({ p }: { p: { body: string; impact: string | null; might_help: string | null } }) {
  const long = p.body.length > 320 || !!(p.impact && p.might_help)
  const [open, setOpen] = useState(false)
  return (
    <div>
      <p className={clsx('whitespace-pre-wrap text-[0.97rem] leading-relaxed [overflow-wrap:anywhere]', long && !open && 'line-clamp-4')}>{p.body}</p>
      {(!long || open) && p.impact ? <p className="mt-1.5 text-sm text-ink-soft [overflow-wrap:anywhere]"><span className="text-ink-faint">Impact · </span>{p.impact}</p> : null}
      {(!long || open) && p.might_help ? <p className="mt-1 text-sm text-ink-soft [overflow-wrap:anywhere]"><span className="text-ink-faint">Might help · </span>{p.might_help}</p> : null}
      {long ? <button className="mt-1 text-sm text-accent-ink underline-offset-2 hover:underline" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? 'Show less' : 'Show all'}</button> : null}
    </div>
  )
}

function Meta({ category, period }: { category: string | null; period: string | null }) {
  const meta = categoryMeta(category)
  return (
    <span className="inline-flex items-center gap-2 text-xs text-ink-soft">
      {category ? (
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full" style={{ background: meta.color }} /> {meta.label}
        </span>
      ) : null}
      {period ? <span className="text-ink-faint">{PERIODS.find((x) => x.id === period)?.label}</span> : null}
    </span>
  )
}

const iconBtn = 'rounded-full p-2 text-ink-soft hover:bg-ink/6 hover:text-ink disabled:opacity-40 disabled:pointer-events-none'

/** A thought that exists only on this device (waiting, sending, or needing a decision). */
export function LocalThought({ item, moveChoices, showDestination }: { item: OutboxItem; moveChoices: Destination[]; showDestination?: boolean }) {
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
  const copy = async () => {
    try {
      await navigator.clipboard.writeText([item.payload.body, item.payload.impact && `Impact: ${item.payload.impact}`, item.payload.might_help && `Might help: ${item.payload.might_help}`].filter(Boolean).join('\n\n'))
      toast('Copied')
    } catch {
      toast('Couldn’t copy — select the text instead', 'danger')
    }
  }
  return (
    <li className={clsx('rounded-[var(--radius-card)] border border-dashed bg-card/60 p-4', state === 'attention' ? 'border-warn/50' : 'border-accent/35')}>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <StatusLabel state={state} />
        <span className="text-xs text-ink-faint" title={fmtFull(item.createdAt)}>{fmtWhen(item.createdAt)}{showDestination ? ` · ${item.sprintName ?? 'a sprint you can’t open any more'}` : ''}</span>
      </div>
      <Body p={item.payload} />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <Meta category={item.payload.category} period={item.payload.period} />
        <div className="flex items-center gap-1">
          {item.status !== 'attention' || (item.reason !== 'closed' && item.reason !== 'no_access') ? (
            <button className={iconBtn} aria-label="Edit" disabled={item.status === 'sending'} onClick={() => setEditing(true)} title={item.status === 'sending' ? 'Being sent right now' : 'Edit'}>
              <Pencil className="size-4" />
            </button>
          ) : null}
          <button className={iconBtn} aria-label="Copy text" onClick={copy}>
            <Copy className="size-4" />
          </button>
          <button
            className={clsx(iconBtn, 'hover:bg-danger/10 hover:text-danger')}
            aria-label={item.status === 'attention' ? 'Discard' : 'Delete from this device'}
            disabled={item.status === 'sending'}
            onClick={async () => {
              if (!confirm('Remove this unsent thought from this device? It was never submitted, so it isn’t anywhere else.')) return
              await local.remove(item.id).catch((e) => toast((e as Error).message, 'danger'))
            }}
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>
      {why ? (
        <div className="mt-3 rounded-xl bg-warn/10 px-3 py-2.5 text-sm">
          <p>{why}</p>
          {item.reason === 'closed' && others.length ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <CornerDownRight className="size-4 text-ink-faint" />
              {others.map((o) => (
                <Button key={o.sprintId} size="sm" onClick={() => local.moveTo(item.id, o)}>Send to {o.sprintName} instead</Button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <LocalEditDialog item={editing ? item : null} onClose={() => setEditing(false)} />
    </li>
  )
}

/** Your thoughts for one sprint: what's still on this device, then what has reached the sprint. */
export function MyThoughts({ sprintId, editable, moveChoices, online }: { sprintId: string; editable: boolean; moveChoices: Destination[]; online: boolean }) {
  const local = useLocal()
  const toast = useToast()
  const [entries, setEntries] = useState<MyEntry[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState<MyEntry | null>(null)
  const seen = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(new Set())
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
  }, [load])
  // Something was accepted (or the queue changed): show the confirmed list.
  useEffect(() => {
    if (local.recentlySubmitted.length) load()
  }, [local.recentlySubmitted.length, load])

  const mine = local.items.filter((i) => i.sprintId === sprintId).slice().reverse()
  const count = (entries?.length ?? 0) + mine.length
  return (
    <section aria-labelledby="my-thoughts" className="mt-10">
      <div className="waterline" />
      <div className="mb-3 mt-4 flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <h2 id="my-thoughts" className="font-display text-lg">My thoughts{count ? <span className="ml-2 text-sm font-normal text-ink-faint">{count}</span> : null}</h2>
        <span className="text-xs text-ink-faint">{editable ? 'Only you can see these until collection closes' : online ? 'Collection closed · read-only' : 'Offline · editing what you submitted needs a connection'}</span>
      </div>
      <ul className="space-y-2.5">
        {mine.map((i) => <LocalThought key={i.id} item={i} moveChoices={moveChoices} />)}
        {entries?.map((e) => (
          <li key={e.id} className={clsx('card p-4', fresh.has(e.id) && 'anim-reflect')}>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <StatusLabel state="submitted" />
              <span className="text-xs text-ink-faint" title={fmtFull(e.created_at)}>{fmtWhen(e.created_at)}</span>
            </div>
            <Body p={e} />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <Meta category={e.category} period={e.period} />
              {editable ? (
                <div className="flex items-center gap-1">
                  <button className={iconBtn} aria-label="Edit" disabled={!online} title={online ? 'Edit' : 'Editing a submitted thought needs a connection'} onClick={() => setEditing(e)}>
                    <Pencil className="size-4" />
                  </button>
                  <button
                    className={clsx(iconBtn, 'hover:bg-danger/10 hover:text-danger')}
                    aria-label="Delete"
                    disabled={!online}
                    title={online ? 'Delete from the sprint' : 'Deleting needs a connection'}
                    onClick={async () => {
                      if (!confirm('Delete this thought from the sprint? This can’t be undone.')) return
                      try {
                        await del(`/api/sprints/${sprintId}/entries/${e.id}`)
                        toast('Deleted from the sprint')
                        load()
                      } catch (err) {
                        toast(err instanceof ApiError ? err.message : 'Couldn’t delete', 'danger')
                      }
                    }}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {entries && count === 0 ? <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-soft">Nothing here yet. The first thought is usually the hardest.</p> : null}
      {failed && !entries ? <p className="mt-2 text-sm text-ink-soft">Your submitted thoughts will show here when Muni can reach the server.</p> : null}
      <EntryEditDialog entry={editing} sprintId={sprintId} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
    </section>
  )
}

// ------------------------------------------------------------------ editing

function PayloadFields({ p, set }: { p: Payload; set: (x: Partial<Payload>) => void }) {
  return (
    <div className="space-y-4">
      <Textarea value={p.body} onChange={(e) => set({ body: e.target.value })} rows={4} aria-label="Thought" maxLength={2000} />
      <ChipGroup value={p.category} onChange={(v) => set({ category: v as Category | null })} options={CATEGORIES} label="Category" allowNone />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="e-impact">Impact</Label>
          <Textarea id="e-impact" rows={2} className="min-h-0" value={p.impact} onChange={(e) => set({ impact: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="e-help">What might help</Label>
          <Textarea id="e-help" rows={2} className="min-h-0" value={p.might_help} onChange={(e) => set({ might_help: e.target.value })} />
        </div>
      </div>
      <ChipGroup value={p.period} onChange={(v) => set({ period: v as Period | null })} options={periodOptions} label="Period" allowNone />
    </div>
  )
}

function LocalEditDialog({ item, onClose }: { item: OutboxItem | null; onClose: () => void }) {
  const local = useLocal()
  const [p, setP] = useState<Payload>(emptyPayload)
  const [error, setError] = useState('')
  useEffect(() => {
    if (item) {
      setP(item.payload)
      setError('')
    }
  }, [item])
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()} title="Edit unsent thought" description="It hasn’t been sent yet, so the change stays on this device until it is." wide>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (!item || !p.body.trim()) return
          const ok = await local.edit(item.id, p).catch(() => false)
          if (ok) onClose()
          else setError('It started sending before your change was saved. Check the list, then edit the submitted thought if you need to.')
        }}
      >
        <PayloadFields p={p} set={(x) => setP((c) => ({ ...c, ...x }))} />
        <ErrorText>{error}</ErrorText>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">Save changes</Button>
        </div>
      </form>
    </Dialog>
  )
}

function EntryEditDialog({ entry, sprintId, onClose, onSaved }: { entry: MyEntry | null; sprintId: string; onClose: () => void; onSaved: () => void }) {
  const [p, setP] = useState<Payload>(emptyPayload)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (entry) {
      setP({ body: entry.body, category: (entry.category as Category) ?? null, impact: entry.impact ?? '', might_help: entry.might_help ?? '', period: (entry.period as Period) ?? null })
      setError('')
    }
  }, [entry])
  return (
    <Dialog open={!!entry} onOpenChange={(o) => !o && onClose()} title="Edit thought" wide>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (!entry) return
          setBusy(true)
          setError('')
          try {
            await patch(`/api/sprints/${sprintId}/entries/${entry.id}`, { category: p.category, body: p.body, impact: p.impact || undefined, might_help: p.might_help || undefined, period: p.period })
            onSaved()
          } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Couldn’t save')
          } finally {
            setBusy(false)
          }
        }}
      >
        <PayloadFields p={p} set={(x) => setP((c) => ({ ...c, ...x }))} />
        <ErrorText>{error}</ErrorText>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy}>Save changes</Button>
        </div>
      </form>
    </Dialog>
  )
}
