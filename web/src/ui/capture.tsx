import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, Pencil, Trash2 } from 'lucide-react'
import { ApiError, del, get, newKey, patch, post } from '@/api/client'
import type { Category, MyEntry, Period } from '@/api/types'
import { CATEGORIES, categoryMeta, MEMORY_PROMPTS, PERIODS } from '@/lib/categories'
import { Button, CategoryDot, ChipGroup, Dialog, ErrorText, Kbd, Label, Textarea, useToast } from '@/ui'

const isFinePointer = () => window.matchMedia('(pointer: fine)').matches

/**
 * The composer. Text first; category optional; the rest folded away.
 * The idempotency key is minted when typing starts, so a retry after a
 * dropped connection can never create a second entry.
 */
export function CaptureComposer({ sprintId, sprintName, onSaved, autoFocus = 'desktop', compact }: { sprintId: string; sprintName: string; onSaved?: (e: MyEntry) => void; autoFocus?: 'desktop' | 'never' | 'always'; compact?: boolean }) {
  const toast = useToast()
  const [body, setBody] = useState('')
  const [category, setCategory] = useState<Category | null>(null)
  const [impact, setImpact] = useState('')
  const [help, setHelp] = useState('')
  const [period, setPeriod] = useState<Period | null>(null)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; sessionEnded?: boolean } | null>(null)
  const keyRef = useRef<string | null>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const prompt = useMemo(() => MEMORY_PROMPTS[Math.floor(Math.random() * MEMORY_PROMPTS.length)], [])

  useEffect(() => {
    if (autoFocus === 'always' || (autoFocus === 'desktop' && isFinePointer())) areaRef.current?.focus()
  }, [autoFocus])

  const reset = () => {
    setBody('')
    setCategory(null)
    setImpact('')
    setHelp('')
    setPeriod(null)
    setMore(false)
    keyRef.current = null
    setError(null)
  }

  const submit = useCallback(async (e?: FormEvent) => {
    e?.preventDefault()
    if (!body.trim() || busy) return
    keyRef.current ??= newKey()
    setBusy(true)
    setError(null)
    try {
      const saved = await post<MyEntry>(`/api/sprints/${sprintId}/entries`, {
        category,
        body,
        impact: impact || undefined,
        might_help: help || undefined,
        period,
        idempotency_key: keyRef.current,
      })
      reset()
      toast('Saved for your retro.')
      onSaved?.(saved)
      if (isFinePointer()) areaRef.current?.focus()
    } catch (err) {
      // The text stays exactly where it is. Nothing was saved.
      if (err instanceof ApiError && err.status === 401) setError({ text: 'Your session ended. Your text is still here — sign in again in a new tab, then save.', sessionEnded: true })
      else if (err instanceof ApiError && err.status === 409) setError({ text: err.message })
      else setError({ text: err instanceof ApiError ? err.message : 'Couldn’t save. Your text is still here — try again.' })
    } finally {
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, busy, category, impact, help, period, sprintId])

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape' && more) {
      setMore(false)
    }
  }

  return (
    <form onSubmit={submit} className={clsx('card', compact ? 'p-4' : 'p-5 sm:p-6')} aria-label={`Capture a thought for ${sprintName}`}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div className="text-sm text-ink-soft">
          Saving to <span className="font-medium text-ink">{sprintName}</span> · only you can see it until collection closes
        </div>
      </div>
      <Textarea
        ref={areaRef}
        value={body}
        onChange={(e) => {
          setBody(e.target.value)
          keyRef.current ??= newKey()
        }}
        onKeyDown={onKey}
        placeholder={prompt}
        aria-label="Your observation"
        rows={compact ? 2 : 3}
        maxLength={2000}
        className="text-[17px] leading-relaxed"
        enterKeyHint="enter"
      />
      <div className="mt-3">
        <ChipGroup value={category} onChange={setCategory} options={CATEGORIES} label="Category (optional)" allowNone />
      </div>
      <button type="button" className="mt-3 inline-flex flex-wrap items-center gap-x-1 text-sm text-ink-soft hover:text-ink" onClick={() => setMore((m) => !m)} aria-expanded={more}>
        <ChevronDown className={clsx('size-4 transition-transform', more && 'rotate-180')} /> <span className="whitespace-nowrap">{more ? 'Less' : 'Add context'}</span> <span className="text-ink-faint">— impact, what might help, when</span>
      </button>
      {more ? (
        <div className="anim-rise mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="impact">What was the impact?</Label>
            <Textarea id="impact" rows={2} value={impact} onChange={(e) => setImpact(e.target.value)} onKeyDown={onKey} maxLength={2000} />
          </div>
          <div>
            <Label htmlFor="help">What might help?</Label>
            <Textarea id="help" rows={2} value={help} onChange={(e) => setHelp(e.target.value)} onKeyDown={onKey} maxLength={2000} />
          </div>
          <div className="sm:col-span-2">
            <Label>When in the sprint?</Label>
            <ChipGroup value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ id: p.id, label: p.label, color: 'var(--ink-faint)' }))} label="Period (optional)" allowNone />
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="mt-3">
          <ErrorText>{error.text}</ErrorText>
          {error.sessionEnded ? (
            <a className="text-sm underline" href="/signin" target="_blank" rel="noreferrer">
              Open sign-in in a new tab
            </a>
          ) : null}
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className="hidden text-xs text-ink-faint sm:inline">
          <Kbd>{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}</Kbd> + <Kbd>Enter</Kbd> saves
        </span>
        <Button type="submit" variant="primary" busy={busy} disabled={!body.trim()} className="ml-auto min-w-40">
          Save the thought
        </Button>
      </div>
    </form>
  )
}

