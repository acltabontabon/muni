/**
 * Account security, compactly: the ways to sign in (passkeys and email codes), the sessions that
 * are signed in, and recent security activity. Removing a passkey and signing out a session are
 * different things, and each says what it does. Everything shown comes from the server; after any
 * change the lists are reloaded from it rather than patched locally.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { KeyRound, Mail, MoreHorizontal } from 'lucide-react'
import * as Popover from '@radix-ui/react-popover'
import { ApiError, del, get, patch, post } from '@/api/client'
import type { PasskeyInfo, SecurityEventInfo, SessionInfo } from '@/api/types'
import { useAuth } from '@/lib/auth'
import { addPasskey, describePasskeyError, enablePasskeyUnlock, suggestedPasskeyName, supportsPasskeys, type PasskeyUnlock } from '@/lib/passkeys'
import { keyring } from '@/lib/e2ee/keyring'
import { useDeviceKeys } from '@/lib/e2ee/E2eeProvider'
import { Button, Dialog, ErrorText, Input, Label, useToast } from '@/ui'
import { useReauth } from '@/ui/reauth'
import { EmailSetup } from '@/ui/email-setup'

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const failure = (e: unknown, doing: string) =>
  e instanceof ApiError && e.status === 0 ? `You’re offline, so nothing changed. Try again when you’re connected.` : `Couldn’t ${doing}: ${e instanceof ApiError ? e.message : 'something went wrong'}.`

function List({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-line rounded-2xl bg-card text-sm shadow-[0_0_0_1px_var(--line)]">{children}</ul>
}

// ------------------------------------------------------------------ sign-in methods

export function SignInMethods() {
  const { me, refresh } = useAuth()
  const toast = useToast()
  const reauth = useReauth()
  const [keys, setKeys] = useState<PasskeyInfo[] | null>(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState<PasskeyInfo | null>(null)
  const [removing, setRemoving] = useState<PasskeyInfo | null>(null)
  /** A passkey just added that supports unlocking but needs one use to do it. */
  const [confirming, setConfirming] = useState<PasskeyInfo | null>(null)
  const { state: deviceKeys } = useDeviceKeys()
  const unlocking = new Set(keyring.unlockingPasskeys())
  const open = deviceKeys.kind === 'ready'
  const load = useCallback(async () => {
    try {
      setKeys(await get<PasskeyInfo[]>('/api/auth/passkeys'))
    } catch (e) {
      setError(failure(e, 'load your passkeys'))
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  const supported = supportsPasskeys()
  const add = async () => {
    setAdding(true)
    setError('')
    try {
      const made = await reauth.run(() => addPasskey(suggestedPasskeyName()))
      if (made) {
        toast(ADDED[made.unlock])
        if (made.unlock === 'confirm') setConfirming(made)
        else setRenaming(made)
      }
    } catch (e) {
      const p = describePasskeyError(e, 'add')
      if (p.kind !== 'cancelled') setError(p.message)
    } finally {
      setAdding(false)
      await load()
      await refresh()
    }
  }
  if (!me) return null
  return (
    <div className="grid gap-5">
      <div>
        <h3 className="text-sm font-medium">Passkeys</h3>
        <p className="mt-1 text-sm text-ink-soft">How you sign in: unlock your device or password manager — fingerprint, face, PIN or screen lock. That stays on your device; Muni never receives your biometric data. A passkey may sync to your other devices through your password manager, so one passkey isn’t necessarily one device.</p>
        <div className="mt-3">
          {keys === null ? null : keys.length === 0 ? (
            <p className="rounded-2xl bg-card px-4 py-3 text-sm text-ink-soft shadow-[0_0_0_1px_var(--line)]">No passkeys yet.</p>
          ) : (
            <List>
              {keys.map((k) => (
                <li key={k.id} className="flex items-center gap-3 px-4 py-3">
                  <KeyRound className="size-4 shrink-0 text-ink-soft" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{k.name}</span>
                    <span className="block text-ink-soft">
                      Added {day(k.created_at)} · {k.last_used_at ? `last used ${when(k.last_used_at)}` : 'not used to sign in yet'}
                      {k.synced ? ' · can sync' : ' · stays on one device or key'}
                    </span>
                    {open ? <span className="block text-ink-soft">{unlocking.has(k.id) ? 'Signs in and unlocks your encrypted writing' : 'Signs in only — doesn’t unlock encrypted writing'}</span> : null}
                  </span>
                  <Popover.Root>
                    <Popover.Trigger asChild>
                      <button className="icon-btn" aria-label={`Manage ${k.name}`}><MoreHorizontal className="size-4" /></button>
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Content align="end" sideOffset={4} className="z-50 w-48 rounded-2xl border border-line bg-card p-1.5 shadow-[var(--shadow-float)] anim-rise">
                        <Popover.Close asChild>
                          <button className="block w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-ink/5" onClick={() => setRenaming(k)}>Rename</button>
                        </Popover.Close>
                        {open && !unlocking.has(k.id) ? (
                          <Popover.Close asChild>
                            <button className="block w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-ink/5" onClick={() => setConfirming(k)}>Let it unlock…</button>
                          </Popover.Close>
                        ) : null}
                        <Popover.Close asChild>
                          <button className="block w-full rounded-xl px-3 py-2 text-left text-sm text-danger hover:bg-danger/10" onClick={() => setRemoving(k)}>Remove…</button>
                        </Popover.Close>
                      </Popover.Content>
                    </Popover.Portal>
                  </Popover.Root>
                </li>
              ))}
            </List>
          )}
        </div>
        {supported ? (
          <Button className="mt-3" size="sm" variant={keys?.length ? 'secondary' : 'primary'} busy={adding} onClick={add}>
            <KeyRound className="size-4" aria-hidden /> {keys?.length ? 'Add another passkey' : 'Add a passkey'}
          </Button>
        ) : (
          <p className="mt-3 text-sm text-ink-soft">This browser can’t create passkeys. Passkeys you add elsewhere still work on devices that support them.</p>
        )}
        <ErrorText>{error}</ErrorText>
      </div>

      {keys !== null && keys.length < 2 && !me.email ? (
        <p role="status" className="rounded-2xl bg-[color-mix(in_oklab,var(--warn)_12%,var(--card))] px-4 py-3 text-sm">
          <strong className="font-medium">{keys.length === 0 ? 'No way to sign in is set up.' : 'One passkey, no recovery email.'}</strong> If you lose {keys.length === 0 ? 'access' : 'this passkey'}, you lose the account — Muni can’t restore it. Add a second passkey (on another device, a security key or another password manager), or a recovery email.
        </p>
      ) : null}

      <RecoveryEmail passkeys={keys?.length ?? 0} run={reauth.run} onChanged={async () => { await refresh() }} />

      <div className="rounded-2xl bg-ink/[0.04] px-4 py-3 text-sm text-ink-soft">
        <p><strong className="font-medium text-ink">If you lose every passkey.</strong> {me.email ? <>Sign in with a code to {me.email} (“Used Muni before?” on the sign-in page) and add a new passkey. Anyone who can read that inbox could do the same, so keep your email account secure.</> : <>With no recovery email, Muni has nothing it can use to tell it’s you, so it can’t restore the account — there is no support reset. Your team can invite a new account; thoughts you already shared stay in their sprints, without your name.</>}</p>
        <p className="mt-2">Getting back into your account isn’t the same as getting back your encrypted writing. A passkey marked “unlocks your encrypted writing” does both, on any device where you can use it. A recovery email, or a passkey that only signs in, gets you into the account — then you’ll need a passkey that unlocks, a device that’s still unlocked, or your recovery key (see Encryption below). Muni has no way to recover encrypted content for you.</p>
      </div>

      <RenameDialog passkey={renaming} onClose={() => setRenaming(null)} onSaved={load} />
      <ConfirmUnlockDialog passkey={confirming} onClose={() => setConfirming(null)} onDone={load} />
      <RemoveDialog passkey={removing} lastUnlock={!!removing && unlocking.has(removing.id) && unlocking.size === 1 && deviceKeys.kind === 'ready' && !deviceKeys.methods.recovery} onClose={() => setRemoving(null)} onRemoved={async (ended) => { toast(ended ? `Passkey removed · ${ended} ${ended === 1 ? 'session' : 'sessions'} signed out` : 'Passkey removed'); await load(); await refresh() }} run={reauth.run} />
      {reauth.dialog}
    </div>
  )
}

function RenameDialog({ passkey, onClose, onSaved }: { passkey: PasskeyInfo | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setName(passkey?.name ?? '')
    setError('')
  }, [passkey])
  return (
    <Dialog open={!!passkey} onOpenChange={(o) => !o && onClose()} title="Name this passkey" description="A name that helps you recognise it later, like the password manager or device it lives in.">
      <form
        className="grid gap-2"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!passkey) return
          setBusy(true)
          try {
            await patch(`/api/auth/passkeys/${passkey.id}`, { name })
            await onSaved()
            onClose()
          } catch (err) {
            setError(failure(err, 'rename it'))
          } finally {
            setBusy(false)
          }
        }}
      >
        <Label htmlFor="pk-name">Name</Label>
        <Input id="pk-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus />
        <ErrorText>{error}</ErrorText>
        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy}>Save</Button>
        </div>
      </form>
    </Dialog>
  )
}

