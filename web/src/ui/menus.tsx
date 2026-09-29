/**
 * The two header menus. Workspace switcher: the workspaces you belong to, plus the secondary
 * things you're allowed to do there. Account menu: you, this device, and leaving.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import * as Popover from '@radix-ui/react-popover'
import { clsx } from 'clsx'
import { Check, ChevronDown, ChevronRight, Download, LayoutList, LogOut, Monitor, Moon, Info, Plus, Settings2, Smile, Sun, Trash2, Users } from 'lucide-react'
import { ApiError, post } from '@/api/client'
import type { Me, Workspace } from '@/api/types'
import { useAuth } from '@/lib/auth'
import { useLocal } from '@/lib/local/LocalProvider'
import { applyAppearance, forgetSignedInState, readPrefs, writePrefs } from '@/lib/prefs'
import { installInstructions, promptInstall, usePwa } from '@/lib/pwa'
import { chooseWorkspace } from '@/lib/workspace'
import { keyring } from '@/lib/e2ee/keyring'
import { announceSignOut, markSignedOutLocally } from '@/lib/signout'
import { APP_VERSION } from '@/lib/release'
import { useDeviceKeys } from '@/lib/e2ee/E2eeProvider'
import { Button, Dialog, ErrorText, Input, Label, Switch, useToast } from '@/ui'
import { menuKeys } from '@/ui/menu-keys'
import { Portrait } from '@/worlds/portraits'
import { useWorld } from '@/worlds/world'

const panel = 'z-50 w-[min(20rem,calc(100vw-24px))] rounded-2xl border border-line bg-card p-1.5 shadow-[var(--shadow-float)] anim-rise'
const item = 'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] text-ink hover:bg-ink/5 focus-visible:bg-ink/5'

// ------------------------------------------------------------------ workspaces

export function WorkspaceSwitcher({ current }: { current: Me['workspaces'][number] | null }) {
  const { me, refresh, offline } = useAuth()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const nav = useNavigate()
  if (!me) return null
  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button className="inline-flex h-9 min-w-0 max-w-[46vw] items-center gap-1.5 rounded-full px-3 text-sm font-medium text-ink hover:bg-ink/5 sm:max-w-xs" aria-label={`Workspace: ${current?.name ?? 'none'}. Switch workspace`}>
            <span className="truncate">{current?.name ?? 'No workspace'}</span>
            <ChevronDown className="size-4 shrink-0 text-ink-faint" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="start" sideOffset={6} className={panel}>
            {me.workspaces.length ? <div className="px-3 pb-1 pt-2 text-xs text-ink-faint">Your workspaces</div> : null}
            <div role="menu" aria-label="Workspaces" onKeyDown={menuKeys}>
              {me.workspaces.map((w) => (
                <button
                  key={w.id}
                  role="menuitemradio"
                  aria-checked={w.id === current?.id}
                  className={item}
                  onClick={() => {
                    chooseWorkspace(w.id)
                    setOpen(false)
                    nav('/')
                  }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{w.name}</span>
                    <span className="block text-xs text-ink-faint">{w.role === 'owner' ? 'Owner' : 'Member'}{w.is_demo ? ' · fictional demo' : ''}</span>
                  </span>
                  {w.id === current?.id ? <Check className="size-4 text-accent" /> : null}
                </button>
              ))}
            </div>
            <div className="my-1 h-px bg-line" />
            {current ? (
              <>
                <Link to={`/workspaces/${current.id}`} className={item} onClick={() => setOpen(false)}>
                  <LayoutList className="size-4 text-ink-soft" /> Sprints &amp; outcomes
                </Link>
                <Link to={`/workspaces/${current.id}/people`} className={item} onClick={() => setOpen(false)}>
                  <Users className="size-4 text-ink-soft" /> People
                </Link>
                {current.role === 'owner' ? (
                  <Link to={`/workspaces/${current.id}/settings`} className={item} onClick={() => setOpen(false)}>
                    <Settings2 className="size-4 text-ink-soft" /> Workspace settings
                  </Link>
                ) : null}
                <div className="my-1 h-px bg-line" />
                {/* Any member may set up a sprint in their workspace (the server checks membership). */}
                {!offline ? (
                  <Link to={`/workspaces/${current.id}/sprints/new`} className={item} onClick={() => setOpen(false)}>
                    <Plus className="size-4 text-ink-soft" /> New sprint
                  </Link>
                ) : null}
              </>
            ) : null}
            {!offline ? (
              <button className={item} onClick={() => { setOpen(false); setCreating(true) }}>
                <Plus className="size-4 text-ink-soft" /> New workspace
              </button>
            ) : null}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <NewWorkspaceDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={async (w) => {
          setCreating(false)
          await refresh()
          chooseWorkspace(w.id)
          nav(`/workspaces/${w.id}`)
        }}
      />
    </>
  )
}