/** Your own entries, on any device. Editable while collection is open. */
export function MyThoughts({ sprintId, refreshKey, editable }: { sprintId: string; refreshKey: number; editable: boolean }) {
  const [entries, setEntries] = useState<MyEntry[] | null>(null)
  const [editing, setEditing] = useState<MyEntry | null>(null)
  const toast = useToast()
  const load = useCallback(() => get<MyEntry[]>(`/api/sprints/${sprintId}/entries/mine`).then(setEntries).catch(() => setEntries([])), [sprintId])
  useEffect(() => {
    load()
  }, [load, refreshKey])
  if (!entries) return null
  return (
    <section aria-label="My thoughts">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-display text-xl">My thoughts</h2>
        <span className="text-sm text-ink-soft">{entries.length === 0 ? '' : `${entries.length} saved · visible only to you${editable ? '' : ' (collection closed; read-only)'}`}</span>
      </div>
      {entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-5 text-center text-ink-soft">Something worth remembering? Leave it here.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => {
            const meta = categoryMeta(e.category)
            return (
              <li key={e.id} className="card anim-rise flex items-start gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-3">
                    <CategoryDot color={meta.color} label={meta.label} small />
                    {e.period ? <span className="text-xs text-ink-faint">{PERIODS.find((p) => p.id === e.period)?.label}</span> : null}
                  </div>
                  <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{e.body}</p>
                  {e.impact ? <p className="mt-1 text-sm text-ink-soft"><span className="text-ink-faint">Impact:</span> {e.impact}</p> : null}
                  {e.might_help ? <p className="mt-1 text-sm text-ink-soft"><span className="text-ink-faint">Might help:</span> {e.might_help}</p> : null}
                </div>
                {editable ? (
                  <div className="flex shrink-0 gap-1">
                    <button className="rounded-full p-2 text-ink-soft hover:bg-ink/6 hover:text-ink" aria-label="Edit" onClick={() => setEditing(e)}>
                      <Pencil className="size-4" />
                    </button>
                    <button
                      className="rounded-full p-2 text-ink-soft hover:bg-danger/10 hover:text-danger"
                      aria-label="Delete"
                      onClick={async () => {
                        if (!confirm('Delete this thought? This can’t be undone.')) return
                        await del(`/api/sprints/${sprintId}/entries/${e.id}`)
                        toast('Deleted')
                        load()
                      }}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
      <EditDialog entry={editing} sprintId={sprintId} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
    </section>
  )
}

function EditDialog({ entry, sprintId, onClose, onSaved }: { entry: MyEntry | null; sprintId: string; onClose: () => void; onSaved: () => void }) {
  const [body, setBody] = useState('')
  const [category, setCategory] = useState<Category | null>(null)
  const [impact, setImpact] = useState('')
  const [help, setHelp] = useState('')
  const [period, setPeriod] = useState<Period | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (entry) {
      setBody(entry.body)
      setCategory((entry.category as Category) ?? null)
      setImpact(entry.impact ?? '')
      setHelp(entry.might_help ?? '')
      setPeriod((entry.period as Period) ?? null)
      setError('')
    }
  }, [entry])
  return (
    <Dialog open={!!entry} onOpenChange={(o) => !o && onClose()} title="Edit thought" wide>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!entry) return
          setBusy(true)
          setError('')
          try {
            await patch(`/api/sprints/${sprintId}/entries/${entry.id}`, { category, body, impact: impact || undefined, might_help: help || undefined, period })
            onSaved()
          } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Couldn’t save')
          } finally {
            setBusy(false)
          }
        }}
      >
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} aria-label="Observation" maxLength={2000} />
        <ChipGroup value={category} onChange={setCategory} options={CATEGORIES} label="Category" allowNone />
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="e-impact">Impact</Label>
            <Textarea id="e-impact" rows={2} value={impact} onChange={(e) => setImpact(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="e-help">What might help</Label>
            <Textarea id="e-help" rows={2} value={help} onChange={(e) => setHelp(e.target.value)} />
          </div>
        </div>
        <ChipGroup value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ id: p.id, label: p.label, color: 'var(--ink-faint)' }))} label="Period" allowNone />
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy}>Save changes</Button>
        </div>
      </form>
    </Dialog>
  )
}
