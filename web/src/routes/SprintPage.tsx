/**
 * A sprint's one home, for every stage and everyone in it. The sprint bar at the top (ui/sprint-bar)
 * says where the sprint is and holds the facilitator's next change; below it, the page is what
 * this person does now:
 *
 *   Not open yet  a quiet note, until the facilitator opens collection
 *   Collecting    the writer (Muni's journal, or the person's character room) and their thoughts
 *   Closed        everyone's thoughts, revealed without names, to read before the retro
 *   Retro         the way into the live retro
 *   Done          the outcomes: what the team agreed to try, and the recap
 *
 * "Write" and the home page are shortcuts to this page for the sprint that's collecting. Writing
 * lives in a WritingHost above the drawing, so a change of character, a sprint closing mid-sentence
 * or an offline moment never takes the words with it.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { ApiError, get } from '@/api/client'
import type { CaptureTarget, Experiment, SprintDetail, SprintKeyView } from '@/api/types'
import { useAuth } from '@/lib/auth'
import { isComposerDirty } from '@/lib/dirty'
import { PHASE_OF, sprintPlan } from '@/lib/lifecycle'
import { useLive } from '@/lib/live'
import { useLocal, type Destination } from '@/lib/local/LocalProvider'
import type { ContextSprint } from '@/lib/local/store'
import { readPrefs, writePrefs } from '@/lib/prefs'
import { useResource, useResources } from '@/lib/resource'
import { chooseWorkspace } from '@/lib/workspace'
import { keyring } from '@/lib/e2ee/keyring'
import { fingerprint, fromB64u } from '@/lib/e2ee/crypto'
import { useDeviceKeys } from '@/lib/e2ee/E2eeProvider'
import { Button, Spinner, useDocumentTitle } from '@/ui'
import { Composer, LocalThoughtList, MyThoughts, useWriting, WritingHost } from '@/ui/capture'
import { InviteDialog } from '@/ui/invite-email'
import { JournalScene } from '@/ui/journal'
import { DeviceKeyNotice, EncryptionLine } from '@/ui/keys'
import { AppShell } from '@/ui/shell'
import { SprintBar, useSprintControl, type BarSprint } from '@/ui/sprint-bar'
import { RetroWhen } from '@/ui/when'
import { RoomEmpty, StateWriter, Writer } from '@/worlds/room'
import { Room } from '@/worlds/rooms'
import { useWorld } from '@/worlds/world'
import { lazyPart, Loading } from '@/ui/lazy'
import { TeamThoughts } from '@/ui/team-thoughts'
import { Commitments } from './Home'
import { useGuidePage } from '@/guide/GuideProvider'
import { FirstEveningClosing } from '@/guide/Sky'

// A finished sprint's recap loads when one is opened; writing and the retro don't wait for it.
const OutcomesView = lazyPart(() => import('./Outcomes'), (m) => m.OutcomesView)

type Cached = { sprint: ContextSprint; workspaceName: string | null; fetchedAt: number }
const toDest = (s: { id: string; workspace_id: string; name: string; encryption?: 'e1' | null }): Destination => ({ workspaceId: s.workspace_id, sprintId: s.id, sprintName: s.name, encrypted: s.encryption === 'e1' })

export function SprintPage() {
  const { sprintId = '' } = useParams()
  // Another sprint is another page: nothing on screen — its state, its destination for new words,
  // whether it's encrypted — carries over from the one before.
  return <SprintView key={sprintId} sprintId={sprintId} />
}

function SprintView({ sprintId }: { sprintId: string }) {
  const nav = useNavigate()
  const location = useLocation()
  const { me, offline: authOffline } = useAuth()
  const { world } = useWorld()
  const local = useLocal()
  const resources = useResources()
  const [s, setS] = useState<SprintDetail | null>(null)
  const [cached, setCached] = useState<Cached | null>(null)
  const [error, setError] = useState('')
  // Collection closed while there were words in the writer: the writer stays, with the words.
  const [kept, setKept] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [inviting, setInviting] = useState(false)
  const [collected, setCollected] = useState<number | null>(null)
  const [agreed, setAgreed] = useState<number | undefined>(undefined)
  const status = useRef<string | null>(null)

  // The store object changes with every queue update; read it through a ref so loading is stable.
  const localRef = useRef(local)
  useEffect(() => {
    localRef.current = local
  }, [local])

  // Reads overlap (unlocking, the room's hints, a change made here): only the newest one's answer is shown.
  const seq = useRef(0)
  const loadedAt = useRef(0)
  const load = useCallback(async () => {
    const my = ++seq.current
    try {
      const d = await get<SprintDetail>(`/api/sprints/${sprintId}`)
      if (my !== seq.current) return
      loadedAt.current = Date.now()
      if (status.current === 'collecting' && d.status !== 'collecting' && isComposerDirty()) setKept(true)
      status.current = d.status
      setS(d)
      setCached(null)
      setError('')
      // Opening a sprint means being in its workspace; a collecting sprint is where "Write" goes next.
      if (readPrefs().lastWorkspace !== d.workspace_id) chooseWorkspace(d.workspace_id)
      if (d.status === 'collecting' && d.is_participant) {
        writePrefs({ lastSprint: d.id })
        localRef.current.cacheContext({ id: d.id, workspace_id: d.workspace_id, name: d.name, status: d.status, retro_local: d.retro_local, timezone: d.timezone }, d.workspace_name).catch(() => {})
      }
    } catch (err) {
      if (my !== seq.current) return
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) return setError('This sprint doesn’t exist, or you’re not in its workspace.')
      // Anything else (no connection, a hiccup, a session to renew): keep what's on screen, and
      // the words being written with it. With nothing shown yet, what this device kept, if anything.
      if (status.current) return
      const network = !(err instanceof ApiError) || err.status === 0
      const c = network ? (await localRef.current.cachedContexts().catch(() => [])).find((x) => x.sprint.id === sprintId) : undefined
      if (c) setCached(c)
      else setError(network ? 'You’re offline, and this device hasn’t kept anything for this sprint.' : err instanceof ApiError ? err.message : 'Couldn’t load this sprint.')
    }
  }, [sprintId])

  // Read again when this device unlocks or locks (what can be shown changed), and when the
  // connection returns. Coming back to the tab is the room's to say (its "all", below): once.
  const { keysEpoch, state: keys, changes } = useDeviceKeys()
  // A plaintext sprint reads the same whatever this device's keys do: only an encrypted one (or one
  // not known yet) is read again when they change.
  const encrypted = useRef<boolean | null>(null)
  encrypted.current = s ? s.encryption === 'e1' : null
  const first = useRef(true)
  useEffect(() => {
    if (!first.current && encrypted.current === false) return
    first.current = false
    load()
  }, [load, keys.kind, keysEpoch])
  useEffect(() => {
    window.addEventListener('online', load)
    return () => window.removeEventListener('online', load)
  }, [load])
  // Every open tab and every participant follows the sprint's state as it changes.
  useLive(
    sprintId,
    (r) => {
      // The socket's first "all" on opening follows the page's own first read: once is enough.
      if (r === 'sprint' || (r === 'all' && Date.now() - loadedAt.current > 2000)) load()
      if (r === 'commitments' || r === 'all' || r === 'sprint') setRefresh((n) => n + 1)
    },
    () => nav('/'),
  )

  // Share this device's keys with anyone in the sprint who should have them and doesn't (never a
  // still-sealed version, except to the facilitator), then show the facilitator who still can't read.
  const [access, setAccess] = useState<SprintKeyView | null>(null)
  useEffect(() => {
    if (s?.encryption !== 'e1' || keys.kind !== 'ready') return
    let live = true
    keyring.shareMissing(sprintId).then(() => keyring.sprint(sprintId, true)).then((k) => live && setAccess(k?.view ?? null)).catch(() => {})
    return () => {
      live = false
    }
  }, [s?.encryption, s?.status, keys.kind, sprintId])

  const offline = authOffline || (!s && !!cached)
  const control = useSprintControl(
    { id: sprintId, status: s?.status, encryption: s?.encryption },
    {
      online: !offline,
      onChanged: (d) => {
        // What the change answered with is newer than any read still on its way.
        seq.current++
        status.current = d.status
        setS(d)
        resources.invalidate('/api/me/capture-target')
      },
      onInvite: () => setInviting(true),
    },
  )

  // Other collecting sprints: a draft can move to one in this workspace; others are a link away.
  const capture = useResource<CaptureTarget>(!offline ? '/api/me/capture-target' : null, { focus: true })
  const wsId = s?.workspace_id ?? cached?.sprint.workspace_id ?? null
  const experiments = useResource<Experiment[]>(wsId && !offline ? `/api/workspaces/${wsId}/experiments` : null)
  const choices = useMemo(() => {
    const others = (capture.data?.collecting ?? []).filter((x) => x.workspace_id === wsId && x.id !== sprintId)
    return others.length && s ? [toDest(s), ...others.map(toDest)] : []
  }, [capture.data, wsId, sprintId, s])
  const moveChoices = (capture.data?.collecting ?? []).map(toDest)

  useDocumentTitle(s?.name ?? cached?.sprint.name ?? 'Sprint')

  // "Write" (the header's shortcut) lands here with the field in reach, on any device.
  // Once, as soon as the field is there, and never taking focus from something already chosen.
  const wantsWrite = !!(location.state as { write?: boolean } | null)?.write
  const focused = useRef(false)
  useEffect(() => {
    if (!wantsWrite || focused.current) return
    const el = document.querySelector<HTMLTextAreaElement>('textarea[name="thought"]')
    if (!el) return
    focused.current = true
    if (document.activeElement && document.activeElement !== document.body && document.activeElement !== el) return
    el.scrollIntoView({ block: 'center' })
    el.focus({ preventScroll: true })
  })

  // The first evening: what this page knows, for the guide to point at the next real control.
  const pending = local.items.some((i) => i.sprintId === sprintId)
  useGuidePage(
    s && !error
      ? {
          at: 'sprint',
          workspaceId: s.workspace_id,
          phase: PHASE_OF[s.status] ?? 'draft',
          fac: s.is_facilitator,
          participant: s.is_participant,
          people: s.participants.length,
          wrote: collected === null ? (pending ? true : null) : collected > 0 || pending,
          themes: s.theme_count ?? 0,
          can: { open: s.allowed_transitions.includes('collecting'), close: s.allowed_transitions.includes('preparing'), start: s.allowed_transitions.includes('live') },
          endsOn: s.ends_on,
          retroAt: s.retro_at,
          online: !offline,
        }
      : null,
  )
  const demo = !!me?.workspaces.find((w) => w.id === s?.workspace_id)?.is_demo

  if (error)
    return (
      <AppShell>
        <div className="mx-auto max-w-lg py-16 text-center">
          <h1 className="font-display text-xl">Can’t open this sprint</h1>
          <p className="mt-2 text-ink-soft">{error}</p>
          <Link to="/" className="mt-5 inline-block text-sm underline underline-offset-4">Back to Muni</Link>
        </div>
      </AppShell>
    )
  if (!me || (!s && !cached))
    return (
      <AppShell wide>
        <div className="grid place-items-center py-24 text-ink-soft"><Spinner /></div>
      </AppShell>
    )

  // ── What's on screen.
  const st = s?.status ?? cached!.sprint.status
  const phase = PHASE_OF[st] ?? 'draft'
  const collecting = st === 'collecting'
  const participant = s ? s.is_participant : true
  const writing = participant && (collecting || kept)
  const name = s?.name ?? cached!.sprint.name
  const workspaceId = s?.workspace_id ?? cached!.sprint.workspace_id
  const dest: Destination | null = collecting ? { workspaceId, sprintId, sprintName: name, ...(s ? { encrypted: s.encryption === 'e1' } : {}) } : null
  const bar: BarSprint | null = s
    ? { ...s, participant_count: s.participants.length }
    : null
  const plan = s ? sprintPlan({ ...s, participant_count: s.participants.length, experiment_count: agreed }, { online: !offline }) : null
  const moveTo = (d: Destination) => {
    writePrefs({ lastSprint: d.sprintId })
    nav(`/sprints/${d.sprintId}`)
  }

  const unsent = local.items.filter((i) => i.sprintId !== sprintId)
  const mine = (experiments.data ?? []).filter((e) => e.owner_account_id === me.account_id && (e.status === 'proposed' || e.status === 'accepted'))
  const extras = (
    <>
      {unsent.length ? (
        <section className="mt-14 mark-indent" aria-labelledby="unsent">
          <h2 id="unsent" className="font-display text-lg">Not sent yet <span className="ml-1 font-normal text-ink-faint">{unsent.length}</span></h2>
          <p className="mb-2 text-sm text-ink-soft">Kept on this device for other sprints.</p>
          <div className="mark-outdent"><LocalThoughtList items={unsent} moveChoices={moveChoices} showDestination /></div>
        </section>
      ) : null}
      {mine.length ? <Commitments items={mine} me={me} /> : null}
    </>
  )
  const offlineNote = offline ? (
    <p className="mb-5 flex items-start gap-2 rounded-xl bg-ink/5 px-3.5 py-2.5 text-sm text-ink-soft" role="status">
      <span className="dot dot--queued mt-1.5" aria-hidden />
      <span>
        You’re offline. {writing && collecting ? `Thoughts you save wait on this device${local.kind === 'memory' ? ' (in this tab)' : ''} and are sent when Muni reconnects.` : 'Muni will catch up when you reconnect.'}
        {cached ? <span className="text-ink-faint"> Sprint details from {new Date(cached.fetchedAt).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}.</span> : null}
      </span>
    </p>
  ) : null
  const keyNotice = s?.encryption === 'e1' ? <div className="mb-4"><DeviceKeyNotice need={writing ? 'write' : 'read'} /></div> : null
  const notices = (
    <>
      {offlineNote}
      {keyNotice}
    </>
  )
  const thoughts = (roomEmpty?: ReactNode) => (
    <MyThoughts sprintId={sprintId} editable={collecting && !offline} moveChoices={moveChoices} online={!offline} onCount={setCollected} empty={roomEmpty} />
  )

  const header = bar && plan ? (
    <SprintBar
      s={bar}
      plan={plan}
      control={control}
      compact={writing}
      extra={s?.is_facilitator && s.encryption === 'e1' ? <AccessNote view={access} changes={changes.filter((c) => c.sprintId === sprintId)} status={st} /> : null}
    />
  ) : (
    <OfflineBar name={name} workspaceName={cached?.workspaceName ?? null} workspaceId={workspaceId} status={st} />
  )

  let body: ReactNode
  if (writing) {
    const empty = collected === 0
    const closedNote = !collecting ? <>Collection closed while you were writing. Nothing was sent: your words are still here to copy.</> : undefined
    body = (
      <WritingHost key={`${sprintId}:${local.cleared}`} dest={dest} choices={choices} onChoose={moveTo}>
        {world ? (
          <Room
            world={world}
            mode="write"
            empty={empty}
            bar={header}
            notices={<>{notices}<MoveDraft choices={choices} current={sprintId} /></>}
            context={null}
            writing={<Writer closed={closedNote} level={2} />}
            collection={thoughts(<RoomEmpty />)}
            extras={extras}
          />
        ) : (
          <>
            <JournalScene bubble={empty} respond className="journal-scene--under-bar">
              <MoveDraft choices={choices} current={sprintId} />
              <h2 className="journal-title mt-2">
                <label htmlFor="thought-field">What’s worth <em>remembering</em>?</label>
              </h2>
            </JournalScene>
            <div className="journal-body" data-empty={empty || undefined}>
              <div className="home-compose min-w-0 self-start">
                {notices}
                <Composer fieldId="thought-field" dest={dest} choices={[]} onChoose={moveTo} closed={closedNote} />
              </div>
              <div className="home-collection min-w-0 pt-1">
                {thoughts()}
                {extras}
              </div>
            </div>
          </>
        )}
      </WritingHost>
    )
  } else if (phase === 'done' && s) {
    body = (
      <div className={world ? 'room sprint-done' : 'sprint-done'} data-room={world ?? undefined} data-mode={world ? 'done' : undefined}>
        {world ? header : null}
        {notices}
        {participant && !demo ? <FirstEveningClosing /> : null}
        <Suspense fallback={<Loading />}>
          <OutcomesView s={s} onCount={setAgreed} refresh={refresh} />
        </Suspense>
        {participant ? (
          <>
            <details className="sprint-fold">
              <summary>Everyone’s thoughts</summary>
              <div className="mt-4"><TeamThoughts sprintId={sprintId} refresh={refresh} /></div>
            </details>
            <details className="sprint-fold">
              <summary>Your thoughts in this sprint</summary>
              <div className="mt-4">{thoughts()}</div>
            </details>
          </>
        ) : null}
      </div>
    )
  } else {
    const who = s?.participants.find((p) => p.is_facilitator)
    const fac = !!s?.is_facilitator
    let title: ReactNode
    let text: ReactNode
    let action: ReactNode = null
    let lights = 0
    let bubble = false
    if (phase === 'draft') {
      title = <>Thoughts open here <em>soon</em></>
      text = fac ? 'Once you open collection, this is where everyone in the sprint writes, you included.' : `When ${who && !who.is_you ? who.display_name : 'the facilitator'} opens collection, this is where you’ll write. Nothing to do until then.`
      bubble = true
    } else if (phase === 'collecting') {
      title = <>Thoughts are being <em>gathered</em></>
      text = 'You’re not in this sprint, so there’s nothing for you to write here. The facilitator can add you.'
    } else if (phase === 'closed') {
      title = <>Ready for the <em>conversation</em></>
      text = participant ? 'Here’s everything the team wrote, without names. Read it before the retro — that’s where you’ll talk about it.' : 'Collection is closed.'
      lights = 2
    } else {
      title = <>The retro is <em>happening</em> now</>
      if (participant && !fac) {
        text = 'Vote, answer and add from this device. Your votes, answers and additions never carry your name.'
        action = (
          <Link to={`/sprints/${sprintId}/room`} className="ws-btn ws-btn--primary" data-guide="join-retro">
            Join the retro <ArrowRight className="size-4" aria-hidden />
          </Link>
        )
      } else if (fac) {
        text = 'You’re running it from the stage. Your own votes and answers go here, where nobody sees them — open this on your phone, or next to the stage.'
        action = (
          <Link to={`/sprints/${sprintId}/room`} className="ws-btn ws-btn--secondary">
            Vote and answer <ArrowRight className="size-4" aria-hidden />
          </Link>
        )
      } else text = 'You’re not in this sprint’s retro. The facilitator can add you to the next one.'
      lights = 3
    }
    const sheet = (
      <div>
        <p className="max-w-prose text-ink-soft">{text}</p>
        {action ? <div className="mt-5">{action}</div> : null}
      </div>
    )
    // Closed: the reveal is the page — everyone's thoughts, with your own folded below them.
    const reveal = participant && phase === 'closed'
    const list = reveal ? <TeamThoughts sprintId={sprintId} refresh={refresh} /> : participant && phase !== 'draft' && phase !== 'collecting' ? thoughts(world ? <RoomEmpty /> : undefined) : null
    // Something of yours that didn't reach the sprint (it needs a decision) keeps the fold open.
    const more = reveal ? (
      <>
        <details className="sprint-fold" open={pending || undefined}>
          <summary>Your thoughts in this sprint</summary>
          <div className="mt-4">{thoughts()}</div>
        </details>
        {extras}
      </>
    ) : extras
    body = world ? (
      <Room
        world={world}
        mode="state"
        empty={!reveal && !!list && collected === 0}
        notices={notices}
        bar={header}
        context={null}
        writing={<StateWriter title={title} level={2}>{sheet}</StateWriter>}
        collection={list}
        extras={more}
      />
    ) : (
      <>
        <JournalScene lights={lights} bubble={bubble} className="journal-scene--under-bar">
          <h2 className="journal-title">{title}</h2>
        </JournalScene>
        <div className="mt-4 max-w-3xl">
          {notices}
          {sheet}
          {list ? <div className="mt-12">{list}</div> : null}
          {more}
        </div>
      </>
    )
  }

  // In a character's room the bar is part of the room's own composition; in Muni's journal it heads the page.
  return (
    <AppShell wide>
      {world ? null : header}
      {body}
      {s ? <About s={s} /> : null}
      {s ? <InviteDialog open={inviting} onClose={() => setInviting(false)} workspaceId={s.workspace_id} sprints={s.is_facilitator ? [{ id: s.id, name: s.name }] : []} defaultSprint={s.is_facilitator ? s.id : undefined} canWorkspace={me.workspaces.some((w) => w.id === s.workspace_id && w.role === 'owner')} onInvited={load} /> : null}
    </AppShell>
  )
}

/**
 * In Muni's journal, when more than one sprint in this workspace is collecting: which one these
 * words are for, and a way to take them to another. (A character's room has the same in its
 * sprint label.) Moving carries the words; nothing is sent.
 */
