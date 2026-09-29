/**
 * Settings: a few decisions, each with its title and a line of why on the left and the control on
 * the right, then one Save for the form. Edits not yet saved are kept (in memory, for this account)
 * while you look at another section, and the page says so; leaving Muni with them asks first.
 * Below, the workspace's activity: who changed what, never what anyone wrote.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ApiError, patch } from '@/api/client'
import type { AuditEvent, SprintSummary, WorkspaceDetail } from '@/api/types'
import { describeEvent } from '@/lib/audit'
import { useAuth } from '@/lib/auth'
import { useResource, useResources } from '@/lib/resource'
import { Button, ErrorText, Input, useDocumentTitle, useToast } from '@/ui'
import { sentence } from '@/ui/invite-email'
import { SectionError, SectionPending, useWorkspaceShell } from './Layout'

type Draft = { name: string; retention: string; outcome: string }
/** Unsaved edits, per account and workspace, for as long as this page is open. Never stored. */
const drafts = new Map<string, Draft>()

const LIMITS = { retention: [7, 3650], outcome: [30, 3650] } as const
function problems(v: Draft) {
  const out: Partial<Record<keyof Draft, string>> = {}
  if (!v.name.trim()) out.name = 'Give the workspace a name.'
  for (const k of ['retention', 'outcome'] as const) {
    const n = Number(v[k])
    const [lo, hi] = LIMITS[k]
    if (!/^\d+$/.test(v[k].trim()) || n < lo || n > hi) out[k] = `Between ${lo} and ${hi} days.`
  }
  return out
}

export function WorkspaceSettings() {
  const { ws } = useWorkspaceShell()
  useDocumentTitle(`Settings · ${ws.name}`)
  const detail = useResource<WorkspaceDetail>(`/api/workspaces/${ws.id}`)
  if (ws.role !== 'owner') return <p className="ws-empty">Only workspace owners can change these settings.</p>
  if (detail.error) return <SectionError error={detail.error} onRetry={() => void detail.reload()} what="this workspace’s settings" />
  if (!detail.data) return <SectionPending label="Loading settings" rows={4} />
  return (
    <>
      <SettingsForm d={detail.data} />
      <Activity workspaceId={ws.id} />
    </>
  )
}

