import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { clsx } from 'clsx'
import { ArrowRight, ChevronDown, FolderInput, GitMerge, Trash2 } from 'lucide-react'
import { ApiError, del, get, patch, post } from '@/api/client'
import type { GroupingView, SharedEntry, SprintDetail, ThemeView } from '@/api/types'
import { useLive } from '@/lib/live'
import { useKeysEpoch } from '@/lib/e2ee/E2eeProvider'
import { Badge, Button, Dialog, EmptyState, Input, Spinner, Textarea, useDocumentTitle, useToast } from '@/ui'
import { AppShell, PageTitle } from '@/ui/shell'
import { CategoryMix, EntryCard } from '@/ui/entries'

export function Prepare() {
  const { sprintId = '' } = useParams()
  const nav = useNavigate()
  const toast = useToast()
  const [s, setS] = useState<SprintDetail | null>(null)
  const [g, setG] = useState<GroupingView | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [newTitle, setNewTitle] = useState('')
  const [pendingReset, setPendingReset] = useState<{ run: (reason: string) => Promise<void> } | null>(null)
  const [resetReason, setResetReason] = useState('')
  useDocumentTitle(s ? `${s.name} · prepare` : 'Prepare')

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
      setG(await get<GroupingView>(`/api/sprints/${sprintId}/themes`))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t load')
    }
  }, [sprintId])
  const keysEpoch = useKeysEpoch()
  useEffect(() => {
    load()
  }, [load, keysEpoch])
  useLive(sprintId, () => load())

  /** Runs a structural change; if the server needs a vote-reset reason, asks for one and retries. */
  const structural = useCallback(
    async (fn: (reason?: string) => Promise<unknown>) => {
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

  const moveTo = async (themeId: string | null, ids: string[]) => {
    if (!ids.length) return
    setSelected(new Set())
    if (themeId) return structural((reason) => patch(`/api/sprints/${sprintId}/themes/${themeId}`, { entry_ids: ids, reset_voting_reason: reason }))
    return structural((reason) => post(`/api/sprints/${sprintId}/themes/ungroup`, { entry_ids: ids, reset_voting_reason: reason }))
  }

  if (error)
    return (
      <AppShell>
        <EmptyState title="Preparation studio">{error}</EmptyState>
      </AppShell>
    )
  if (!s)
    return (
      <AppShell wide>
        <div className="grid place-items-center py-20"><Spinner /></div>
      </AppShell>
    )
  if (!g)
    return (
      <AppShell>
        <PageTitle eyebrow={s.name} title="Make space to look back">Close collection first. Until then every entry is sealed — including from you.</PageTitle>
        <Button variant="primary" onClick={() => nav(`/sprints/${sprintId}`)}>Back to the sprint</Button>
      </AppShell>
    )
  const themes = g.themes
  const canEdit = g.can_edit
  return (
    <AppShell wide>
      <PageTitle
        eyebrow={<Link to={`/sprints/${sprintId}`} className="hover:underline">{s.name}</Link>}
        title={<>Prepare the <em>conversation</em></>}
        actions={
          <>
            {s.status === 'preparing' ? (
              <Button variant="primary" onClick={async () => { try { await post(`/api/sprints/${sprintId}/transition`, { to: 'ready' }); toast('Themes marked ready'); load() } catch (e) { toast(e instanceof ApiError ? e.message : 'Couldn’t', 'danger') } }}>
                Mark ready <ArrowRight className="size-4" />
              </Button>
            ) : s.status === 'ready' ? (
              <Button variant="primary" onClick={async () => { try { await post(`/api/sprints/${sprintId}/transition`, { to: 'live' }); nav(`/sprints/${sprintId}/stage`) } catch (e) { toast(e instanceof ApiError ? e.message : 'Couldn’t', 'danger') } }}>
                Start the retro <ArrowRight className="size-4" />
              </Button>
            ) : s.status === 'live' ? (
              <Button variant="primary" onClick={() => nav(`/sprints/${sprintId}/stage`)}>Back to the stage</Button>
            ) : null}
          </>
        }
      >
        {g.total_entries} {g.total_entries === 1 ? 'thought' : 'thoughts'}, {themes.length} {themes.length === 1 ? 'theme' : 'themes'}, {g.ungrouped.length} not grouped yet. Thoughts are anonymous, in random order, and stay exactly as written — themes only gather them. {s.status === 'preparing' ? 'Mark ready when the discussion has a shape.' : ''}
        {g.voting_open ? <span className="ml-2 text-warn">A voting round is open — changing the theme set will ask you to reset it.</span> : null}
      </PageTitle>

      <div className="grid gap-6 lg:grid-cols-[minmax(320px,1fr)_minmax(0,1.6fr)]">
        <section aria-label="Ungrouped entries">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-display text-xl">Ungrouped <span className="text-ink-faint">{g.ungrouped.length}</span></h2>
            {selected.size ? (
              <MoveMenu label={`Move ${selected.size} to…`} themes={themes} onPick={(tid) => moveTo(tid, [...selected])} onNew={(title) => structural((reason) => post(`/api/sprints/${sprintId}/themes`, { title, entry_ids: [...selected], reset_voting_reason: reason })).then(() => setSelected(new Set()))} />
            ) : null}
          </div>
          <div className="space-y-2" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/entry'); if (id) moveTo(null, [id]) }}>
            {g.ungrouped.length === 0 ? <p className="rounded-xl border border-dashed border-line p-5 text-center text-sm text-ink-soft">Everything is in a theme. Drop an entry here to ungroup it.</p> : null}
            {g.ungrouped.map((e) => (
              <EntryCard key={e.id} e={e} dense draggable={canEdit} onDragStart={(ev) => ev.dataTransfer.setData('text/entry', e.id)} selected={selected.has(e.id)} onSelect={canEdit ? () => setSelected((sel) => { const n = new Set(sel); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n }) : undefined}>
                {canEdit ? <MoveMenu compact label="Move to…" themes={themes} onPick={(tid) => moveTo(tid, [e.id])} onNew={(title) => structural((reason) => post(`/api/sprints/${sprintId}/themes`, { title, entry_ids: [e.id], reset_voting_reason: reason }))} /> : null}
              </EntryCard>
            ))}
          </div>
        </section>
        <section aria-label="Themes">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-display text-xl">Themes <span className="text-ink-faint">{themes.length}</span></h2>
            {canEdit ? (
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!newTitle.trim()) return; structural((reason) => post(`/api/sprints/${sprintId}/themes`, { title: newTitle, reset_voting_reason: reason })).then(() => setNewTitle('')) }}>
                <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="New theme title" className="h-9 w-48 py-1 text-sm" maxLength={80} aria-label="New theme title" />
                <Button size="sm" type="submit">Add</Button>
              </form>
            ) : null}
          </div>
          {themes.length === 0 ? (
            <EmptyState title="No themes yet">Name a theme above, or pick thoughts on the left and move them into a new one. Themes are optional — a retro without them still shows every thought.</EmptyState>
          ) : (
            <div className="space-y-3">
              {themes.map((t) => (
                <ThemeCard key={t.id} t={t} all={themes} sprintId={sprintId} canEdit={canEdit} onDropEntry={(id) => moveTo(t.id, [id])} onMove={(tid, ids) => moveTo(tid, ids)} structural={structural} onChange={load} />
              ))}
            </div>
          )}
        </section>
      </div>

      <Dialog open={!!pendingReset} onOpenChange={(o) => !o && setPendingReset(null)} title="A voting round is open" description="Changing the themes now cancels the round; people keep their unused votes for the next one. Say why in a few words — participants see it.">
        <Input value={resetReason} onChange={(e) => setResetReason(e.target.value)} placeholder="e.g. merged two overlapping themes" maxLength={200} autoFocus />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setPendingReset(null)}>Keep voting as is</Button>
          <Button variant="primary" disabled={!resetReason.trim()} onClick={async () => { const r = pendingReset; setPendingReset(null); await r?.run(resetReason); setResetReason('') }}>Reset voting and continue</Button>
        </div>
      </Dialog>
    </AppShell>
  )
}

