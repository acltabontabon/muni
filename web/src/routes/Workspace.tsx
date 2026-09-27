import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowRight, Copy, MoreHorizontal, Plus, QrCode, UserPlus } from 'lucide-react'
import * as Popover from '@radix-ui/react-popover'
import { ApiError, del, get, patch, post } from '@/api/client'
import type { AuditEvent, Experiment, SprintDetail, SprintSummary, WorkspaceDetail } from '@/api/types'
import { describeEvent } from '@/lib/audit'
import { OUTCOME_LABEL } from '@/lib/categories'
import { STATUS_PHRASE, sprintGuide } from '@/lib/lifecycle'
import { useAuth } from '@/lib/auth'
import { writePrefs } from '@/lib/prefs'
import { dateRange, shortDate } from '@/lib/schedule'
import { chooseWorkspace } from '@/lib/workspace'
import { Button, Dialog, ErrorText, Help, Input, Label, Spinner, useDocumentTitle, useToast } from '@/ui'
import { AppShell } from '@/ui/shell'
import { HorizonBand, Postcard } from '@/ui/art'
import { StepPips } from '@/ui/guide'
import { RetroWhen } from '@/ui/when'
import { ActiveCodes, InviteQrDialog, JoinRequests } from '@/ui/invite-qr'

type Tab = 'overview' | 'people' | 'settings'

function useWorkspace(workspaceId: string) {
  const [ws, setWs] = useState<WorkspaceDetail | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      const w = await get<WorkspaceDetail>(`/api/workspaces/${workspaceId}`)
      setWs(w)
      writePrefs({ lastWorkspace: workspaceId })
      chooseWorkspace(workspaceId)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t load this workspace')
    }
  }, [workspaceId])
  useEffect(() => {
    load()
  }, [load])
  return { ws, error, reload: load }
}

/** The frame every workspace page shares: its name over a strip of evening, then its sections. */
function Frame({ ws, tab, children, aside }: { ws: WorkspaceDetail; tab: Tab; children: ReactNode; aside?: ReactNode }) {
  const id = ws.workspace.id
  const owner = ws.workspace.role === 'owner'
  const tabs: { id: Tab; label: string; to: string }[] = [
    { id: 'overview', label: 'Sprints', to: `/workspaces/${id}` },
    { id: 'people', label: 'People', to: `/workspaces/${id}/people` },
    ...(owner ? [{ id: 'settings' as Tab, label: 'Settings', to: `/workspaces/${id}/settings` }] : []),
  ]
  return (
    <AppShell workspace={{ id, name: ws.workspace.name, role: ws.workspace.role, is_demo: ws.workspace.is_demo }}>
      <HorizonBand className="mb-5">
        <div className="flex min-h-[136px] flex-col px-5 pb-12 pt-5 sm:min-h-[152px] sm:px-7 sm:pb-14 sm:pt-6">
          <p className="text-[13px] font-medium text-ink-soft">{ws.workspace.is_demo ? 'Demo workspace · fictional team and data' : owner ? 'Workspace · you’re an owner' : 'Workspace'}</p>
          <h1 className="font-display mt-0.5 max-w-[min(34rem,70%)] text-[1.7rem] leading-[1.1] tracking-[-0.025em] [overflow-wrap:anywhere] sm:text-[2.1rem]">{ws.workspace.name}</h1>
        </div>
      </HorizonBand>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Workspace" className="subnav">
          {tabs.map((t) => (
            <Link key={t.id} to={t.to} aria-current={tab === t.id ? 'page' : undefined}>{t.label}</Link>
          ))}
        </nav>
        {aside}
      </div>
      {children}
    </AppShell>
  )
}

