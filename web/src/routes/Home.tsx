/**
 * Opening Muni ("/", the header's "Write", the old /capture link): a shortcut to the sprint that
 * matters to you now in the workspace you're in. It opens that sprint's own page, where writing,
 * the retro and the outcomes all live, so there is one place per sprint and never a second
 * composer. Only when there's nothing to open, or more than one sprint is collecting and you
 * haven't said which, does this page show anything itself.
 *
 * Which sprint: one collecting for you (or the one you chose last, of several), then a live
 * retro, then one whose collection has closed, then one not open yet. Muni never picks one of
 * several collecting sprints silently.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router'
import { ArrowRight, ChevronRight } from 'lucide-react'
import { get } from '@/api/client'
import type { CaptureTarget, Experiment, Me, SprintSummary, Workspace } from '@/api/types'
import { useAuth } from '@/lib/auth'
import { OUTCOME_LABEL } from '@/lib/categories'
import { pickDestination } from '@/lib/destination'
import { useLocal } from '@/lib/local/LocalProvider'
import type { ContextSprint } from '@/lib/local/store'
import { readPrefs, writePrefs } from '@/lib/prefs'
import { useResources } from '@/lib/resource'
import { shortDate } from '@/lib/schedule'
import { chooseWorkspace, useCurrentWorkspace } from '@/lib/workspace'
import { Spinner, useDocumentTitle } from '@/ui'
import { LocalThoughtList } from '@/ui/capture'
import { JournalScene } from '@/ui/journal'
import { NewWorkspaceDialog } from '@/ui/menus'
import { AppShell } from '@/ui/shell'
import { RetroWhen } from '@/ui/when'
import { useWorld } from '@/worlds/world'
import { Room } from '@/worlds/rooms'
import { SprintTab, StateWriter } from '@/worlds/room'

type Sprintish = Pick<SprintSummary, 'id' | 'workspace_id' | 'name' | 'status' | 'timezone'> & Partial<SprintSummary>
type Loaded = { capture: CaptureTarget | null; cached: { sprint: ContextSprint; workspaceName: string | null; fetchedAt: number }[]; offline: boolean }

export function Home() {
  useDocumentTitle('')
  const { me, offline: authOffline } = useAuth()
  const local = useLocal()
  const resources = useResources()
  const location = useLocation()
  const [params] = useSearchParams()
  const [data, setData] = useState<Loaded | null>(null)
  const [sprints, setSprints] = useState<{ ws: string; list: SprintSummary[] | null } | null>(null)
  const [experiments, setExperiments] = useState<Experiment[] | null>(null)
  // "Write" asks for the field; anything else just opens the sprint.
  const write = !!(location.state as { write?: boolean } | null)?.write

  const localRef = useRef(local)
  useEffect(() => {
    localRef.current = local
  }, [local])
  const load = useCallback(async () => {
    const cached = await localRef.current.cachedContexts().catch(() => [])
    try {
      // Through the shared cache: the sprint page this usually leads to reads the same answer.
      const capture = await resources.load<CaptureTarget>('/api/me/capture-target')
      setData({ capture, cached, offline: false })
    } catch {
      setData({ capture: null, cached, offline: true })
    }
  }, [resources])
  useEffect(() => {
    load()
  }, [load])
  // Opened offline: try again as soon as the connection is back.
  useEffect(() => {
    window.addEventListener('online', load)
    return () => window.removeEventListener('online', load)
  }, [load])

  const collectingAll: Sprintish[] = useMemo(() => data?.capture?.collecting ?? [], [data])
  const hint = collectingAll[0]?.workspace_id ?? null
  const ws = useCurrentWorkspace(me, hint)
  const wsId = ws?.id ?? null
  const offline = authOffline || !!data?.offline

  // Only when nothing in the workspace is open: its sprints (a draft, the last retro) and commitments.
  const upcomingHere = (data?.capture?.upcoming ?? []).filter((s) => s.workspace_id === wsId)
  const collectingHere: Sprintish[] = useMemo(() => {
    if (!wsId) return []
    if (data?.capture) return data.capture.collecting.filter((s) => s.workspace_id === wsId)
    return (data?.cached ?? []).filter((c) => c.sprint.workspace_id === wsId && c.sprint.status === 'collecting').map((c) => ({ ...c.sprint }))
  }, [data, wsId])
  const needList = !!data && !offline && !!wsId && collectingHere.length === 0 && upcomingHere.length === 0
  useEffect(() => {
    if (!needList || !wsId) return
    let live = true
    Promise.all([get<SprintSummary[]>(`/api/workspaces/${wsId}/sprints`).catch(() => null), get<Experiment[]>(`/api/workspaces/${wsId}/experiments`).catch(() => null)]).then(([list, exps]) => {
      if (!live) return
      setSprints({ ws: wsId, list })
      setExperiments(exps)
    })
    return () => {
      live = false
    }
  }, [needList, wsId])

  // An old deep link (/capture?sprint=…) goes straight to that sprint.
  const deep = params.get('sprint')
  if (deep) return <Navigate to={`/sprints/${deep}`} replace state={{ write: true }} />
  if (!me) return null
  if (me.workspaces.length === 0) return <Welcome />
  if (!data) return <Waiting ws={ws} />

  const dest = pickDestination(collectingHere, readPrefs().lastSprint)
  const live = upcomingHere.find((s) => s.status === 'live')
  const closed = upcomingHere.find((s) => s.status === 'preparing' || s.status === 'ready')
  const list = sprints?.ws === wsId ? sprints.list : null
  const draft = list?.find((s) => s.status === 'draft' && s.is_participant)
  const target = dest ?? (collectingHere.length > 1 ? null : (live ?? closed ?? draft ?? null))
  if (target) return <Navigate to={`/sprints/${target.id}`} replace state={write ? { write: true } : undefined} />
  if (needList && !sprints) return <Waiting ws={ws} />

  // ── Nothing to open by itself: say what there is.
  const lastDone = (list ?? []).find((s) => (s.status === 'completed' || s.status === 'archived') && s.is_participant)
  const commitments = (experiments ?? []).filter((e) => e.owner_account_id === me.account_id && (e.status === 'proposed' || e.status === 'accepted'))
  const several = collectingHere.length > 1
  const title = several ? <>Where should your thought <em>go</em>?</> : <>Nothing to write for <em>yet</em></>
  const body = several ? (
    <ChooseSprint sprints={collectingHere} />
  ) : (
    <div>
      <p className="max-w-prose text-ink-soft">
        {offline ? 'You’re offline, and this device hasn’t kept a sprint to write for. Muni will catch up when you reconnect.' : `When a sprint in ${ws?.name ?? 'this workspace'} opens for thoughts, you’ll write in it here.`}
      </p>
      {!offline && ws ? (
        <p className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          {lastDone ? (
            <Link to={`/sprints/${lastDone.id}`} className="inline-flex items-center gap-1 font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-accent">
              What {lastDone.name} agreed to try <ArrowRight className="size-4" aria-hidden />
            </Link>
          ) : null}
          <Link to={`/workspaces/${ws.id}`} className="text-ink-soft underline underline-offset-4 hover:text-ink">All sprints</Link>
          <Link to={`/workspaces/${ws.id}/sprints/new`} className="text-ink-soft underline underline-offset-4 hover:text-ink">Set up a sprint</Link>
        </p>
      ) : null}
    </div>
  )
  const extras = (
    <>
      <div className="mark-indent"><PendingJoins /></div>
      {local.items.length ? (
        <section className="mt-14 mark-indent" aria-labelledby="unsent">
          <h2 id="unsent" className="font-display text-lg">Not sent yet <span className="ml-1 font-normal text-ink-faint">{local.items.length}</span></h2>
          <p className="mb-2 text-sm text-ink-soft">Kept on this device.</p>
          <div className="mark-outdent"><LocalThoughtList items={local.items} moveChoices={collectingAll.map((s) => ({ workspaceId: s.workspace_id, sprintId: s.id, sprintName: s.name, encrypted: s.encryption === 'e1' }))} showDestination /></div>
        </section>
      ) : null}
      {commitments.length ? <Commitments items={commitments} me={me} /> : null}
    </>
  )
  return <Quiet ws={ws} me={me} title={title} body={body} extras={extras} tab={several ? 'Choose a sprint' : (ws?.name ?? 'This workspace')} state={several ? 'choose' : 'none'} bubble={!several} />
}

function Waiting({ ws }: { ws: Me['workspaces'][number] | null }) {
  return (
    <AppShell workspace={ws} wide>
      <div className="grid place-items-center py-24 text-ink-soft"><Spinner /></div>
    </AppShell>
  )
}

/** A page with no sprint of its own: the journal's scene (or the person's room) with one heading. */
function Quiet({ ws, me, title, body, extras, tab, state, bubble }: { ws: Me['workspaces'][number] | null; me: Me; title: ReactNode; body: ReactNode; extras?: ReactNode; tab: string; state: 'choose' | 'none'; bubble?: boolean }) {
  const { world } = useWorld()
  if (world)
    return (
      <AppShell workspace={ws} wide>
        <Room world={world} mode="state" context={<SprintTab s={null} state={state} title={tab} me={me} />} writing={<StateWriter title={title}>{body}</StateWriter>} collection={null} extras={extras} />
      </AppShell>
    )
  return (
    <AppShell workspace={ws} wide>
      <JournalScene bubble={bubble}>
        <p className="text-sm text-ink-soft">{tab}</p>
        <h1 className="journal-title mt-2">{title}</h1>
      </JournalScene>
      <div className="mt-4 max-w-3xl">
          {body}
        {extras}
      </div>
    </AppShell>
  )
}

