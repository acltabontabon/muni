/**
 * Themes: the facilitator's sorting table before the retro. Optional — without themes the retro
 * still shows every thought — but it's what gives the conversation its topics, the room its vote
 * and each topic its opening question.
 *
 * Built to need no explaining. Each thought is a slip with a round check: tap the ones that belong
 * together (click, Enter or Space). Then either name them — the empty pile at the end of the themes
 * always has a name field, and so does the bar that appears at the foot of the screen — or add
 * them to a theme: every pile says "Add 2 here" while something is selected. A slip in a theme
 * has its own "Take out". Until the first theme exists, three numbered lines say all of this.
 * Dragging still works. A theme's title and opening question are edited where they're read; its
 * notes, park, flag, merge and remove live in its ⋯ menu. Thoughts stay exactly as written.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { clsx } from 'clsx'
import * as Popover from '@radix-ui/react-popover'
import { Check, MoreHorizontal, Plus, Undo2, X } from 'lucide-react'
import { ApiError, del, get, patch, post } from '@/api/client'
import type { GroupingView, SharedEntry, SprintDetail, ThemeView } from '@/api/types'
import { categoryMeta, PERIODS } from '@/lib/categories'
import { useLive } from '@/lib/live'
import { useKeysEpoch } from '@/lib/e2ee/E2eeProvider'
import { isLocked } from '@/lib/e2ee/keyring'
import { Button, Dialog, EmptyState, Input, Spinner, useDocumentTitle, useToast } from '@/ui'
import { menuKeys } from '@/ui/menu-keys'
import { AppShell } from '@/ui/shell'
import { SprintBar, useSprintControl } from '@/ui/sprint-bar'
import { sprintPlan } from '@/lib/lifecycle'

/** A change to the themes: its answer is the whole sorting table, as it is after the change. */
type Change = (reason?: string) => Promise<GroupingView>
/** Makes a change and shows its answer. Throws what the server said. */
type Apply = (fn: Change, reason?: string) => Promise<void>
/** A change to the theme set; true once it's made (after asking why, if a vote was open). */
type Structural = (fn: Change) => Promise<boolean>

const problem = (e: unknown) => (e instanceof ApiError ? (e.status === 0 ? 'You’re offline, so nothing changed.' : e.message) : 'Couldn’t save')

