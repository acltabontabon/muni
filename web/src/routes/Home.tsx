import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { ArrowRight, ChevronRight, Radio } from 'lucide-react'
import { get } from '@/api/client'
import type { CaptureTarget, Experiment, Me, SprintSummary, Workspace } from '@/api/types'
import { useAuth } from '@/lib/auth'
import { OUTCOME_LABEL } from '@/lib/categories'
import { pickDestination } from '@/lib/destination'
import { isComposerDirty } from '@/lib/dirty'
import { STATUS_PHRASE } from '@/lib/lifecycle'
import { useLocal, type Destination } from '@/lib/local/LocalProvider'
import type { ContextSprint } from '@/lib/local/store'
import { readPrefs, writePrefs } from '@/lib/prefs'
import { shortDate } from '@/lib/schedule'
import { chooseWorkspace, useCurrentWorkspace } from '@/lib/workspace'
import { Button, Spinner, useDocumentTitle } from '@/ui'
import { Composer, LocalThoughtList, MyThoughts } from '@/ui/capture'
import { NewWorkspaceDialog } from '@/ui/menus'
import { AppShell } from '@/ui/shell'
import { Postcard } from '@/ui/art'
import { RetroWhen } from '@/ui/when'
import { DeviceKeyNotice } from '@/ui/keys'

type Sprintish = Pick<SprintSummary, 'id' | 'workspace_id' | 'name' | 'status' | 'retro_local' | 'timezone'> & Partial<SprintSummary>
type Loaded = { capture: CaptureTarget | null; sprints: SprintSummary[] | null; experiments: Experiment[] | null; cached: { sprint: ContextSprint; workspaceName: string | null; fetchedAt: number }[]; offline: boolean }

const toDest = (s: Sprintish): Destination => ({ workspaceId: s.workspace_id, sprintId: s.id, sprintName: s.name, encrypted: s.encryption === 'e1' })