function MoveDraft({ choices, current }: { choices: Destination[]; current: string }) {
  const writing = useWriting()
  const others = choices.filter((c) => c.sprintId !== current)
  if (!others.length) return null
  return (
    <p className="text-sm text-ink-soft">
      Also collecting:{' '}
      {others.map((o, i) => (
        <span key={o.sprintId}>
          {i ? ', ' : ''}
          <button type="button" className="font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-accent" onClick={() => writing.choose(o)}>
            {o.sprintName}
          </button>
        </span>
      ))}
      <span className="text-ink-faint"> · what you’ve written moves with you</span>
    </p>
  )
}

/** Offline, from what this device kept: the sprint's name and its last known state. */
function OfflineBar({ name, workspaceName, workspaceId, status }: { name: string; workspaceName: string | null; workspaceId: string; status: string }) {
  return (
    <section className="sbar" aria-label={name} data-phase={PHASE_OF[status] ?? 'draft'}>
      <div className="sbar-top">
        <div className="sbar-id">
          <p className="sbar-kicker"><Link to={`/workspaces/${workspaceId}`}>{workspaceName ?? 'Sprints'}</Link></p>
          <h1 className="sbar-name">{name}</h1>
          <p className="sbar-status">
            <span className="sbar-state"><span className="sbar-dot" aria-hidden />{status === 'collecting' ? 'Collecting thoughts, when last seen' : 'Offline'}</span>
          </p>
        </div>
      </div>
    </section>
  )
}

