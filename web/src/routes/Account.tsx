import { useEffect, useState } from 'react'
import { get, patch, post } from '@/api/client'
import { useAuth } from '@/lib/auth'
import { applyTheme, readPrefs, writePrefs } from '@/lib/prefs'
import { Button, Input, Label, useDocumentTitle, useToast, Help } from '@/ui'
import { AppShell, PageTitle } from '@/ui/shell'
import { Link } from 'react-router'

type SessionInfo = { id: string; current: boolean; created_at: string; last_seen_at: string }

export function Account() {
  useDocumentTitle('Account')
  const { me, refresh } = useAuth()
  const toast = useToast()
  const [name, setName] = useState(me?.display_name ?? '')
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [theme, setTheme] = useState(readPrefs().theme ?? 'system')
  useEffect(() => {
    get<SessionInfo[]>('/api/auth/sessions').then(setSessions).catch(() => {})
  }, [])
  if (!me) return null
  return (
    <AppShell>
      <PageTitle title="Account">Your name is shown when you’re invited to speak and on experiments you own. It is never shown with entries or votes.</PageTitle>
      <div className="grid gap-6 md:grid-cols-2">
        <section className="card p-6">
          <h2 className="font-display text-xl">Name</h2>
          <form
            className="mt-4 space-y-3"
            onSubmit={async (e) => {
              e.preventDefault()
              await patch('/api/auth/me', { display_name: name })
              await refresh()
              toast('Name updated')
            }}
          >
            <Label htmlFor="dn">Display name</Label>
            <Input id="dn" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            <Help>Signed in as {me.email}</Help>
            <Button type="submit" variant="primary">Save</Button>
          </form>
        </section>
        <section className="card p-6">
          <h2 className="font-display text-xl">Appearance</h2>
          <Help className="mt-1">The meeting stage always uses the dark theme so it reads well on a shared screen.</Help>
          <div className="mt-4 flex gap-2">
            {(['system', 'light', 'dark'] as const).map((t) => (
              <Button key={t} variant={theme === t ? 'primary' : 'secondary'} size="sm" onClick={() => { setTheme(t); writePrefs({ theme: t }); applyTheme(t) }}>
                {t[0].toUpperCase() + t.slice(1)}
              </Button>
            ))}
          </div>
        </section>
        <section className="card p-6 md:col-span-2">
          <h2 className="font-display text-xl">Devices</h2>
          <Help className="mt-1">Every device signed in with your email shares one account and one vote budget.</Help>
          <ul className="mt-4 divide-y divide-line text-sm">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2">
                <span>{s.current ? 'This device' : 'Another device'} · last active {new Date(s.last_seen_at).toLocaleString()}</span>
                {s.current ? <span className="text-ink-faint">current</span> : null}
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <Button
              variant="danger"
              size="sm"
              onClick={async () => {
                await post('/api/auth/logout-others')
                setSessions((s) => s.filter((x) => x.current))
                toast('Other devices signed out')
              }}
            >
              Sign out everywhere else
            </Button>
          </div>
        </section>
        <section className="card p-6 md:col-span-2">
          <h2 className="font-display text-xl">Privacy &amp; data</h2>
          <p className="mt-2 text-ink-soft">
            Who can see your thoughts and when, what the operator and service providers can access, what this device keeps, and how long everything is kept. <Link to="/privacy" className="underline underline-offset-2">Privacy &amp; data</Link>
          </p>
        </section>
      </div>
    </AppShell>
  )
}