export function NewWorkspaceDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (w: Workspace) => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      onCreated(await post<Workspace>('/api/workspaces', { name }))
      setName('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="New workspace" description="A workspace is one team: its sprints, members and experiments.">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <Label htmlFor="wsname">Team name</Label>
          <Input id="wsname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Payments team" maxLength={80} required />
        </div>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy}>Create workspace</Button>
        </div>
      </form>
    </Dialog>
  )
}

// ------------------------------------------------------------------ account

export function AccountMenu() {
  const { me, offline } = useAuth()
  const local = useLocal()
  const pwa = usePwa()
  const [open, setOpen] = useState(false)
  const [dialog, setDialog] = useState<null | 'signout' | 'clear' | 'keep-off' | 'install'>(null)
  const [theme, setTheme] = useState(readPrefs().theme ?? 'system')
  const world = useWorld()
  if (!me) return null
  const initial = me.display_name.trim()[0]?.toUpperCase() ?? '·'
  const close = (d: typeof dialog = null) => {
    setOpen(false)
    setDialog(d)
  }
  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button data-account-trigger className="grid size-9 place-items-center overflow-hidden rounded-full bg-accent-soft text-sm font-semibold text-accent-ink hover:brightness-95" aria-label={`Account menu for ${me.display_name}`}>
            {world.character ? <Portrait id={world.character.id} size={36} /> : initial}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="end" sideOffset={6} className={clsx(panel, 'w-[min(21rem,calc(100vw-24px))]')}>
            {/* You: your face, your name, and the way into your account. */}
            <Link to="/account" className="acct-head" onClick={() => setOpen(false)}>
              <span className="acct-face" aria-hidden>{world.character ? <Portrait id={world.character.id} size={44} /> : initial}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{me.display_name}</span>
                <span className="block truncate text-[13px] text-ink-soft">{offline ? 'Offline — showing what this device kept' : 'Account & settings'}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden />
            </Link>
            <button
              className={clsx(item, 'acct-row')}
              onClick={() => {
                setOpen(false)
                world.setChooserOpen(true)
              }}
            >
              <Smile className="size-4 text-ink-soft" aria-hidden />
              <span className="flex-1">Character</span>
              <span className="acct-value">{world.character ? world.character.name : 'Choose one'}</span>
            </button>
            <div className={clsx(item, 'acct-row cursor-default hover:bg-transparent')}>
              {theme === 'dark' ? <Moon className="size-4 text-ink-soft" aria-hidden /> : theme === 'light' ? <Sun className="size-4 text-ink-soft" aria-hidden /> : <Monitor className="size-4 text-ink-soft" aria-hidden />}
              <span className="flex-1" id="acct-theme">Theme</span>
              <span className="acct-seg" role="group" aria-labelledby="acct-theme">
                {([['system', Monitor, 'Match this device'], ['light', Sun, 'Light'], ['dark', Moon, 'Dark']] as const).map(([t, Icon, label]) => (
                  <button
                    key={t}
                    aria-pressed={theme === t}
                    aria-label={label}
                    title={label}
                    onClick={() => {
                      setTheme(t)
                      writePrefs({ theme: t })
                      applyAppearance({ mode: t })
                    }}
                  >
                    <Icon className="size-3.5" aria-hidden />
                  </button>
                ))}
              </span>
            </div>
            {local.storageError ? <p className="px-3 pb-1 text-xs text-danger">{local.storageError}</p> : null}
            <div className="my-1 h-px bg-line" />
            <p className="acct-group">This device</p>
            {!pwa.installed ? (
              <button
                className={item}
                onClick={async () => {
                  if (pwa.installable) {
                    setOpen(false)
                    await promptInstall()
                  } else close('install')
                }}
              >
                <Download className="size-4 text-ink-soft" aria-hidden /> Install Muni
              </button>
            ) : null}
            <button className={item} onClick={() => close('clear')}>
              <Trash2 className="size-4 text-ink-soft" aria-hidden /> Clear local data
            </button>
            <div className="my-1 h-px bg-line" />
            <div className="acct-foot">
              <button className="acct-signout" onClick={() => close('signout')}>
                <LogOut className="size-4" aria-hidden /> Sign out
              </button>
              <Link to="/about" className="acct-about" onClick={() => setOpen(false)}>
                <Info className="size-3.5" aria-hidden /> Muni {APP_VERSION}
              </Link>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <LeaveDialog kind={dialog === 'signout' ? 'signout' : dialog === 'clear' ? 'clear' : null} onClose={() => setDialog(null)} />
      <KeepOffDialog open={dialog === 'keep-off'} onClose={() => setDialog(null)} />
      <Dialog open={dialog === 'install'} onOpenChange={(o) => !o && setDialog(null)} title="Install Muni" description="Muni works the same in the browser; installing just gives it its own window and a home-screen icon.">
        <p className="text-[15px]">{installInstructions(pwa)}</p>
        <div className="mt-5 flex justify-end">
          <Button variant="primary" onClick={() => setDialog(null)}>Done</Button>
        </div>
      </Dialog>
    </>
  )
}

