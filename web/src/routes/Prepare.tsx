/**
 * Themes: the facilitator's sorting table before the retro. Optional — without themes the retro
 * still shows every thought — but it's what gives the conversation its topics, the room its vote
 * and each topic its opening question.
 *
 * Loose thoughts sit on the left as passages, the themes on the right as chapters with their
 * thoughts always in view. Picking up a thought (a click, Enter or Space) — or several, loose or
 * already in a theme — brings up one tray that says where to put them: an existing theme, a new
 * one, or back among the loose. Dragging works too. A theme's title and opening question are
 * edited where they're read and saved on leaving the field; its notes (a neutral summary, a draft
 * experiment) fold away; park, flag, merge and remove live in its ⋯ menu. Thoughts stay exactly as
 * written: themes only gather them.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { clsx } from 'clsx'
import * as Popover from '@radix-ui/react-popover'
import { MoreHorizontal, Plus, X } from 'lucide-react'
import { ApiError, del, get, patch, post } from '@/api/client'
import type { GroupingView, SharedEntry, SprintDetail, ThemeView } from '@/api/types'
import { categoryMeta, PERIODS } from '@/lib/categories'
import { useLive } from '@/lib/live'
import { useKeysEpoch } from '@/lib/e2ee/E2eeProvider'
import { isLocked } from '@/lib/e2ee/keyring'
import { Button, Dialog, EmptyState, Input, Spinner, useDocumentTitle, useToast } from '@/ui'
import { AppShell } from '@/ui/shell'
import { SprintBar, useSprintControl } from '@/ui/sprint-bar'
import { sprintPlan } from '@/lib/lifecycle'

type Structural = (fn: (reason?: string) => Promise<unknown>) => Promise<void>

export function Prepare() {
  const { sprintId = '' } = useParams()
  const nav = useNavigate()
  const toast = useToast()
  const [s, setS] = useState<SprintDetail | null>(null)
  const [g, setG] = useState<GroupingView | null>(null)
  const [error, setError] = useState('')
  /** Thoughts picked up (loose or in a theme), waiting to be put somewhere. */
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [pendingReset, setPendingReset] = useState<{ run: (reason: string) => Promise<void> } | null>(null)
  const [resetReason, setResetReason] = useState('')
  useDocumentTitle(s ? `${s.name} · themes` : 'Themes')

  const load = useCallback(async () => {
    try {
      const d = await get<SprintDetail>(`/api/sprints/${sprintId}`)
      setS(d)
      if (!d.is_facilitator) {
        setError('Only the facilitator prepares themes.')
        return
      }
      if (['draft', 'collecting'].includes(d.status)) {
        setG(null)
        return
      }
      const view = await get<GroupingView>(`/api/sprints/${sprintId}/themes`)
      setG(view)
      // What was picked up and has since gone (moved elsewhere, another tab) is let go.
      const ids = new Set([...view.ungrouped, ...view.themes.flatMap((t) => t.entries)].map((e) => e.id))
      setPicked((p) => (p.size && [...p].some((id) => !ids.has(id)) ? new Set([...p].filter((id) => ids.has(id))) : p))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t load')
    }
  }, [sprintId])
  const keysEpoch = useKeysEpoch()
  useEffect(() => {
    load()
  }, [load, keysEpoch])
  useLive(sprintId, () => load())
  const control = useSprintControl({ id: sprintId, status: s?.status, encryption: s?.encryption }, { online: navigator.onLine, onChanged: (d) => { setS(d); load() } })

  /** Runs a change to the theme set; if a voting round is open, asks why first (participants see it). */
  const structural: Structural = useCallback(
    async (fn) => {
      try {
        await fn()
        await load()
      } catch (err) {
        if (err instanceof ApiError && err.status === 409 && /voting round is open/.test(err.message)) {
          setPendingReset({ run: async (reason) => { await fn(reason); await load() } })
        } else toast(err instanceof ApiError ? err.message : 'Couldn’t save', 'danger')
      }
    },
    [load, toast],
  )

  const putInto = async (themeId: string | null, ids: string[]) => {
    if (!ids.length) return
    setPicked(new Set())
    if (themeId) return structural((reason) => patch(`/api/sprints/${sprintId}/themes/${themeId}`, { entry_ids: ids, reset_voting_reason: reason }))
    return structural((reason) => post(`/api/sprints/${sprintId}/themes/ungroup`, { entry_ids: ids, reset_voting_reason: reason }))
  }
  const newTheme = (title: string, ids: string[]) => {
    setPicked(new Set())
    return structural((reason) => post(`/api/sprints/${sprintId}/themes`, { title, entry_ids: ids, reset_voting_reason: reason }))
  }
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })

  if (error)
    return (
      <AppShell>
        <EmptyState title="Themes">{error}</EmptyState>
      </AppShell>
    )
  if (!s)
    return (
      <AppShell wide>
        <div className="grid place-items-center py-20"><Spinner /></div>
      </AppShell>
    )
  const bar = <SprintBar s={{ ...s, participant_count: s.participants.length }} plan={sprintPlan({ ...s, participant_count: s.participants.length }, { online: navigator.onLine })} control={control} view="themes" />
  if (!g)
    return (
      <AppShell wide>
        {bar}
        <header className="sort-head">
          <h1 className="sort-title">Group into <em>themes</em></h1>
          <p className="sort-lede">Thoughts are sealed while collection is open, including from you. Once it closes, they arrive here to be gathered, if you like, before the retro.</p>
          <Button variant="primary" className="mt-6" onClick={() => nav(`/sprints/${sprintId}`)}>Back to the sprint</Button>
        </header>
      </AppShell>
    )

  const themes = g.themes
  const canEdit = g.can_edit
  const grouped = g.total_entries - g.ungrouped.length
  // In a theme's own list, a picked thought already there is simply "in it"; the tray names where else it can go.
  const pickedIds = [...picked]
  const homeOf = (id: string) => themes.find((t) => t.entries.some((e) => e.id === id))?.id ?? null
  const homes = new Set(pickedIds.map(homeOf))

  return (
    <AppShell wide>
      {bar}
      <header className="sort-head">
        <h1 className="sort-title">Group into <em>themes</em></h1>
        <p className="sort-lede">
          Optional. Themes give the retro its topics, its vote and an opening question each; without them, every thought is still shown. Thoughts stay exactly as written.
        </p>
        <Tally total={g.total_entries} grouped={grouped} themes={themes.length} />
        {g.voting_open ? <p className="sort-warn">A vote is open. Changing the themes will ask you to reset it.</p> : null}
      </header>

      <div className="sort">
        <section className="sort-loose" aria-labelledby="loose-title" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/entry'); if (id) putInto(null, [id]) }}>
          <h2 id="loose-title" className="sort-col-title">Loose <span>{g.ungrouped.length}</span></h2>
          {canEdit && g.ungrouped.length ? <p className="sort-hint">Pick up the ones that belong together.</p> : null}
          {g.ungrouped.length === 0 ? (
            <p className="sort-empty">{g.total_entries ? 'Every thought is in a theme.' : 'No thoughts were added before collection closed.'}</p>
          ) : (
            <ul className="sort-list">
              {g.ungrouped.map((e) => <Thought key={e.id} e={e} canEdit={canEdit} picked={picked.has(e.id)} onToggle={() => toggle(e.id)} />)}
            </ul>
          )}
        </section>

        <section className="sort-themes" aria-labelledby="themes-title">
          <div className="sort-themes-head">
            <h2 id="themes-title" className="sort-col-title">Themes <span>{themes.length}</span></h2>
            {canEdit ? <NewTheme onCreate={(title) => newTheme(title, [])} /> : null}
          </div>
          {themes.length === 0 ? (
            <div className="sort-invite">
              <p className="sort-invite-line">Pick up a few thoughts that belong together, then name them.</p>
              <p className="sort-hint">Or start with a name: “Who owns staging?”, “Reviews that wait”.</p>
            </div>
          ) : (
            <ol className="sort-chapters">
              {themes.map((t, i) => (
                <Chapter key={t.id} t={t} n={i + 1} all={themes} sprintId={sprintId} canEdit={canEdit} picked={picked} onToggle={toggle} onDropEntry={(id) => putInto(t.id, [id])} structural={structural} onChange={load} />
              ))}
            </ol>
          )}
        </section>
      </div>

      {canEdit && picked.size ? (
        <Tray count={picked.size} themes={themes} homes={homes} onPut={(tid) => putInto(tid, pickedIds)} onNew={(title) => newTheme(title, pickedIds)} onLoose={homes.size === 1 && homes.has(null) ? null : () => putInto(null, pickedIds)} onClear={() => setPicked(new Set())} />
      ) : null}

      <Dialog open={!!pendingReset} onOpenChange={(o) => !o && setPendingReset(null)} title="A vote is open" description="Changing the themes now cancels the round; people keep their unused votes for the next one. Say why in a few words — participants see it.">
        <Input value={resetReason} onChange={(e) => setResetReason(e.target.value)} placeholder="e.g. merged two overlapping themes" maxLength={200} autoFocus />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setPendingReset(null)}>Keep the vote as it is</Button>
          <Button variant="primary" disabled={!resetReason.trim()} onClick={async () => { const r = pendingReset; setPendingReset(null); await r?.run(resetReason); setResetReason('') }}>Reset the vote and continue</Button>
        </div>
      </Dialog>
    </AppShell>
  )
}