/** The sprint's plain facts, folded away: who's in, the retro in full, reminders, how it's stored. */
function About({ s }: { s: SprintDetail }) {
  return (
    <details className="sprint-fold sprint-about">
      <summary>About this sprint</summary>
      <div className="sprint-about-body">
        <section aria-labelledby="whos-in">
          <h2 id="whos-in" className="ws-eyebrow">Who’s in</h2>
          <ul className="mt-3 flex flex-wrap gap-1.5 text-sm">
            {s.participants.map((p) => (
              <li key={p.account_id} className="rounded-full bg-card px-3 py-1 shadow-[0_0_0_1px_var(--line)]">
                {p.display_name}
                {p.is_you ? <span className="text-ink-faint"> (you)</span> : null}
                {p.is_facilitator ? <span className="text-ink-faint"> · facilitator</span> : null}
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="retro-planned" className="text-sm">
          <h2 id="retro-planned" className="ws-eyebrow">Retro, as planned</h2>
          <p className="mt-2"><RetroWhen s={s} icon={false} prefix="" /> · {s.retro_duration_min} min</p>
          <p className="mt-1 text-ink-soft">The date is a plan. The retro starts only when the facilitator starts it{s.is_facilitator ? '; changing the date never changes where the sprint is' : ''}.</p>
        </section>
        <section className="space-y-1 text-sm text-ink-soft">
          {s.reminders_enabled ? (
            <p>
              Reminder emails while collecting: {s.my_reminders_opt_out ? 'off for you' : 'on'} · <Link to="/account#notifications" className="underline underline-offset-2">change</Link>
            </p>
          ) : null}
          {s.encryption !== 'e1' ? <p><EncryptionLine encryption={s.encryption} /></p> : null}
        </section>
      </div>
    </details>
  )
}

/** For the facilitator: who can't read yet, and keys that changed unexpectedly. */
function AccessNote({ view, changes, status }: { view: SprintKeyView | null; changes: { accountId: string; name: string }[]; status: string }) {
  if (!view?.participants) return null
  const noKey = view.participants.filter((p) => !p.public_key)
  const sealed = status === 'draft' || status === 'collecting'
  const waiting = sealed ? [] : view.participants.filter((p) => p.public_key && !p.has_latest && !changes.some((c) => c.accountId === p.account_id))
  if (!noKey.length && !waiting.length && !changes.length) return null
  return (
    <div className="sbar-access">
      {noKey.length ? <p><span className="text-ink">{noKey.map((p) => p.display_name).join(', ')}</span> {noKey.length === 1 ? 'hasn’t' : 'haven’t'} set up encryption yet. {sealed ? 'They can still write once they do; ' : ''}they’ll get access automatically from a device that has it.</p> : null}
      {waiting.length ? <p>Waiting for access: {waiting.map((p) => p.display_name).join(', ')}. The next device with the key that opens this page shares it.</p> : null}
      {changes.map((c) => <KeyChange key={c.accountId} c={c} view={view} />)}
    </div>
  )
}

function KeyChange({ c, view }: { c: { accountId: string; name: string }; view: SprintKeyView }) {
  const p = view.participants?.find((x) => x.account_id === c.accountId)
  return (
    <div className="rounded-2xl bg-warn/10 px-3.5 py-2.5 text-ink">
      <p><strong className="font-medium">{c.name}’s encryption key changed.</strong> That happens when someone starts over after losing their devices, or if something is wrong. Muni won’t share this sprint with the new key until you confirm it with them.</p>
      {p?.public_key ? (
        <p className="mt-2 flex flex-wrap items-center gap-3">
          <span className="text-ink-soft">New fingerprint: <span className="font-mono text-ink">{fingerprint(fromB64u(p.public_key, 32))}</span></span>
          <Button size="sm" onClick={() => keyring.acceptKeyChange(c.accountId, p.public_key!)}>They confirmed it</Button>
        </p>
      ) : null}
    </div>
  )
}
