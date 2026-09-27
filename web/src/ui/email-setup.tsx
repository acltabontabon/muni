/**
 * Adding or changing the account's optional email address: enter it, receive a code, confirm.
 * Used in Account → Signing in and right after creating an account. The server needs a recent
 * sign-in for this (`run` from useReauth asks, then retries).
 */
import { useId, useState, type FormEvent } from 'react'
import { ApiError, post } from '@/api/client'
import { Button, ErrorText, Input, Label } from '@/ui'

type Run = <T>(fn: () => Promise<T>) => Promise<T | undefined>
const direct: Run = (fn) => fn()

export function EmailSetup({ current, onChanged, onCancel, run = direct }: { current: string | null; onChanged: (email: string | null) => void; onCancel?: () => void; run?: Run }) {
  const id = useId()
  const [step, setStep] = useState<'address' | 'code'>('address')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const problem = (e: unknown) =>
    e instanceof ApiError
      ? e.status === 0
        ? 'You’re offline. Try again when you’re connected.'
        : e.code === 'code_mismatch'
          ? 'That code doesn’t match. Check the newest email from Muni.'
          : e.code === 'email_in_use'
            ? 'That address is already on another Muni account. If it’s yours, sign out and use “Used Muni before?” with it instead.'
            : e.message.charAt(0).toUpperCase() + e.message.slice(1)
      : 'Something went wrong. Try again.'
  const send = async (e?: FormEvent) => {
    e?.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await run(() => post('/api/me/email/request', { email: email.trim() }))
      if (r !== undefined) {
        setNote(`We sent a code to ${email.trim()}. It works once, for 10 minutes.`)
        setStep('code')
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'resend_cooldown') {
        setNote('A code was sent to this address a moment ago — use that one.')
        setStep('code')
      } else setError(problem(err))
    } finally {
      setBusy(false)
    }
  }
  const confirm = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await run(() => post<{ email: string }>('/api/me/email/verify', { email: email.trim(), code }))
      if (r) onChanged(r.email)
    } catch (err) {
      setError(problem(err))
    } finally {
      setBusy(false)
    }
  }
  if (step === 'code')
    return (
      <form onSubmit={confirm} className="grid gap-2">
        {note ? <p role="status" className="text-sm text-ink-soft">{note}</p> : null}
        <Label htmlFor={`${id}-code`}>Code</Label>
        <Input id={`${id}-code`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} autoFocus />
        <ErrorText>{error}</ErrorText>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" busy={busy} disabled={code.length !== 6}>Confirm address</Button>
          <Button type="button" variant="ghost" onClick={() => { setStep('address'); setCode(''); setError('') }}>Use a different address</Button>
        </div>
      </form>
    )
  return (
    <form onSubmit={send} className="grid gap-2">
      <Label htmlFor={`${id}-email`}>{current ? 'New email address' : 'Email address'}</Label>
      <Input id={`${id}-email`} type="email" autoComplete="email" inputMode="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoFocus />
      <ErrorText>{error}</ErrorText>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" busy={busy}>Send a code</Button>
        {onCancel ? <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button> : null}
      </div>
    </form>
  )
}
