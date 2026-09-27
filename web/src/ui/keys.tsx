/**
 * Encryption, in plain words. Normally there's nothing to see: signing in with a passkey unlocks
 * your writing, and a new account gets its key without asking. People only see something when
 * this device needs them — to confirm with a passkey, to use a recovery key — and each message says
 * what happened and what to do, never "missing key" while it's still being unlocked.
 */
import { useCallback, useEffect, useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Copy, Download, KeyRound, Loader2, MonitorSmartphone } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { CryptoError } from '@/lib/e2ee/crypto'
import { keyring } from '@/lib/e2ee/keyring'
import { useDeviceKeys } from '@/lib/e2ee/E2eeProvider'
import { describePasskeyError, supportsPasskeys, unlockWithPasskey } from '@/lib/passkeys'
import { ApiError, del, get } from '@/api/client'
import type { DeviceInfo } from '@/api/types'
import { Button, Dialog, ErrorText, useToast } from '@/ui'
import { useReauth } from '@/ui/reauth'

function RecoveryKeyView({ value }: { value: string }) {
  const toast = useToast()
  const { me } = useAuth()
  return (
    <div>
      <p className="rounded-2xl bg-card-2 px-4 py-4 text-center font-mono text-[17px] leading-relaxed tracking-wide [overflow-wrap:anywhere] select-all" aria-label="Your recovery key">
        {value}
      </p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <Button size="sm" onClick={async () => { try { await navigator.clipboard.writeText(value); toast('Copied — paste it somewhere safe') } catch { toast('Couldn’t copy — select the text instead', 'danger') } }}>
          <Copy className="size-4" /> Copy
        </Button>
        <Button
          size="sm"
          onClick={() => {
            const text = `Muni recovery key for ${me?.display_name || 'your account'}\n\n${value}\n\nKeep this private. With it, any device you sign in on can read your encrypted writing and your team’s encrypted retrospectives.\nMuni can’t recover it for you.\n`
            const a = document.createElement('a')
            a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
            a.download = 'muni-recovery-key.txt'
            a.click()
            URL.revokeObjectURL(a.href)
          }}
        >
          <Download className="size-4" /> Save as a file
        </Button>
      </div>
    </div>
  )
}

/**
 * Only when every way back in is gone: new keys. Refused (by the keyring) if this device turns out
 * to be able to read after all — confirming it's you with a passkey may unlock it on the way.
 */
function StartOverDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const reauth = useReauth()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const close = () => {
    setError('')
    onClose()
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title="Start over with new keys?"
      description="Only if you’ve lost every passkey that unlocks your writing, every unlocked device and your recovery key. Content sealed to your old key stays unreadable to you — Muni can’t open it either. Teammates who still have access can share current sprints with you again."
    >
      <ErrorText>{error}</ErrorText>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button
          variant="danger"
          busy={busy}
          onClick={async () => {
            setBusy(true)
            setError('')
            try {
              await reauth.run(() => keyring.replace())
              if (keyring.state().kind === 'ready') {
                toast('New keys are ready on this device.')
                close()
              }
            } catch (e) {
              if (e instanceof CryptoError && e.code === 'mismatch' && keyring.state().kind === 'ready') {
                toast('Your writing is unlocked on this device — nothing was replaced.')
                close()
              } else setError(e instanceof Error ? e.message : 'Couldn’t create new keys.')
            } finally {
              setBusy(false)
            }
          }}
        >
          Create new keys
        </Button>
      </div>
      {reauth.dialog}
    </Dialog>
  )
}

export function UnlockDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const uid = useId()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reset, setReset] = useState(false)
  return (
    <>
      <Dialog open={open && !reset} onOpenChange={(o) => !o && onClose()} title="Unlock with your recovery key" description="The 36-character key you saved when you made a recovery key. After this, signing in on this device unlocks your writing again.">
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            setError('')
            try {
              await keyring.unlock(text)
              setText('')
              onClose()
            } catch (err) {
              setError(err instanceof CryptoError && err.code === 'auth' ? 'That recovery key doesn’t open this account’s key.' : err instanceof Error ? err.message : 'Couldn’t unlock.')
            } finally {
              setBusy(false)
            }
          }}
        >
          <label htmlFor={`${uid}-rk`} className="block text-sm font-medium">Recovery key</label>
          <input id={`${uid}-rk`} className="mt-1.5 w-full rounded-xl border border-line bg-card px-3.5 py-2.5 font-mono tracking-wide" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" spellCheck={false} autoCapitalize="characters" placeholder="XXXX-XXXX-…" aria-invalid={error ? true : undefined} />
          <ErrorText>{error}</ErrorText>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
            <button type="button" className="text-sm text-ink-soft underline underline-offset-2" onClick={() => setReset(true)}>Lost it?</button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="submit" variant="primary" busy={busy} disabled={text.replace(/[\s-]/g, '').length < 36}>Unlock</Button>
            </div>
          </div>
        </form>
      </Dialog>
      <StartOverDialog open={open && reset} onClose={() => { setReset(false); onClose() }} />
    </>
  )
}