/** How far the sorting has come: one fine line, filled as thoughts find a theme. */
function Tally({ total, grouped, themes }: { total: number; grouped: number; themes: number }) {
  const share = total ? grouped / total : 0
  return (
    <div className="sort-tally">
      <span className="sort-tally-line" aria-hidden><span style={{ width: `${Math.round(share * 100)}%` }} /></span>
      <p>
        <strong>{grouped} of {total}</strong> {total === 1 ? 'thought' : 'thoughts'} in {themes} {themes === 1 ? 'theme' : 'themes'}
      </p>
    </div>
  )
}

/** One thought: its words, its category as a word in the margin. Picked up with a click, Enter or Space. */
function Thought({ e, canEdit, picked, onToggle, compact }: { e: SharedEntry; canEdit: boolean; picked: boolean; onToggle: () => void; compact?: boolean }) {
  const meta = categoryMeta(e.category)
  const locked = isLocked(e.body)
  const body = (
    <>
      <span className="sort-cat" style={{ ['--c' as string]: meta.color }}>{e.category ? meta.label : ''}</span>
      <span className="sort-words">
        <span className={clsx('sort-text', locked && 'italic text-ink-soft')}>{locked ? e.body.slice(1) : e.body}</span>
        {!compact && (e.impact || e.might_help) ? (
          <span className="sort-context">
            {e.impact ? <span><i>Impact</i> {e.impact}</span> : null}
            {e.might_help ? <span><i>Might help</i> {e.might_help}</span> : null}
          </span>
        ) : null}
        {!compact && e.period ? <span className="sort-period">{PERIODS.find((p) => p.id === e.period)?.label}</span> : null}
      </span>
    </>
  )
  if (!canEdit) return <li className="sort-thought" data-compact={compact || undefined}><div className="sort-thought-inner">{body}</div></li>
  return (
    <li className="sort-thought" data-compact={compact || undefined} data-picked={picked || undefined}>
      <button
        type="button"
        className="sort-thought-inner"
        aria-pressed={picked}
        draggable
        onDragStart={(ev) => ev.dataTransfer.setData('text/entry', e.id)}
        onClick={onToggle}
      >
        {body}
        <span className="sr-only">{picked ? ' (picked up)' : ''}</span>
      </button>
    </li>
  )
}