function Loading({ error }: { error?: string }) {
  return (
    <AppShell>
      {error ? (
        <div className="mx-auto max-w-lg py-16 text-center">
          <h1 className="font-display text-xl">Can’t open this workspace</h1>
          <p className="mt-2 text-ink-soft">{error}</p>
          <Link to="/" className="mt-5 inline-block text-sm underline underline-offset-4">Back to Muni</Link>
        </div>
      ) : (
        <div className="grid place-items-center py-20 text-ink-soft"><Spinner /></div>
      )}
    </AppShell>
  )
}

const ORDER = ['live', 'ready', 'preparing', 'collecting', 'draft']

// ------------------------------------------------------------------ overview

export function WorkspacePage() {
  const { workspaceId = '' } = useParams()
  const nav = useNavigate()
  const { ws, error } = useWorkspace(workspaceId)
  const { offline } = useAuth()
  const [sprints, setSprints] = useState<SprintSummary[] | null>(null)
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [lead, setLead] = useState<SprintDetail | null>(null)
  useDocumentTitle(ws?.workspace.name ?? 'Workspace')
  useEffect(() => {
    Promise.all([get<SprintSummary[]>(`/api/workspaces/${workspaceId}/sprints`), get<Experiment[]>(`/api/workspaces/${workspaceId}/experiments`)])
      .then(([s, e]) => {
        setSprints(s)
        setExperiments(e)
      })
      .catch(() => setSprints([]))
  }, [workspaceId])
  const active = useMemo(() => (sprints ?? []).filter((s) => ORDER.includes(s.status)).sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status)), [sprints])
  const past = (sprints ?? []).filter((s) => s.status === 'completed' || s.status === 'archived')
  const leadId = active.find((s) => s.is_participant)?.id ?? active[0]?.id
  useEffect(() => {
    if (!leadId) return setLead(null)
    get<SprintDetail>(`/api/sprints/${leadId}`).then(setLead).catch(() => setLead(null))
  }, [leadId])

  if (!ws || !sprints) return <Loading error={error} />
  const today = new Date().toISOString().slice(0, 10)
  const revisit = experiments.filter((e) => e.status === 'accepted' || e.status === 'proposed').sort((a, b) => a.review_on.localeCompare(b.review_on))
  const others = active.filter((s) => s.id !== lead?.id)
  const newSprint = !offline ? (
    <Button size="sm" onClick={() => nav(`/workspaces/${workspaceId}/sprints/new`)}><Plus className="size-4" /> New sprint</Button>
  ) : null

  return (
    <Frame ws={ws} tab="overview" aside={active.length || past.length ? newSprint : null}>
      {/* 1. Now: the current sprint and the next thing to do. */}
      {lead ? <NowCard s={lead} online={!offline} /> : active.length === 0 ? (
        <section className="fac-area flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
          <Postcard framing="close" className="aspect-[3/2] w-full max-w-[12rem] shrink-0" />
          <div className="min-w-0">
            <h2 className="font-display text-xl">{past.length ? 'No sprint is open right now' : <>Set up your first <em>sprint</em></>}</h2>
            <p className="mt-1 max-w-prose text-ink-soft">A sprint gives the team a place to write thoughts as things happen, then a retro to talk them through. Setup takes a minute: a name, the dates, and who’s in.</p>
            {!offline ? <Button className="mt-4" variant="primary" onClick={() => nav(`/workspaces/${workspaceId}/sprints/new`)}>Set up a sprint <ArrowRight className="size-4" /></Button> : null}
          </div>
        </section>
      ) : (
        <div className="grid place-items-center py-10 text-ink-soft"><Spinner /></div>
      )}

      {others.length ? (
        <section className="mt-8" aria-labelledby="also">
          <h2 id="also" className="eyebrow mb-3">Also open</h2>
          <SprintRows sprints={others} />
        </section>
      ) : null}

      <div className={revisit.length && past.length ? 'mt-12 grid gap-10 lg:grid-cols-2' : 'mt-12 space-y-12'}>
        {/* 2. Experiments to revisit, when there are any. */}
        {revisit.length ? (
          <section aria-labelledby="revisit">
            <h2 id="revisit" className="font-display text-lg">To revisit</h2>
            <p className="text-sm text-ink-soft">Experiments the team agreed to try. The next retro starts with these.</p>
            <ul className="mt-4 divide-y divide-line rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)]">
              {revisit.slice(0, 6).map((e) => (
                <li key={e.id} className="p-4">
                  <p className="font-medium [overflow-wrap:anywhere]">{e.change_to_try}</p>
                  <p className="mt-1 text-sm text-ink-soft">
                    {e.status === 'proposed' ? <span className="text-warn">{e.owner_name ? `Waiting for ${e.owner_name} to accept` : 'Needs an owner'} · </span> : e.owner_name ? `${e.owner_name} · ` : ''}
                    <span className={e.review_on <= today ? 'font-medium text-accent-ink' : ''}>{e.review_on <= today ? 'Due to revisit' : 'Revisit'} {shortDate(e.review_on)}</span>
                    <span className="text-ink-faint"> · from {e.sprint_name}</span>
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : past.length ? (
          <p className="text-sm text-ink-soft">No experiments to revisit. When a retro agrees on one, it shows here until the team looks back at it.</p>
        ) : null}

        {/* 3. Previous sprints. */}
        {past.length ? (
          <section aria-labelledby="previous">
            <h2 id="previous" className="font-display text-lg">Previous sprints</h2>
            <p className="text-sm text-ink-soft">Outcomes and recaps.</p>
            <ul className="mt-4 divide-y divide-line rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)]">
              {past.slice(0, 12).map((s) => {
                const tried = experiments.filter((e) => e.sprint_id === s.id && e.status !== 'proposed')
                return (
                  <li key={s.id}>
                    <Link to={`/sprints/${s.id}/outcomes`} className="flex items-center gap-3 p-4 hover:bg-ink/[0.03]">
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium [overflow-wrap:anywhere]">{s.name}</span>
                        <span className="block text-sm text-ink-soft">{dateRange(s.starts_on, s.ends_on)}{s.status === 'archived' ? ' · archived' : ''}{tried.length ? ` · ${tried.length} ${tried.length === 1 ? 'experiment' : 'experiments'}` : ''}</span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-ink-faint" aria-hidden />
                    </Link>
                  </li>
                )
              })}
            </ul>
            {experiments.some((e) => ['helped', 'did_not_help', 'inconclusive', 'not_tried'].includes(e.status)) ? (
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer text-ink-soft hover:text-ink">What past experiments showed</summary>
                <ul className="mt-2 space-y-2">
                  {experiments.filter((e) => ['helped', 'did_not_help', 'inconclusive', 'not_tried'].includes(e.status)).map((e) => (
                    <li key={e.id} className="rounded-xl bg-card-2/70 px-3 py-2">
                      <span className="font-medium">{OUTCOME_LABEL[e.status]}</span> · {e.change_to_try}
                      {e.outcome_note ? <span className="block text-ink-soft">{e.outcome_note}</span> : null}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
        ) : null}
      </div>
    </Frame>
  )
}

/** The sprint that matters now: where it is, and the next step for you. */
function NowCard({ s, online }: { s: SprintDetail; online: boolean }) {
  const g = sprintGuide({ ...s, participant_count: s.participants.length }, { online })
  const primary = g.actions[0]
  const facNext = g.facilitator?.actions[0]
  return (
    <section aria-labelledby="now" className="rounded-3xl bg-card p-5 shadow-[0_0_0_1px_var(--line),0_18px_40px_-30px_rgb(60_40_140/0.35)] sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="eyebrow">Now</span>
        <StepPips step={g.step} />
      </div>
      <div className="mt-3 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h2 id="now" className="font-display text-2xl leading-tight [overflow-wrap:anywhere]">
            <Link to={`/sprints/${s.id}`} className="hover:underline">{s.name}</Link>
          </h2>
          <p className="mt-1 font-medium text-accent-ink">{g.title}</p>
          <p className="mt-1 max-w-prose text-ink-soft">{g.body}</p>
          <div className="mt-3 flex flex-col gap-1 text-sm text-ink-soft">
            <RetroWhen s={s} />
            <span>{dateRange(s.starts_on, s.ends_on)} · {s.participants.length} {s.participants.length === 1 ? 'person' : 'people'}{s.facilitator_name ? ` · facilitated by ${s.is_facilitator ? 'you' : s.facilitator_name}` : ''}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {primary?.kind === 'write' ? <Link to={`/?sprint=${s.id}`}><Button variant="primary">Write a thought <ArrowRight className="size-4" /></Button></Link> : null}
          {primary?.kind === 'link' ? <Link to={primary.href}><Button variant={facNext ? 'secondary' : 'primary'}>{primary.label}</Button></Link> : null}
          {g.facilitator ? <Link to={`/sprints/${s.id}`}><Button variant={primary ? 'secondary' : 'primary'}>{facNext ? `Next: ${facNext.label.replace('…', '')}` : 'Sprint guide'}</Button></Link> : !primary ? <Link to={`/sprints/${s.id}`}><Button>Sprint guide</Button></Link> : null}
        </div>
      </div>
    </section>
  )
}

function SprintRows({ sprints }: { sprints: SprintSummary[] }) {
  return (
    <ul className="divide-y divide-line rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)]">
      {sprints.map((s) => (
        <li key={s.id}>
          <Link to={`/sprints/${s.id}`} className="flex items-center gap-3 p-4 hover:bg-ink/[0.03]">
            <span className="min-w-0 flex-1">
              <span className="block font-medium [overflow-wrap:anywhere]">{s.name}</span>
              <span className="block text-sm font-medium text-accent-ink">{STATUS_PHRASE[s.status] ?? s.status}</span>
              <RetroWhen s={s} icon={false} className="text-sm text-ink-soft" />
            </span>
            <ArrowRight className="size-4 shrink-0 text-ink-faint" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  )
}

// ------------------------------------------------------------------ people

export function WorkspacePeople() {
  const { workspaceId = '' } = useParams()
  const { ws, error, reload } = useWorkspace(workspaceId)
  const { refresh } = useAuth()
  const toast = useToast()
  const [inviting, setInviting] = useState(false)
  const [qr, setQr] = useState(false)
  const [codesVersion, setCodesVersion] = useState(0)
  const [sprints, setSprints] = useState<SprintSummary[]>([])
  const [removing, setRemoving] = useState<WorkspaceDetail['members'][number] | null>(null)
  useDocumentTitle(ws ? `People · ${ws.workspace.name}` : 'People')
  useEffect(() => {
    get<SprintSummary[]>(`/api/workspaces/${workspaceId}/sprints`).then(setSprints).catch(() => {})
  }, [workspaceId])
  if (!ws) return <Loading error={error} />
  const owner = ws.workspace.role === 'owner'
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn()
      if (done) toast(done)
      await reload()
      await refresh()
    } catch (e) {
      toast(e instanceof ApiError ? sentence(e.message) : 'Couldn’t make that change', 'danger')
    }
  }
  const facilitating = sprints.filter((s) => s.is_facilitator && !['completed', 'archived'].includes(s.status))
  return (
    <Frame
      ws={ws}
      tab="people"
      aside={
        ws.can_invite ? (
          <span className="flex gap-2">
            <Button size="sm" onClick={() => setQr(true)}><QrCode className="size-4" /> Invite link or QR</Button>
            <Button size="sm" variant="primary" onClick={() => setInviting(true)}><UserPlus className="size-4" /> Invite by email</Button>
          </span>
        ) : null
      }
    >
      <div className="max-w-3xl">
        <p className="mb-5 text-ink-soft">
          {ws.members.length} {ws.members.length === 1 ? 'person' : 'people'} in this workspace.{' '}
          {owner ? 'As an owner you can change roles and remove people.' : ws.can_invite ? 'As a facilitator you can invite people.' : 'Owners and facilitators invite people.'}
        </p>
        <ul className="divide-y divide-line rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)]">
          {ws.members.map((m) => (
            <li key={m.account_id} className="flex items-center gap-3 p-4">
              <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent-ink">{m.display_name.trim()[0]?.toUpperCase() ?? '·'}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{m.display_name}{m.is_you ? <span className="font-normal text-ink-faint"> (you)</span> : null}</span>
                <span className="block truncate text-sm text-ink-soft">{m.role === 'owner' ? 'Owner' : 'Member'}{m.email ? ` · ${m.email}` : ''}</span>
              </span>
              {owner && !m.is_you ? (
                <Popover.Root>
                  <Popover.Trigger asChild>
                    <button className="icon-btn" aria-label={`Manage ${m.display_name}`}><MoreHorizontal className="size-4" /></button>
                  </Popover.Trigger>
                  <Popover.Portal>
                    <Popover.Content align="end" sideOffset={4} className="z-50 w-56 rounded-2xl border border-line bg-card p-1.5 shadow-[var(--shadow-float)] anim-rise">
                      <Popover.Close asChild>
                        <button className="block w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-ink/5" onClick={() => act(() => patch(`/api/workspaces/${workspaceId}/members/${m.account_id}`, { role: m.role === 'owner' ? 'member' : 'owner' }), m.role === 'owner' ? `${m.display_name} is now a member` : `${m.display_name} is now an owner`)}>
                          {m.role === 'owner' ? 'Make a member' : 'Make an owner'}
                        </button>
                      </Popover.Close>
                      <Popover.Close asChild>
                        <button className="block w-full rounded-xl px-3 py-2 text-left text-sm text-danger hover:bg-danger/10" onClick={() => setRemoving(m)}>Remove from workspace…</button>
                      </Popover.Close>
                    </Popover.Content>
                  </Popover.Portal>
                </Popover.Root>
              ) : null}
            </li>
          ))}
        </ul>
        {ws.can_invite ? (
          <div className="mt-10">
            <JoinRequests key={codesVersion} workspaceId={workspaceId} onDecided={() => { void reload(); setCodesVersion((v) => v + 1) }} />
          </div>
        ) : null}
        {ws.can_invite ? <ActiveCodes workspaceId={workspaceId} version={codesVersion} onChanged={() => setCodesVersion((v) => v + 1)} /> : null}
        {ws.can_invite && ws.pending_invitations.length ? (
          <section className="mt-10" aria-labelledby="pending">
            <h2 id="pending" className="font-display text-lg">Invited</h2>
            <p className="text-sm text-ink-soft">Waiting for them to open the link. Links expire after 14 days.</p>
            <ul className="mt-4 divide-y divide-line rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)]">
              {ws.pending_invitations.map((i) => (
                <li key={i.id} className="flex items-center gap-3 p-4 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{i.email}</span>
                    <span className="block text-ink-soft">Expires {shortDate(i.expires_at.slice(0, 10))}{i.sprint_id ? ` · joins ${sprints.find((s) => s.id === i.sprint_id)?.name ?? 'a sprint'}` : ''}</span>
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => act(() => del(`/api/workspaces/${workspaceId}/invitations/${i.id}`), 'Invitation withdrawn')}>Withdraw</Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      <InviteDialog open={inviting} onClose={() => setInviting(false)} workspaceId={workspaceId} sprints={facilitating} onInvited={reload} />
      <InviteQrDialog open={qr} onClose={() => { setQr(false); setCodesVersion((v) => v + 1) }} workspaceId={workspaceId} workspaceName={ws.workspace.name} canWorkspace={ws.can_invite} sprints={facilitating} onChanged={() => { void reload(); setCodesVersion((v) => v + 1) }} />
      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} title={`Remove ${removing?.display_name ?? ''}?`} description="They lose access to this workspace immediately, including any sprint in progress.">
        <p className="text-sm text-ink-soft">Thoughts they already submitted stay in their sprints, still without their name. They can be invited again later.</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button>
          <Button variant="danger" onClick={async () => { const m = removing; setRemoving(null); if (m) await act(() => del(`/api/workspaces/${workspaceId}/members/${m.account_id}`), `${m.display_name} was removed`) }}>Remove</Button>
        </div>
      </Dialog>
    </Frame>
  )
}

export function InviteDialog({ open, onClose, workspaceId, sprints, onInvited, defaultSprint }: { open: boolean; onClose: () => void; workspaceId: string; sprints: Pick<SprintSummary, 'id' | 'name'>[]; onInvited: () => void; defaultSprint?: string }) {
  const [email, setEmail] = useState('')
  const [sprint, setSprint] = useState(defaultSprint ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ text: string; link?: string }[]>([])
  useEffect(() => {
    if (open) {
      setSprint(defaultSprint ?? '')
      setDone([])
      setError('')
    }
  }, [open, defaultSprint])
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Invite by email" description="We email them a link. It works once — whoever opens it first and signs in with a passkey joins — and expires in 14 days. No email? Use an invite link or QR instead.">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError('')
          try {
            const r = await post<{ already_member: boolean; email: string; link?: string }>(`/api/workspaces/${workspaceId}/invitations`, { email, sprint_id: sprint || undefined })
            setDone((d) => [...d, r.already_member ? { text: `${r.email} is already a member${sprint ? ' and was added to the sprint' : ''}.` } : { text: `Invitation sent to ${r.email}.`, link: r.link }])
            setEmail('')
            onInvited()
          } catch (err) {
            setError(err instanceof ApiError ? sentence(err.message) : 'Couldn’t invite')
          } finally {
            setBusy(false)
          }
        }}
      >
        <div>
          <Label htmlFor="inv-email">Email</Label>
          <Input id="inv-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="off" placeholder="teammate@company.com" />
        </div>
        {sprints.length ? (
          <div>
            <Label htmlFor="inv-sprint" hint="optional">Also add them to</Label>
            <select id="inv-sprint" className="w-full rounded-xl border border-line bg-card px-3.5 py-2.5" value={sprint} onChange={(e) => setSprint(e.target.value)}>
              <option value="">Just the workspace</option>
              {sprints.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        ) : null}
        <ErrorText>{error}</ErrorText>
        {done.length ? (
          <ul className="space-y-1 text-sm text-ok" role="status">
            {done.map((d, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-3">
                {d.text}
                {d.link ? (
                  <button type="button" className="inline-flex items-center gap-1 text-ink-soft underline underline-offset-2" onClick={() => navigator.clipboard.writeText(d.link!).catch(() => window.prompt('Copy this invite link', d.link))}>
                    <Copy className="size-3.5" aria-hidden /> Copy invite link
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {done.some((d) => d.link) ? <p className="text-xs text-ink-soft">Share it only with that person: the link works once, for whoever opens it first.</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Done</Button>
          <Button type="submit" variant="primary" busy={busy}>{done.length ? 'Invite another' : 'Send invitation'}</Button>
        </div>
      </form>
    </Dialog>
  )
}

// ------------------------------------------------------------------ settings

export function WorkspaceSettings() {
  const { workspaceId = '' } = useParams()
  const { ws, error, reload } = useWorkspace(workspaceId)
  useDocumentTitle(ws ? `Settings · ${ws.workspace.name}` : 'Settings')
  if (!ws) return <Loading error={error} />
  if (ws.workspace.role !== 'owner')
    return (
      <Frame ws={ws} tab="settings">
        <p className="max-w-prose text-ink-soft">Only workspace owners can change these settings.</p>
      </Frame>
    )
  return (
    <Frame ws={ws} tab="settings">
      <div className="grid max-w-5xl gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <SettingsForm ws={ws} onSaved={reload} />
        <Activity workspaceId={workspaceId} />
      </div>
    </Frame>
  )
}

function SettingsForm({ ws, onSaved }: { ws: WorkspaceDetail; onSaved: () => void }) {
  const { refresh } = useAuth()
  const toast = useToast()
  const [name, setName] = useState(ws.workspace.name)
  const [retention, setRetention] = useState(String(ws.workspace.retention_days))
  const [outcome, setOutcome] = useState(String(ws.workspace.outcome_retention_days))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await patch(`/api/workspaces/${ws.workspace.id}`, { name, retention_days: Number(retention), outcome_retention_days: Number(outcome) })
      toast('Settings saved')
      onSaved()
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? sentence(err.message) : 'Couldn’t save')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={save} className="space-y-8">
      <section className="space-y-2">
        <h2 className="font-display text-lg">Name</h2>
        <Label htmlFor="ws-name">Workspace name</Label>
        <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
      </section>
      <section className="space-y-3">
        <h2 className="font-display text-lg">How long things are kept</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="ret">Thoughts and notes</Label>
            <div className="flex items-center gap-2"><Input id="ret" type="number" min={7} max={3650} value={retention} onChange={(e) => setRetention(e.target.value)} className="w-28" /> <span className="text-sm text-ink-soft">days</span></div>
          </div>
          <div>
            <Label htmlFor="oret">Experiments and recaps</Label>
            <div className="flex items-center gap-2"><Input id="oret" type="number" min={30} max={3650} value={outcome} onChange={(e) => setOutcome(e.target.value)} className="w-28" /> <span className="text-sm text-ink-soft">days</span></div>
          </div>
        </div>
        <Help>Counted from when a sprint finishes. Thoughts, themes and notes go after the first period; accepted experiments and published recaps stay for the second, so the next retro can revisit them. <Link to="/privacy#retention" className="underline underline-offset-2">Retention</Link></Help>
      </section>
      <ErrorText>{error}</ErrorText>
      <Button type="submit" variant="primary" busy={busy}>Save settings</Button>
    </form>
  )
}

function Activity({ workspaceId }: { workspaceId: string }) {
  const [events, setEvents] = useState<AuditEvent[] | null>(null)
  const [sprints, setSprints] = useState<SprintSummary[]>([])
  const [n, setN] = useState(25)
  useEffect(() => {
    get<AuditEvent[]>(`/api/workspaces/${workspaceId}/audit`).then(setEvents).catch(() => setEvents([]))
    get<SprintSummary[]>(`/api/workspaces/${workspaceId}/sprints`).then(setSprints).catch(() => {})
  }, [workspaceId])
  const name = (id: string) => sprints.find((s) => s.id === id)?.name
  return (
    <section aria-labelledby="activity">
      <h2 id="activity" className="font-display text-lg">Activity</h2>
      <p className="text-sm text-ink-soft">Who changed what. It never includes what anyone wrote, and never links a person to a thought.</p>
      {!events ? <div className="py-6 text-ink-soft"><Spinner /></div> : events.length === 0 ? <p className="mt-4 text-sm text-ink-soft">Nothing yet.</p> : (
        <ol className="mt-4 space-y-3 text-sm">
          {events.slice(0, n).map((e) => {
            const d = describeEvent(e, name)
            return (
              <li key={e.id} className="flex gap-3">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-line-strong" />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{d.who}</span> {d.what}{d.where ? <span className="text-ink-soft"> · {d.where}</span> : null}
                  <time className="block text-xs text-ink-faint" dateTime={e.created_at}>{new Date(e.created_at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
                </span>
              </li>
            )
          })}
        </ol>
      )}
      {events && events.length > n ? <Button size="sm" variant="ghost" className="mt-3" onClick={() => setN((x) => x + 50)}>Show older</Button> : null}
    </section>
  )
}

function sentence(m: string) {
  const t = m.trim()
  return t ? t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.') : t
}
