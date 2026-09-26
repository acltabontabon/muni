/**
 * Encryption, in plain words. People see four ideas and never the machinery:
 *   this device can read your team's encrypted content · unlock it on this device ·
 *   save your recovery key · this device doesn't have the key.
 */
import { useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Copy, Download, KeyRound } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { CryptoError } from '@/lib/e2ee/crypto'
import { keyring } from '@/lib/e2ee/keyring'
import { useDeviceKeys } from '@/lib/e2ee/E2eeProvider'
import { ApiError } from '@/api/client'
import { Button, Dialog, ErrorText, useToast } from '@/ui'

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
            const text = `Muni recovery key for ${me?.email ?? 'your account'}\n\n${value}\n\nKeep this private. With it, any device you sign in on can read your team’s encrypted retrospectives.\nMuni can’t recover it for you.\n`
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

/** First device: create the keys, show the recovery key once, and ask that it's saved. */
export function SetupDialog({ open, onClose, replace }: { open: boolean; onClose: () => void; replace?: boolean }) {
  const [recovery, setRecovery] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const close = () => {
    setRecovery(null)
    setSaved(false)
    setError('')
    onClose()
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && (recovery ? saved && close() : close())}
      title={recovery ? 'Save your recovery key' : replace ? 'Start over with new keys?' : 'Set up encryption on this device'}
      description={
        recovery
          ? 'You’ll need it to read your team’s encrypted content on another device, or if this browser’s data is cleared. Muni can’t recover it for you.'
          : replace
            ? 'Only if you’ve lost every device and your recovery key. Content sealed to your old key stays unreadable to you — teammates who still have access can share the current sprints with you again.'
            : 'Encrypted sprints are sealed on your team’s devices before they reach Muni’s servers. This creates your key on this device and a recovery key for you to keep.'
      }
    >
      {recovery ? (
        <>
          <RecoveryKeyView value={recovery} />
          <label className="mt-5 flex cursor-pointer items-start gap-3 text-[15px]">
            <input type="checkbox" className="mt-1 size-4 accent-[var(--accent)]" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            <span>I’ve saved it somewhere safe, like a password manager.</span>
          </label>
          <div className="mt-5 flex justify-end">
            <Button variant="primary" disabled={!saved} busy={busy} onClick={async () => { setBusy(true); try { await keyring.confirmRecoverySaved() } finally { setBusy(false); close() } }}>Done</Button>
          </div>
        </>
      ) : (
        <>
          <ul className="space-y-2 text-sm text-ink-soft">
            <li>· Your key stays in this browser. Signing out removes it.</li>
            <li>· Anyone who can use this browser profile can use the key — set it up on your own device.</li>
          </ul>
          <ErrorText>{error}</ErrorText>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>Not now</Button>
            <Button
              variant={replace ? 'danger' : 'primary'}
              busy={busy}
              onClick={async () => {
                setBusy(true)
                setError('')
                try {
                  setRecovery(await keyring.setup({ replace }))
                } catch (e) {
                  setError(e instanceof ApiError && e.status === 409 ? 'This account already has a key. Unlock it with your recovery key instead.' : e instanceof Error ? e.message : 'Couldn’t set up encryption.')
                } finally {
                  setBusy(false)
                }
              }}
            >
              {replace ? 'Create new keys' : 'Set up this device'}
            </Button>
          </div>
        </>
      )}
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
      <Dialog open={open && !reset} onOpenChange={(o) => !o && onClose()} title="Unlock your content on this device" description="Enter the recovery key you saved when you set up encryption.">
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
      <SetupDialog open={open && reset} replace onClose={() => { setReset(false); onClose() }} />
    </>
  )
}

/**
 * Shown where encrypted content is used, only when something is needed from this person.
 * `need` says why (writing, reading).
 */
