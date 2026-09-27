/**
 * Team invitations for managers: the invite QR (a shared link that lets people *ask* to join),
 * the codes that are active, and the requests waiting for a decision.
 *
 * The QR encodes nothing but the ordinary https://…/join#<token> link. It holds no session, no
 * sign-in secret and no encryption key; the token is useless without a person approving.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import qrcode from 'qrcode-generator'
import { Check, Copy, QrCode, UserCheck, UserX } from 'lucide-react'
import { ApiError, del, get, post } from '@/api/client'
import type { JoinLinkInfo, JoinRequestInfo, SprintSummary } from '@/api/types'
import { Button, Dialog, ErrorText, useToast } from '@/ui'

const date = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const ago = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  return days < 1 ? 'today' : days === 1 ? 'yesterday' : days < 60 ? `${days} days ago` : `on ${new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
}
const problem = (e: unknown, doing: string) => (e instanceof ApiError && e.status === 0 ? 'You’re offline, so nothing changed.' : `Couldn’t ${doing}: ${e instanceof ApiError ? e.message : 'something went wrong'}.`)

/** Links shown in this page session only (memory, never storage): the server keeps just a fingerprint. */
const shown = new Map<string, { url: string; link: JoinLinkInfo }>()
const scopeKey = (workspaceId: string, sprintId: string | null, mode: 'approval' | 'direct' = 'approval') => `${workspaceId}:${sprintId ?? ''}:${mode}`

