import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ApiError, get, patch } from '@/api/client'
import type { CaptureTarget, SprintSummary } from '@/api/types'
import { useAuth } from '@/lib/auth'
import { applyAppearance, readPrefs, writePrefs } from '@/lib/prefs'
import { Button, ErrorText, Input, Label, Switch, useDocumentTitle, useToast } from '@/ui'
import { DeviceControls, LeaveDialog } from '@/ui/menus'
import { AppShell, PageTitle } from '@/ui/shell'
import { EncryptionSettings } from '@/ui/keys'
import { DeleteAccountDialog } from '@/ui/departure'
import { MailAddress, SecurityActivity, Sessions, SignInMethods } from '@/ui/security'
import { CharacterSettings } from '@/worlds/Character'
import { APP_VERSION } from '@/lib/release'
import { ChevronRight } from 'lucide-react'


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

/** A settings row that opens another page: a title, one line of what's there, and the way in. */
function SettingsLink({ to, title, detail }: { to: string; title: string; detail: ReactNode }) {
  return (
    <Link to={to} className="group flex max-w-xl items-center gap-4 rounded-2xl border border-line bg-card px-4 py-3.5 hover:border-line-strong">
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-sm text-ink-soft">{detail}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  )
}

/** You: your name, how you sign in, encryption, the emails Muni sends you, how it looks, this device, and your sessions. */
export function Account() {
  useDocumentTitle('Account')
  const { me, refresh } = useAuth()
  const [forgetting, setForgetting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const toast = useToast()
  const [name, setName] = useState(me?.display_name ?? '')
  const [nameError, setNameError] = useState('')
  const [sprints, setSprints] = useState<SprintSummary[] | null>(null)
  const [theme, setTheme] = useState(readPrefs().theme ?? 'system')
  useEffect(() => {
    get<CaptureTarget>('/api/me/capture-target').then((c) => setSprints([...c.collecting, ...c.upcoming])).catch(() => setSprints([]))
  }, [])
  if (!me) return null
  const reminding = (sprints ?? []).filter((s) => s.reminders_enabled && ['collecting', 'draft', 'preparing', 'ready'].includes(s.status))
  return (
    <AppShell>
      <PageTitle title="Account">Signed in as <span className="text-ink [overflow-wrap:anywhere]">{me.display_name}</span> with a passkey.</PageTitle>
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

        <Block id="sign-in" title="Signing in" lead="Your passkeys are the only way into your account. There’s no password and no email sign-in.">
          <SignInMethods />
        </Block>

        <Block id="encryption" title="Encryption" lead="Whether this device can open your encrypted writing, and your ways back in.">
          <EncryptionSettings onForget={() => setForgetting(true)} />
          <LeaveDialog kind={forgetting ? 'signout' : null} forget onClose={() => setForgetting(false)} />
        </Block>

        <Block id="notifications" title="Notifications" lead="Invitations and sprint reminders.">
          <MailAddress />
          <div className="mt-4" />
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

        <Block id="character" title="Character" lead="Your face in the retro, next to your name. Its world dresses your own pages — that part is just for you.">
          <CharacterSettings />
        </Block>

        <Block id="appearance" title="Appearance" lead="The retro’s shared stage always uses the dark theme so it reads well on a big screen.">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Theme">
            {(['system', 'light', 'dark'] as const).map((t) => (
              <Button key={t} variant={theme === t ? 'primary' : 'secondary'} size="sm" aria-pressed={theme === t} onClick={() => { setTheme(t); writePrefs({ theme: t }); applyAppearance({ mode: t }) }}>
                {t === 'system' ? 'Match this device' : t === 'light' ? 'Light' : 'Dark'}
              </Button>
            ))}
          </div>
        </Block>

        <Block id="device" title="This device" lead="What Muni keeps in this browser for your account.">
          <DeviceControls />
        </Block>

        <Block id="sessions" title="Signed-in sessions" lead="Every browser or installed app signed in to your account. Same account, same votes.">
          <Sessions />
        </Block>

        <Block id="activity" title="Security activity" lead="Recent sign-ins and changes to how you sign in.">
          <SecurityActivity />
        </Block>

        <Block id="privacy" title="Privacy">
          <SettingsLink to="/privacy" title="Privacy & data" detail="Who sees your thoughts and when, what encryption covers, and what Muni keeps." />
        </Block>

        <Block id="about" title="About">
          <SettingsLink to="/about" title="About Muni" detail={`Version ${APP_VERSION}, and what’s new.`} />
        </Block>

        <Block id="delete" title="Delete your account" lead="Leave Muni altogether. What your teams have already seen stays with them, tied to no one.">
          <Button variant="danger" onClick={() => setDeleting(true)}>Delete account…</Button>
          <DeleteAccountDialog open={deleting} onClose={() => setDeleting(false)} />
        </Block>
      </div>
    </AppShell>
  )
}