/** Shows `children` only after a moment, so a quick unlock never flashes anything. */
function Later({ ms = 500, children }: { ms?: number; children: ReactNode }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setShown(true), ms)
    return () => window.clearTimeout(t)
  }, [ms])
  return shown ? <>{children}</> : null
}

/** "Unlock with your passkey": one confirmation. A cancelled prompt is just that — not a lost key. */
function usePasskeyUnlock() {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const run = useCallback(async () => {
    setBusy(true)
    setNote('')
    try {
      await unlockWithPasskey()
      const s = keyring.state()
      if (s.kind !== 'ready') setNote(s.kind === 'needs-passkey' || s.kind === 'locked' ? (s.note ?? 'That passkey can’t unlock your writing here. Try another passkey, or use your recovery key.') : '')
    } catch (e) {
      const p = describePasskeyError(e, 'confirm')
      setNote(p.kind === 'cancelled' ? 'No passkey was used, so your writing stays locked here for now. Try again whenever you’re ready.' : p.message)
    } finally {
      setBusy(false)
    }
  }, [])
  return { run, busy, note }
}

/**
 * Shown where encrypted content is used, only when something is needed from this person (or, for a
 * moment, that it's unlocking). `need` says why (writing, reading).
 */
export function DeviceKeyNotice({ need = 'read' }: { need?: 'write' | 'read' }) {
  const { state } = useDeviceKeys()
  const [dialog, setDialog] = useState<null | 'unlock' | 'recovery'>(null)
  const passkey = usePasskeyUnlock()
  const canPasskey = supportsPasskeys()
  let body: ReactNode = null
  if (state.kind === 'restoring')
    body = (
      <Later>
        <p className="flex items-center gap-2 px-1 text-sm text-ink-soft" role="status" aria-live="polite">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Unlocking your writing…
        </p>
      </Later>
    )
  else if (state.kind === 'offline')
    body = (
      <Row>
        <strong className="font-medium">You’re offline.</strong> Your encrypted writing unlocks when Muni can be reached. {need === 'write' ? 'You can keep writing — nothing is sent until then.' : ''}
      </Row>
    )
  else if (state.kind === 'error')
    body = (
      <Row action={<Button size="sm" onClick={() => void keyring.refresh()}>Try again</Button>}>
        {state.message}
      </Row>
    )
  else if (state.kind === 'needs-passkey')
    body = (
      <Row
        action={
          <div className="flex flex-wrap gap-2">
            {canPasskey ? <Button size="sm" variant="primary" busy={passkey.busy} onClick={passkey.run}><KeyRound className="size-4" aria-hidden /> Unlock with passkey</Button> : null}
            {state.recoveryAvailable ? <Button size="sm" variant={canPasskey ? 'ghost' : 'primary'} onClick={() => setDialog('unlock')}>Use recovery key</Button> : null}
          </div>
        }
      >
        <strong className="font-medium">Confirm with your passkey to unlock your writing on this device.</strong> {passkey.note || state.note || ''}
      </Row>
    )
  else if (state.kind === 'locked')
    body = (
      <Row action={state.recoveryAvailable ? <Button size="sm" variant="primary" onClick={() => setDialog('unlock')}>Use recovery key</Button> : <Button size="sm" onClick={() => setDialog('unlock')}>Options</Button>}>
        <strong className="font-medium">Your writing is encrypted, and this device can’t unlock it yet.</strong>{' '}
        {state.note ? `${state.note} ` : ''}
        {state.recoveryAvailable ? 'Use your recovery key, or sign in with a passkey that unlocks your writing.' : 'Sign in with a passkey that unlocks your writing, or use a device where it’s already unlocked. A passkey you add now can’t recover a key this device never had.'}
      </Row>
    )
  else if (state.kind === 'ready' && !state.methods.passkeys && !state.methods.recovery)
    body = (
      <Row action={<Link to="/account#encryption" className="text-sm font-medium underline underline-offset-2">Add a way back in</Link>}>
        <strong className="font-medium">Only this device can unlock your writing.</strong> Let your passkey unlock it too, or save a recovery key, so losing this device doesn’t mean losing access.
      </Row>
    )
  return (
    <>
      {body}
      <UnlockDialog open={dialog === 'unlock'} onClose={() => setDialog(null)} />
      <NewRecoveryDialog open={dialog === 'recovery'} onClose={() => setDialog(null)} />
    </>
  )
}

