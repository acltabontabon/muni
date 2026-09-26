/**
 * "Confirm it's you": the recent-sign-in check before adding or removing a passkey or changing
 * recovery settings. The server decides when it's needed (403 `reauth_required`); `run` asks,
 * then retries the action once. A passkey if the account has one, otherwise (or instead) a code
 * to the account's own address. Confirming never switches accounts.
 */
import { useCallback, useState, type FormEvent } from 'react'
import { KeyRound } from 'lucide-react'
import { ApiError, post } from '@/api/client'
import type { Me } from '@/api/types'
import { useAuth } from '@/lib/auth'
import { confirmWithPasskey, describePasskeyError, isInstalled, supportsPasskeys } from '@/lib/passkeys'
import { Button, Dialog, ErrorText, Input, Label } from '@/ui'

export function useReauth() {
  const [pending, setPending] = useState<{ resolve: (ok: boolean) => void } | null>(null)
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await fn()
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'reauth_required')) throw e
      const ok = await new Promise<boolean>((resolve) => setPending({ resolve }))
      if (!ok) return undefined
      return fn()
    }
  }, [])
  const dialog = (
    <ReauthDialog
      open={!!pending}
      onDone={(ok) => {
        pending?.resolve(ok)
        setPending(null)
      }}
    />
  )
  return { run, dialog }
}

function ReauthDialog({ open, onDone }: { open: boolean; onDone: (ok: boolean) => void }) {
  const { me, refresh } = useAuth()
  const [mode, setMode] = useState<'choose' | 'code'>('choose')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const canPasskey = !!me && me.passkeys > 0 && supportsPasskeys()
  const reset = () => {
    setMode('choose')
    setCode('')
    setError('')
    setNote('')
  }
  const finish = async (ok: boolean) => {
    if (ok) await refresh()
    reset()
    onDone(ok)
  }
  const passkey = async () => {
    setBusy(true)
    setError('')
    try {
      await confirmWithPasskey()
      await finish(true)
    } catch (e) {
      setError(describePasskeyError(e, 'confirm').message)
    } finally {
      setBusy(false)
    }
  }
  const sendCode = async () => {
    if (!me) return
    setBusy(true)
    setError('')
    try {
      await post('/api/auth/request-code', { email: me.email })
      setNote(`We sent a code to ${me.email}.`)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'resend_cooldown') setNote(`A code was sent to ${me.email} a moment ago — use that one.`)
      else {
        setError(e instanceof ApiError && e.status === 0 ? 'You’re offline. Try again when you’re connected.' : e instanceof ApiError ? e.message : 'Couldn’t send a code.')
        return
      }
    } finally {
      setBusy(false)
    }
    setMode('code')
  }
  const verify = async (e: FormEvent) => {
    e.preventDefault()
    if (!me || busy) return
    setBusy(true)
    setError('')
    try {
      await post<Me>('/api/auth/verify', { email: me.email, code, reauth: true, installed: isInstalled() })
      await finish(true)
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'code_mismatch' ? 'That code doesn’t match. Check the newest email from Muni.' : err instanceof ApiError ? err.message : 'Couldn’t confirm. Try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && finish(false)}
      title="Confirm it’s you"
      description="Changes to how you sign in or recover your account need a recent sign-in. This keeps someone using an unlocked device from adding their own way in."
    >
      {mode === 'choose' ? (
        <div className="grid gap-2">
          {canPasskey ? (
            <Button variant="primary" busy={busy} onClick={passkey} autoFocus>
              <KeyRound className="size-4" aria-hidden /> Use a passkey
            </Button>
          ) : null}
          <Button variant={canPasskey ? 'secondary' : 'primary'} busy={busy && !canPasskey} onClick={sendCode} autoFocus={!canPasskey}>
            Email me a code
          </Button>
        </div>
      ) : (
        <form onSubmit={verify} className="grid gap-2">
          {note ? <p role="status" className="text-sm text-ink-soft">{note}</p> : null}
          <Label htmlFor="reauth-code">Code</Label>
          <Input id="reauth-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} autoFocus />
          <Button type="submit" variant="primary" busy={busy} disabled={code.length !== 6}>Confirm</Button>
        </form>
      )}
      <ErrorText>{error}</ErrorText>
    </Dialog>
  )
}