const ADDED: Record<PasskeyUnlock, string> = {
  ready: 'Passkey added. It signs you in and unlocks your encrypted writing.',
  confirm: 'Passkey added. Confirm once with it so it can unlock your writing too.',
  unsupported: 'Passkey added. It signs you in; this passkey or browser can’t unlock encrypted writing.',
  later: 'Passkey added. It signs you in. To let it unlock your writing, use it once on a device where your writing is unlocked.',
}

/** One use of a particular passkey, so it can unlock too (only from a device that's unlocked). */
function ConfirmUnlockDialog({ passkey, onClose, onDone }: { passkey: PasskeyInfo | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toast = useToast()
  useEffect(() => setError(''), [passkey])
  return (
    <Dialog open={!!passkey} onOpenChange={(o) => !o && onClose()} title="Let this passkey unlock your writing?" description={`Confirm once with “${passkey?.name ?? ''}”. This device, which is already unlocked, then lets that passkey open your encrypted writing when you sign in with it — here or on another device.`}>
      <ErrorText>{error}</ErrorText>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Not now</Button>
        <Button
          variant="primary"
          busy={busy}
          onClick={async () => {
            if (!passkey) return
            setBusy(true)
            setError('')
            try {
              const r = await enablePasskeyUnlock(passkey.id)
              if (r === 'ready') {
                toast('That passkey now unlocks your writing.')
                onClose()
              } else setError(r === 'unsupported' || r === 'confirm' ? 'That passkey (or this browser) can’t unlock encrypted writing. It still signs you in.' : 'This device isn’t unlocked right now, so it can’t share access with that passkey.')
              await onDone()
            } catch (e) {
              const p = describePasskeyError(e, 'confirm')
              if (p.kind !== 'cancelled') setError(p.message)
              else setError('Not confirmed. The passkey still signs you in; try again whenever you like.')
            } finally {
              setBusy(false)
            }
          }}
        >
          Confirm with the passkey
        </Button>
      </div>
    </Dialog>
  )
}

function RemoveDialog({ passkey, lastUnlock, onClose, onRemoved, run }: { passkey: PasskeyInfo | null; lastUnlock: boolean; onClose: () => void; onRemoved: (ended: number) => Promise<void>; run: ReturnType<typeof useReauth>['run'] }) {
  const [endSessions, setEndSessions] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setEndSessions(true)
    setError('')
  }, [passkey])
  return (
    <Dialog open={!!passkey} onOpenChange={(o) => !o && onClose()} title={`Remove “${passkey?.name ?? ''}”?`} description="It won’t sign in to Muni any more. Your password manager may still list it — you can delete it there too.">
      <label className="flex cursor-pointer items-start gap-3 text-[15px]">
        <input type="checkbox" className="mt-1 size-4 accent-[var(--accent)]" checked={endSessions} onChange={(e) => setEndSessions(e.target.checked)} />
        <span>Also sign out other sessions that signed in with this passkey<span className="block text-sm text-ink-soft">Removing a passkey doesn’t end sessions by itself. This one stays signed in.</span></span>
      </label>
      {lastUnlock ? (
        <p className="mt-4 rounded-2xl bg-warn/10 px-3.5 py-2.5 text-sm">
          <strong className="font-medium">It’s the only passkey that unlocks your encrypted writing,</strong> and you have no recovery key. After removing it, only devices that are unlocked now can open your writing. Save a recovery key first (Encryption, below), or let another passkey unlock.
        </p>
      ) : null}
      <ErrorText>{error}</ErrorText>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          variant="danger"
          busy={busy}
          onClick={async () => {
            if (!passkey) return
            setBusy(true)
            setError('')
            try {
              const r = await run(() => del<{ sessions_ended: number }>(`/api/auth/passkeys/${passkey.id}`, { revoke_sessions: endSessions }))
              if (r) {
                onClose()
                await onRemoved(r.sessions_ended)
              }
            } catch (e) {
              setError(e instanceof ApiError && e.code === 'last_method' ? 'This is your only way to sign in. Add another passkey or a recovery email first.' : failure(e, 'remove it'))
            } finally {
              setBusy(false)
            }
          }}
        >
          Remove passkey
        </Button>
      </div>
    </Dialog>
  )
}

