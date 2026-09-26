import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArrowRight, Plus } from 'lucide-react'
import { get, post, ApiError } from '@/api/client'
import type { CaptureTarget, Workspace } from '@/api/types'
import { useAuth } from '@/lib/auth'
import { Button, EmptyState, ErrorText, Input, Label, useDocumentTitle } from '@/ui'
import { AppShell, PageTitle } from '@/ui/shell'
import { Mark } from '@/brand/Mark'

export function Home() {
  useDocumentTitle('Home')
  const { me, refresh } = useAuth()
  const nav = useNavigate()
  const [target, setTarget] = useState<CaptureTarget | null>(null)
  const [creating, setCreating] = useState(false)
  useEffect(() => {
    get<CaptureTarget>('/api/me/capture-target').then(setTarget).catch(() => {})
  }, [])
  if (!me) return null
  const collecting = target?.collecting ?? []
  const upcoming = target?.upcoming ?? []
  return (
    <AppShell>
      {collecting.length > 0 ? (
        <section className="card anim-rise mb-8 flex flex-wrap items-center justify-between gap-4 border-sinag/30 bg-[color-mix(in_oklab,var(--sinag)_6%,var(--card))] p-5">
          <div>
            <div className="text-sm text-sinag-ink">A sprint is collecting</div>
            <div className="font-display text-2xl">{collecting.length === 1 ? collecting[0].name : `${collecting.length} sprints`}</div>
          </div>
          <Button variant="primary" size="lg" onClick={() => nav('/capture')}>
            Capture a moment <ArrowRight className="size-4" />
          </Button>
        </section>
      ) : null}
      {upcoming.length > 0 ? (
        <section className="mb-8">
          <div className="mb-2 text-sm text-ink-soft">Coming up</div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {upcoming.map((s) => (
              <li key={s.id}>
                <Link to={s.status === 'live' ? `/sprints/${s.id}/room` : `/sprints/${s.id}`} className="card flex items-center justify-between p-4 hover:border-ink/30">
                  <div>
                    <div className="font-medium">{s.name}</div>
                    <div className="text-sm text-ink-soft">{s.status === 'live' ? 'Retro is live — join the room' : `Retro ${s.retro_local}`}</div>
                  </div>
                  <ArrowRight className="size-4 text-ink-faint" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <PageTitle title={me.workspaces.length ? 'Workspaces' : 'Welcome to Muni'} actions={me.workspaces.length ? <Button onClick={() => setCreating(true)}><Plus className="size-4" /> New workspace</Button> : undefined}>
        {me.workspaces.length ? 'A workspace is one team. Sprints, members and experiments live inside it.' : null}
      </PageTitle>
      {me.workspaces.length === 0 || creating ? (
        <div className="grid gap-6 md:grid-cols-[1fr_1.2fr]">
          {!me.workspaces.length ? (
            <div className="measure">
              <Mark size={48} className="text-ink" />
              <p className="mt-4 text-lg">Capture thoughts throughout the sprint. Reflect together. Turn insights into action.</p>
              <p className="mt-3 text-ink-soft">Start by creating a workspace for your team. Then invite people by email, set up a sprint, and let everyone add thoughts as the sprint happens. If you were invited, open the link in that email instead.</p>
            </div>
          ) : null}
          <CreateWorkspace onCreated={async (w) => { await refresh(); nav(`/workspaces/${w.id}`) }} onCancel={me.workspaces.length ? () => setCreating(false) : undefined} />
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {me.workspaces.map((w) => (
            <li key={w.id}>
              <Link to={`/workspaces/${w.id}`} className="card block p-5 transition-colors hover:border-ink/30">
                <div className="font-display text-xl">{w.name}</div>
                <div className="mt-1 text-sm text-ink-soft">
                  {w.role === 'owner' ? 'Owner' : 'Member'}
                  {w.is_demo ? ' · demo (fictional data)' : ''}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {me.workspaces.length === 0 && !creating ? (
        <div className="mt-8">
          <EmptyState title="Nothing to open yet">Once you’re in a workspace, this page shows where to add a thought and what’s coming up.</EmptyState>
        </div>
      ) : null}
    </AppShell>
  )
}

function CreateWorkspace({ onCreated, onCancel }: { onCreated: (w: Workspace) => void; onCancel?: () => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      onCreated(await post<Workspace>('/api/workspaces', { name }))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="card p-6">
      <h2 className="font-display text-xl">Create a workspace</h2>
      <div className="mt-4">
        <Label htmlFor="wsname">Team name</Label>
        <Input id="wsname" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Payments team" maxLength={80} required />
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="mt-4 flex gap-2">
        <Button type="submit" variant="primary" busy={busy}>Create workspace</Button>
        {onCancel ? <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button> : null}
      </div>
    </form>
  )
}