function SettingsForm({ d }: { d: WorkspaceDetail }) {
  const { me, refresh } = useAuth()
  const store = useResources()
  const toast = useToast()
  const key = `${me?.account_id}:${d.workspace.id}`
  const saved: Draft = { name: d.workspace.name, retention: String(d.workspace.retention_days), outcome: String(d.workspace.outcome_retention_days) }
  const [draft, setDraftState] = useState<Draft | null>(() => drafts.get(key) ?? null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState(false)
  const v = draft ?? saved
  const dirty = !!draft && (draft.name !== saved.name || draft.retention !== saved.retention || draft.outcome !== saved.outcome)
  const bad = problems(v)
  const setDraft = (next: Draft | null) => {
    setDraftState(next)
    if (next) drafts.set(key, next)
    else drafts.delete(key)
  }
  const edit = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...v, [k]: e.target.value })

  // Closing the tab or reloading with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setTried(true)
    setError('')
    if (Object.keys(bad).length) return
    setBusy(true)
    try {
      await patch(`/api/workspaces/${d.workspace.id}`, { name: v.name.trim(), retention_days: Number(v.retention), outcome_retention_days: Number(v.outcome) })
      // Read what was saved before letting go of the draft, so the old values never flash back.
      store.invalidate(`/api/workspaces/${d.workspace.id}`)
      store.invalidate('/api/me/capture-target')
      await Promise.all([refresh(), store.load(`/api/workspaces/${d.workspace.id}`).catch(() => {})])
      setDraft(null)
      setTried(false)
      toast('Settings saved')
    } catch (err) {
      setError(err instanceof ApiError ? (err.status === 0 ? 'You’re offline, so nothing was saved. Your changes are still here.' : sentence(err.message)) : 'Couldn’t save.')
    } finally {
      setBusy(false)
    }
  }
  const show = (k: keyof Draft) => (tried || (draft && draft[k] !== saved[k]) ? bad[k] : undefined)

  return (
    <form onSubmit={save} noValidate aria-label="Workspace settings">
      <section className="ws-section" aria-labelledby="set-name">
        <div className="ws-section-head">
          <h2 id="set-name" className="ws-section-title">Name</h2>
          <p className="ws-section-note">What everyone in the workspace sees.</p>
        </div>
        <div className="settings-field">
          <label htmlFor="ws-name" className="settings-label">Workspace name</label>
          <Input id="ws-name" value={v.name} onChange={edit('name')} maxLength={80} required aria-invalid={!!show('name') || undefined} aria-describedby={show('name') ? 'ws-name-error' : undefined} />
          {show('name') ? <p id="ws-name-error" className="settings-error">{show('name')}</p> : null}
        </div>
      </section>

      <section className="ws-section" aria-labelledby="set-keep">
        <div className="ws-section-head">
          <h2 id="set-keep" className="ws-section-title">How long things are kept</h2>
          <p className="ws-section-note">Counted from when a sprint finishes. <Link to="/privacy#retention" className="underline underline-offset-2">About retention</Link></p>
        </div>
        <div className="settings-pair">
          <div className="settings-field">
            <label htmlFor="ret" className="settings-label">Thoughts, themes and notes</label>
            <div className="settings-days">
              <Input id="ret" inputMode="numeric" value={v.retention} onChange={edit('retention')} aria-invalid={!!show('retention') || undefined} aria-describedby="ret-help" />
              <span>days</span>
            </div>
            <p id="ret-help" className={show('retention') ? 'settings-error' : 'settings-help'}>{show('retention') ?? 'Then they’re deleted. 7 to 3650.'}</p>
          </div>
          <div className="settings-field">
            <label htmlFor="oret" className="settings-label">Experiments and recaps</label>
            <div className="settings-days">
              <Input id="oret" inputMode="numeric" value={v.outcome} onChange={edit('outcome')} aria-invalid={!!show('outcome') || undefined} aria-describedby="oret-help" />
              <span>days</span>
            </div>
            <p id="oret-help" className={show('outcome') ? 'settings-error' : 'settings-help'}>{show('outcome') ?? 'Kept longer, so the next retro can revisit them. 30 to 3650.'}</p>
          </div>
        </div>
      </section>

      <div className="settings-save">
        <div className="settings-save-inner">
          <Button type="submit" variant="primary" busy={busy} disabled={!dirty}>Save changes</Button>
          {dirty ? (
            <>
              <button type="button" className="ws-link" onClick={() => { setDraft(null); setTried(false); setError('') }}>Discard</button>
              <span className="settings-status" role="status">Unsaved changes</span>
            </>
          ) : (
            <span className="settings-status" role="status">All changes saved</span>
          )}
        </div>
        <ErrorText>{error}</ErrorText>
      </div>
    </form>
  )
}

function Activity({ workspaceId }: { workspaceId: string }) {
  const events = useResource<AuditEvent[]>(`/api/workspaces/${workspaceId}/audit`)
  const sprints = useResource<SprintSummary[]>(`/api/workspaces/${workspaceId}/sprints`)
  const [n, setN] = useState(15)
  const name = (id: string) => sprints.data?.find((s) => s.id === id)?.name
  const list = events.data
  return (
    <section className="ws-section" aria-labelledby="activity">
      <div className="ws-section-head">
        <h2 id="activity" className="ws-section-title">Activity</h2>
        <p className="ws-section-note">Who changed what. It never includes what anyone wrote, and never links a person to a thought.</p>
      </div>
      <div className="min-w-0">
        {events.error ? (
          <p className="ws-inline-error" role="alert">Couldn’t load the activity. <button type="button" className="ws-link" onClick={() => void events.reload()}>Try again</button></p>
        ) : !list || sprints.loading ? (
          <SectionPending label="Loading activity" rows={5} />
        ) : list.length === 0 ? (
          <p className="ws-empty">Nothing yet.</p>
        ) : (
          <>
            <ol className="activity">
              {list.slice(0, n).map((e) => {
                const d = describeEvent(e, name)
                return (
                  <li key={e.id}>
                    <time dateTime={e.created_at}>{new Date(e.created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
                    <span className="min-w-0">
                      <span className="font-medium">{d.who}</span> {d.what}
                      {d.where ? <span className="text-ink-soft"> · {d.where}</span> : null}
                    </span>
                  </li>
                )
              })}
            </ol>
            {list.length > n ? <button type="button" className="ws-link mt-4" onClick={() => setN((x) => x + 50)}>Show older</button> : null}
          </>
        )}
      </div>
    </section>
  )
}