/** Several sprints collecting: choose one; Muni remembers it on this device. */
function ChooseSprint({ sprints }: { sprints: Sprintish[] }) {
  const nav = useNavigate()
  return (
    <div>
      <p className="text-ink-soft">{sprints.length} sprints are collecting. Pick the one this thought belongs to; Muni remembers your choice on this device.</p>
      <ul className="passages mt-4">
        {sprints.map((s) => (
          <li key={s.id} className="border-t border-line first:border-0">
            <button
              className="flex min-h-11 w-full items-center gap-3 py-4 text-left hover:text-accent-ink"
              onClick={() => {
                writePrefs({ lastSprint: s.id })
                nav(`/sprints/${s.id}`, { state: { write: true } })
              }}
            >
              <span className="dot dot--submitted" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block font-medium [overflow-wrap:anywhere]">{s.name}</span>
                {s.retro_at ? <RetroWhen s={{ retro_at: s.retro_at, timezone: s.timezone }} icon={false} className="text-sm text-ink-soft" /> : null}
              </span>
              <ChevronRight className="size-4 text-ink-faint" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ExperimentList({ items, me }: { items: Experiment[]; me: Me }) {
  return (
    <ul className="mt-5">
      {items.map((e) => (
        <li key={e.id} className="border-t border-line py-3.5 first:border-0 first:pt-1">
          <p className="max-w-[34rem] leading-relaxed [overflow-wrap:anywhere]">{e.change_to_try}</p>
          <p className="mt-1 text-sm text-ink-soft">
            {e.status === 'proposed' && e.owner_account_id === me.account_id ? (
              <span className="font-medium text-accent-ink">You’ve been asked to own this. Accept it in the sprint’s outcomes · </span>
            ) : (
              <>
                {e.status !== 'accepted' ? `${OUTCOME_LABEL[e.status]} · ` : ''}
                {e.owner_name ? (e.owner_account_id === me.account_id ? 'You own this' : e.owner_name) : 'No owner yet'} ·{' '}
              </>
            )}
            revisit {shortDate(e.review_on)}
          </p>
        </li>
      ))}
    </ul>
  )
}

/** Experiments this person owns, until the team revisits them. */
export function Commitments({ items, me }: { items: Experiment[]; me: Me }) {
  return (
    <section className="mt-14 mark-indent" aria-labelledby="commitments">
      <h2 id="commitments" className="font-display text-lg">Your commitments</h2>
      <p className="text-sm text-ink-soft">Experiments you own, until the team revisits them.</p>
      <ExperimentList items={items} me={me} />
    </section>
  )
}

/** Requests to join a team that someone on it hasn't decided yet (made from an invite QR or link). */
function PendingJoins() {
  const { me } = useAuth()
  const list = me?.pending_join_requests ?? []
  if (!list.length) return null
  return (
    <ul className="mt-6 grid gap-2">
      {list.map((r) => (
        <li key={r.id}>
          <Link to={`/join/requests/${r.id}`} className="flex items-center gap-2 rounded-xl bg-accent-soft/60 px-3.5 py-2.5 text-sm text-ink hover:bg-accent-soft" role="status">
            <span className="dot dot--queued" aria-hidden />
            <span>Waiting for approval to join <strong className="font-medium">{r.workspace_name}</strong></span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function Welcome() {
  const { me, refresh } = useAuth()
  const { world } = useWorld()
  const nav = useNavigate()
  const [creating, setCreating] = useState(false)
  const body = (
    <>
      <PendingJoins />
      <p className="mt-2 max-w-prose text-lg text-ink-soft">If you were invited to a team, open your invite link or scan the team’s QR code. It brings you straight to your sprint.</p>
      <p className="mt-6 text-sm text-ink-soft">
        Starting a team yourself? <button className="font-medium text-ink underline underline-offset-4 hover:decoration-accent" onClick={() => setCreating(true)}>Create a workspace</button>
      </p>
    </>
  )
  return (
    <AppShell workspace={null} wide>
      {world && me ? (
        <Room world={world} mode="state" context={<SprintTab s={null} state="none" title="No team yet" me={me} />} writing={<StateWriter title="Welcome to Muni">{body}</StateWriter>} collection={null} />
      ) : (
        <>
          <JournalScene bubble>
            <p className="text-sm text-ink-soft">A moment to reflect</p>
            <h1 className="journal-title mt-2">Welcome to <em>Muni</em></h1>
          </JournalScene>
          <div className="mt-4 max-w-2xl">
                  {body}
          </div>
        </>
      )}
      <NewWorkspaceDialog open={creating} onClose={() => setCreating(false)} onCreated={async (w: Workspace) => { setCreating(false); await refresh(); chooseWorkspace(w.id); nav(`/workspaces/${w.id}`) }} />
    </AppShell>
  )
}