export function DeviceKeyNotice({ need = 'read' }: { need?: 'write' | 'read' }) {
  const { state } = useDeviceKeys()
  const [dialog, setDialog] = useState<null | 'setup' | 'unlock' | 'recovery'>(null)
  let body: ReactNode = null
  if (state.kind === 'none')
    body = (
      <Row action={<Button size="sm" variant="primary" onClick={() => setDialog('setup')}>Set up this device</Button>}>
        <strong className="font-medium">This sprint is encrypted.</strong> {need === 'write' ? 'Set up encryption on this device to send thoughts to it.' : 'Set up encryption on this device to read it.'}
      </Row>
    )
  else if (state.kind === 'locked')
    body = (
      <Row action={<Button size="sm" variant="primary" onClick={() => setDialog('unlock')}>Unlock</Button>}>
        <strong className="font-medium">This device doesn’t have the required key.</strong> Unlock your content on this device with your recovery key.
      </Row>
    )
  else if (state.kind === 'ready' && !state.recoverySaved)
    body = (
      <Row action={<Button size="sm" onClick={() => setDialog('recovery')}>Save it now</Button>}>
        <strong className="font-medium">Save your recovery information.</strong> Without it, losing this device means losing access to encrypted content.
      </Row>
    )
  return (
    <>
      {body}
      <SetupDialog open={dialog === 'setup'} onClose={() => setDialog(null)} />
      <UnlockDialog open={dialog === 'unlock'} onClose={() => setDialog(null)} />
      <NewRecoveryDialog open={dialog === 'recovery'} onClose={() => setDialog(null)} />
    </>
  )
}

function Row({ children, action }: { children: ReactNode; action: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-accent-soft/70 px-4 py-3 text-sm text-ink sm:flex-row sm:items-center sm:justify-between" role="status">
      <p className="flex items-start gap-2"><KeyRound className="mt-0.5 size-4 shrink-0 text-accent-ink" aria-hidden /> <span>{children}</span></p>
      <div className="shrink-0">{action}</div>
    </div>
  )
}

export function NewRecoveryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
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
    <Dialog open={open} onOpenChange={(o) => !o && close()} title="A new recovery key" description={value ? 'Your previous recovery key no longer works. Save this one.' : 'Muni never keeps your recovery key, so it can’t show it again. You can make a new one — the old one stops working.'}>
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
            <Button variant="primary" busy={busy} onClick={async () => { setBusy(true); try { setValue(await keyring.newRecovery()) } catch (e) { setError(e instanceof Error ? e.message : 'Couldn’t make a new key') } finally { setBusy(false) } }}>Make a new recovery key</Button>
          </div>
        </>
      )}
    </Dialog>
  )
}

/** Account page: this device's encryption state and what can be done about it. */
export function EncryptionSettings() {
  const { state } = useDeviceKeys()
  const [dialog, setDialog] = useState<null | 'setup' | 'unlock' | 'recovery' | 'reset' | 'forget'>(null)
  return (
    <div className="space-y-4 text-[15px]">
      {state.kind === 'ready' ? (
        <>
          <p>This device can access your team’s encrypted content.</p>
          <p className="text-sm text-ink-soft">Your key’s fingerprint: <span className="font-mono text-ink">{state.fingerprint}</span>. Teammates can compare it with what their device shows for you.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setDialog('recovery')}>{state.recoverySaved ? 'Make a new recovery key' : 'Save your recovery key'}</Button>
            <Button size="sm" variant="ghost" onClick={() => setDialog('forget')}>Remove the key from this device</Button>
          </div>
        </>
      ) : state.kind === 'locked' ? (
        <>
          <p>This device doesn’t have your key yet.</p>
          <div className="flex flex-wrap gap-2"><Button size="sm" variant="primary" onClick={() => setDialog('unlock')}>Unlock with your recovery key</Button></div>
        </>
      ) : state.kind === 'none' ? (
        <>
          <p>Encryption isn’t set up yet. You’ll need it to take part in encrypted sprints.</p>
          <div><Button size="sm" variant="primary" onClick={() => setDialog('setup')}>Set up this device</Button></div>
        </>
      ) : (
        <p className="text-ink-soft">Checking this device…</p>
      )}
      <p className="text-sm text-ink-soft">Your recovery key is separate from signing in: an email code gets you into your account, not into encrypted content. <Link to="/privacy#encryption" className="underline underline-offset-2">How encryption works</Link></p>
      <SetupDialog open={dialog === 'setup'} onClose={() => setDialog(null)} />
      <UnlockDialog open={dialog === 'unlock'} onClose={() => setDialog(null)} />
      <NewRecoveryDialog open={dialog === 'recovery'} onClose={() => setDialog(null)} />
      <Dialog open={dialog === 'forget'} onOpenChange={(o) => !o && setDialog(null)} title="Remove the key from this device?" description="You’ll need your recovery key to read encrypted content here again. Nothing is deleted from your account.">
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
          <Button variant="danger" onClick={async () => { await keyring.forget(); setDialog(null) }}>Remove</Button>
        </div>
      </Dialog>
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
