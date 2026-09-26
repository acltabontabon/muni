import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { clsx } from 'clsx'
import { ArrowRight, CalendarClock, ChevronRight, History, Radio } from 'lucide-react'
import { get } from '@/api/client'
import type { CaptureTarget, Experiment, Me, SprintSummary, Workspace } from '@/api/types'
import { useAuth } from '@/lib/auth'
import { OUTCOME_LABEL } from '@/lib/categories'
import { isComposerDirty } from '@/lib/dirty'
import { useLocal, type Destination } from '@/lib/local/LocalProvider'
import type { ContextSprint } from '@/lib/local/store'
import { readPrefs, writePrefs } from '@/lib/prefs'
import { chooseWorkspace, useCurrentWorkspace } from '@/lib/workspace'
import { Badge, Button, Dialog, Spinner, useDocumentTitle } from '@/ui'
import { Composer, LocalThought, MyThoughts } from '@/ui/capture'
import { NewWorkspaceDialog } from '@/ui/menus'
import { AppShell } from '@/ui/shell'
import { Mark } from '@/brand/Mark'

type Sprintish = Pick<SprintSummary, 'id' | 'workspace_id' | 'name' | 'status' | 'retro_local' | 'timezone'> & Partial<SprintSummary>
type Loaded = { capture: CaptureTarget | null; sprints: SprintSummary[] | null; experiments: Experiment[] | null; cached: { sprint: ContextSprint; workspaceName: string | null; fetchedAt: number }[]; offline: boolean }

const toDest = (s: Sprintish): Destination => ({ workspaceId: s.workspace_id, sprintId: s.id, sprintName: s.name })