/** Keyboard-accessible alternative to drag-and-drop. */
function MoveMenu({ label, themes, onPick, onNew, compact }: { label: string; themes: ThemeView[]; onPick: (themeId: string) => void; onNew: (title: string) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <div className="relative" ref={ref}>
      <button type="button" className={clsx('inline-flex items-center gap-1 rounded-full border border-line bg-card text-ink-soft hover:text-ink', compact ? 'px-2 py-0.5 text-xs' : 'h-9 px-3 text-sm')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <FolderInput className="size-3.5" /> {label} <ChevronDown className="size-3" />
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-64 rounded-xl border border-line bg-card p-1 shadow-[var(--shadow-float)] anim-rise">
          <div className="max-h-56 overflow-y-auto">
            {themes.map((t) => (
              <button key={t.id} role="menuitem" className="block w-full truncate rounded-lg px-3 py-2 text-left text-sm hover:bg-ink/6" onClick={() => { onPick(t.id); setOpen(false) }}>
                {t.title}
              </button>
            ))}
            {themes.length === 0 ? <div className="px-3 py-2 text-xs text-ink-faint">No themes yet</div> : null}
          </div>
          <form className="flex gap-1 border-t border-line p-1" onSubmit={(e) => { e.preventDefault(); if (!title.trim()) return; onNew(title.trim()); setTitle(''); setOpen(false) }}>
            <input className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-2 py-1 text-sm" placeholder="New theme…" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} aria-label="New theme title" />
            <Button size="sm" type="submit" variant="primary">Create</Button>
          </form>
        </div>
      ) : null}
    </div>
  )
}

