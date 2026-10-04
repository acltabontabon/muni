/**
 * People: the team as a directory. Owners and members in two groups on one fine-ruled list — a
 * monogram, a readable name, and only what's worth knowing. Someone asking to join comes first,
 * because it needs a decision; invitations and invite codes follow for those who manage them. The
 * server decides who may do what; this page only offers what it allows.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import * as Popover from '@radix-ui/react-popover'
import { ChevronDown, Mail, MoreHorizontal, QrCode, Search, UserPlus } from 'lucide-react'
import { ApiError, del, patch, post } from '@/api/client'
import type { JoinLinkInfo, JoinRequestInfo, MemberInfo, SprintSummary, WorkspaceDetail } from '@/api/types'
import { useAuth } from '@/lib/auth'
import { useResource, useResources } from '@/lib/resource'
import { shortDate } from '@/lib/schedule'
import { Button, Dialog, useDocumentTitle, useToast } from '@/ui'
import { InviteDialog, sentence } from '@/ui/invite-email'
import { InviteQrDialog } from '@/ui/invite-qr'
import { LeaveWorkspaceDialog } from '@/ui/departure'
import { initials, SectionActions, SectionError, SectionPending, useWorkspaceShell } from './Layout'

/** A directory this long gets a way to find someone. */
const SEARCH_FROM = 12

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const joined = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
const ago = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  return days < 1 ? 'today' : days === 1 ? 'yesterday' : days < 60 ? `${days} days ago` : `on ${new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
}
const list = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`)
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export function WorkspacePeople() {
  const { ws } = useWorkspaceShell()
  return <PeopleSection key={ws.id} />
}