export function QrImage({ value, label }: { value: string; label: string }) {
  const { d, n } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(value)
    qr.make()
    const count = qr.getModuleCount()
    let path = ''
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (qr.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`
    return { d: path, n: count }
  }, [value])
  // Always dark on light with a quiet zone, whatever the theme: that's what cameras read best.
  return (
    <svg viewBox={`-4 -4 ${n + 8} ${n + 8}`} role="img" aria-label={label} className="block aspect-square w-full max-w-[16rem] rounded-2xl" shapeRendering="crispEdges">
      <rect x="-4" y="-4" width={n + 8} height={n + 8} fill="#ffffff" />
      <path d={d} fill="#161412" />
    </svg>
  )
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 2000)
        } catch {
          window.prompt('Copy this invite link', url)
        }
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? 'Copied' : 'Copy invite link'}
    </Button>
  )
}

type Scope = { id: string | null; name: string }

export function InviteQrDialog({ open, onClose, workspaceId, workspaceName, canWorkspace, sprints, onChanged }: { open: boolean; onClose: () => void; workspaceId: string; workspaceName: string; canWorkspace: boolean; sprints: Pick<SprintSummary, 'id' | 'name'>[]; onChanged: () => void }) {
  const scopes: Scope[] = useMemo(() => [...(canWorkspace ? [{ id: null, name: workspaceName }] : []), ...sprints.map((s) => ({ id: s.id, name: s.name }))], [canWorkspace, workspaceName, sprints])
  const [scope, setScope] = useState<string>('')
  const [mode, setMode] = useState<'approval' | 'direct'>('approval')
  const [hours, setHours] = useState(168)
  const [cap, setCap] = useState(30)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [existing, setExisting] = useState<JoinLinkInfo | null>(null)
  const [current, setCurrent] = useState<{ url: string; link: JoinLinkInfo } | null>(null)
  const sprintId = scope === '' ? (scopes[0]?.id ?? null) : scope === 'ws' ? null : scope
  useEffect(() => {
    if (!open) return
    setError('')
    setExisting(null)
    // A personal link is for one person: never re-shown, a new one each time.
    setCurrent(mode === 'approval' ? (shown.get(scopeKey(workspaceId, sprintId)) ?? null) : null)
  }, [open, workspaceId, sprintId, mode])

  const create = async (replace: boolean) => {
    setBusy(true)
    setError('')
    try {
      const r = await post<{ link: JoinLinkInfo; url: string }>(`/api/workspaces/${workspaceId}/join-links`, { sprint_id: sprintId ?? undefined, expires_in_hours: mode === 'direct' ? Math.min(hours, 168) : hours, max_requests: cap, replace, mode })
      if (mode === 'approval') shown.set(scopeKey(workspaceId, sprintId), r)
      setCurrent(r)
      setExisting(null)
      onChanged()
    } catch (e) {
      if (e instanceof ApiError && e.code === 'link_exists') setExisting(e.details.link as JoinLinkInfo)
      else setError(problem(e, 'make an invite code'))
    } finally {
      setBusy(false)
    }
  }
  const turnOff = async (id: string) => {
    setBusy(true)
    setError('')
    try {
      await del(`/api/workspaces/${workspaceId}/join-links/${id}`)
      shown.delete(scopeKey(workspaceId, sprintId))
      setCurrent(null)
      setExisting(null)
      onChanged()
    } catch (e) {
      setError(problem(e, 'turn it off'))
    } finally {
      setBusy(false)
    }
  }
  const scopeName = scopes.find((s) => s.id === sprintId)?.name ?? workspaceName

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Invite with a link or QR" description="No email address needed. Either people scan a team QR and you approve each one, or you send one person a personal link that works once.">
      {current ? (
        <div className="grid gap-4">
          <div className="grid justify-items-center gap-3 rounded-2xl bg-ink/[0.04] p-4">
            <QrImage value={current.url} label={`Invite QR code for ${scopeName}`} />
            <p className="text-center text-sm font-medium">{current.link.mode === 'direct' ? `Personal invite to ${scopeName}` : `Scan to join ${scopeName}`}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CopyLink url={current.url} />
            <Button size="sm" variant="ghost" busy={busy} onClick={() => turnOff(current.link.id)}>Turn off this code</Button>
            {current.link.mode === 'approval' ? (
              <Button size="sm" variant="ghost" onClick={() => { setMode('direct'); setHours(24); setCurrent(null) }}>Personal link instead</Button>
            ) : null}
          </div>
          {current.link.mode === 'direct' ? (
            <p className="text-sm text-ink-soft">
              Works once, until {date(current.link.expires_at)}. Whoever opens it first and signs in joins as a member{current.link.sprint_id ? ' and participant in this sprint' : ''} — so send it only to the person you mean, privately. It doesn’t sign anyone in; they use their own passkey.
            </p>
          ) : (
            <p className="text-sm text-ink-soft">
              Works until {date(current.link.expires_at)}, for up to {current.link.max_requests} requests. Joins as a member{current.link.sprint_id ? ' and participant in this sprint' : ''} — never as an owner. The link is an equal alternative to scanning: send it to anyone who can’t scan.
            </p>
          )}
          {current.link.mode === 'direct' ? (
            <Button size="sm" variant="ghost" className="justify-self-start" onClick={() => setCurrent(null)}>Make another personal link</Button>
          ) : (
            <JoinRequests workspaceId={workspaceId} sprintId={current.link.sprint_id} live onDecided={onChanged} />
          )}
        </div>
      ) : existing ? (
        <div className="grid gap-3">
          <p className="text-[15px]">An invite code for {scopeName} is already active — made by {existing.created_by_name}, working until {date(existing.expires_at)}, {existing.request_count} of {existing.max_requests} requests used.</p>
          <p className="text-sm text-ink-soft">Muni keeps only a fingerprint of each code, so it can’t show that one again. Replace it to get a new QR; the old one stops working. Requests already made stay for you to decide.</p>
          <ErrorText>{error}</ErrorText>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" busy={busy} onClick={() => turnOff(existing.id)}>Just turn it off</Button>
            <Button variant="primary" busy={busy} onClick={() => create(true)}>Replace with a new code</Button>
          </div>
        </div>
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void create(false)
          }}
        >
          <fieldset className="grid gap-2">
            <legend className="mb-1.5 text-sm font-medium">Kind of invite</legend>
            {([['approval', 'Team QR', 'Anyone with the code can ask to join; you approve each person. Good for showing on a screen.'], ['direct', 'Personal link', 'For one person you choose. Works once and joins them directly — send it privately.']] as const).map(([value, label, hint]) => (
              <label key={value} className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line px-3.5 py-2.5 text-sm has-[:checked]:border-[color-mix(in_oklab,var(--accent)_55%,var(--line))]">
                <input type="radio" name="invite-mode" className="mt-1 accent-[var(--accent)]" checked={mode === value} onChange={() => { setMode(value); if (value === 'direct' && hours > 168) setHours(24) }} />
                <span><span className="block font-medium">{label}</span><span className="block text-ink-soft">{hint}</span></span>
              </label>
            ))}
          </fieldset>
          {scopes.length > 1 ? (
            <label className="grid gap-1.5 text-sm font-medium">
              Invite to
              <select className="w-full rounded-xl border border-line bg-card px-3.5 py-2.5 font-normal" value={sprintId === null ? 'ws' : sprintId} onChange={(e) => setScope(e.target.value)}>
                {scopes.map((s) => (
                  <option key={s.id ?? 'ws'} value={s.id ?? 'ws'}>{s.id ? `${s.name} (sprint)` : `${s.name} (workspace only)`}</option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1.5 text-sm font-medium">
              Works for
              <select className="w-full rounded-xl border border-line bg-card px-3.5 py-2.5 font-normal" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                <option value={24}>24 hours</option>
                <option value={168}>7 days</option>
                {mode === 'approval' ? <option value={720}>30 days</option> : null}
              </select>
            </label>
            <label className={`grid gap-1.5 text-sm font-medium ${mode === 'direct' ? 'invisible' : ''}`}>
              Up to
              <select className="w-full rounded-xl border border-line bg-card px-3.5 py-2.5 font-normal" value={cap} onChange={(e) => setCap(Number(e.target.value))}>
                <option value={10}>10 requests</option>
                <option value={30}>30 requests</option>
                <option value={100}>100 requests</option>
              </select>
            </label>
          </div>
          <div className="rounded-2xl bg-ink/[0.04] px-4 py-3 text-sm text-ink-soft">
            {mode === 'approval' ? (
              <p><strong className="font-medium text-ink">Who can join?</strong> Anyone who has the code — including from a screenshot — can <em>ask</em>. Each person joins only when approved, as a member. Approve people you recognise: names are chosen by whoever asks, and many accounts have no email address.</p>
            ) : (
              <p><strong className="font-medium text-ink">Who can join?</strong> Whoever opens the link first and signs in, once, as a member. Treat it like a key: send it only to the person you mean. You can turn it off from the People page until it’s used.</p>
            )}
          </div>
          <ErrorText>{error}</ErrorText>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" busy={busy}><QrCode className="size-4" /> {mode === 'direct' ? 'Make a personal link' : 'Show team QR'}</Button>
          </div>
        </form>
      )}
    </Dialog>
  )
}

/**
 * Requests waiting for a decision. `live` (while the QR is on screen) checks every few seconds,
 * backing off, for up to 30 minutes; otherwise on load and when the page regains focus.
 */
export function JoinRequests({ workspaceId, sprintId, live = false, onDecided }: { workspaceId: string; sprintId?: string | null; live?: boolean; onDecided?: () => void }) {
  const toast = useToast()
  const [rows, setRows] = useState<JoinRequestInfo[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const load = useCallback(async () => {
    try {
      const all = await get<JoinRequestInfo[]>(`/api/workspaces/${workspaceId}/join-requests`)
      setRows(sprintId === undefined ? all : all.filter((r) => r.sprint_id === sprintId))
    } catch (e) {
      setError(problem(e, 'load requests'))
    }
  }, [workspaceId, sprintId])
  useEffect(() => {
    void load()
    const onFocus = () => !document.hidden && void load()
    document.addEventListener('visibilitychange', onFocus)
    let n = 0
    const start = Date.now()
    const tick = () => {
      if (Date.now() - start > 30 * 60_000) return
      timer.current = window.setTimeout(async () => {
        if (!document.hidden) await load()
        n++
        tick()
      }, Math.min(5000 + n * 1000, 20_000))
    }
    if (live) tick()
    return () => {
      window.clearTimeout(timer.current)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [load, live])
  const decide = async (r: JoinRequestInfo, verdict: 'approve' | 'decline') => {
    setBusy(r.id)
    setError('')
    try {
      await post(`/api/workspaces/${workspaceId}/join-requests/${r.id}/${verdict}`)
      toast(verdict === 'approve' ? `${r.display_name} joined` : `Declined ${r.display_name}’s request`)
      onDecided?.()
    } catch (e) {
      // Another manager or tab may have decided first: the list below shows how things stand.
      setError(e instanceof ApiError && e.code === 'request_closed' ? `${r.display_name}’s request was already closed (${e.message}).` : problem(e, verdict))
    } finally {
      setBusy(null)
      await load()
    }
  }
  if (rows === null) return error ? <ErrorText>{error}</ErrorText> : null
  return (
    <section aria-labelledby="join-requests">
      <h3 id="join-requests" className="font-display text-lg">Asking to join{rows.length ? ` (${rows.length})` : ''}</h3>
      <p className="text-sm text-ink-soft">Approve only people you recognise. Names are chosen by whoever asks; an email address, when there is one, was confirmed with a code. If you’re unsure, ask them in person.</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink-soft">{live ? 'No requests yet. They’ll appear here as people scan.' : 'No one is waiting.'}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-2xl bg-card text-sm shadow-[0_0_0_1px_var(--line)]">
          {rows.map((r) => (
            <li key={r.id} className="grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <span className="min-w-0">
                <span className="block truncate font-medium">{r.display_name}</span>
                <span className="block truncate text-ink-soft [overflow-wrap:anywhere]">{r.email ?? (r.has_passkey ? 'No email on this account · signs in with a passkey' : 'No email on this account')}</span>
                <span className="mt-1 block text-ink-soft">
                  Asked {ago(r.requested_at)} · account made {ago(r.account_created_at)}
                  {r.sprint_name ? ` · for ${r.sprint_name}` : ''}
                </span>
                <span className="mt-1 flex flex-wrap gap-1.5">
                  {r.matches_email_invitation ? <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent-ink">Matches an email invitation you sent</span> : null}
                  {r.previously_member ? <span className="rounded-full bg-ink/5 px-2 py-0.5 text-xs">Was in this workspace before</span> : null}
                  {r.link_turned_off ? <span className="rounded-full bg-ink/5 px-2 py-0.5 text-xs">Code since turned off</span> : null}
                </span>
              </span>
              <span className="flex gap-2">
                <Button size="sm" variant="ghost" busy={busy === r.id} onClick={() => decide(r, 'decline')}><UserX className="size-4" /> Decline</Button>
                <Button size="sm" variant="primary" busy={busy === r.id} onClick={() => decide(r, 'approve')}><UserCheck className="size-4" /> Approve</Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <ErrorText>{error}</ErrorText>
    </section>
  )
}

/** Active codes, for turning them off from the People page. */
export function ActiveCodes({ workspaceId, version, onChanged }: { workspaceId: string; version: number; onChanged: () => void }) {
  const [links, setLinks] = useState<JoinLinkInfo[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    get<JoinLinkInfo[]>(`/api/workspaces/${workspaceId}/join-links`).then(setLinks).catch(() => setLinks([]))
  }, [workspaceId, version])
  if (!links.length) return null
  return (
    <section className="mt-10" aria-labelledby="codes">
      <h2 id="codes" className="font-display text-lg">Invite codes</h2>
      <p className="text-sm text-ink-soft">Team QR codes and personal links that work now. Turning one off stops it at once; people who already asked stay in the list above.</p>
      <ul className="mt-4 divide-y divide-line rounded-2xl bg-card text-sm shadow-[0_0_0_1px_var(--line)]">
        {links.map((l) => (
          <li key={l.id} className="flex items-center gap-3 p-4">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{l.mode === 'direct' ? 'Personal link' : 'Team QR'} · {l.sprint_name ? `${l.sprint_name} (sprint)` : 'workspace'}</span>
              <span className="block text-ink-soft">By {l.created_by_name} · until {date(l.expires_at)}{l.mode === 'direct' ? ' · unused' : ` · ${l.request_count} of ${l.max_requests} requests`}</span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                try {
                  await del(`/api/workspaces/${workspaceId}/join-links/${l.id}`)
                  onChanged()
                } catch (e) {
                  setError(problem(e, 'turn it off'))
                }
              }}
            >
              Turn off
            </Button>
          </li>
        ))}
      </ul>
      <ErrorText>{error}</ErrorText>
    </section>
  )
}
