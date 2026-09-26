import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Mark } from '@/brand/Mark'
import { post, ApiError } from '@/api/client'
import type { Me } from '@/api/types'
import { useAuth } from '@/lib/auth'
import { Button, ErrorText, Help, Input, Label, useDocumentTitle } from '@/ui'
import { Link } from 'react-router'

export function SignIn() {
  useDocumentTitle('Sign in')
  const { me, refresh } = useAuth()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next') || '/'
  useEffect(() => {
    if (me) nav(next, { replace: true })
  }, [me, nav, next])
  return (
    <div className="min-h-dvh grid place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Mark size={56} className="mx-auto text-ink" />
          <h1 className="font-display mt-4 text-2xl">Good retros start before the meeting.</h1>
          <p className="mt-2 text-ink-soft">Sign in with your email. No password to remember.</p>
        </div>
        <div className="card p-6">
          <CodeSignIn onSignedIn={async () => { await refresh(); nav(next, { replace: true }) }} />
        </div>
        <p className="mt-6 text-center text-xs text-ink-faint">
          Muni is invite-only. Verifying your email proves you control that mailbox, nothing more. <Link to="/about" className="underline">How Muni handles privacy</Link>
        </p>
      </div>
    </div>
  )
}

/** Email → six-digit code → session. Reused by the invitation page with a fixed address. */
export function CodeSignIn({ onSignedIn, fixedEmailHint, requireEmail }: { onSignedIn: (me: Me) => void; fixedEmailHint?: string; requireEmail?: string }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const codeRef = useRef<HTMLInputElement>(null)

  const request = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await post('/api/auth/request-code', { email })
      setStep('code')
      window.setTimeout(() => codeRef.current?.focus(), 50)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }
  const verify = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const me = await post<Me>('/api/auth/verify', { email, code, display_name: name || undefined })
      onSignedIn(me)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  if (step === 'email')
    return (
      <form onSubmit={request} className="space-y-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" inputMode="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder={fixedEmailHint ? `the address this was sent to (${fixedEmailHint})` : 'you@team.com'} />
          {requireEmail ? <Help>This invitation is for {fixedEmailHint}. Enter that exact address.</Help> : null}
        </div>
        <div>
          <Label htmlFor="name" hint="if this is your first time">Your name</Label>
          <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="How teammates see you" maxLength={80} />
        </div>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" variant="primary" className="w-full" busy={busy}>
          Email me a code
        </Button>
      </form>
    )
  return (
    <form onSubmit={verify} className="space-y-4">
      <div>
        <Label htmlFor="code">Six-digit code</Label>
        <Input ref={codeRef} id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} required value={code} onChange={(e) => setCode(e.target.value)} className="font-mono text-2xl tracking-[0.3em] text-center" placeholder="••••••" />
        <Help>
          Sent to <span className="text-ink">{email}</span>. It expires in 10 minutes and works once.
        </Help>
      </div>
      <ErrorText>{error}</ErrorText>
      <Button type="submit" variant="primary" className="w-full" busy={busy}>
        Sign in
      </Button>
      <button type="button" className="w-full text-sm text-ink-soft hover:text-ink" onClick={() => { setStep('email'); setCode('') }}>
        Use a different email
      </button>
    </form>
  )
}