export function Prepare() {
  const { sprintId = '' } = useParams()
  const nav = useNavigate()
  const toast = useToast()
  const [s, setS] = useState<SprintDetail | null>(null)
  const [g, setG] = useState<GroupingView | null>(null)
  /** The last read failed. It takes the page only while nothing has been read. */
  const [error, setError] = useState('')
  /** Thoughts picked up (loose or in a theme), waiting to be put somewhere. */
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [pendingReset, setPendingReset] = useState<{ run: (reason: string) => Promise<boolean>; cancel: () => void } | null>(null)
  const [resetReason, setResetReason] = useState('')
  useDocumentTitle(s ? `${s.name} · themes` : 'Themes')

  // Answers can arrive out of order (a reload and a change's own answer): a table older than the
  // one on screen is never shown over it.
  const asked = useRef(0)
  const shown = useRef(0)
  const show = useCallback((ticket: number, view: GroupingView | null) => {
    if (ticket < shown.current) return
    shown.current = ticket
    setG(view)
    if (!view) return
    // What was picked up and has since gone (moved elsewhere, another tab) is let go.
    const ids = new Set([...view.ungrouped, ...view.themes.flatMap((t) => t.entries)].map((e) => e.id))
    setPicked((p) => (p.size && [...p].some((id) => !ids.has(id)) ? new Set([...p].filter((id) => ids.has(id))) : p))
  }, [])

  const load = useCallback(async () => {
    const ticket = ++asked.current
    try {
      // Asked together; the themes are set aside when the sprint says there are none to sort yet.
      const [d, view] = await Promise.all([get<SprintDetail>(`/api/sprints/${sprintId}`), get<GroupingView>(`/api/sprints/${sprintId}/themes`).catch((e: unknown) => e)])
      setS(d)
      if (!d.is_facilitator || ['draft', 'collecting'].includes(d.status)) show(ticket, null)
      else if (view instanceof Error) throw view
      else show(ticket, view as GroupingView)
      setError('')
    } catch (err) {
      setError(err instanceof ApiError ? (err.status === 0 ? 'You’re offline. The themes show again when Muni can be reached.' : err.message) : 'Couldn’t load')
    }
  }, [sprintId, show])
  // Hints that come close together (a vote closing says "votes" and "themes") make one more read, not several.
  const reading = useRef<Promise<void> | null>(null)
  const again = useRef(false)
  const reload = useCallback(() => {
    if (reading.current) {
      again.current = true
      return
    }
    reading.current = (async () => {
      do {
        again.current = false
        await load()
      } while (again.current)
      reading.current = null
    })()
  }, [load])
  const keysEpoch = useKeysEpoch()
  useEffect(() => {
    load()
  }, [load, keysEpoch])

  // Each change this tab makes is followed by one "themes" hint about it — already in the change's
  // own answer, so it's not read again. (Expected for a few seconds; a change that failed sent none.)
  const echoes = useRef<number[]>([])
  const ownEcho = () => {
    const now = Date.now()
    echoes.current = echoes.current.filter((t) => t > now)
    return echoes.current.shift() !== undefined
  }
  useLive(sprintId, (r) => {
    if (r === 'commitments' || r === 'checkins' || (r === 'themes' && ownEcho())) return
    reload()
  })
  const control = useSprintControl({ id: sprintId, status: s?.status, encryption: s?.encryption }, { online: navigator.onLine, onChanged: (d) => { setS(d); load() } })

  const apply: Apply = useCallback(
    async (fn, reason) => {
      const ticket = ++asked.current
      echoes.current.push(Date.now() + 5000)
      try {
        show(ticket, await fn(reason))
      } catch (err) {
        echoes.current.pop()
        throw err
      }
    },
    [show],
  )

  /** Runs a change to the theme set; if a voting round is open, asks why first (participants see it). */
  const structural: Structural = useCallback(
    async (fn) => {
      try {
        await apply(fn)
        return true
      } catch (err) {
        if (err instanceof ApiError && err.status === 409 && /voting round is open/.test(err.message))
          return new Promise<boolean>((resolve) =>
            setPendingReset({
              run: async (reason) => {
                try {
                  await apply(fn, reason)
                  resolve(true)
                  return true
                } catch (e) {
                  toast(problem(e), 'danger')
                  resolve(false)
                  return false
                }
              },
              cancel: () => resolve(false),
            }),
          )
        toast(problem(err), 'danger')
        return false
      }
    },
    [apply, toast],
  )

  /** Once a change with them is made, the thoughts it moved are no longer picked up (anything picked meanwhile stays). */
  const letGo = (ids: string[]) => setPicked((p) => new Set([...p].filter((id) => !ids.includes(id))))
  const putInto = async (themeId: string | null, ids: string[]) => {
    if (!ids.length) return
    const done = themeId
      ? await structural((reason) => patch<GroupingView>(`/api/sprints/${sprintId}/themes/${themeId}`, { entry_ids: ids, reset_voting_reason: reason }))
      : await structural((reason) => post<GroupingView>(`/api/sprints/${sprintId}/themes/ungroup`, { entry_ids: ids, reset_voting_reason: reason }))
    if (done) letGo(ids)
  }
  const newTheme = async (title: string, ids: string[]) => {
    const done = await structural((reason) => post<GroupingView>(`/api/sprints/${sprintId}/themes`, { title, entry_ids: ids, reset_voting_reason: reason }))
    if (done) letGo(ids)
    return done
  }
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === 'Escape' && !['INPUT', 'TEXTAREA'].includes(t.tagName)) setPicked(new Set())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const sealed = !!s && ['draft', 'collecting'].includes(s.status)
  if (s && !s.is_facilitator)
    return (
      <AppShell>
        <EmptyState title="Themes">Only the facilitator prepares themes.</EmptyState>
      </AppShell>
    )
  if (!s || (!g && !sealed))
    return error ? (
      <AppShell>
        <EmptyState title="Themes" action={<Button onClick={() => void load()}>Try again</Button>}>{error}</EmptyState>
      </AppShell>
    ) : (
      <AppShell wide>
        <div className="grid place-items-center py-20"><Spinner /></div>
      </AppShell>
    )
  const bar = <SprintBar s={{ ...s, participant_count: s.participants.length }} plan={sprintPlan({ ...s, participant_count: s.participants.length }, { online: navigator.onLine })} control={control} view="themes" slim />
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

  const loose = g.ungrouped
  return (
    <AppShell wide>
      {bar}
      <header className="sort-head">
        <h1 className="sort-title">Group into <em>themes</em></h1>
        <p className="sort-lede">Optional. Each theme becomes a topic in the retro. Thoughts stay exactly as written.</p>
        {canEdit && themes.length === 0 && loose.length ? (
          <ol className="sort-steps" aria-label="How">
            <li><span>1</span>Tap the thoughts that belong together</li>
            <li><span>2</span>Name them — that’s a theme</li>
            <li><span>3</span>Give it an opening question, if you like</li>
          </ol>
        ) : (
          <Tally total={g.total_entries} grouped={grouped} themes={themes.length} />
        )}
        {g.voting_open ? <p className="sort-warn">A vote is open. Changing the themes will ask you to reset it.</p> : null}
        {error ? (
          <p className="mt-3 text-sm text-ink-soft" role="status">
            Couldn’t check for changes just now, so this may be out of date. <button type="button" className="underline underline-offset-2" onClick={() => void load()}>Try again</button>
          </p>
        ) : null}
      </header>

      <div className="sort">
        <section className="sort-loose" aria-labelledby="loose-title" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/entry'); if (id) putInto(null, [id]) }}>
          <h2 id="loose-title" className="sort-col-title">To sort <span>{loose.length}</span></h2>
          {loose.length === 0 ? (
            <p className="sort-empty">{g.total_entries ? 'Every thought is in a theme.' : 'No thoughts were added before collection closed.'}</p>
          ) : (
            <ul className="sort-slips">
              {loose.map((e) => <Slip key={e.id} e={e} canEdit={canEdit} picked={picked.has(e.id)} onToggle={() => toggle(e.id)} />)}
            </ul>
          )}
        </section>

        <section className="sort-themes" aria-labelledby="themes-title">
          <h2 id="themes-title" className="sort-col-title">Themes <span>{themes.length}</span></h2>
          <ol className="sort-piles">
            {themes.map((t, i) => {
              const addable = pickedIds.filter((id) => homeOf(id) !== t.id)
              return <Pile key={t.id} t={t} n={i + 1} all={themes} sprintId={sprintId} canEdit={canEdit} picked={picked} onToggle={toggle} addable={addable.length} onAdd={() => putInto(t.id, addable)} onTakeOut={(id) => putInto(null, [id])} onDropEntry={(id) => putInto(t.id, [id])} structural={structural} apply={apply} />
            })}
            {canEdit ? <GhostPile n={themes.length + 1} first={!themes.length} selected={picked.size} onCreate={(title) => newTheme(title, pickedIds)} /> : null}
          </ol>
        </section>
      </div>

      {canEdit && picked.size ? (
        <Tray count={picked.size} themes={themes} homes={homes} onPut={(tid) => putInto(tid, pickedIds)} onNew={(title) => newTheme(title, pickedIds)} onLoose={homes.size === 1 && homes.has(null) ? null : () => putInto(null, pickedIds)} onClear={() => setPicked(new Set())} />
      ) : null}

      <Dialog open={!!pendingReset} onOpenChange={(o) => { if (!o) { pendingReset?.cancel(); setPendingReset(null) } }} title="A vote is open" description="Changing the themes now cancels the round; people keep their unused votes for the next one. Say why in a few words — participants see it.">
        <Input value={resetReason} onChange={(e) => setResetReason(e.target.value)} placeholder="e.g. merged two overlapping themes" maxLength={200} autoFocus />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => { pendingReset?.cancel(); setPendingReset(null) }}>Keep the vote as it is</Button>
          {/* A change that fails says so; its reason stays typed for the next try. */}
          <Button variant="primary" disabled={!resetReason.trim()} onClick={async () => { const r = pendingReset; setPendingReset(null); if (await r?.run(resetReason.trim())) setResetReason('') }}>Reset the vote and continue</Button>
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