// ------------------------------------------------------------------ sessions

export function Sessions() {
  const toast = useToast()
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const load = useCallback(async () => {
    try {
      setSessions(await get<SessionInfo[]>('/api/auth/sessions'))
      return true
    } catch (e) {
      setError(failure(e, 'load your sessions'))
      return false
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  const others = (sessions ?? []).filter((s) => !s.current)
  const endOthers = async () => {
    setBusy('others')
    setError('')
    try {
      await post('/api/auth/logout-others')
      toast('Signed out everywhere else')
    } catch (e) {
      setError(failure(e, 'sign out your other sessions'))
    } finally {
      // Whatever happened, show what the server says is signed in now.
      await load()
      setBusy(null)
    }
  }
  const endOne = async (s: SessionInfo) => {
    setBusy(s.id)
    setError('')
    try {
      await del(`/api/auth/sessions/${s.id}`)
      toast('Session signed out')
    } catch (e) {
      setError(failure(e, 'sign out that session'))
    } finally {
      await load()
      setBusy(null)
    }
  }
  return (
    <div>
      {sessions === null ? null : (
        <List>
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{s.label ?? 'A browser'}{s.current ? <span className="font-normal text-ink-faint"> · this session</span> : null}</span>
                <span className="block text-ink-soft">
                  {s.method === 'passkey' ? `Passkey${s.passkey_name ? ` (${s.passkey_name})` : ''}` : 'Email code'} · signed in {day(s.created_at)} · active {when(s.last_seen_at)}
                </span>
              </span>
              {s.current ? null : (
                <Button size="sm" variant="ghost" busy={busy === s.id} onClick={() => endOne(s)} aria-label={`Sign out ${s.label ?? 'this session'}`}>Sign out</Button>
              )}
            </li>
          ))}
        </List>
      )}
      {others.length ? (
        <Button className="mt-4" variant="danger" size="sm" busy={busy === 'others'} onClick={endOthers}>
          Sign out everywhere else
        </Button>
      ) : null}
      <ErrorText>{error}</ErrorText>
      <p className="mt-3 text-sm text-ink-soft">Signing out a session ends it on that device straight away. It doesn’t remove a passkey — remove the passkey too if a device is lost. Sessions end on their own after 30 days.</p>
    </div>
  )
}