function Row({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-accent-soft/70 px-4 py-3 text-sm text-ink sm:flex-row sm:items-center sm:justify-between" role="status">
      <p className="flex items-start gap-2"><KeyRound className="mt-0.5 size-4 shrink-0 text-accent-ink" aria-hidden /> <span>{children}</span></p>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

export function NewRecoveryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const reauth = useReauth()
  const { state } = useDeviceKeys()
  const hasOne = state.kind === 'ready' && state.methods.recovery
  const [value, setValue] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const close = () => {
    setValue(null)
    setSaved(false)
    setError('')
    onClose()
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && (value ? saved && close() : close())}
      title={hasOne && !value ? 'A new recovery key' : 'Your recovery key'}
      description={value ? 'Save it somewhere safe, like a password manager. With it, any device you sign in on can unlock your writing. Muni can’t show it again.' : hasOne ? 'Muni never keeps your recovery key, so it can’t show it again. You can make a new one — the old one stops working.' : 'A backup for when no passkey or device can unlock your writing. Muni never keeps it: it’s shown to you once.'}
    >
      {value ? (
        <>
          <RecoveryKeyView value={value} />
          <label className="mt-5 flex cursor-pointer items-start gap-3 text-[15px]">
            <input type="checkbox" className="mt-1 size-4 accent-[var(--accent)]" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            <span>I’ve saved it somewhere safe.</span>
          </label>
          <div className="mt-5 flex justify-end"><Button variant="primary" disabled={!saved} onClick={async () => { await keyring.confirmRecoverySaved(); close() }}>Done</Button></div>
        </>
      ) : (
        <>
          <ErrorText>{error}</ErrorText>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button variant="primary" busy={busy} onClick={async () => { setBusy(true); try { const v = await reauth.run(() => keyring.newRecovery()); if (v) setValue(v) } catch (e) { setError(e instanceof Error ? e.message : 'Couldn’t make a recovery key') } finally { setBusy(false) } }}>{hasOne ? 'Make a new recovery key' : 'Make a recovery key'}</Button>
          </div>
        </>
      )}
      {reauth.dialog}
    </Dialog>
  )
}

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '')