/**
 * A thought as a slip: a round check, then its words, exactly as written, with its category as a
 * word. Tapping (or Enter, Space) selects it; selected, the check fills. Inside a theme it has its
 * own "Take out".
 */
function Slip({ e, canEdit, picked, onToggle, onTakeOut }: { e: SharedEntry; canEdit: boolean; picked: boolean; onToggle: () => void; onTakeOut?: () => void }) {
  const meta = categoryMeta(e.category)
  const locked = isLocked(e.body)
  const inTheme = !!onTakeOut
  const words = (
    <span className="sort-slip-body">
      <span className={clsx('sort-slip-text', locked && 'italic text-ink-soft')}>{locked ? e.body.slice(1) : e.body}</span>
      {!inTheme && (e.impact || e.might_help) ? (
        <span className="sort-context">
          {e.impact ? <span><i>Impact</i> {e.impact}</span> : null}
          {e.might_help ? <span><i>Might help</i> {e.might_help}</span> : null}
        </span>
      ) : null}
      {e.category || (!inTheme && e.period) ? (
        <span className="sort-slip-meta">
          {e.category ? <span className="sort-slip-cat" style={{ ['--c' as string]: meta.color }}>{meta.label}</span> : null}
          {!inTheme && e.period ? <span>{PERIODS.find((p) => p.id === e.period)?.label}</span> : null}
        </span>
      ) : null}
    </span>
  )
  if (!canEdit) return <li className="sort-slip" data-in={inTheme || undefined} style={{ ['--c' as string]: e.category ? meta.color : undefined }}><div className="sort-slip-btn sort-slip-btn--still">{words}</div></li>
  return (
    <li className="sort-slip" data-in={inTheme || undefined} data-picked={picked || undefined} style={{ ['--c' as string]: e.category ? meta.color : undefined }}>
      <button type="button" className="sort-slip-btn" aria-pressed={picked} draggable onDragStart={(ev) => ev.dataTransfer.setData('text/entry', e.id)} onClick={onToggle}>
        <span className="sort-check" aria-hidden>{picked ? <Check className="size-3.5" strokeWidth={3} /> : null}</span>
        {words}
        <span className="sr-only">{picked ? ' (selected)' : ''}</span>
      </button>
      {onTakeOut ? (
        <button type="button" className="sort-takeout" onClick={onTakeOut} aria-label="Take out of this theme" title="Take out of this theme">
          <Undo2 className="size-3.5" aria-hidden /> <span>Take out</span>
        </button>
      ) : null}
    </li>
  )
}