/**
 * Signing out or clearing local data: unsent work and drafts are named, and discarding them is
 * explicit. Signing out ends the session on the server first. If that fails, nothing is removed
 * and the reason is shown; the person may then sign out on this device only, which forgets the
 * account here now and ends the server session the next time the device is online (lib/signout.ts).
 * `stay` keeps the current page (the invitation page signs in again in place).
 *
 * Signing out takes the encryption key out of memory (in every tab) but keeps this device able to
 * unlock again — only after signing in again. "Forget this device" also removes that, and
 * everything else Muni keeps here for the account; passkeys stay wherever the person keeps them.
 */
export function LeaveDialog({ kind, onClose, stay, forget: forgetByDefault = false }: { kind: 'signout' | 'clear' | null; onClose: () => void; stay?: boolean; forget?: boolean }) {
  const { signOutLocal } = useAuth()
  const local = useLocal()
  const toast = useToast()
  const nav = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** Set when the server couldn't end the session: offers signing out on this device only. */
  const [serverFailed, setServerFailed] = useState<null | 'offline' | 'refused'>(null)
  const [drafts, setDrafts] = useState(0)
  const [forget, setForget] = useState(forgetByDefault)
  /** Signing out (or forgetting) would leave no way to unlock the encrypted writing. */
  const [risk, setRisk] = useState<'none' | 'only-copy'>('none')
  useEffect(() => {
    if (kind) local.draftCount().then(setDrafts, () => setDrafts(0))
    if (kind === 'signout') keyring.signOutRisk().then(setRisk, () => setRisk('none'))
    setForget(forgetByDefault)
    setError('')
    setServerFailed(null)
  }, [kind, local, forgetByDefault])
  const queued = local.items.length
  const unsent = queued + drafts
  const { state: keys } = useDeviceKeys()
  // Forgetting this device when it's the only way to unlock loses the writing for good.
  const onlyWay = kind === 'signout' && keys.kind === 'ready' && !keys.methods.passkeys && !keys.methods.recovery
  const forgetHere = async (opts: { forgetDevice: boolean }) => {
    await local.clearLocal()
    if (opts.forgetDevice) await keyring.forgetDevice({ serverToo: false })
    else keyring.lock()
    forgetSignedInState()
    announceSignOut()
    signOutLocal()
    if (!stay) nav('/signin')
  }
  const act = async () => {
    setBusy(true)
    setError('')
    try {
      if (kind === 'signout') {
        // While the session still works, the server forgets this device's half of its key too.
        if (forget) await keyring.forgetDevice({ serverToo: true, keepSignedIn: true })
        try {
          await post('/api/auth/logout')
        } catch (e) {
          // 401: the session had already ended — carry on. Anything else: still signed in, keep everything.
          if (!(e instanceof ApiError && e.status === 401)) {
            const offline = e instanceof ApiError && e.status === 0
            setServerFailed(offline ? 'offline' : 'refused')
            setError(offline ? 'Muni can’t be reached, so your session couldn’t be ended on the server. Nothing was removed.' : `Muni couldn’t end your session: ${e instanceof ApiError ? sentence(e.message) : 'something went wrong.'} Nothing was removed.`)
            return
          }
        }
        await forgetHere({ forgetDevice: forget })
      } else {
        await local.clearLocal()
        toast('Cleared from this device. Nothing was deleted from Muni.')
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }
  const signOutHereOnly = async () => {
    setBusy(true)
    try {
      markSignedOutLocally()
      // The session can't be ended right now, so what would reopen the key here goes too.
      await forgetHere({ forgetDevice: true })
      onClose()
    } finally {
      setBusy(false)
    }
  }
  const title = kind === 'signout' ? 'Sign out of Muni?' : 'Clear local data?'
  let body: ReactNode
  const what = [queued ? (queued === 1 ? '1 thought hasn’t been sent' : `${queued} thoughts haven’t been sent`) : '', drafts ? (drafts === 1 ? '1 draft is unfinished' : `${drafts} drafts are unfinished`) : ''].filter(Boolean).join(' and ')
  if (unsent > 0)
    body = (
      <>
        <p className="text-[15px]">
          <strong>{what}.</strong> {kind === 'signout' ? 'Signing out' : 'Clearing'} removes {unsent === 1 ? 'it' : 'them'} from this device for good.
        </p>
        <p className="mt-2 text-sm text-ink-soft">Try sending first, or copy anything you want to keep.</p>
      </>
    )
  else body = <p className="text-[15px]">{kind === 'signout' ? 'Drafts and anything Muni kept on this device for your account are removed. Your submitted thoughts stay in their sprints.' : 'Removes drafts and cached sprint details kept on this device for your account. It doesn’t delete anything from Muni’s servers.'}</p>
  return (
    <Dialog open={!!kind} onOpenChange={(o) => !o && onClose()} title={title}>
      {body}
      {kind === 'signout' ? (
        <>
          <p className="mt-3 text-sm text-ink-soft">This signs you out in every tab on this device. Your encrypted writing locks; signing in again here unlocks it.</p>
          <label className="mt-4 flex cursor-pointer items-start gap-3 text-[15px]">
            <input type="checkbox" className="mt-1 size-4 accent-[var(--accent)]" checked={forget} onChange={(e) => setForget(e.target.checked)} />
            <span>
              Also forget this device
              <span className="block text-sm text-ink-soft">Removes everything Muni keeps in this browser for your account, including what lets it unlock your encrypted writing after you sign in. Next time here, you’ll need a passkey that unlocks your writing, or your recovery key. Your passkeys aren’t touched — they stay in your password manager or on your device.</span>
            </span>
          </label>
        </>
      ) : null}
      {kind === 'signout' && ((forget && onlyWay) || risk === 'only-copy') ? (
        <p className="mt-3 rounded-2xl bg-warn/10 px-3.5 py-2.5 text-sm">
          <strong className="font-medium">This device is the only way to unlock your encrypted writing.</strong> {risk === 'only-copy' ? 'Muni couldn’t keep it safely for your next sign-in, so signing out removes it.' : 'Forgetting it removes that.'} Without a passkey that unlocks or a recovery key, the writing can’t be opened again. <Link to="/account#encryption" className="underline underline-offset-2" onClick={onClose}>Add a way back in first</Link>.
        </p>
      ) : null}
      {serverFailed && onlyWay ? (
        <p className="mt-3 rounded-2xl bg-warn/10 px-3.5 py-2.5 text-sm">
          <strong className="font-medium">Signing out on this device only also removes its unlock</strong> — the session can’t be ended right now, so leaving it would let anyone with this browser reopen your writing. This device is your only way to unlock it.
        </p>
      ) : null}
      <ErrorText>{error}</ErrorText>
      {serverFailed ? (
        <p className="mt-3 text-sm text-ink-soft">
          You can sign out on this device only: it forgets your account now{unsent > 0 ? ' (and discards what’s listed above)' : ''}, and Muni ends the session the next time this device is online. Until then the session stays valid on Muni’s servers — if this device may be in someone else’s hands, use “Sign out everywhere else” from another device.
        </p>
      ) : null}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        {unsent > 0 ? <Button onClick={() => local.retry()}>Try sending now</Button> : null}
        {serverFailed ? (
          <>
            <Button busy={busy} onClick={act}>Try again</Button>
            <Button variant="danger" busy={busy} onClick={signOutHereOnly}>Sign out on this device</Button>
          </>
        ) : (
          <Button variant={unsent > 0 ? 'danger' : 'primary'} busy={busy} onClick={act}>
            {unsent > 0 ? (kind === 'signout' ? 'Discard and sign out' : 'Discard and clear') : kind === 'signout' ? 'Sign out' : 'Clear'}
          </Button>
        )}
      </div>
    </Dialog>
  )
}

/**
 * The same device-storage controls as the account menu, laid out for a page (Privacy & data):
 * keeping drafts on this device, and clearing what it holds for this account.
 */
export function DeviceControls() {
  const local = useLocal()
  const [dialog, setDialog] = useState<null | 'clear' | 'keep-off'>(null)
  return (
    <div className="space-y-4">
      <Switch
        id="keep-local-page"
        checked={local.keepLocal}
        disabled={typeof indexedDB === 'undefined'}
        onCheckedChange={async (on) => {
          if (on) await local.setKeepLocal(true).catch(() => {})
          else setDialog('keep-off')
        }}
        label="Keep drafts on this device"
        description="Recover drafts after closing Muni and write without a connection. For a personal device: anyone who uses it could read them."
      />
      {local.storageError ? <p className="text-sm text-danger">{local.storageError}</p> : null}
      <div>
        <Button size="sm" onClick={() => setDialog('clear')}>
          <Trash2 className="size-4" /> Clear local data
        </Button>
        <p className="mt-1.5 text-sm text-ink-soft">Removes what this device keeps for your account. Nothing is deleted from Muni’s servers.</p>
      </div>
      <LeaveDialog kind={dialog === 'clear' ? 'clear' : null} onClose={() => setDialog(null)} />
      <KeepOffDialog open={dialog === 'keep-off'} onClose={() => setDialog(null)} />
    </div>
  )
}

function KeepOffDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const local = useLocal()
  const unsent = local.items.length
  const [busy, setBusy] = useState(false)
  const turnOff = async (discard: boolean) => {
    setBusy(true)
    try {
      await local.setKeepLocal(false, { discard })
      onClose()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Stop keeping drafts on this device?" description="Drafts will last only while this tab is open. Muni won’t open offline on this device.">
      {unsent > 0 ? <p className="text-[15px]">{unsent === 1 ? '1 thought is' : `${unsent} thoughts are`} waiting to be sent. You can keep {unsent === 1 ? 'it' : 'them'} in this tab until {unsent === 1 ? 'it’s' : 'they’re'} sent, or discard {unsent === 1 ? 'it' : 'them'}.</p> : null}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        {unsent > 0 ? <Button variant="danger" busy={busy} onClick={() => turnOff(true)}>Discard and turn off</Button> : null}
        <Button variant="primary" busy={busy} onClick={() => turnOff(false)}>{unsent > 0 ? 'Keep in this tab' : 'Turn off'}</Button>
      </div>
    </Dialog>
  )
}

/** Server messages are lower-case fragments; show them as sentences. */
function sentence(m: string) {
  const t = m.trim()
  return t ? t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.') : t
}