function ThemeCard({ t, all, sprintId, canEdit, onDropEntry, onMove, structural, onChange }: { t: ThemeView; all: ThemeView[]; sprintId: string; canEdit: boolean; onDropEntry: (id: string) => void; onMove: (themeId: string | null, ids: string[]) => Promise<void>; structural: (fn: (reason?: string) => Promise<unknown>) => Promise<void>; onChange: () => void }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(t.title)
  const [summary, setSummary] = useState(t.summary)
  const [question, setQuestion] = useState(t.question)
  const [experiment, setExperiment] = useState(t.draft_experiment ?? '')
  const [merging, setMerging] = useState(false)
  const [splitting, setSplitting] = useState<Set<string>>(new Set())
  const [splitTitle, setSplitTitle] = useState('')
  useEffect(() => { setTitle(t.title); setSummary(t.summary); setQuestion(t.question); setExperiment(t.draft_experiment ?? '') }, [t])
  const dirty = title !== t.title || summary !== t.summary || question !== t.question || experiment !== (t.draft_experiment ?? '')
  const save = async () => {
    try {
      await patch(`/api/sprints/${sprintId}/themes/${t.id}`, { title, summary, question, draft_experiment: experiment })
      toast('Theme saved')
      onChange()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Couldn’t save', 'danger')
    }
  }
  const flag = (k: 'parked' | 'needs_attention', v: boolean) => patch(`/api/sprints/${sprintId}/themes/${t.id}`, { [k]: v }).then(onChange)
  return (
    <article className={clsx('card p-4', t.parked && 'opacity-80')} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/entry'); if (id) onDropEntry(id) }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {canEdit ? (
            <input className="w-full bg-transparent font-display text-xl leading-tight outline-none focus:border-b focus:border-accent" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Theme title" maxLength={80} />
          ) : (
            <h3 className="font-display text-xl">{t.title}</h3>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
            <span>{t.entry_count} {t.entry_count === 1 ? 'entry' : 'entries'}</span>
            <CategoryMix mix={t.category_mix} />
            {t.parked ? <Badge>parked</Badge> : null}
            {t.needs_attention ? <Badge tone="warn">needs attention</Badge> : null}
            {typeof t.votes === 'number' ? <Badge>{t.votes} votes</Badge> : null}
          </div>
        </div>
        {canEdit ? (
          <div className="flex items-center gap-1">
            <button className="rounded-full px-2 py-1 text-xs text-ink-soft hover:bg-ink/6" onClick={() => flag('parked', !t.parked)}>{t.parked ? 'Unpark' : 'Park'}</button>
            <button className="rounded-full px-2 py-1 text-xs text-ink-soft hover:bg-ink/6" onClick={() => flag('needs_attention', !t.needs_attention)} title="Needs attention despite low votes">{t.needs_attention ? 'Clear flag' : 'Flag'}</button>
            <button className="rounded-full p-1.5 text-ink-soft hover:bg-ink/6" aria-label="Merge into another theme" title="Merge into…" onClick={() => setMerging(true)}><GitMerge className="size-4" /></button>
            <button className="rounded-full p-1.5 text-ink-soft hover:bg-danger/10 hover:text-danger" aria-label="Delete theme" onClick={() => { if (confirm('Delete this theme? Its entries go back to Ungrouped.')) structural((reason) => del(`/api/sprints/${sprintId}/themes/${t.id}`, { reset_voting_reason: reason })) }}><Trash2 className="size-4" /></button>
          </div>
        ) : null}
      </div>
      {canEdit ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Textarea rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Neutral summary — what was observed, in a sentence or two" aria-label="Summary" maxLength={500} className="text-sm" />
          <Textarea rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="An open question to start the conversation" aria-label="Opening question" maxLength={240} className="text-sm" />
          <Input value={experiment} onChange={(e) => setExperiment(e.target.value)} placeholder="Draft experiment (optional)" aria-label="Draft experiment" maxLength={300} className="text-sm sm:col-span-2" />
          {dirty ? <div className="sm:col-span-2"><Button size="sm" variant="primary" onClick={save}>Save theme</Button></div> : null}
        </div>
      ) : (
        <>
          {t.summary ? <p className="mt-2 text-sm text-ink-soft">{t.summary}</p> : null}
          {t.question ? <p className="mt-1 text-sm italic">{t.question}</p> : null}
        </>
      )}
      <button className="mt-3 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <ChevronDown className={clsx('size-4 transition-transform', open && 'rotate-180')} /> {open ? 'Hide' : 'Show'} entries
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          {t.entries.map((e: SharedEntry) => (
            <EntryCard key={e.id} e={e} dense draggable={canEdit} onDragStart={(ev) => ev.dataTransfer.setData('text/entry', e.id)} selected={splitting.has(e.id)} onSelect={canEdit ? () => setSplitting((s) => { const n = new Set(s); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n }) : undefined}>
              {canEdit ? <MoveMenu compact label="Move" themes={all.filter((x) => x.id !== t.id)} onPick={(tid) => onMove(tid, [e.id])} onNew={(title) => structural((reason) => post(`/api/sprints/${sprintId}/themes`, { title, entry_ids: [e.id], reset_voting_reason: reason }))} /> : null}
            </EntryCard>
          ))}
          {t.context.length ? (
            <div className="rounded-xl border border-dashed border-line p-3 text-sm">
              <div className="mb-1 text-xs text-ink-faint">Added during the retro</div>
              {t.context.map((c) => <p key={c.id} className="py-1">{c.body}</p>)}
            </div>
          ) : null}
          {canEdit && splitting.size ? (
            <form className="flex flex-wrap items-center gap-2 rounded-xl bg-paper p-2" onSubmit={(e) => { e.preventDefault(); structural((reason) => post(`/api/sprints/${sprintId}/themes/${t.id}/split`, { title: splitTitle, entry_ids: [...splitting], reset_voting_reason: reason })).then(() => { setSplitting(new Set()); setSplitTitle('') }) }}>
              <span className="text-sm">Split {splitting.size} into</span>
              <Input value={splitTitle} onChange={(e) => setSplitTitle(e.target.value)} placeholder="new theme title" className="h-9 w-48 py-1 text-sm" required maxLength={80} />
              <Button size="sm" type="submit">Split</Button>
              <Button size="sm" variant="ghost" type="button" onClick={() => { onMove(null, [...splitting]); setSplitting(new Set()) }}>Ungroup them</Button>
            </form>
          ) : null}
        </div>
      ) : null}
      <Dialog open={merging} onOpenChange={setMerging} title={`Merge “${t.title}” into…`} description="Entries and context move; this theme’s text is dropped.">
        <div className="space-y-1">
          {all.filter((x) => x.id !== t.id).map((x) => (
            <button key={x.id} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-ink/6" onClick={() => { setMerging(false); structural((reason) => post(`/api/sprints/${sprintId}/themes/${t.id}/merge`, { into_theme_id: x.id, reset_voting_reason: reason })) }}>
              {x.title} <span className="text-xs text-ink-faint">{x.entry_count}</span>
            </button>
          ))}
        </div>
      </Dialog>
    </article>
  )
}