/** "Mon 28 Sep 2026, 14:00 (UTC+08:00)" plus the reader's own time when it differs. */
export function RetroWhen({ s }: { s: Sprintish }) {
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const yours = s.retro_at && s.timezone !== deviceTz ? new Date(s.retro_at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : null
  return (
    <span>
      Retro {s.retro_local.replace(/ \d{4},/, ',')}
      {yours ? <span className="text-ink-faint"> · {yours} your time</span> : null}
    </span>
  )
}

/**
 * The participant's home: the sprint you're in, a place to write, and your thoughts. It adapts to
 * where the sprint is (collecting, closed, live, done) without ever navigating away from text
 * you're still writing.
 */
export function Home() {
  useDocumentTitle('')
  const { me, offline: authOffline } = useAuth()
  const local = useLocal()
  const [params] = useSearchParams()
  const [data, setData] = useState<Loaded | null>(null)
  const [chosen, setChosen] = useState<string | null>(params.get('sprint') ?? readPrefs().lastSprint ?? null)

  const load = useCallback(async () => {
    const cached = await local.cachedContexts()
    try {
      const capture = await get<CaptureTarget>('/api/me/capture-target')
      setData((d) => ({ capture, sprints: d?.sprints ?? null, experiments: d?.experiments ?? null, cached, offline: false }))
    } catch {
      setData((d) => ({ capture: d?.capture ?? null, sprints: d?.sprints ?? null, experiments: d?.experiments ?? null, cached, offline: true }))
    }
  }, [local])
  useEffect(() => {
    load()
    const onVisible = () => document.visibilityState === 'visible' && load()
    window.addEventListener('online', load)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', load)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  // A deep link to a sprint (/capture?sprint=…) opens its workspace.
  const deepSprint = params.get('sprint')
  const allSprints: Sprintish[] = useMemo(() => [...(data?.capture?.collecting ?? []), ...(data?.capture?.upcoming ?? [])], [data])
  const hint = allSprints.find((s) => s.id === deepSprint)?.workspace_id ?? data?.capture?.collecting[0]?.workspace_id ?? null
  useEffect(() => {
    const target = allSprints.find((s) => s.id === deepSprint)
    if (target) chooseWorkspace(target.workspace_id)
  }, [allSprints, deepSprint])
  const ws = useCurrentWorkspace(me, hint)

  // Workspace-scoped extras: past sprints and commitments.
  useEffect(() => {
    if (!ws || data?.offline) return
    Promise.all([get<SprintSummary[]>(`/api/workspaces/${ws.id}/sprints`).catch(() => null), get<Experiment[]>(`/api/workspaces/${ws.id}/experiments`).catch(() => null)]).then(([sprints, experiments]) =>
      setData((d) => (d ? { ...d, sprints, experiments } : d)),
    )
  }, [ws, data?.offline])

  const offline = authOffline || !!data?.offline
  // Where can a thought go in this workspace? From the server, or (offline) from what this device kept.
  const collectingHere: Sprintish[] = useMemo(() => {
    if (!ws) return []
    if (data?.capture) return data.capture.collecting.filter((s) => s.workspace_id === ws.id)
    return (data?.cached ?? []).filter((c) => c.sprint.workspace_id === ws.id && c.sprint.status === 'collecting').map((c) => ({ ...c.sprint }))
  }, [data, ws])
  const upcomingHere = (data?.capture?.upcoming ?? []).filter((s) => s.workspace_id === ws?.id)
  const live = upcomingHere.find((s) => s.status === 'live')
  const closed = upcomingHere.find((s) => s.status === 'preparing' || s.status === 'ready')
  const recentDone = (data?.sprints ?? []).filter((s) => s.status === 'completed' && s.is_participant)[0]
  const elsewhere = (data?.capture?.collecting ?? []).filter((s) => s.workspace_id !== ws?.id)

  // Keep a little context for offline use (only on a device that keeps drafts).
  useEffect(() => {
    if (!data?.capture || offline) return
    for (const s of data.capture.collecting) {
      local.cacheContext({ id: s.id, workspace_id: s.workspace_id, name: s.name, status: s.status, retro_local: s.retro_local, timezone: s.timezone }, me?.workspaces.find((w) => w.id === s.workspace_id)?.name ?? null)
    }
  }, [data?.capture, offline, local, me])

  // One destination opens directly; several need an explicit choice (a remembered one counts).
  const dest = collectingHere.length === 1 ? collectingHere[0] : collectingHere.find((s) => s.id === chosen) ?? null
  const [sticky, setSticky] = useState<Sprintish | null>(null)
  useEffect(() => {
    if (dest) setSticky(dest)
  }, [dest])
  // If collection closed while someone was mid-sentence, keep the composer (and their text) up.
  const composerFor = dest ?? (sticky && isComposerDirty() && sticky.workspace_id === ws?.id ? sticky : null)
  const choose = (d: Destination) => {
    setChosen(d.sprintId)
    writePrefs({ lastSprint: d.sprintId, lastWorkspace: d.workspaceId })
  }
  const choices = collectingHere.map(toDest)
  const moveChoices = (data?.capture?.collecting ?? []).map(toDest)
  // The sprint whose list is on screen already shows its own unsent thoughts; the rest go below.
  const shownSprintId = composerFor?.id ?? (collectingHere.length > 1 ? null : live?.id ?? closed?.id ?? null)
  const unsentElsewhere = local.items.filter((i) => i.sprintId !== shownSprintId)

  if (!me) return null
  if (me.workspaces.length === 0) return <Welcome />
  if (!data)
    return (
      <AppShell workspace={ws}>
        <div className="grid place-items-center py-24 text-ink-soft"><Spinner /></div>
      </AppShell>
    )

  const myCommitments = (data.experiments ?? []).filter((e) => e.owner_account_id === me.account_id && (e.status === 'proposed' || e.status === 'accepted'))
  const aside = <Aside ws={ws!} commitments={myCommitments} elsewhere={elsewhere} me={me} />

  const wide = myCommitments.length > 0 || elsewhere.length > 0
  return (
    <AppShell workspace={ws}>
      <div className={clsx(!wide && 'mx-auto max-w-2xl')}>
      {offline ? (
        <p className="mb-5 flex items-center gap-2 rounded-xl bg-ink/5 px-3 py-2 text-sm text-ink-soft" role="status">
          <span className="dot dot--queued" aria-hidden /> You’re offline. {composerFor ? `Thoughts you save wait on this device${local.kind === 'memory' ? ' (in this tab)' : ''} and are sent when Muni reconnects.` : 'Muni will catch up when you reconnect.'}
          {data.cached.length && !data.capture ? <span className="text-ink-faint"> Sprint details from {new Date(Math.max(...data.cached.map((c) => c.fetchedAt))).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}.</span> : null}
        </p>
      ) : null}
      {live ? (
        <Link to={`/sprints/${live.id}/room`} className="card mb-6 flex items-center gap-4 border-accent/40 p-4 hover:border-accent">
          <Radio className="size-5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <div className="font-medium [overflow-wrap:anywhere]">{live.name} is live</div>
            <div className="text-sm text-ink-soft">Join the retro on this device</div>
          </div>
          <span className="inline-flex items-center gap-1 text-sm font-medium text-accent-ink">Join <ArrowRight className="size-4" /></span>
        </Link>
      ) : null}
      </div>

      <div className={clsx('grid gap-10', wide ? 'lg:grid-cols-[minmax(0,1fr)_280px]' : 'mx-auto max-w-2xl')}>
        <div className="min-w-0">
          {composerFor ? (
            <>
              <header className="mb-5">
                <p className="flex items-center gap-2 text-sm text-accent-ink"><span className="dot dot--submitted" aria-hidden /> Collecting</p>
                <h1 className="font-display mt-1 text-2xl leading-tight [overflow-wrap:anywhere] sm:text-[28px]">{collectingHere.length > 1 && !dest ? 'Where should your thought go?' : composerFor.name}</h1>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-soft"><CalendarClock className="size-4 shrink-0" /> <RetroWhen s={composerFor} /></p>
                {!dest ? <p className="mt-2 rounded-xl bg-warn/10 px-3 py-2 text-sm">This sprint stopped collecting. Your text is still here — copy it, or send it to another sprint below.</p> : null}
              </header>
              <Composer key={local.cleared} dest={dest ? toDest(dest) : null} choices={choices} onChoose={choose} />
              <MyThoughts sprintId={composerFor.id} editable={!!dest && !offline} moveChoices={moveChoices} online={!offline} />
            </>
          ) : collectingHere.length > 1 ? (
            <ChooseDestination sprints={collectingHere} onChoose={(s) => choose(toDest(s))} />
          ) : live ? (
            <State title={`${live.name}`} kicker="Retro live" body="Thoughts are closed; the conversation is happening now." action={<Link to={`/sprints/${live.id}/room`}><Button variant="primary">Join the retro</Button></Link>}>
              <MyThoughts sprintId={live.id} editable={false} moveChoices={moveChoices} online={!offline} />
            </State>
          ) : closed ? (
            <State title={closed.name} kicker="Collection closed" body={<><RetroWhen s={closed} />. Thoughts are closed while the facilitator prepares the conversation.</>} action={<Link to={`/sprints/${closed.id}`} className="text-sm underline underline-offset-4">Open the sprint</Link>}>
              <MyThoughts sprintId={closed.id} editable={false} moveChoices={moveChoices} online={!offline} />
            </State>
          ) : recentDone ? (
            <State title={recentDone.name} kicker="Completed" body="Here’s what the team agreed to try." action={<Link to={`/sprints/${recentDone.id}/outcomes`}><Button>Outcomes and recap</Button></Link>}>
              <ExperimentList items={(data.experiments ?? []).filter((e) => e.sprint_id === recentDone.id && e.status !== 'proposed')} me={me} empty="No experiments were agreed in this retro." />
            </State>
          ) : (
            <State
              title="Nothing to write for yet"
              kicker={ws?.name}
              body={`When someone in ${ws?.name ?? 'this workspace'} opens a sprint for you, you’ll write your thoughts here.`}
              action={!offline && ws ? <Link to={`/workspaces/${ws.id}/sprints/new`} className="text-sm text-ink-soft underline underline-offset-4 hover:text-ink">Set up a sprint</Link> : undefined}
            />
          )}

          {unsentElsewhere.length ? (
            <section className="mt-10" aria-labelledby="unsent">
              <h2 id="unsent" className="font-display mb-3 text-lg">Not sent yet <span className="ml-1 text-sm font-normal text-ink-faint">{unsentElsewhere.length}</span></h2>
              <ul className="space-y-2.5">{unsentElsewhere.map((i) => <LocalThought key={i.id} item={i} moveChoices={moveChoices} showDestination />)}</ul>
            </section>
          ) : null}

          <MobileMore ws={ws} commitments={myCommitments} elsewhere={elsewhere} me={me} />
        </div>
        {myCommitments.length || elsewhere.length ? <div className="hidden lg:block">{aside}</div> : null}
      </div>
    </AppShell>
  )
}

function State({ title, kicker, body, action, children }: { title: string; kicker?: string; body: React.ReactNode; action?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div>
      <header className="mb-2">
        {kicker ? <p className="text-sm text-ink-soft">{kicker}</p> : null}
        <h1 className="font-display mt-1 text-2xl leading-tight [overflow-wrap:anywhere] sm:text-[28px]">{title}</h1>
        <p className="mt-2 text-ink-soft measure">{body}</p>
        {action ? <div className="mt-4">{action}</div> : null}
      </header>
      {children}
    </div>
  )
}

function ChooseDestination({ sprints, onChoose }: { sprints: Sprintish[]; onChoose: (s: Sprintish) => void }) {
  return (
    <div>
      <p className="text-sm text-ink-soft">More than one sprint is collecting</p>
      <h1 className="font-display mt-1 text-2xl leading-tight sm:text-[28px]">Where should your thought go?</h1>
      <ul className="mt-5 space-y-2">
        {sprints.map((s) => (
          <li key={s.id}>
            <button className="card flex w-full items-center gap-3 p-4 text-left hover:border-ink/30" onClick={() => onChoose(s)}>
              <span className="dot dot--queued" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block font-medium [overflow-wrap:anywhere]">{s.name}</span>
                <span className="block text-sm text-ink-soft"><RetroWhen s={s} /></span>
              </span>
              <ChevronRight className="size-4 text-ink-faint" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ExperimentList({ items, me, empty }: { items: Experiment[]; me: Me; empty?: string }) {
  if (!items.length) return empty ? <p className="mt-4 text-sm text-ink-soft">{empty}</p> : null
  return (
    <ul className="mt-4 space-y-2">
      {items.map((e) => (
        <li key={e.id} className="card p-4">
          <p className="font-medium [overflow-wrap:anywhere]">{e.change_to_try}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
            <Badge tone={e.status === 'proposed' ? 'accent' : e.status === 'helped' ? 'ok' : 'neutral'}>{e.status === 'proposed' && e.owner_account_id === me.account_id ? 'Waiting for you to accept' : OUTCOME_LABEL[e.status]}</Badge>
            {e.owner_name ? <span>{e.owner_account_id === me.account_id ? 'You own this' : `Owner ${e.owner_name}`}</span> : null}
            <span className="text-ink-faint">Review {new Date(e.review_on + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}

function Aside({ ws, commitments, elsewhere, me }: { ws: Me['workspaces'][number]; commitments: Experiment[]; elsewhere: SprintSummary[]; me: Me }) {
  return (
    <aside className="space-y-8">
      {commitments.length ? (
        <section>
          <h2 className="text-sm font-medium text-ink-soft">Your commitments</h2>
          <ExperimentList items={commitments} me={me} />
        </section>
      ) : null}
      {elsewhere.length ? (
        <section>
          <h2 className="text-sm font-medium text-ink-soft">Also collecting</h2>
          <ul className="mt-2 space-y-1.5">
            {elsewhere.map((s) => (
              <li key={s.id}>
                <button className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm hover:bg-ink/5" onClick={() => { chooseWorkspace(s.workspace_id); writePrefs({ lastSprint: s.id }) }}>
                  <span className="dot dot--queued" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  <span className="truncate text-xs text-ink-faint">{me.workspaces.find((w) => w.id === s.workspace_id)?.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <Link to={`/workspaces/${ws.id}`} className="inline-flex items-center gap-2 text-sm text-ink-soft hover:text-ink">
        <History className="size-4" /> Past sprints and outcomes
      </Link>
    </aside>
  )
}

/** On small screens the secondary column becomes one labelled row that opens a sheet. */
function MobileMore({ ws, commitments, elsewhere, me }: { ws: Me['workspaces'][number] | null; commitments: Experiment[]; elsewhere: SprintSummary[]; me: Me }) {
  const [open, setOpen] = useState(false)
  if (!ws) return null
  const label = [commitments.length ? `${commitments.length} commitment${commitments.length === 1 ? '' : 's'}` : null, elsewhere.length ? `${elsewhere.length} more collecting` : null].filter(Boolean).join(' · ')
  return (
    <div className="mt-10 lg:hidden">
      {label ? (
        <button className="card flex w-full items-center gap-3 p-4 text-left" onClick={() => setOpen(true)}>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Commitments &amp; other sprints</span>
            <span className="block text-sm text-ink-soft">{label}</span>
          </span>
          <ChevronRight className="size-4 text-ink-faint" />
        </button>
      ) : null}
      <Link to={`/workspaces/${ws.id}`} className="mt-4 inline-flex items-center gap-2 text-sm text-ink-soft hover:text-ink">
        <History className="size-4" /> Past sprints and outcomes
      </Link>
      <Dialog open={open} onOpenChange={setOpen} title="Commitments & other sprints">
        <Aside ws={ws} commitments={commitments} elsewhere={elsewhere} me={me} />
      </Dialog>
    </div>
  )
}

function Welcome() {
  const { refresh } = useAuth()
  const nav = useNavigate()
  const [creating, setCreating] = useState(false)
  return (
    <AppShell workspace={null}>
      <div className="mx-auto max-w-xl py-10 text-center">
        <Mark size={52} className="mx-auto text-ink" />
        <h1 className="font-display mt-6 text-3xl">Welcome to Muni</h1>
        <p className="mt-3 text-lg text-ink-soft">If you were invited to a team, open the link from your invitation email — it brings you straight to your sprint.</p>
        <p className="mt-8 text-sm text-ink-soft">
          Starting a team yourself? <button className="underline underline-offset-4 hover:text-ink" onClick={() => setCreating(true)}>Create a workspace</button>
        </p>
      </div>
      <NewWorkspaceDialog open={creating} onClose={() => setCreating(false)} onCreated={async (w: Workspace) => { setCreating(false); await refresh(); chooseWorkspace(w.id); nav(`/workspaces/${w.id}`) }} />
    </AppShell>
  )
}
