/**
 * The two header menus. Workspace switcher: the workspaces you belong to, plus the secondary
 * things you're allowed to do there. Account menu: you, this device, and leaving.
 */
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import * as Popover from '@radix-ui/react-popover'
import { clsx } from 'clsx'
import { Check, ChevronDown, Download, LogOut, Monitor, Moon, Plus, Settings2, Shield, Sun, Trash2 } from 'lucide-react'
import { ApiError, post } from '@/api/client'
import type { Me, Workspace } from '@/api/types'
import { useAuth } from '@/lib/auth'
import { useLocal } from '@/lib/local/LocalProvider'
import { applyTheme, readPrefs, writePrefs } from '@/lib/prefs'
import { installInstructions, promptInstall, usePwa } from '@/lib/pwa'
import { chooseWorkspace } from '@/lib/workspace'
import { Button, Dialog, ErrorText, Input, Label, Switch, useToast } from '@/ui'

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
            <div role="menu" aria-label="Workspaces">
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
                  <Settings2 className="size-4 text-ink-soft" /> Workspace overview
                </Link>
                {/* Any member may set up a sprint in their workspace (the server checks membership). */}
                {!offline ? (
                  <Link to={`/workspaces/${current.id}/sprints/new`} className={item} onClick={() => setOpen(false)}>
                    <Plus className="size-4 text-ink-soft" /> New sprint in {current.name}
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
          <button className="grid size-9 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent-ink hover:brightness-95" aria-label={`Account menu for ${me.display_name}`}>
            {initial}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="end" sideOffset={6} className={clsx(panel, 'w-[min(22rem,calc(100vw-24px))]')}>
            <div className="px-3 pb-2 pt-2.5">
              <div className="truncate font-medium">{me.display_name}</div>
              {me.email ? <div className="truncate text-sm text-ink-soft">{me.email}</div> : <div className="text-sm text-ink-soft">Offline — showing what this device kept</div>}
            </div>
            <div className="my-1 h-px bg-line" />
            <Link to="/account" className={item} onClick={() => setOpen(false)}>
              <Settings2 className="size-4 text-ink-soft" /> Name, devices &amp; preferences
            </Link>
            <div className="flex items-center gap-2 px-3 py-2" role="group" aria-label="Theme">
              {([['system', Monitor], ['light', Sun], ['dark', Moon]] as const).map(([t, Icon]) => (
                <button
                  key={t}
                  aria-pressed={theme === t}
                  className={clsx('inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full border text-xs capitalize', theme === t ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-ink-soft hover:text-ink')}
                  onClick={() => {
                    setTheme(t)
                    writePrefs({ theme: t })
                    applyTheme(t)
                  }}
                >
                  <Icon className="size-3.5" /> {t}
                </button>
              ))}
            </div>
            <div className="px-3">
              <Switch
                id="keep-local"
                checked={local.keepLocal}
                disabled={typeof indexedDB === 'undefined'}
                onCheckedChange={async (on) => {
                  if (on) await local.setKeepLocal(true).catch(() => {})
                  else close('keep-off')
                }}
                label="Keep drafts on this device"
                description="Recover drafts after closing Muni and write without a connection. For a personal device: anyone who uses it could read them."
              />
            </div>
            {local.storageError ? <p className="px-3 pb-1 text-xs text-danger">{local.storageError}</p> : null}
            <div className="my-1 h-px bg-line" />
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
                <Download className="size-4 text-ink-soft" /> Install Muni
              </button>
            ) : null}
            <Link to="/about" className={item} onClick={() => setOpen(false)}>
              <Shield className="size-4 text-ink-soft" /> Privacy &amp; how Muni works
            </Link>
            <button className={item} onClick={() => close('clear')}>
              <Trash2 className="size-4 text-ink-soft" /> Clear local data
            </button>
            <button className={item} onClick={() => close('signout')} disabled={offline}>
              <LogOut className="size-4 text-ink-soft" /> {offline ? 'Sign out (needs a connection)' : 'Sign out'}
            </button>
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

/** Signing out or clearing local data: unsent work is named, and discarding it is explicit. */
function LeaveDialog({ kind, onClose }: { kind: 'signout' | 'clear' | null; onClose: () => void }) {
  const { signOutLocal } = useAuth()
  const local = useLocal()
  const toast = useToast()
  const nav = useNavigate()
  const [busy, setBusy] = useState(false)
  const unsent = local.items.length
  const act = async () => {
    setBusy(true)
    try {
      await local.clearLocal()
      if (kind === 'signout') {
        await post('/api/auth/logout').catch(() => {})
        signOutLocal()
        nav('/signin')
      } else toast('Cleared from this device. Nothing was deleted from Muni.')
      onClose()
    } finally {
      setBusy(false)
    }
  }
  const title = kind === 'signout' ? 'Sign out of Muni?' : 'Clear local data?'
  let body: ReactNode
  if (unsent > 0)
    body = (
      <>
        <p className="text-[15px]">
          <strong>{unsent === 1 ? '1 thought hasn’t' : `${unsent} thoughts haven’t`} been sent</strong> to {unsent === 1 ? 'its sprint' : 'their sprints'} yet. {kind === 'signout' ? 'Signing out' : 'Clearing'} removes {unsent === 1 ? 'it' : 'them'} from this device for good.
        </p>
        <p className="mt-2 text-sm text-ink-soft">Try sending first, or copy anything you want to keep.</p>
      </>
    )
  else body = <p className="text-[15px]">{kind === 'signout' ? 'Drafts and anything Muni kept on this device for your account are removed. Your submitted thoughts stay in their sprints.' : 'Removes drafts and cached sprint details kept on this device for your account. It doesn’t delete anything from Muni’s servers.'}</p>
  return (
    <Dialog open={!!kind} onOpenChange={(o) => !o && onClose()} title={title}>
      {body}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        {unsent > 0 ? <Button onClick={() => local.retry()}>Try sending now</Button> : null}
        <Button variant={unsent > 0 ? 'danger' : 'primary'} busy={busy} onClick={act}>
          {unsent > 0 ? (kind === 'signout' ? 'Discard and sign out' : 'Discard and clear') : kind === 'signout' ? 'Sign out' : 'Clear'}
        </Button>
      </div>
    </Dialog>
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