/** A theme as a chapter: its number, its title and opening question where they're read, its thoughts in view. */
function Chapter({ t, n, all, sprintId, canEdit, picked, onToggle, onDropEntry, structural, onChange }: { t: ThemeView; n: number; all: ThemeView[]; sprintId: string; canEdit: boolean; picked: Set<string>; onToggle: (id: string) => void; onDropEntry: (id: string) => void; structural: Structural; onChange: () => void }) {
  const toast = useToast()
  const uid = useId()
  const [over, setOver] = useState(false)
  const [notes, setNotes] = useState(false)
  const [merging, setMerging] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const save = async (field: 'title' | 'question' | 'summary' | 'draft_experiment', value: string) => {
    if ((field === 'draft_experiment' ? t.draft_experiment ?? '' : t[field]) === value) return
    if (field === 'title' && !value.trim()) return
    try {
      await patch(`/api/sprints/${sprintId}/themes/${t.id}`, { [field]: value })
      setSaved(field)
      window.setTimeout(() => setSaved((f) => (f === field ? null : f)), 1800)
      onChange()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Couldn’t save', 'danger')
    }
  }
  const flag = (k: 'parked' | 'needs_attention', v: boolean) => patch(`/api/sprints/${sprintId}/themes/${t.id}`, { [k]: v }).then(onChange)
  const mix = Object.entries(t.category_mix).filter(([, c]) => c > 0)
  return (
    <li
      className="sort-chapter"
      data-parked={t.parked || undefined}
      data-over={over || undefined}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const id = e.dataTransfer.getData('text/entry'); if (id) onDropEntry(id) }}
    >
      <div className="sort-chapter-head">
        <span className="sort-chapter-n" aria-hidden>{String(n).padStart(2, '0')}</span>
        <div className="min-w-0 flex-1">
          {canEdit ? (
            <Field wrap className="sort-chapter-title" label="Theme title" value={t.title} max={80} onSave={(v) => save('title', v)} />
          ) : (
            <h3 className="sort-chapter-title">{t.title}</h3>
          )}
          <p className="sort-chapter-meta">
            <span>{t.entry_count} {t.entry_count === 1 ? 'thought' : 'thoughts'}</span>
            {mix.length ? (
              <span className="sort-mix" aria-label={mix.map(([c, k]) => `${k} ${categoryMeta(c).label}`).join(', ')}>
                {mix.map(([c, k]) => Array.from({ length: k }, (_, i) => <i key={`${c}${i}`} style={{ background: categoryMeta(c).color }} />))}
              </span>
            ) : null}
            {typeof t.votes === 'number' ? <span>{t.votes} {t.votes === 1 ? 'vote' : 'votes'}</span> : null}
            {t.parked ? <span className="sort-mark">Parked</span> : null}
            {t.needs_attention ? <span className="sort-mark sort-mark--flag">Flagged for the retro</span> : null}
            {saved ? <span className="sort-saved" role="status">Saved</span> : null}
          </p>
        </div>
        {canEdit ? (
          <ThemeMenu
            items={[
              { label: t.parked ? 'Bring back from parked' : 'Park — keep it out of the retro', run: () => flag('parked', !t.parked) },
              { label: t.needs_attention ? 'Clear the flag' : 'Flag — discuss it whatever the vote', run: () => flag('needs_attention', !t.needs_attention) },
              ...(all.length > 1 ? [{ label: 'Merge into another theme…', run: () => setMerging(true) }] : []),
              { label: 'Remove the theme…', run: () => setRemoving(true), danger: true },
            ]}
          />
        ) : null}
      </div>

      <div className="sort-question">
        <span className="sort-question-lead">Open with</span>
        {canEdit ? (
          <Field wrap className="sort-question-text" label="Opening question" value={t.question} max={240} placeholder="an open question to start the conversation" onSave={(v) => save('question', v)} />
        ) : (
          <span className="sort-question-text">{t.question || '—'}</span>
        )}
      </div>

      {t.entries.length ? (
        <ul className="sort-list sort-list--in">
          {t.entries.map((e) => <Thought key={e.id} e={e} compact canEdit={canEdit} picked={picked.has(e.id)} onToggle={() => onToggle(e.id)} />)}
        </ul>
      ) : (
        <p className="sort-drop">Empty for now. Pick up thoughts and put them here.</p>
      )}

      {t.context.length ? (
        <div className="sort-later">
          <p className="sort-question-lead">Added during the retro</p>
          {t.context.map((c) => <p key={c.id}>{c.body}</p>)}
        </div>
      ) : null}

      {canEdit ? (
        <div className="sort-notes">
          <button type="button" className="sort-notes-toggle" aria-expanded={notes} aria-controls={`${uid}-notes`} onClick={() => setNotes((o) => !o)}>
            {notes ? 'Fold the notes' : t.summary || t.draft_experiment ? 'Notes' : 'Add notes'}
            {!notes && (t.summary || t.draft_experiment) ? <span className="sort-notes-sum">· {[t.summary && 'summary', t.draft_experiment && 'a draft experiment'].filter(Boolean).join(', ')}</span> : null}
          </button>
          {notes ? (
            <div id={`${uid}-notes`} className="sort-notes-body anim-rise">
              <label className="sort-note">
                <span>A neutral summary</span>
                <Field multiline label="Summary" value={t.summary} max={500} placeholder="What was observed, in a sentence or two" onSave={(v) => save('summary', v)} />
              </label>
              <label className="sort-note">
                <span>A draft experiment</span>
                <Field label="Draft experiment" value={t.draft_experiment ?? ''} max={300} placeholder="Something the team could try (optional)" onSave={(v) => save('draft_experiment', v)} />
              </label>
            </div>
          ) : null}
        </div>
      ) : t.summary ? (
        <p className="sort-summary">{t.summary}</p>
      ) : null}

      <Dialog open={merging} onOpenChange={setMerging} title={`Merge “${t.title}” into…`} description="Its thoughts and anything added in the retro move there; this theme’s own words are dropped.">
        <ul className="sort-merge">
          {all.filter((x) => x.id !== t.id).map((x) => (
            <li key={x.id}>
              <button type="button" onClick={() => { setMerging(false); structural((reason) => post(`/api/sprints/${sprintId}/themes/${t.id}/merge`, { into_theme_id: x.id, reset_voting_reason: reason })) }}>
                {x.title} <span>{x.entry_count}</span>
              </button>
            </li>
          ))}
        </ul>
      </Dialog>
      <Dialog open={removing} onOpenChange={setRemoving} title={`Remove “${t.title}”?`} description="Its thoughts go back among the loose ones, exactly as written. Its title, question and notes are removed.">
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRemoving(false)}>Keep it</Button>
          <Button variant="danger" onClick={() => { setRemoving(false); structural((reason) => del(`/api/sprints/${sprintId}/themes/${t.id}`, { reset_voting_reason: reason })) }}>Remove the theme</Button>
        </div>
      </Dialog>
    </li>
  )
}

