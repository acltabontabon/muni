import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ApiError, get, patch, post } from '@/api/client'
import type { CaptureTarget, SprintSummary } from '@/api/types'
import { useAuth } from '@/lib/auth'
import { applyTheme, readPrefs, writePrefs } from '@/lib/prefs'
import { Button, ErrorText, Help, Input, Label, Switch, useDocumentTitle, useToast } from '@/ui'
import { DeviceControls } from '@/ui/menus'
import { AppShell, PageTitle } from '@/ui/shell'
import { EncryptionSettings } from '@/ui/keys'

type SessionInfo = { id: string; current: boolean; created_at: string; last_seen_at: string }

function Block({ id, title, lead, children }: { id: string; title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-t`} className="grid scroll-mt-24 gap-3 border-t border-line/70 py-8 first:border-0 first:pt-0 md:grid-cols-[14rem_minmax(0,1fr)] md:gap-10">
      <div>
        <h2 id={`${id}-t`} className="font-display text-lg">{title}</h2>
        {lead ? <p className="mt-1 text-sm text-ink-soft">{lead}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

/** You: your name, the emails Muni sends you, how it looks, this device, and your other devices. */
export function Account() {
  useDocumentTitle('Account')
  const { me, refresh } = useAuth()
  const toast = useToast()
  const [name, setName] = useState(me?.display_name ?? '')
  const [nameError, setNameError] = useState('')
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [sprints, setSprints] = useState<SprintSummary[] | null>(null)
  const [theme, setTheme] = useState(readPrefs().theme ?? 'system')
  useEffect(() => {
    get<SessionInfo[]>('/api/auth/sessions').then(setSessions).catch(() => {})
    get<CaptureTarget>('/api/me/capture-target').then((c) => setSprints([...c.collecting, ...c.upcoming])).catch(() => setSprints([]))
  }, [])
  if (!me) return null
  const reminding = (sprints ?? []).filter((s) => s.reminders_enabled && ['collecting', 'draft', 'preparing', 'ready'].includes(s.status))
  return (
    <AppShell>
      <PageTitle title="Account">Signed in as <span className="text-ink [overflow-wrap:anywhere]">{me.email}</span>.</PageTitle>
      <div className="max-w-4xl">
        <Block id="name" title="Your name" lead="Shown in your workspaces, when you’re invited to speak, and on experiments you own. Never with your thoughts or votes.">
          <form
            className="flex max-w-md flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={async (e) => {
              e.preventDefault()
              setNameError('')
              try {
                await patch('/api/auth/me', { display_name: name })
                await refresh()
                toast('Name updated')
              } catch (err) {
                setNameError(err instanceof ApiError ? err.message : 'Couldn’t save your name')
              }
            }}
          >
            <div className="flex-1">
              <Label htmlFor="dn">Display name</Label>
              <Input id="dn" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
            </div>
            <Button type="submit" variant="primary">Save</Button>
          </form>
          <ErrorText>{nameError}</ErrorText>
        </Block>

        <Block id="encryption" title="Encryption" lead="Encrypted sprints are sealed on your team’s devices. Your key lives on your devices and, locked with your recovery key, nowhere else.">
          <EncryptionSettings />
        </Block>

        <Block id="notifications" title="Notifications" lead="Muni emails you only for sign-in codes, invitations and these reminders — never marketing.">
          {sprints === null ? null : reminding.length === 0 ? (
            <p className="text-sm text-ink-soft">No sprint of yours has reminders turned on right now.</p>
          ) : (
            <ul className="space-y-1">
              {reminding.map((s) => (
                <li key={s.id}>
                  <Switch
                    id={`rem-${s.id}`}
                    checked={!s.my_reminders_opt_out}
                    onCheckedChange={async (on) => {
                      setSprints((l) => l?.map((x) => (x.id === s.id ? { ...x, my_reminders_opt_out: !on } : x)) ?? l)
                      try {
                        await patch(`/api/sprints/${s.id}/me`, { reminders_opt_out: !on })
                      } catch {
                        setSprints((l) => l?.map((x) => (x.id === s.id ? { ...x, my_reminders_opt_out: on } : x)) ?? l)
                        toast('Couldn’t change that — try again', 'danger')
                      }
                    }}
                    label={`Reminders for ${s.name}`}
                    description="Mid-sprint and the day before the retro. Neutral links only."
                  />
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Block id="appearance" title="Appearance" lead="The retro’s shared stage always uses the dark theme so it reads well on a big screen.">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Theme">
            {(['system', 'light', 'dark'] as const).map((t) => (
              <Button key={t} variant={theme === t ? 'primary' : 'secondary'} size="sm" aria-pressed={theme === t} onClick={() => { setTheme(t); writePrefs({ theme: t }); applyTheme(t) }}>
                {t === 'system' ? 'Match this device' : t === 'light' ? 'Light' : 'Dark'}
              </Button>
            ))}
          </div>
        </Block>

        <Block id="device" title="This device" lead="What Muni keeps in this browser for your account.">
          <DeviceControls />
        </Block>

        <Block id="devices" title="Other devices" lead="Every device signed in with your email is the same account, with one set of votes.">
          <ul className="divide-y divide-line rounded-2xl bg-card text-sm shadow-[0_0_0_1px_var(--line)]">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span>{s.current ? 'This device' : 'Another device'} <span className="text-ink-soft">· active {new Date(s.last_seen_at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></span>
                {s.current ? <span className="text-xs text-ink-faint">current</span> : null}
              </li>
            ))}
          </ul>
          {sessions.length > 1 ? (
            <Button
              className="mt-4"
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
          ) : null}
          <Help>Who can see your thoughts and when, what the operator can access, and how long things are kept: <Link to="/privacy" className="underline underline-offset-2">Privacy &amp; data</Link>.</Help>
        </Block>
      </div>
    </AppShell>
  )
}