function PeopleSection() {
  const { ws } = useWorkspaceShell()
  const { refresh } = useAuth()
  const store = useResources()
  const toast = useToast()
  useDocumentTitle(`People · ${ws.name}`)
  const base = `/api/workspaces/${ws.id}`
  // Independent, so asked for together; the list shows once, whole.
  const detail = useResource<WorkspaceDetail>(base)
  const requests = useResource<JoinRequestInfo[]>(`${base}/join-requests`, { focus: true })
  const links = useResource<JoinLinkInfo[]>(`${base}/join-links`)
  const sprints = useResource<SprintSummary[]>(`${base}/sprints`)
  const [inviting, setInviting] = useState<'email' | 'qr' | null>(null)
  const [removing, setRemovingState] = useState<MemberInfo | null>(null)
  /** Sprints the server said the removal would strand (when the page's list was out of date). */
  const [refused, setRefused] = useState<{ id: string; name: string }[]>([])
  const setRemoving = (m: MemberInfo | null) => {
    setRemovingState(m)
    setRefused([])
  }
  const blockedBy = refused.length ? refused : (removing?.facilitating ?? [])
  const [leaving, setLeaving] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const d = detail.data
  const facilitating = useMemo(() => (sprints.data ?? []).filter((s) => s.is_facilitator && !['completed', 'archived'].includes(s.status)), [sprints.data])

  /** Membership changed: this workspace's lists (and your own view of it) are read again. */
  const changed = async () => {
    store.invalidate(base)
    await refresh()
  }
  const act = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    if (busy) return
    setBusy(key)
    try {
      await fn()
      if (done) toast(done)
      await changed()
    } catch (e) {
      toast(e instanceof ApiError ? (e.status === 0 ? 'You’re offline, so nothing changed.' : sentence(e.message)) : 'Couldn’t make that change', 'danger')
      store.invalidate(base)
    } finally {
      setBusy(null)
    }
  }
  const decide = async (r: JoinRequestInfo, verdict: 'approve' | 'decline') => {
    if (busy) return
    setBusy(r.id)
    try {
      await post(`${base}/join-requests/${r.id}/${verdict}`)
      toast(verdict === 'approve' ? `${r.display_name} joined` : `Declined ${r.display_name}’s request`)
    } catch (e) {
      // Another manager or tab may have decided first: the list, read again, shows how things stand.
      toast(e instanceof ApiError && e.code === 'request_closed' ? `${r.display_name}’s request was already closed.` : e instanceof ApiError && e.status === 0 ? 'You’re offline, so nothing changed.' : 'Couldn’t decide that request.', 'danger')
    } finally {
      setBusy(null)
      store.invalidate(base)
    }
  }

  if (detail.error) return <SectionError error={detail.error} onRetry={() => void detail.reload()} what="the people in this workspace" />
  if (!d || requests.loading || links.loading || sprints.loading) return <SectionPending label="Loading people" rows={6} />

  const owner = d.workspace.role === 'owner'
  // What concerns the whole workspace — inviting to it alone, its invite codes, who joins it, the
  // invitations waiting — is for owners. A facilitator invites people to the sprints they run, and
  // sees only those sprints' codes and requests.
  const forWorkspace = owner && d.can_invite
  const mySprints = new Set(facilitating.map((s) => s.id))
  const mine = (sprintId: string | null) => (sprintId ? mySprints.has(sprintId) : forWorkspace)
  const canInvite = forWorkspace || facilitating.length > 0
  const found = query.trim() ? d.members.filter((m) => fold(`${m.display_name} ${m.email ?? ''}`).includes(fold(query.trim()))) : d.members
  const owners = found.filter((m) => m.role === 'owner')
  const members = found.filter((m) => m.role !== 'owner')
  const waiting = (requests.data ?? []).filter((r) => mine(r.sprint_id))
  const codes = (links.data ?? []).filter((l) => mine(l.sprint_id))
  const sprintName = (id: string) => sprints.data?.find((s) => s.id === id)?.name ?? 'a sprint'

  const manage = (m: MemberInfo) =>
    m.is_you ? (
      <Popover.Root>
        <Popover.Trigger asChild>
          <button type="button" className="icon-btn person-menu" aria-label="Your membership" disabled={!!busy}>
            <MoreHorizontal className="size-4" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="end" sideOffset={4} className="menu-panel anim-rise">
            <Popover.Close asChild>
              <button type="button" className="menu-item menu-item--danger" onClick={() => setLeaving(true)}>Leave workspace…</button>
            </Popover.Close>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    ) : owner ? (
      <Popover.Root>
        <Popover.Trigger asChild>
          <button type="button" className="icon-btn person-menu" aria-label={`Manage ${m.display_name}`} disabled={!!busy}>
            <MoreHorizontal className="size-4" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="end" sideOffset={4} className="menu-panel anim-rise">
            <Popover.Close asChild>
              <button
                type="button"
                className="menu-item"
                onClick={() => act(m.account_id, () => patch(`${base}/members/${m.account_id}`, { role: m.role === 'owner' ? 'member' : 'owner' }), m.role === 'owner' ? `${m.display_name} is now a member` : `${m.display_name} is now an owner`)}
              >
                {m.role === 'owner' ? 'Make a member' : 'Make an owner'}
              </button>
            </Popover.Close>
            <div className="my-1 h-px bg-line" role="separator" />
            <Popover.Close asChild>
              <button type="button" className="menu-item menu-item--danger" onClick={() => setRemoving(m)}>Remove from workspace…</button>
            </Popover.Close>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    ) : null

  const person = (m: MemberInfo) => (
    <li key={m.account_id} className="person" data-you={m.is_you || undefined}>
      <span className="person-mark" aria-hidden>{initials(m.display_name)}</span>
      <span className="person-main">
        <span className="person-name">
          {m.display_name}
          {m.is_you ? <span className="person-you"> (you)</span> : null}
        </span>
        {m.email ? <span className="person-meta">{m.email}</span> : null}
      </span>
      <span className="person-side">Joined {joined(m.joined_at)}</span>
      <span className="person-act">{manage(m)}</span>
    </li>
  )

  return (
    <>
      {canInvite ? (
        <SectionActions>
          <Popover.Root>
            <Popover.Trigger asChild>
              <button type="button" className="ws-btn ws-btn--primary">
                <UserPlus className="size-4" aria-hidden /> Invite <ChevronDown className="size-4 opacity-70" aria-hidden />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content align="end" sideOffset={6} className="menu-panel anim-rise w-[min(19rem,calc(100vw-24px))]">
                <Popover.Close asChild>
                  <button type="button" className="menu-item items-start" onClick={() => setInviting('email')}>
                    <Mail className="mt-0.5 size-4 shrink-0 text-ink-soft" aria-hidden />
                    <span><span className="block font-medium">By email</span><span className="block text-[13px] text-ink-soft">A link that works once, for one address.</span></span>
                  </button>
                </Popover.Close>
                <Popover.Close asChild>
                  <button type="button" className="menu-item items-start" onClick={() => setInviting('qr')}>
                    <QrCode className="mt-0.5 size-4 shrink-0 text-ink-soft" aria-hidden />
                    <span><span className="block font-medium">With a link or QR</span><span className="block text-[13px] text-ink-soft">No email needed. A team QR you approve, or a personal link.</span></span>
                  </button>
                </Popover.Close>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </SectionActions>
      ) : null}

      <div className="people-lede">
        <p>
          <strong className="font-medium text-ink">{d.members.length} {d.members.length === 1 ? 'person' : 'people'}</strong> in this workspace.{' '}
          {owner ? 'As an owner you can invite people, change roles and remove people.' : canInvite ? 'You can invite people to the sprints you facilitate; owners invite people to the workspace.' : 'Owners invite people to the workspace; facilitators, to their sprints.'}
        </p>
        {d.members.length > SEARCH_FROM ? (
          <label className="people-search">
            <Search className="size-4 shrink-0 text-ink-faint" aria-hidden />
            <span className="sr-only">Find a person</span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a person" autoComplete="off" />
          </label>
        ) : null}
      </div>

      {d.members.length === 1 && canInvite ? <section className="people-welcome" aria-labelledby="people-welcome-title"><div><p className="ws-eyebrow">There’s room at the table</p><h2 id="people-welcome-title">Reflection is better <em>together.</em></h2><p>Invite a teammate to this workspace, or bring them straight into a sprint. They’ll have their own space to write.</p></div><div className="people-welcome-actions"><button type="button" className="ws-btn ws-btn--secondary" onClick={() => setInviting('email')}><Mail className="size-4" aria-hidden /> Invite by email</button><button type="button" className="ws-link" onClick={() => setInviting('qr')}>Share a link or QR</button></div></section> : null}
      {sprints.error ? <p className="ws-inline-error" role="alert">Couldn’t check the sprints you facilitate. <button type="button" className="ws-link" onClick={() => void sprints.reload()}>Try again</button></p> : null}

      {waiting.length ? (
        <section className="ws-section ws-section--attention" aria-labelledby="asking">
          <div className="ws-section-head">
            <h2 id="asking" className="ws-section-title">Asking to join <span className="ws-count">{waiting.length}</span></h2>
            <p className="ws-section-note">Approve only people you recognise. Names are chosen by whoever asks; an email address, when there is one, was confirmed with a code.</p>
          </div>
          <ul className="people">
            {waiting.map((r) => (
              <li key={r.id} className="person person--request">
                <span className="person-mark person-mark--open" aria-hidden>{initials(r.display_name)}</span>
                <span className="person-main">
                  <span className="person-name">{r.display_name}</span>
                  <span className="person-meta">{r.email ?? (r.has_passkey ? 'No email · signs in with a passkey' : 'No email on this account')}</span>
                  <span className="person-meta">Asked {ago(r.requested_at)} · account made {ago(r.account_created_at)}{r.sprint_name ? ` · for ${r.sprint_name}` : ''}</span>
                  {r.matches_email_invitation || r.previously_member || r.link_turned_off ? (
                    <span className="person-flags">
                      {[r.matches_email_invitation && 'Matches an email invitation you sent', r.previously_member && 'Was in this workspace before', r.link_turned_off && 'Code since turned off'].filter(Boolean).join(' · ')}
                    </span>
                  ) : null}
                </span>
                <span className="person-decide">
                  <Button size="sm" variant="ghost" busy={busy === r.id} disabled={!!busy} onClick={() => decide(r, 'decline')}>Decline</Button>
                  <Button size="sm" variant="primary" busy={busy === r.id} disabled={!!busy} onClick={() => decide(r, 'approve')}>Approve</Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : requests.error && canInvite ? (
        <p className="ws-inline-error" role="alert">Couldn’t check for people asking to join. <button type="button" className="ws-link" onClick={() => void requests.reload()}>Try again</button></p>
      ) : null}

      {query.trim() && found.length === 0 ? (
        <p className="ws-empty" role="status">No one here matches “{query.trim()}”. <button type="button" className="ws-link" onClick={() => setQuery('')}>Clear search</button></p>
      ) : (
        <>
          {owners.length ? (
            <section className="ws-section" aria-labelledby="owners">
              <div className="ws-section-head">
                <h2 id="owners" className="ws-section-title">Owners <span className="ws-count">{owners.length}</span></h2>
                <p className="ws-section-note">
                  Manage people and settings.
                  {owner && d.members.length > 1 && d.members.filter((m) => m.role === 'owner').length === 1 ? ' You’re the only one: make someone you trust an owner too, so the workspace isn’t stuck if you ever lose your passkey.' : ''}
                </p>
              </div>
              <ul className="people">{owners.map(person)}</ul>
            </section>
          ) : null}
          {members.length ? (
            <section className="ws-section" aria-labelledby="members">
              <div className="ws-section-head">
                <h2 id="members" className="ws-section-title">Members <span className="ws-count">{members.length}</span></h2>
                <p className="ws-section-note">Write in the sprints they’re part of, and take part in retros.</p>
              </div>
              <ul className="people">{members.map(person)}</ul>
            </section>
          ) : null}
        </>
      )}

      {forWorkspace && d.pending_invitations.length ? (
        <section className="ws-section" aria-labelledby="invited">
          <div className="ws-section-head">
            <h2 id="invited" className="ws-section-title">Invited by email <span className="ws-count">{d.pending_invitations.length}</span></h2>
            <p className="ws-section-note">Waiting for them to open the link. Links expire after 14 days.</p>
          </div>
          <ul className="people">
            {d.pending_invitations.map((i) => (
              <li key={i.id} className="person person--quiet">
                <span className="person-mark person-mark--open" aria-hidden><Mail className="size-3.5" /></span>
                <span className="person-main">
                  <span className="person-name person-name--email">{i.email}</span>
                  <span className="person-meta">Expires {shortDate(i.expires_at.slice(0, 10))}{i.sprint_id ? ` · joins ${sprintName(i.sprint_id)}` : ''}</span>
                </span>
                <span className="person-act">
                  <Button size="sm" variant="ghost" busy={busy === i.id} disabled={!!busy} onClick={() => act(i.id, () => del(`${base}/invitations/${i.id}`), 'Invitation withdrawn')}>Withdraw</Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {codes.length ? (
        <section className="ws-section" aria-labelledby="codes">
          <div className="ws-section-head">
            <h2 id="codes" className="ws-section-title">Invite codes <span className="ws-count">{codes.length}</span></h2>
            <p className="ws-section-note">Team QR codes and personal links that work now. Turning one off stops it at once; anyone who already asked stays above.</p>
          </div>
          <ul className="people">
            {codes.map((l) => (
              <li key={l.id} className="person person--quiet">
                <span className="person-mark person-mark--open" aria-hidden><QrCode className="size-3.5" /></span>
                <span className="person-main">
                  <span className="person-name">{l.mode === 'direct' ? 'Personal link' : 'Team QR'} · {l.sprint_name ? `${l.sprint_name} (sprint)` : 'workspace'}</span>
                  <span className="person-meta">By {l.created_by_name} · until {when(l.expires_at)}{l.mode === 'direct' ? ' · unused' : ` · ${l.request_count} of ${l.max_requests} requests`}</span>
                </span>
                <span className="person-act">
                  <Button size="sm" variant="ghost" busy={busy === l.id} disabled={!!busy} onClick={() => act(l.id, () => del(`${base}/join-links/${l.id}`), 'Invite code turned off')}>Turn off</Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {links.error && canInvite ? <p className="ws-inline-error" role="alert">Couldn’t load the invite codes. <button type="button" className="ws-link" onClick={() => void links.reload()}>Try again</button></p> : null}

      <InviteDialog open={inviting === 'email'} onClose={() => setInviting(null)} workspaceId={ws.id} sprints={facilitating} canWorkspace={forWorkspace} onInvited={() => store.invalidate(base)} />
      <InviteQrDialog
        open={inviting === 'qr'}
        onClose={() => {
          setInviting(null)
          store.invalidate(base)
        }}
        workspaceId={ws.id}
        workspaceName={ws.name}
        canWorkspace={forWorkspace}
        sprints={facilitating}
        onChanged={() => store.invalidate(base)}
      />
      <LeaveWorkspaceDialog open={leaving} onClose={() => setLeaving(false)} workspace={{ id: ws.id, name: ws.name }} />
      <Dialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.display_name ?? ''}?`}
        description={blockedBy.length ? undefined : 'They lose access to this workspace immediately, including any sprint in progress.'}
      >
        {blockedBy.length ? (
          <>
            <p className="text-[15px]">
              {removing?.display_name} facilitates {list(blockedBy.map((f) => f.name))}, and others are in {blockedBy.length === 1 ? 'it' : 'them'}. Removing them now would leave {blockedBy.length === 1 ? 'that sprint' : 'those sprints'} without anyone to run {blockedBy.length === 1 ? 'it' : 'them'} — and an encrypted sprint without its key.
            </p>
            <p className="mt-2 text-sm text-ink-soft">Ask them to choose another facilitator in the sprint’s setup. If they can’t — they’ve lost their passkey, say — open {blockedBy.length === 1 ? 'the sprint' : 'each sprint'} and choose <strong>More → Take over facilitating…</strong>. Then you can remove them.</p>
            <ul className="mt-3 grid gap-1 text-sm">
              {blockedBy.map((f) => <li key={f.id}><Link className="underline underline-offset-4" to={`/sprints/${f.id}`}>Open {f.name}</Link></li>)}
            </ul>
          </>
        ) : (
          <p className="text-sm text-ink-soft">Thoughts they already submitted stay in their sprints, still without their name. They can be invited again later.</p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRemoving(null)}>{blockedBy.length ? 'Close' : 'Cancel'}</Button>
          {blockedBy.length ? null : (
            <Button
              variant="danger"
              busy={busy === 'remove'}
              onClick={async () => {
                const m = removing
                if (!m || busy === 'remove') return
                setBusy('remove')
                try {
                  await del(`${base}/members/${m.account_id}`)
                  setRemoving(null)
                  toast(`${m.display_name} was removed`)
                  await changed()
                } catch (e) {
                  // Facilitation may have changed since the page loaded: say why, here, and keep the dialog open.
                  if (e instanceof ApiError && e.code === 'facilitating') setRefused((e.details.sprints as { id: string; name: string }[]) ?? [])
                  else {
                    setRemoving(null)
                    toast(e instanceof ApiError ? (e.status === 0 ? 'You’re offline, so nothing changed.' : sentence(e.message)) : 'Couldn’t make that change', 'danger')
                  }
                  store.invalidate(base)
                } finally {
                  setBusy(null)
                }
              }}
            >
              Remove
            </Button>
          )}
        </div>
      </Dialog>
    </>
  )
}
