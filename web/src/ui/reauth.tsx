/**
 * "Confirm it's you": the recent-sign-in check before adding or removing a passkey or changing
 * keys. The server decides when it's needed (403 `reauth_required`); `run` asks, then retries the
 * action once. Confirming is always with one of the account's own passkeys and never switches
 * accounts.
 */
import { useCallback, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { ApiError } from '@/api/client'
import { useAuth } from '@/lib/auth'
import { confirmWithPasskey, describePasskeyError, supportsPasskeys } from '@/lib/passkeys'
import { Button, Dialog, ErrorText } from '@/ui'

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
  const { refresh } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const canPasskey = supportsPasskeys()
  const finish = async (ok: boolean) => {
    if (ok) await refresh()
    setError('')
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
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && finish(false)}
      title="Confirm it’s you"
      description="Changes to your passkeys and keys need a recent sign-in, so someone using an unlocked device can’t add their own way in."
    >
      {canPasskey ? (
        <Button variant="primary" busy={busy} onClick={passkey} autoFocus>
          <KeyRound className="size-4" aria-hidden /> Confirm with your passkey
        </Button>
      ) : (
        <p className="text-sm text-ink-soft">This browser can’t use passkeys. Confirm on a device that can.</p>
      )}
      <ErrorText>{error}</ErrorText>
    </Dialog>
  )
}