/** Text edited where it's read: looks like the words, saves when you leave it (or press Enter). Escape puts it back. */
function Field({ value, onSave, label, className, placeholder, max, multiline, wrap }: { value: string; onSave: (v: string) => void; label: string; className?: string; placeholder?: string; max: number; multiline?: boolean; /** One line of meaning that may wrap on a narrow screen (Enter still saves). */ wrap?: boolean }) {
  const [v, setV] = useState(value)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setV(value)
  }, [value])
  const common = {
    'aria-label': label,
    className: clsx('sort-field', className),
    value: v,
    placeholder,
    maxLength: max,
    onFocus: () => (focused.current = true),
    onBlur: () => {
      focused.current = false
      const next = v.trim()
      if (!next && label === 'Theme title') return setV(value)
      if (next !== value) onSave(next)
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        setV(value)
        requestAnimationFrame(() => (e.target as HTMLElement).blur())
      } else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        ;(e.target as HTMLElement).blur()
      }
    },
  }
  if (multiline || wrap) return <textarea rows={multiline ? 2 : 1} {...common} onChange={(e) => setV(wrap ? e.target.value.replace(/\n/g, ' ') : e.target.value)} />
  return <input {...common} onChange={(e) => setV(e.target.value)} />
}

/** A new, empty theme by name. */
function NewTheme({ onCreate }: { onCreate: (title: string) => void }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  if (!open)
    return (
      <button type="button" className="sort-new" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden /> New theme
      </button>
    )
  return (
    <form className="sort-new-form" onSubmit={(e) => { e.preventDefault(); if (!title.trim()) return; onCreate(title.trim()); setTitle(''); setOpen(false) }}>
      <input autoFocus className="sort-field" placeholder="Name it" aria-label="New theme title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} />
      <Button size="sm" type="submit" variant="primary">Add</Button>
      <button type="button" className="icon-btn" aria-label="Cancel" onClick={() => setOpen(false)}><X className="size-4" aria-hidden /></button>
    </form>
  )
}