/** A theme as a pile: its number and name, its opening question, its slips. While thoughts are selected, it offers to take them. */
function Pile({ t, n, all, sprintId, canEdit, picked, onToggle, addable, onAdd, onTakeOut, onDropEntry, structural, apply }: { t: ThemeView; n: number; all: ThemeView[]; sprintId: string; canEdit: boolean; picked: Set<string>; onToggle: (id: string) => void; addable: number; onAdd: () => void; onTakeOut: (id: string) => void; onDropEntry: (id: string) => void; structural: Structural; apply: Apply }) {
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
      await apply(() => patch<GroupingView>(`/api/sprints/${sprintId}/themes/${t.id}`, { [field]: value }))
      setSaved(field)
      window.setTimeout(() => setSaved((f) => (f === field ? null : f)), 1800)
    } catch (e) {
      toast(problem(e), 'danger')
    }
  }
  const flag = async (k: 'parked' | 'needs_attention', v: boolean) => {
    try {
      await apply(() => patch<GroupingView>(`/api/sprints/${sprintId}/themes/${t.id}`, { [k]: v }))
    } catch (e) {
      toast(problem(e), 'danger')
    }
  }
  const mix = Object.entries(t.category_mix).filter(([, c]) => c > 0)
  const hasNotes = !!(t.summary || t.draft_experiment)
  return (
    <li
      className="sort-pile"
      data-parked={t.parked || undefined}
      data-over={over || undefined}
      data-target={(canEdit && addable > 0) || undefined}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const id = e.dataTransfer.getData('text/entry'); if (id) onDropEntry(id) }}
    >
      <div className="sort-pile-head">
        <span className="sort-pile-n" aria-hidden>{String(n).padStart(2, '0')}</span>
        <div className="min-w-0 flex-1">
          {canEdit ? <Field wrap className="sort-pile-title" label="Theme title" value={t.title} max={80} onSave={(v) => save('title', v)} /> : <h3 className="sort-pile-title">{t.title}</h3>}
          <p className="sort-pile-meta">
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
              { label: notes || hasNotes ? 'Notes' : 'Add notes…', run: () => setNotes(true) },
              { label: t.parked ? 'Bring back from parked' : 'Park — keep it out of the retro', run: () => flag('parked', !t.parked) },
              { label: t.needs_attention ? 'Clear the flag' : 'Flag — discuss it whatever the vote', run: () => flag('needs_attention', !t.needs_attention) },
              ...(all.length > 1 ? [{ label: 'Merge into another theme…', run: () => setMerging(true) }] : []),
              { label: 'Remove the theme…', run: () => setRemoving(true), danger: true },
            ]}
          />
        ) : null}
      </div>

      {canEdit && addable > 0 ? (
        <button type="button" className="sort-pile-add" onClick={onAdd}>
          <Plus className="size-4" aria-hidden /> Add {addable === 1 ? 'the selected thought' : `${addable} selected thoughts`} here
        </button>
      ) : null}

      <div className="sort-question">
        <span className="sort-question-lead">Open with</span>
        {canEdit ? <Field wrap className="sort-question-text" label="Opening question" value={t.question} max={240} placeholder="a question to start the conversation (optional)" onSave={(v) => save('question', v)} /> : <span className="sort-question-text">{t.question || '—'}</span>}
      </div>

      {t.entries.length ? (
        <ul className="sort-slips sort-slips--in">
          {t.entries.map((e) => <Slip key={e.id} e={e} canEdit={canEdit} picked={picked.has(e.id)} onToggle={() => onToggle(e.id)} onTakeOut={canEdit ? () => onTakeOut(e.id) : undefined} />)}
        </ul>
      ) : (
        <p className="sort-drop">Empty. Tap thoughts, then “Add here”.</p>
      )}

      {t.context.length ? (
        <div className="sort-later">
          <p className="sort-question-lead">Added during the retro</p>
          {t.context.map((c) => <p key={c.id}>{c.body}</p>)}
        </div>
      ) : null}

      {canEdit && (notes || hasNotes) ? (
        <div className="sort-notes">
          <button type="button" className="sort-notes-toggle" aria-expanded={notes} aria-controls={`${uid}-notes`} onClick={() => setNotes((o) => !o)}>
            {notes ? 'Fold the notes' : 'Notes'}
            {!notes && hasNotes ? <span className="sort-notes-sum">· {[t.summary && 'summary', t.draft_experiment && 'a draft experiment'].filter(Boolean).join(', ')}</span> : null}
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
      ) : !canEdit && t.summary ? (
        <p className="sort-summary">{t.summary}</p>
      ) : null}

      <Dialog open={merging} onOpenChange={setMerging} title={`Merge “${t.title}” into…`} description="Its thoughts and anything added in the retro move there; this theme’s own words are dropped.">
        <ul className="sort-merge">
          {all.filter((x) => x.id !== t.id).map((x) => (
            <li key={x.id}>
              <button type="button" onClick={() => { setMerging(false); void structural((reason) => post<GroupingView>(`/api/sprints/${sprintId}/themes/${t.id}/merge`, { into_theme_id: x.id, reset_voting_reason: reason })) }}>
                {x.title} <span>{x.entry_count}</span>
              </button>
            </li>
          ))}
        </ul>
      </Dialog>
      <Dialog open={removing} onOpenChange={setRemoving} title={`Remove “${t.title}”?`} description="Its thoughts go back to be sorted, exactly as written. Its title, question and notes are removed.">
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRemoving(false)}>Keep it</Button>
          <Button variant="danger" onClick={() => { setRemoving(false); void structural((reason) => del<GroupingView>(`/api/sprints/${sprintId}/themes/${t.id}`, { reset_voting_reason: reason })) }}>Remove the theme</Button>
        </div>
      </Dialog>
    </li>
  )
}