/** Account page: the ways to unlock encrypted writing, and what can be done about them. */
export function EncryptionSettings({ onForget }: { onForget?: () => void }) {
  const { state } = useDeviceKeys()
  const toast = useToast()
  const [dialog, setDialog] = useState<null | 'unlock' | 'recovery'>(null)
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null)
  const [error, setError] = useState('')
  const passkey = usePasskeyUnlock()
  const loadDevices = useCallback(async () => {
    try {
      setDevices(await get<DeviceInfo[]>('/api/me/devices'))
    } catch {
      setDevices(null)
    }
  }, [])
  useEffect(() => {
    if (state.kind === 'ready') void loadDevices()
  }, [state.kind, loadDevices])
  const [thisDevice, setThisDevice] = useState<string | null>(null)
  useEffect(() => {
    void keyring.deviceId().then(setThisDevice)
  }, [state])
  const others = (devices ?? []).filter((d) => d.id !== thisDevice)
  return (
    <div className="space-y-4 text-[15px]">
      {state.kind === 'ready' ? (
        <>
          <p>Your encrypted writing is unlocked on this device.</p>
          <ul className="space-y-1.5 text-sm">
            <li>· <strong className="font-medium">Passkeys:</strong> {state.methods.passkeys ? `${state.methods.passkeys === 1 ? 'one passkey unlocks' : `${state.methods.passkeys} passkeys unlock`} it when you sign in with ${state.methods.passkeys === 1 ? 'it' : 'them'}, on any device where you can use ${state.methods.passkeys === 1 ? 'it' : 'them'}.` : 'none unlock it yet. Passkeys in Sign-in methods above show which can, and let those that support it unlock too.'}</li>
            <li>· <strong className="font-medium">This device:</strong> {state.persisted === false ? 'Muni couldn’t keep the unlock in this browser, so you’ll confirm with a passkey (or recovery key) next time.' : 'stays able to unlock after you sign out — only once you sign in again.'}</li>
            <li>· <strong className="font-medium">Recovery key:</strong> {state.methods.recovery ? (state.recoverySaved ? 'saved.' : 'made, not confirmed as saved.') : 'none. A backup for when no passkey or device can unlock.'}</li>
          </ul>
          {!state.methods.passkeys && !state.methods.recovery ? (
            <p className="rounded-2xl bg-warn/10 px-3.5 py-2.5 text-sm"><strong className="font-medium">Only this device can unlock your writing.</strong> If you lose it, or clear this browser, the writing can’t be opened. Let a passkey unlock it, or make a recovery key.</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setDialog('recovery')}>{state.methods.recovery ? 'Make a new recovery key' : 'Make a recovery key'}</Button>
            {onForget ? <Button size="sm" variant="ghost" onClick={onForget}>Forget this device…</Button> : null}
          </div>
          {others.length ? (
            <div>
              <h3 className="text-sm font-medium">Other devices that can unlock after signing in</h3>
              <ul className="mt-2 divide-y divide-line rounded-2xl bg-card text-sm shadow-[0_0_0_1px_var(--line)]">
                {others.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                    <MonitorSmartphone className="size-4 shrink-0 text-ink-soft" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{d.label ?? 'A browser'}</span>
                      <span className="block text-ink-soft">{d.last_used_at ? `Last unlocked ${day(d.last_used_at)}` : `Added ${day(d.created_at)}`}</span>
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        setError('')
                        try {
                          await del(`/api/me/devices/${d.id}`)
                          toast('That device can no longer unlock your writing by itself.')
                          await loadDevices()
                        } catch (e) {
                          setError(e instanceof ApiError && e.status === 0 ? 'You’re offline, so nothing changed.' : 'Couldn’t remove it. Try again.')
                        }
                      }}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-sm text-ink-soft">Removing one means it needs a passkey that unlocks, or the recovery key, to read your writing again. It can’t take back what that device already showed.</p>
            </div>
          ) : null}
          <p className="text-sm text-ink-soft">Your key’s fingerprint: <span className="font-mono text-ink">{state.fingerprint}</span>. Teammates can compare it with what their device shows for you.</p>
        </>
      ) : state.kind === 'needs-passkey' ? (
        <>
          <p>Confirm with your passkey to unlock your writing on this device.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" busy={passkey.busy} onClick={passkey.run}><KeyRound className="size-4" aria-hidden /> Unlock with passkey</Button>
            {state.recoveryAvailable ? <Button size="sm" variant="ghost" onClick={() => setDialog('unlock')}>Use recovery key</Button> : null}
          </div>
          {passkey.note || state.note ? <p className="text-sm text-ink-soft">{passkey.note || state.note}</p> : null}
        </>
      ) : state.kind === 'locked' ? (
        <>
          <p>This device can’t unlock your encrypted writing yet.{state.note ? ` ${state.note}` : ''}</p>
          <div className="flex flex-wrap gap-2"><Button size="sm" variant="primary" onClick={() => setDialog('unlock')}>{state.recoveryAvailable ? 'Unlock with your recovery key' : 'Options'}</Button></div>
        </>
      ) : state.kind === 'offline' ? (
        <p className="text-ink-soft">You’re offline. Your writing unlocks when Muni can be reached.</p>
      ) : state.kind === 'error' ? (
        <>
          <p>{state.message}</p>
          <div><Button size="sm" onClick={() => void keyring.refresh()}>Try again</Button></div>
        </>
      ) : (
        <p className="text-ink-soft">Unlocking…</p>
      )}
      <ErrorText>{error}</ErrorText>
      <p className="text-sm text-ink-soft">Signing in with a passkey that unlocks your writing opens it on any device. A passkey that only signs in gets you into your account, not into encrypted content. Muni’s servers only ever hold your key locked. <Link to="/privacy#encryption" className="underline underline-offset-2">How encryption works</Link></p>
      <UnlockDialog open={dialog === 'unlock'} onClose={() => setDialog(null)} />
      <NewRecoveryDialog open={dialog === 'recovery'} onClose={() => setDialog(null)} />
    </div>
  )
}

/** One honest line about a sprint's protection, with the detail a click away. */
export function EncryptionLine({ encryption }: { encryption: 'e1' | null | undefined }) {
  return encryption === 'e1' ? (
    <span>Encrypted: thoughts, themes, notes and outcomes are sealed on participants’ devices; Muni’s servers store them unreadable. <Link to="/privacy#encryption" className="underline underline-offset-2">What’s covered</Link></span>
  ) : (
    <span>Set up before on-device encryption: connections and storage are encrypted, but Muni’s servers can read this sprint’s content. <Link to="/privacy#encryption" className="underline underline-offset-2">Details</Link></span>
  )
}