/** A theme's rarer actions, each named. */
function ThemeMenu({ items }: { items: { label: string; run: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="icon-btn sort-menu" aria-label="More for this theme" aria-haspopup="menu">
          <MoreHorizontal className="size-[18px]" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={4} collisionPadding={12} className="menu-panel anim-rise" role="menu" aria-label="More for this theme">
          {items.map((it) => (
            <button key={it.label} type="button" role="menuitem" className={clsx('menu-item', it.danger && 'menu-item--danger')} onClick={() => { setOpen(false); it.run() }}>
              {it.label}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/**
 * What's been picked up, and where it can go: one quiet tray at the foot of the screen. The
 * themes are named in full; "Back to loose" only when something picked up is in a theme.
 */
function Tray({ count, themes, homes, onPut, onNew, onLoose, onClear }: { count: number; themes: ThemeView[]; homes: Set<string | null>; onPut: (themeId: string) => void; onNew: (title: string) => void; onLoose: (() => void) | null; onClear: () => void }) {
  const [naming, setNaming] = useState(false)
  const [title, setTitle] = useState('')
  const targets = themes.filter((t) => !(homes.size === 1 && homes.has(t.id)))
  let into: ReactNode
  if (naming)
    into = (
      <form className="sort-tray-new" onSubmit={(e) => { e.preventDefault(); if (!title.trim()) return; onNew(title.trim()); setTitle(''); setNaming(false) }}>
        <input autoFocus className="sort-field" placeholder="Name the new theme" aria-label="New theme title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setNaming(false)} />
        <Button size="sm" type="submit" variant="primary">Create</Button>
      </form>
    )
  else
    into = (
      <>
        {targets.map((t) => (
          <button key={t.id} type="button" className="sort-tray-to" onClick={() => onPut(t.id)}>{t.title}</button>
        ))}
        <button type="button" className="sort-tray-to sort-tray-to--new" onClick={() => setNaming(true)}><Plus className="size-3.5" aria-hidden /> New theme</button>
        {onLoose ? <button type="button" className="sort-tray-to sort-tray-to--quiet" onClick={onLoose}>Back to loose</button> : null}
      </>
    )
  return (
    <div className="sort-tray" role="region" aria-label="Put the picked-up thoughts somewhere">
      <p className="sort-tray-count" aria-live="polite">
        <strong>{count}</strong> picked up <span>· put {count === 1 ? 'it' : 'them'} in</span>
      </p>
      <div className="sort-tray-targets">{into}</div>
      <button type="button" className="icon-btn" aria-label="Put them down" onClick={onClear}><X className="size-4" aria-hidden /></button>
    </div>
  )
}