/**
 * A new theme's name, kept until the theme exists: if creating it fails, the name (and what was
 * selected for it) stay as they were. One creation at a time.
 */
function useNewTheme(onCreate: (title: string) => Promise<boolean>) {
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || busy) return
    setBusy(true)
    try {
      if (await onCreate(title.trim())) setTitle('')
    } finally {
      setBusy(false)
    }
  }
  return { title, setTitle, busy, submit }
}

/**
 * The next theme, waiting for a name: an empty pile with its field always open. Naming it makes a
 * theme of whatever is selected (or an empty one to fill after).
 */
function GhostPile({ n, first, selected, onCreate }: { n: number; first: boolean; selected: number; onCreate: (title: string) => Promise<boolean> }) {
  const { title, setTitle, busy, submit } = useNewTheme(onCreate)
  return (
    <li className="sort-pile sort-pile--ghost" data-ready={selected > 0 || undefined}>
      <form className="sort-ghost" onSubmit={submit}>
        <span className="sort-pile-n" aria-hidden>{String(n).padStart(2, '0')}</span>
        <input className="sort-field sort-pile-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} aria-label="New theme title" placeholder={selected ? `Name a theme for ${selected === 1 ? 'it' : `these ${selected}`}` : first ? 'Name your first theme' : 'Name another theme'} />
        <Button size="sm" type="submit" variant={selected ? 'primary' : 'secondary'} busy={busy} disabled={!title.trim()}>{selected ? `Create with ${selected}` : 'Create'}</Button>
      </form>
      <p className="sort-ghost-hint">{selected ? `The ${selected === 1 ? 'selected thought goes' : `${selected} selected thoughts go`} into it.` : first ? 'Tap some thoughts first — or name it now and add them after.' : 'Or add selected thoughts to a theme above.'}</p>
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
  // What this device can't show can't be edited here either: it's never saved back in place of the real words.
  const locked = isLocked(value)
  const common = {
    'aria-label': label,
    className: clsx('sort-field', className, locked && 'italic text-ink-soft'),
    value: locked ? value.slice(1) : v,
    readOnly: locked,
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

/** A theme's rarer actions, each named. Arrow keys move between them. */
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
        <Popover.Content align="end" sideOffset={4} collisionPadding={12} className="menu-panel anim-rise" role="menu" aria-label="More for this theme" onKeyDown={menuKeys}>
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
 * What's selected, and where it can go: one bar at the foot of the screen, with the new theme's
 * name field already open, every theme named, and "Take out" when something selected is in a theme.
 */
function Tray({ count, themes, homes, onPut, onNew, onLoose, onClear }: { count: number; themes: ThemeView[]; homes: Set<string | null>; onPut: (themeId: string) => void; onNew: (title: string) => Promise<boolean>; onLoose: (() => void) | null; onClear: () => void }) {
  const { title, setTitle, busy, submit } = useNewTheme(onNew)
  const targets = themes.filter((t) => !(homes.size === 1 && homes.has(t.id)))
  return (
    <div className="sort-tray" role="region" aria-label="Put the selected thoughts in a theme">
      <p className="sort-tray-count" aria-live="polite"><strong>{count}</strong> selected</p>
      <form className="sort-tray-new" onSubmit={submit}>
        <input className="sort-field" placeholder="Name a new theme" aria-label="New theme title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
        <Button size="sm" type="submit" variant="primary" busy={busy} disabled={!title.trim()}>Create</Button>
      </form>
      {targets.length || onLoose ? (
        <div className="sort-tray-targets">
          {targets.length ? <span className="sort-tray-or">or add to</span> : null}
          {targets.map((t) => (
            <button key={t.id} type="button" className="sort-tray-to" onClick={() => onPut(t.id)}>{t.title}</button>
          ))}
          {onLoose ? <button type="button" className="sort-tray-to sort-tray-to--quiet" onClick={onLoose}>Take out of {homes.size > 1 || homes.has(null) ? 'their themes' : 'the theme'}</button> : null}
        </div>
      ) : null}
      <button type="button" className="icon-btn" aria-label="Clear the selection" title="Clear (Esc)" onClick={onClear}><X className="size-4" aria-hidden /></button>
    </div>
  )
}
