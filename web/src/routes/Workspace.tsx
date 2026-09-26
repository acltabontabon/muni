import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowRight, Plus, UserPlus, X } from 'lucide-react'
import { ApiError, del, get, patch, post } from '@/api/client'
import type { AuditEvent, Experiment, SprintSummary, WorkspaceDetail } from '@/api/types'
import { OUTCOME_LABEL, STATUS_LABEL } from '@/lib/categories'
import { useAuth } from '@/lib/auth'
import { writePrefs } from '@/lib/prefs'
import { Badge, Button, Dialog, EmptyState, ErrorText, Help, Input, Label, SectionTitle, Spinner, Switch, useDocumentTitle, useToast } from '@/ui'
import { AppShell, PageTitle } from '@/ui/shell'

export function WorkspacePage() {
  const { workspaceId = '' } = useParams()
  const { me, refresh } = useAuth()
  const nav = useNavigate()
  const toast = useToast()
  const [ws, setWs] = useState<WorkspaceDetail | null>(null)
  const [sprints, setSprints] = useState<SprintSummary[] | null>(null)
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [audit, setAudit] = useState<AuditEvent[] | null>(null)
  const [inviting, setInviting] = useState(false)
  const [error, setError] = useState('')
  useDocumentTitle(ws?.workspace.name ?? 'Workspace')
  const load = useCallback(async () => {
    try {
      const [w, s, e] = await Promise.all([get<WorkspaceDetail>(`/api/workspaces/${workspaceId}`), get<SprintSummary[]>(`/api/workspaces/${workspaceId}/sprints`), get<Experiment[]>(`/api/workspaces/${workspaceId}/experiments`)])
      setWs(w)
      setSprints(s)
      setExperiments(e)
      writePrefs({ lastWorkspace: workspaceId })
      if (w.workspace.role === 'owner') get<AuditEvent[]>(`/api/workspaces/${workspaceId}/audit`).then(setAudit).catch(() => {})
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t load this workspace')
    }
  }, [workspaceId])
  useEffect(() => {
    load()
  }, [load])
  if (error)
    return (
      <AppShell>
        <EmptyState title="Can’t open this workspace">{error}</EmptyState>
      </AppShell>
    )
  if (!ws || !sprints)
    return (
      <AppShell>
        <div className="grid place-items-center py-20 text-ink-soft"><Spinner /></div>
      </AppShell>
    )
  const isOwner = ws.workspace.role === 'owner'
  const current = sprints.filter((s) => !['completed', 'archived'].includes(s.status))
  const past = sprints.filter((s) => ['completed', 'archived'].includes(s.status))
  return (
    <AppShell>
      <PageTitle
        eyebrow={ws.workspace.is_demo ? 'Demo workspace · fictional team, fictional data' : 'Workspace'}
        title={ws.workspace.name}
        actions={
          <>
            {ws.can_invite ? <Button onClick={() => setInviting(true)}><UserPlus className="size-4" /> Invite</Button> : null}
            <Button variant="primary" onClick={() => nav(`/workspaces/${workspaceId}/sprints/new`)}><Plus className="size-4" /> New sprint</Button>
          </>
        }
      />
      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-8">
          <section>
            <SectionTitle>Sprints</SectionTitle>
            {sprints.length === 0 ? (
              <EmptyState title="No sprints yet" action={<Button variant="primary" onClick={() => nav(`/workspaces/${workspaceId}/sprints/new`)}>Set up the first sprint</Button>}>
                A sprint has dates, a retro time and a list of participants. Once it’s collecting, everyone can add thoughts as things happen.
              </EmptyState>
            ) : (
              <ol className="relative space-y-3 border-l border-line pl-5">
                {[...current, ...past].map((s) => (
                  <li key={s.id} className="relative">
                    <span aria-hidden className={`absolute -left-[26px] top-5 size-2.5 rounded-full ${s.status === 'collecting' ? 'bg-accent' : s.status === 'live' ? 'bg-ok' : 'bg-line'}`} />
                    <Link to={`/sprints/${s.id}`} className="card block p-4 transition-colors hover:border-ink/30">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-display text-lg">{s.name}</div>
                        <Badge tone={s.status === 'collecting' ? 'accent' : s.status === 'live' ? 'ok' : 'neutral'}>{STATUS_LABEL[s.status]}</Badge>
                      </div>
                      <div className="mt-1 text-sm text-ink-soft">
                        {s.starts_on} → {s.ends_on} · retro {s.retro_local} · {s.participant_count} people{s.facilitator_name ? ` · facilitated by ${s.facilitator_name}` : ''}
                      </div>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section>
            <SectionTitle>Experiments so far</SectionTitle>
            {experiments.length === 0 ? (
              <p className="text-ink-soft">Nothing yet. Experiments agreed at a retro show up here with their outcome.</p>
            ) : (
              <ul className="space-y-2">
                {experiments.map((e) => (
                  <li key={e.id} className="card p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-medium">{e.change_to_try}</p>
                      <Badge tone={e.status === 'helped' ? 'ok' : e.status === 'did_not_help' ? 'danger' : 'neutral'}>{OUTCOME_LABEL[e.status]}</Badge>
                    </div>
                    <div className="mt-1 text-sm text-ink-soft">
                      {e.sprint_name} · {e.owner_name ? `owner ${e.owner_name}` : 'no owner'} · review {e.review_on}
                    </div>
                    {e.outcome_note ? <p className="mt-1 text-sm">{e.outcome_note}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <div className="space-y-8">
          <section>
            <SectionTitle aside={`${ws.members.length}`}>Members</SectionTitle>
            <ul className="card divide-y divide-line">
              {ws.members.map((m) => (
                <li key={m.account_id} className="flex items-center justify-between gap-2 p-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {m.display_name} {m.is_you ? <span className="text-ink-faint">(you)</span> : null}
                    </div>
                    <div className="truncate text-xs text-ink-soft">{m.email ?? m.role}</div>
                  </div>
                  {isOwner && !m.is_you ? (
                    <div className="flex items-center gap-1">
                      <button className="rounded-full px-2 py-1 text-xs text-ink-soft hover:bg-ink/6" onClick={async () => { await patch(`/api/workspaces/${workspaceId}/members/${m.account_id}`, { role: m.role === 'owner' ? 'member' : 'owner' }); load() }}>
                        {m.role === 'owner' ? 'Make member' : 'Make owner'}
                      </button>
                      <button
                        className="rounded-full p-1.5 text-ink-soft hover:bg-danger/10 hover:text-danger"
                        aria-label={`Remove ${m.display_name}`}
                        onClick={async () => {
                          if (!confirm(`Remove ${m.display_name} from this workspace? They lose access immediately.`)) return
                          await del(`/api/workspaces/${workspaceId}/members/${m.account_id}`)
                          toast('Member removed')
                          load()
                        }}
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
            {ws.pending_invitations.length ? (
              <ul className="mt-3 space-y-1 text-sm">
                {ws.pending_invitations.map((i) => (
                  <li key={i.id} className="flex items-center justify-between rounded-lg border border-dashed border-line px-3 py-2">
                    <span className="truncate text-ink-soft">{i.email} · invited</span>
                    <button className="text-xs text-ink-faint hover:text-danger" onClick={async () => { await del(`/api/workspaces/${workspaceId}/invitations/${i.id}`); load() }}>withdraw</button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
          {isOwner ? <Settings ws={ws} onSaved={async () => { await load(); await refresh() }} /> : null}
          {isOwner && audit ? (
            <section>
              <SectionTitle>Recent actions</SectionTitle>
              <ul className="card max-h-64 divide-y divide-line overflow-y-auto text-xs">
                {audit.slice(0, 40).map((a) => (
                  <li key={a.id} className="flex justify-between gap-2 px-3 py-2">
                    <span><span className="text-ink">{a.actor_name ?? 'system'}</span> <span className="text-ink-soft">{a.action}</span></span>
                    <span className="shrink-0 text-ink-faint">{new Date(a.created_at).toLocaleDateString()}</span>
                  </li>
                ))}
              </ul>
              <Help>Audit events record who changed what, by id. They never contain entry text or link a person to an entry.</Help>
            </section>
          ) : null}
          {me?.workspaces.length && !ws.workspace.is_demo ? null : null}
        </div>
      </div>
      <InviteDialog open={inviting} onClose={() => setInviting(false)} workspaceId={workspaceId} sprints={current} onInvited={load} />
    </AppShell>
  )
}

function Settings({ ws, onSaved }: { ws: WorkspaceDetail; onSaved: () => void }) {
  const toast = useToast()
  const [name, setName] = useState(ws.workspace.name)
  const [retention, setRetention] = useState(String(ws.workspace.retention_days))
  const [outcome, setOutcome] = useState(String(ws.workspace.outcome_retention_days))
  const [aiDefault, setAiDefault] = useState(ws.workspace.ai_enabled_default)
  const [error, setError] = useState('')
  const save = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await patch(`/api/workspaces/${ws.workspace.id}`, { name, retention_days: Number(retention), outcome_retention_days: Number(outcome), ai_enabled_default: aiDefault })
      toast('Settings saved')
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t save')
    }
  }
  return (
    <section>
      <SectionTitle>Settings</SectionTitle>
      <form onSubmit={save} className="card space-y-4 p-4">
        <div>
          <Label htmlFor="ws-name">Name</Label>
          <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="ret">Keep raw notes (days)</Label>
            <Input id="ret" type="number" min={7} max={3650} value={retention} onChange={(e) => setRetention(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="oret">Keep outcomes (days)</Label>
            <Input id="oret" type="number" min={30} max={3650} value={outcome} onChange={(e) => setOutcome(e.target.value)} />
          </div>
        </div>
        <Help>After a sprint finishes, entries, themes, notes and AI drafts are deleted once the first window passes. Accepted experiments and published recaps stay for the second window so the next retro can revisit them.</Help>
        <Switch id="ai-default" checked={aiDefault} onCheckedChange={setAiDefault} label="Suggest AI assistance for new sprints" description={ws.workspace.ai_provider === 'none' ? 'No AI provider is configured on this server, so this only sets the default for later.' : `Provider on this server: ${ws.workspace.ai_provider}. Each sprint still chooses before collection starts.`} />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" variant="primary" size="sm">Save settings</Button>
      </form>
    </section>
  )
}

function InviteDialog({ open, onClose, workspaceId, sprints, onInvited }: { open: boolean; onClose: () => void; workspaceId: string; sprints: SprintSummary[]; onInvited: () => void }) {
  const [email, setEmail] = useState('')
  const [sprint, setSprint] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<string | null>(null)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Invite a teammate" description="They get an email with a link. Joining requires confirming that exact address, so forwarding the link doesn’t let someone else in.">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError('')
          setDone(null)
          try {
            const r = await post<{ already_member: boolean; email: string }>(`/api/workspaces/${workspaceId}/invitations`, { email, sprint_id: sprint || undefined })
            setDone(r.already_member ? `${r.email} is already a member${sprint ? ' and was added to the sprint' : ''}.` : `Invitation sent to ${r.email}.`)
            setEmail('')
            onInvited()
          } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Couldn’t invite')
          } finally {
            setBusy(false)
          }
        }}
      >
        <div>
          <Label htmlFor="inv-email">Email</Label>
          <Input id="inv-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </div>
        {sprints.length ? (
          <div>
            <Label htmlFor="inv-sprint" hint="optional">Add to sprint</Label>
            <select id="inv-sprint" className="w-full rounded-xl border border-line bg-card px-3.5 py-2.5" value={sprint} onChange={(e) => setSprint(e.target.value)}>
              <option value="">Just the workspace</option>
              {sprints.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        ) : null}
        <ErrorText>{error}</ErrorText>
        {done ? <p className="text-sm text-ok">{done}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Done</Button>
          <Button type="submit" variant="primary" busy={busy}>Send invitation <ArrowRight className="size-4" /></Button>
        </div>
      </form>
    </Dialog>
  )
}