/**
 * The participant's home: where you are (workspace, sprint, its status and retro time), one place
 * to write, and your thoughts. It adapts to where the sprint is — collecting, closed, live, done —
 * without ever navigating away from text you're still writing.
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

  const dest = pickDestination(collectingHere, chosen)
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
  const offlineNote = offline ? (
    <p className="mb-5 flex items-start gap-2 rounded-2xl bg-ink/5 px-3.5 py-2.5 text-sm text-ink-soft" role="status">
      <span className="dot dot--queued mt-1.5" aria-hidden />
      <span>
        You’re offline. {composerFor ? `Thoughts you save wait on this device${local.kind === 'memory' ? ' (in this tab)' : ''} and are sent when Muni reconnects.` : 'Muni will catch up when you reconnect.'}
        {data.cached.length && !data.capture ? <span className="text-ink-faint"> Sprint details from {new Date(Math.max(...data.cached.map((c) => c.fetchedAt))).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}.</span> : null}
      </span>
    </p>
  ) : null
  const extras = (
    <>
      {unsentElsewhere.length ? (
        <section className="mt-12" aria-labelledby="unsent">
          <h2 id="unsent" className="font-display text-lg">Not sent yet <span className="ml-1 text-sm font-normal text-ink-faint">{unsentElsewhere.length}</span></h2>
          <p className="mb-5 text-sm text-ink-soft">Kept on this device for other sprints.</p>
          <LocalThoughtList items={unsentElsewhere} moveChoices={moveChoices} showDestination />
        </section>
      ) : null}
      {myCommitments.length ? <Commitments items={myCommitments} me={me} /> : null}
    </>
  )

  // ── Collecting: the composer and the collection side by side when there's room.
  if (composerFor)
    return (
      <AppShell workspace={ws} wide>
        {offlineNote}
        {live ? <LiveBanner s={live} /> : null}
        <Context ws={ws} s={composerFor} status={dest ? 'collecting' : 'closed-now'} elsewhere={elsewhere} me={me} several={collectingHere.length > 1} />
        <div className="grid gap-12 lg:grid-cols-[minmax(0,29rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,34rem)_minmax(0,1fr)] xl:gap-14">
          <div className="home-compose min-w-0 space-y-4 self-start">
            {composerFor.encryption === 'e1' ? <DeviceKeyNotice need="write" /> : null}
            <Composer
              key={`${composerFor.id}:${local.cleared}`}
              dest={dest ? toDest(dest) : null}
              choices={choices}
              onChoose={choose}
              closed={!dest ? <>This sprint stopped collecting. Your text is still here — copy it{choices.length ? ', or choose another sprint above' : ''}.</> : undefined}
            />
            {composerFor.is_facilitator ? (
              <div className="fac-area flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
                <span className="eyebrow">Facilitator</span>
                <span className="min-w-0 flex-1 text-ink-soft">You’re facilitating this sprint. Close collection from its guide when the sprint wraps up.</span>
                <Link to={`/sprints/${composerFor.id}`} className="inline-flex items-center gap-1 font-medium text-accent-ink hover:underline">Sprint guide <ArrowRight className="size-4" aria-hidden /></Link>
              </div>
            ) : null}
          </div>
          <div className="min-w-0">
            <MyThoughts sprintId={composerFor.id} editable={!!dest && !offline} moveChoices={moveChoices} online={!offline} />
            {extras}
          </div>
        </div>
      </AppShell>
    )

  // ── Everything else: one readable column, the current state first.
  return (
    <AppShell workspace={ws}>
      <div className="mx-auto max-w-3xl">
        {offlineNote}
        {collectingHere.length > 1 ? (
          <ChooseDestination ws={ws} sprints={collectingHere} onChoose={(s) => choose(toDest(s))} />
        ) : live ? (
          <State s={live} ws={ws} kicker="Retro live" title={<>The retro is <em>happening</em> now</>} body="Collection is closed. Follow the conversation and take part from this device." action={<Link to={`/sprints/${live.id}/room`}><Button variant="primary">Join the retro <ArrowRight className="size-4" /></Button></Link>}>
            <MyThoughts className="mt-12" sprintId={live.id} editable={false} moveChoices={moveChoices} online={!offline} />
          </State>
        ) : closed ? (
          <State s={closed} ws={ws} kicker={STATUS_PHRASE[closed.status]} title="Collection is closed" body={closed.status === 'ready' ? 'Thoughts are read-only. The retro starts when the facilitator begins it.' : 'Thoughts are read-only while the facilitator prepares the discussion.'} action={<Link to={`/sprints/${closed.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-accent-ink hover:underline">Sprint guide <ArrowRight className="size-4" /></Link>}>
            <MyThoughts className="mt-12" sprintId={closed.id} editable={false} moveChoices={moveChoices} online={!offline} />
          </State>
        ) : recentDone ? (
          <State s={recentDone} ws={ws} kicker="Retro complete" title={<>What we’re <em>taking with us</em></>} body="The last retro is done. Here’s what the team agreed to try." action={<Link to={`/sprints/${recentDone.id}/outcomes`}><Button>Outcomes and recap</Button></Link>} art={<Postcard framing="wide" lights={4} className="aspect-[2.1/1] w-full" />}>
            <ExperimentList items={(data.experiments ?? []).filter((e) => e.sprint_id === recentDone.id && e.status !== 'proposed')} me={me} empty="No experiments were agreed in this retro — sometimes the conversation is the outcome." />
          </State>
        ) : (
          <div className="pt-2">
            <Postcard framing="wide" className="aspect-[2.1/1] w-full" />
            <p className="mt-6 text-sm text-ink-soft">{ws?.name}</p>
            <h1 className="font-display mt-1 text-2xl leading-tight sm:text-[28px]">Nothing to write for <em>yet</em></h1>
            <p className="mt-2 max-w-prose text-ink-soft">When a sprint in {ws?.name ?? 'this workspace'} opens for thoughts, you’ll write them here.</p>
            {!offline && ws ? (
              <p className="mt-4 text-sm">
                <Link to={`/workspaces/${ws.id}/sprints/new`} className="text-ink-soft underline underline-offset-4 hover:text-ink">Set up a sprint</Link>
              </p>
            ) : null}
          </div>
        )}
        {extras}
      </div>
    </AppShell>
  )
}

/** Where you are: status, workspace › sprint, and the retro time. */
function Context({ ws, s, status, elsewhere, me, several }: { ws: Me['workspaces'][number] | null; s: Sprintish; status: 'collecting' | 'closed-now'; elsewhere: SprintSummary[]; me: Me; several: boolean }) {
  return (
    <div className="mb-7 flex flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        {status === 'collecting' ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-0.5 text-[13px] font-medium text-accent-ink"><span className="dot dot--submitted" aria-hidden /> Collecting</span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-warn/12 px-2.5 py-0.5 text-[13px] font-medium text-warn"><span className="dot dot--attention" aria-hidden /> Collection closed</span>
        )}
        <Link to="/privacy#encryption" className="rounded-full px-2 py-0.5 text-[12px] text-ink-soft shadow-[0_0_0_1px_var(--line)] hover:text-ink" title={s.encryption === 'e1' ? 'Content is encrypted on participants’ devices' : 'Set up before encryption: stored readable to Muni’s servers'}>
          {s.encryption === 'e1' ? 'Encrypted' : 'Not encrypted'}
        </Link>
        <nav aria-label="You are here" className="min-w-0 text-ink-soft">
          {ws ? <Link to={`/workspaces/${ws.id}`} className="hover:text-ink hover:underline">{ws.name}</Link> : null}
          <span aria-hidden className="mx-1.5 text-ink-faint">/</span>
          {several ? <span className="text-ink">{status === 'collecting' ? 'choose a sprint below' : s.name}</span> : <Link to={`/sprints/${s.id}`} className="font-medium text-ink [overflow-wrap:anywhere] hover:underline">{s.name}</Link>}
        </nav>
      </div>
      {s.retro_at && !several ? <RetroWhen s={{ retro_at: s.retro_at, timezone: s.timezone }} className="text-sm text-ink-soft" /> : null}
      {elsewhere.length ? (
        <p className="text-sm text-ink-soft">
          Also collecting:{' '}
          {elsewhere.map((o, i) => (
            <span key={o.id}>
              {i ? ', ' : ''}
              <button className="font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-accent" onClick={() => { chooseWorkspace(o.workspace_id); writePrefs({ lastSprint: o.id }) }}>
                {o.name}
              </button>{' '}
              <span className="text-ink-faint">in {me.workspaces.find((w) => w.id === o.workspace_id)?.name}</span>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  )
}

function LiveBanner({ s }: { s: Sprintish }) {
  return (
    <Link to={`/sprints/${s.id}/room`} className="fac-area mb-6 flex items-center gap-4 p-4 hover:brightness-[0.98]">
      <Radio className="size-5 shrink-0 text-accent" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-medium [overflow-wrap:anywhere]">The {s.name} retro is live</div>
        <div className="text-sm text-ink-soft">Join from this device</div>
      </div>
      <span className="inline-flex items-center gap-1 text-sm font-medium text-accent-ink">Join <ArrowRight className="size-4" /></span>
    </Link>
  )
}

function State({ s, ws, title, kicker, body, action, children, art }: { s: Sprintish; ws: Me['workspaces'][number] | null; title: ReactNode; kicker: string; body: ReactNode; action?: ReactNode; children?: ReactNode; art?: ReactNode }) {
  return (
    <div>
      {art ? <div className="mb-7">{art}</div> : null}
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-ink-soft">
        <span className="font-medium text-accent-ink">{kicker}</span>
        <span aria-hidden className="text-ink-faint">·</span>
        {ws ? <Link to={`/workspaces/${ws.id}`} className="hover:text-ink hover:underline">{ws.name}</Link> : null}
        <span aria-hidden className="text-ink-faint">/</span>
        <Link to={`/sprints/${s.id}`} className="text-ink [overflow-wrap:anywhere] hover:underline">{s.name}</Link>
      </p>
      <h1 className="font-display mt-2 text-2xl leading-tight [overflow-wrap:anywhere] sm:text-[30px]">{title}</h1>
      <p className="mt-2 max-w-prose text-ink-soft">{body}</p>
      {s.retro_at && s.status !== 'completed' ? <RetroWhen s={{ retro_at: s.retro_at, timezone: s.timezone }} className="mt-2 text-sm text-ink-soft" /> : null}
      {action ? <div className="mt-5">{action}</div> : null}
      {children}
    </div>
  )
}

function ChooseDestination({ ws, sprints, onChoose }: { ws: Me['workspaces'][number] | null; sprints: Sprintish[]; onChoose: (s: Sprintish) => void }) {
  return (
    <div>
      <p className="text-sm text-ink-soft">{ws?.name} · {sprints.length} sprints are collecting</p>
      <h1 className="font-display mt-1 text-2xl leading-tight sm:text-[30px]">Where should your thought <em>go</em>?</h1>
      <p className="mt-2 text-ink-soft">Pick the sprint it belongs to. Muni remembers your choice on this device.</p>
      <ul className="mt-6 space-y-2">
        {sprints.map((s) => (
          <li key={s.id}>
            <button className="card flex w-full items-center gap-3 rounded-2xl p-4 text-left hover:border-ink/30" onClick={() => onChoose(s)}>
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

function ExperimentList({ items, me, empty }: { items: Experiment[]; me: Me; empty?: string }) {
  if (!items.length) return empty ? <p className="mt-6 text-sm text-ink-soft">{empty}</p> : null
  return (
    <ul className="mt-6 divide-y divide-line rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)]">
      {items.map((e) => (
        <li key={e.id} className="p-4">
          <p className="font-medium [overflow-wrap:anywhere]">{e.change_to_try}</p>
          <p className="mt-1 text-sm text-ink-soft">
            {e.status === 'proposed' && e.owner_account_id === me.account_id ? (
              <span className="font-medium text-accent-ink">You’ve been asked to own this — accept it in the outcomes · </span>
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

function Commitments({ items, me }: { items: Experiment[]; me: Me }) {
  return (
    <section className="mt-12" aria-labelledby="commitments">
      <h2 id="commitments" className="font-display text-lg">Your commitments</h2>
      <p className="text-sm text-ink-soft">Experiments you own, until the team revisits them.</p>
      <ExperimentList items={items} me={me} />
    </section>
  )
}

function Welcome() {
  const { refresh } = useAuth()
  const nav = useNavigate()
  const [creating, setCreating] = useState(false)
  return (
    <AppShell workspace={null}>
      <div className="mx-auto max-w-2xl pt-2">
        <Postcard framing="wide" className="aspect-[2.1/1] w-full" />
        <h1 className="font-display mt-8 text-3xl">Welcome to <em>Muni</em></h1>
        <p className="mt-3 max-w-prose text-lg text-ink-soft">If you were invited to a team, open the link in your invitation email — it brings you straight to your sprint.</p>
        <p className="mt-6 text-sm text-ink-soft">
          Starting a team yourself? <button className="font-medium text-ink underline underline-offset-4 hover:decoration-accent" onClick={() => setCreating(true)}>Create a workspace</button>
        </p>
      </div>
      <NewWorkspaceDialog open={creating} onClose={() => setCreating(false)} onCreated={async (w: Workspace) => { setCreating(false); await refresh(); chooseWorkspace(w.id); nav(`/workspaces/${w.id}`) }} />
    </AppShell>
  )
}