// ------------------------------------------------------------------ activity

const EVENT_TEXT: Record<string, string> = {
  'signin.email': 'Signed in with an email code',
  'signin.passkey': 'Signed in with a passkey',
  'reauth.email': 'Confirmed with an email code',
  'reauth.passkey': 'Confirmed with a passkey',
  'passkey.added': 'Passkey added',
  'passkey.removed': 'Passkey removed',
  'passkey.renamed': 'Passkey renamed',
  'passkey.counter_anomaly': 'A synced passkey reported an unusual counter (usually harmless)',
  'session.revoked': 'A session was signed out',
  'sessions.revoked_others': 'Signed out everywhere else',
  'keys.replaced': 'Encryption keys replaced',
  'keys.recovery_replaced': 'New recovery key made',
  'account.created': 'Account created with a passkey',
  'email.added': 'Recovery email added',
  'email.changed': 'Recovery email changed',
  'email.removed': 'Recovery email removed',
}

export function SecurityActivity() {
  const [events, setEvents] = useState<SecurityEventInfo[] | null>(null)
  useEffect(() => {
    get<SecurityEventInfo[]>('/api/auth/security-events').then(setEvents).catch(() => setEvents([]))
  }, [])
  if (!events?.length) return <p className="text-sm text-ink-soft">{events ? 'Nothing yet.' : ''}</p>
  return (
    <ul className="space-y-1.5 text-sm">
      {events.slice(0, 10).map((e) => (
        <li key={e.id} className="flex flex-wrap justify-between gap-x-4">
          <span>{EVENT_TEXT[e.kind] ?? e.kind}</span>
          <span className="text-ink-soft">{when(e.created_at)}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * The optional recovery email. Adding one enables code sign-in if every passkey is lost, email
 * invitations to that address, and sprint reminders. It is never needed to sign in.
 */
function RecoveryEmail({ passkeys, run, onChanged }: { passkeys: number; run: ReturnType<typeof useReauth>['run']; onChanged: () => Promise<void> }) {
  const { me } = useAuth()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!me) return null
  return (
    <div>
      <h3 className="text-sm font-medium">Recovery email <span className="font-normal text-ink-faint">· optional</span></h3>
      <p className="mt-1 flex items-start gap-2 text-sm text-ink-soft">
        <Mail className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          {me.email ? <>Verified: <span className="text-ink [overflow-wrap:anywhere]">{me.email}</span>. </> : 'None. '}
          An address lets you sign in with a code if you lose every passkey, receive team invitations sent to it, and get sprint reminders. You never need it to sign in, and it’s never shown with your thoughts.
        </span>
      </p>
      {editing ? (
        <div className="mt-3 max-w-md">
          <EmailSetup
            current={me.email}
            run={run}
            onCancel={() => setEditing(false)}
            onChanged={async (e) => {
              setEditing(false)
              await onChanged()
              toast(e ? `${e} added` : 'Email updated')
            }}
          />
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setEditing(true)}>{me.email ? 'Change email' : 'Add a recovery email'}</Button>
          {me.email ? <Button size="sm" variant="ghost" onClick={() => setRemoving(true)} disabled={passkeys === 0} title={passkeys === 0 ? 'Add a passkey first' : undefined}>Remove</Button> : null}
        </div>
      )}
      {me.email && passkeys === 0 ? <p className="mt-2 text-sm text-ink-soft">Add a passkey before removing your email — otherwise there’d be no way to sign in.</p> : null}
      <Dialog open={removing} onOpenChange={(o) => !o && setRemoving(false)} title="Remove your recovery email?" description={`${me.email ?? ''} will no longer sign you in, receive invitations addressed to it, or get reminders.`}>
        {passkeys < 2 ? (
          <p className="rounded-2xl bg-[color-mix(in_oklab,var(--warn)_12%,var(--card))] px-3.5 py-2.5 text-sm">
            <strong className="font-medium">You have one passkey.</strong> Without an email, losing it means losing the account — Muni can’t restore it. Consider adding a second passkey first.
          </p>
        ) : null}
        <ErrorText>{error}</ErrorText>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRemoving(false)}>Keep it</Button>
          <Button
            variant="danger"
            busy={busy}
            onClick={async () => {
              setBusy(true)
              setError('')
              try {
                const r = await run(() => del('/api/me/email'))
                if (r !== undefined) {
                  setRemoving(false)
                  await onChanged()
                  toast('Recovery email removed')
                }
              } catch (e) {
                setError(e instanceof ApiError && e.code === 'last_method' ? 'Add a passkey first.' : failure(e, 'remove it'))
              } finally {
                setBusy(false)
              }
            }}
          >
            {passkeys < 2 ? 'Remove anyway' : 'Remove email'}
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
