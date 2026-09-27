import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { ArrowRight, ChevronRight, Compass, Radio } from 'lucide-react'
import { get } from '@/api/client'
import type { CaptureTarget, Experiment, Me, SprintSummary, Workspace } from '@/api/types'
import { useAuth } from '@/lib/auth'
import { OUTCOME_LABEL } from '@/lib/categories'
import { pickDestination } from '@/lib/destination'
import { isComposerDirty } from '@/lib/dirty'
import { useLocal, type Destination } from '@/lib/local/LocalProvider'
import type { ContextSprint } from '@/lib/local/store'
import { readPrefs, writePrefs } from '@/lib/prefs'
import { shortDate } from '@/lib/schedule'
import { chooseWorkspace, useCurrentWorkspace } from '@/lib/workspace'
import { Button, Spinner, useDocumentTitle } from '@/ui'
import { Composer, LocalThoughtList, MyThoughts } from '@/ui/capture'
import { NewWorkspaceDialog } from '@/ui/menus'
import { AppShell } from '@/ui/shell'
import { JournalScene } from '@/ui/journal'
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

  const [collected, setCollected] = useState<number | null>(null)
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
    <p className="mb-5 flex items-start gap-2 rounded-xl bg-ink/5 px-3.5 py-2.5 text-sm text-ink-soft" role="status">
      <span className="dot dot--queued mt-1.5" aria-hidden />
      <span>
        You’re offline. {composerFor ? `Thoughts you save wait on this device${local.kind === 'memory' ? ' (in this tab)' : ''} and are sent when Muni reconnects.` : 'Muni will catch up when you reconnect.'}
        {data.cached.length && !data.capture ? <span className="text-ink-faint"> Sprint details from {new Date(Math.max(...data.cached.map((c) => c.fetchedAt))).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}.</span> : null}
      </span>
    </p>
  ) : null
  const extras = (
    <>
      <div className="xl:pl-[7.5rem]"><PendingJoins /></div>
      {unsentElsewhere.length ? (
        <section className="mt-14 xl:pl-[7.5rem]" aria-labelledby="unsent">
          <h2 id="unsent" className="font-display text-lg">Not sent yet <span className="ml-1 font-normal text-ink-faint">{unsentElsewhere.length}</span></h2>
          <p className="mb-2 text-sm text-ink-soft">Kept on this device for other sprints.</p>
          <div className="xl:-ml-[7.5rem]"><LocalThoughtList items={unsentElsewhere} moveChoices={moveChoices} showDestination /></div>
        </section>
      ) : null}
      {myCommitments.length ? <Commitments items={myCommitments} me={me} /> : null}
    </>
  )

  // ── Collecting: one scene — the heading on the horizon, writing and the collection beneath it.
  if (composerFor) {
    const empty = collected === 0
    return (
      <AppShell workspace={ws} wide>
        <JournalScene bubble={empty} respond>
          <Context s={composerFor} status={dest ? 'collecting' : 'closed-now'} elsewhere={elsewhere} me={me} several={collectingHere.length > 1} chosen={!!dest} />
          <h1 className="journal-title mt-3">
            <label htmlFor="thought-field">What’s worth <em>remembering</em>?</label>
          </h1>
        </JournalScene>
        <div className="journal-body" data-empty={empty || undefined}>
          <div className="home-compose min-w-0 self-start">
            {offlineNote}
            {live ? <LiveBanner s={live} /> : null}
            {composerFor.encryption === 'e1' ? <div className="mb-4"><DeviceKeyNotice need="write" /></div> : null}
            <Composer
              key={`${composerFor.id}:${local.cleared}`}
              fieldId="thought-field"
              dest={dest ? toDest(dest) : null}
              choices={choices}
              onChoose={choose}
              closed={!dest ? <>This sprint stopped collecting. Your text is still here — copy it{choices.length ? ', or choose another sprint' : ''}.</> : undefined}
            />
          </div>
          <div className="min-w-0 pt-1">
            <MyThoughts sprintId={composerFor.id} editable={!!dest && !offline} moveChoices={moveChoices} online={!offline} onCount={setCollected} />
            {extras}
          </div>
        </div>
      </AppShell>
    )
  }

  // ── Everything else: the same scene with the state as its heading, then one readable column.
  const scene = (kicker: ReactNode, title: ReactNode, opts: { lights?: number; bubble?: boolean } = {}) => (
    <JournalScene lights={opts.lights} bubble={opts.bubble}>
      <p className="text-sm text-ink-soft">{kicker}</p>
      <h1 className="journal-title mt-2">{title}</h1>
    </JournalScene>
  )
  const sprintLink = (s: Sprintish) => <Link to={`/sprints/${s.id}`} className="font-medium text-ink [overflow-wrap:anywhere] hover:underline">{s.name}</Link>
  let head: ReactNode
  let body: ReactNode
  if (collectingHere.length > 1) {
    head = scene(<>{collectingHere.length} sprints are collecting</>, <>Where should your thought <em>go</em>?</>)
    body = <ChooseDestination sprints={collectingHere} onChoose={(s) => choose(toDest(s))} />
  } else if (live) {
    head = scene(<>{sprintLink(live)} · retro live</>, <>The retro is <em>happening</em> now</>)
    body = (
      <State body="Collection is closed. Follow the conversation and take part from this device." action={<Link to={`/sprints/${live.id}/room`}><Button variant="primary">Join the retro <ArrowRight className="size-4" /></Button></Link>}>
        <MyThoughts className="mt-12" sprintId={live.id} editable={false} moveChoices={moveChoices} online={!offline} />
      </State>
    )
  } else if (closed) {
    head = scene(<>{sprintLink(closed)} · <RetroWhen s={closed as { retro_at: string; timezone: string }} icon={false} /></>, <>Collection is <em>closed</em></>)
    body = (
      <State body={closed.status === 'ready' ? 'Thoughts are read-only now. The retro starts when the facilitator begins it.' : 'Thoughts are read-only now while the facilitator prepares the discussion.'} action={<Link to={`/sprints/${closed.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-accent-ink hover:underline">Sprint guide <ArrowRight className="size-4" /></Link>}>
        <MyThoughts className="mt-12" sprintId={closed.id} editable={false} moveChoices={moveChoices} online={!offline} />
      </State>
    )
  } else if (recentDone) {
    head = scene(<>{sprintLink(recentDone)} · retro complete</>, <>What we’re <em>taking with us</em></>, { lights: 4 })
    body = (
      <State body="The last retro is done. Here’s what the team agreed to try." action={<Link to={`/sprints/${recentDone.id}/outcomes`}><Button>Outcomes and recap</Button></Link>}>
        <ExperimentList items={(data.experiments ?? []).filter((e) => e.sprint_id === recentDone.id && e.status !== 'proposed')} me={me} empty="No experiments were agreed in this retro — sometimes the conversation is the outcome." />
      </State>
    )
  } else {
    head = scene(<>{ws?.name}</>, <>Nothing to write for <em>yet</em></>, { bubble: true })
    body = (
      <div>
        <p className="max-w-prose text-ink-soft">When a sprint in {ws?.name ?? 'this workspace'} opens for thoughts, you’ll write them here.</p>
        {!offline && ws ? (
          <p className="mt-4 text-sm">
            <Link to={`/workspaces/${ws.id}/sprints/new`} className="text-ink-soft underline underline-offset-4 hover:text-ink">Set up a sprint</Link>
          </p>
        ) : null}
      </div>
    )
  }
  return (
    <AppShell workspace={ws} wide>
      {head}
      <div className="mt-4 max-w-3xl">
        {offlineNote}
        {body}
        {extras}
      </div>
    </AppShell>
  )
}

/** Where you are, in two quiet lines: the sprint, then its status and the retro time. */
function Context({ s, status, elsewhere, me, several, chosen }: { s: Sprintish; status: 'collecting' | 'closed-now'; elsewhere: SprintSummary[]; me: Me; several: boolean; chosen: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 text-sm text-ink-soft">
      <p className="min-w-0">
        {several && !chosen ? <span className="text-ink">Choose a sprint to write for</span> : <Link to={`/sprints/${s.id}`} className="font-medium text-ink [overflow-wrap:anywhere] hover:underline">{s.name}</Link>}
      </p>
      <p className="min-w-0 [&>*]:align-baseline">
        {status === 'collecting' ? (
          <span className="text-accent-ink"><span className="dot dot--submitted mr-1.5" style={{ width: 7, height: 7 }} aria-hidden />Collecting</span>
        ) : (
          <span className="font-medium text-warn"><span className="dot dot--attention mr-1.5" style={{ width: 7, height: 7 }} aria-hidden />Collection just closed</span>
        )}
        {s.retro_at && !(several && !chosen) ? (
          <>
            <span aria-hidden className="mx-1.5 text-ink-faint">·</span>
            <RetroWhen s={{ retro_at: s.retro_at, timezone: s.timezone }} icon={false} prefix="retro" className="!inline" />
          </>
        ) : null}
        {s.is_facilitator ? (
          <>
            <span aria-hidden className="mx-1.5 text-ink-faint">·</span>
            <Link to={`/sprints/${s.id}`} className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-accent-ink hover:underline">
              <Compass className="size-3.5" aria-hidden /> Sprint guide
            </Link>
          </>
        ) : null}
      </p>
      {elsewhere.length ? (
        <p className="mt-1">
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
    <Link to={`/sprints/${s.id}/room`} className="mb-5 flex items-center gap-3 rounded-xl bg-accent-soft/70 px-4 py-3 text-sm hover:bg-accent-soft">
      <Radio className="size-4 shrink-0 text-accent-ink" aria-hidden />
      <span className="min-w-0 flex-1"><span className="font-medium [overflow-wrap:anywhere]">The {s.name} retro is live.</span> Join from this device.</span>
      <ArrowRight className="size-4 shrink-0 text-accent-ink" aria-hidden />
    </Link>
  )
}

function State({ body, action, children }: { body: ReactNode; action?: ReactNode; children?: ReactNode }) {
  return (
    <div>
      <p className="max-w-prose text-ink-soft">{body}</p>
      {action ? <div className="mt-5">{action}</div> : null}
      {children}
    </div>
  )
}

function ChooseDestination({ sprints, onChoose }: { sprints: Sprintish[]; onChoose: (s: Sprintish) => void }) {
  return (
    <div>
      <p className="text-ink-soft">Pick the sprint it belongs to. Muni remembers your choice on this device.</p>
      <ul className="passages mt-4">
        {sprints.map((s) => (
          <li key={s.id} className="border-t border-line first:border-0">
            <button className="flex w-full items-center gap-3 py-4 text-left hover:text-accent-ink" onClick={() => onChoose(s)}>
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
    <ul className="mt-5">
      {items.map((e) => (
        <li key={e.id} className="border-t border-line py-3.5 first:border-0 first:pt-1">
          <p className="max-w-[34rem] leading-relaxed [overflow-wrap:anywhere]">{e.change_to_try}</p>
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
    <section className="mt-14 xl:pl-[7.5rem]" aria-labelledby="commitments">
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
  const { refresh } = useAuth()
  const nav = useNavigate()
  const [creating, setCreating] = useState(false)
  return (
    <AppShell workspace={null} wide>
      <JournalScene bubble>
        <p className="text-sm text-ink-soft">A moment to reflect</p>
        <h1 className="journal-title mt-2">Welcome to <em>Muni</em></h1>
      </JournalScene>
      <div className="mt-4 max-w-2xl">
        <PendingJoins />
        <p className="mt-6 max-w-prose text-lg text-ink-soft">If you were invited to a team, open your invite link or scan the team’s QR code — it brings you straight to your sprint.</p>
        <p className="mt-6 text-sm text-ink-soft">
          Starting a team yourself? <button className="font-medium text-ink underline underline-offset-4 hover:decoration-accent" onClick={() => setCreating(true)}>Create a workspace</button>
        </p>
      </div>
      <NewWorkspaceDialog open={creating} onClose={() => setCreating(false)} onCreated={async (w: Workspace) => { setCreating(false); await refresh(); chooseWorkspace(w.id); nav(`/workspaces/${w.id}`) }} />
    </AppShell>
  )
}
