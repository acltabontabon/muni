/**
 * The entrance: one shell for signing in, verifying the code, choosing a name, and invitations.
 * One decision at a time. Signing in and signing up are the same flow: the server decides after
 * the code is verified, and asks for a name only when the account has none.
 */
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ApiError, patch, post } from '@/api/client'
import type { CodeSent, Me } from '@/api/types'
import { Mark } from '@/brand/Mark'
import { Button, ErrorText } from '@/ui'
import { DuyanScene } from './scene'

/** How far the evening has gone: email → code → name → in. Drives the sun and the kept lights. */
export const PROGRESS = { email: 0.16, code: 0.5, name: 0.8, done: 1 } as const

/** "muni-muni" in Baybayin (ᜋᜓ mu · ᜈᜒ ni), the pre-colonial Tagalog script. */
const BAYBAYIN = '\u170B\u1713\u1708\u1712 \u170B\u1713\u1708\u1712'

export function EntranceShell({ progress = PROGRESS.email, children }: { progress?: number; children: ReactNode }) {
  // Nothing moves while nobody is looking.
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    const on = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return (
    <div className="entrance" data-paused={hidden || undefined}>
      <header className="entrance-brand">
        <div className="entrance-top">
          <div className="entrance-wordmark">
            <Mark size={32} reflect={false} title="Muni" />
            <span aria-hidden>muni</span>
          </div>
          <span className="entrance-baybayin" lang="tl-Tglg" aria-hidden title="muni-muni, in Baybayin">{BAYBAYIN}</span>
        </div>
        <div className="entrance-message">
          <p className="entrance-headline">
            <span>Keep the <em>thought</em>.</span> <span className="soft">Bring it to the conversation.</span>
          </p>
          <p className="entrance-lede">Capture what matters during the sprint, while it’s still fresh.</p>
          <p className="entrance-kicker"><i lang="tl">muni-muni</i> · Filipino · to reflect; to ponder.</p>
        </div>
        <div className="entrance-scene">
          <DuyanScene progress={progress} />
        </div>
      </header>
      <div className="entrance-side">
        <main className="entrance-auth">{children}</main>
        <footer className="entrance-footer">
          <p>Thoughts stay hidden until collection closes, then are shared without names.</p>
          <nav aria-label="About Muni">
            <Link to="/privacy" className="entrance-link">Privacy &amp; data</Link>
            <a href="https://munimuni.app" className="entrance-link">What is Muni?</a>
          </nav>
        </footer>
      </div>
    </div>
  )
}

/** A step's frame: heading and instructions, with the id the step's input points to. */
export function Step({ title, children, describedBy, lead }: { title: ReactNode; children?: ReactNode; describedBy?: string; lead?: ReactNode }) {
  return (
    <section className="entrance-step" aria-labelledby={`${describedBy}-title`}>
      <h1 id={`${describedBy}-title`}>{title}</h1>
      {lead ? <div id={describedBy} className="instructions">{lead}</div> : null}
      {children}
    </section>
  )
}

const offline = (e: unknown) => e instanceof ApiError && e.status === 0
const minutes = (secs: number) => (secs >= 90 ? `${Math.ceil(secs / 60)} minutes` : `${secs} seconds`)

/** Focus a step's input when the step appears, except on a touch screen's first load (no keyboard jump). */
function useStepFocus(ref: React.RefObject<HTMLInputElement | null>, initial: boolean) {
  useEffect(() => {
    if (initial && !window.matchMedia('(pointer: fine)').matches) return
    ref.current?.focus()
  }, [ref, initial])
}

type Intro = { title: ReactNode; lead: ReactNode }

/**
 * Email → code → (name). `onDone` receives the signed-in account once nothing else is needed.
 * `intro` replaces the email step's heading (the invitation page names the invited address).
 */
export function AuthFlow({ onDone, intro, onProgress }: { onDone: (me: Me) => void | Promise<void>; intro?: Intro; onProgress?: (p: number) => void }) {
  const [step, setStep] = useState<'email' | 'code' | 'name'>('email')
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState<{ expires: number; resendAt: number; note: string | null }>({ expires: 10, resendAt: 0, note: null })
  const [first, setFirst] = useState(true)
  const go = (s: 'email' | 'code' | 'name') => {
    setFirst(false)
    setStep(s)
    onProgress?.(PROGRESS[s])
  }
  if (step === 'email')
    return (
      <EmailStep
        initial={first}
        email={email}
        intro={intro}
        onSent={(address, info, note) => {
          setEmail(address)
          setSent({ expires: info.expires_in_minutes, resendAt: Date.now() + info.resend_after_seconds * 1000, note })
          go('code')
        }}
      />
    )
  if (step === 'code')
    return (
      <CodeStep
        email={email}
        sent={sent}
        onResent={(info, note) => setSent({ expires: info.expires_in_minutes, resendAt: Date.now() + info.resend_after_seconds * 1000, note })}
        onChangeEmail={() => go('email')}
        onVerified={async (me) => {
          if (me.needs_name) go('name')
          else {
            onProgress?.(PROGRESS.done)
            await onDone(me)
          }
        }}
      />
    )
  return <NameStep onDone={async (me) => { onProgress?.(PROGRESS.done); await onDone(me) }} />
}

function EmailStep({ email: initialEmail, initial, intro, onSent }: { email: string; initial: boolean; intro?: Intro; onSent: (email: string, info: CodeSent, note: string | null) => void }) {
  const id = useId()
  const [email, setEmail] = useState(initialEmail)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useStepFocus(ref, initial)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const address = email.trim()
    setError('')
    setBusy(true)
    try {
      onSent(address, await post<CodeSent>('/api/auth/request-code', { email: address }), null)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'resend_cooldown') {
        // A code went to this address moments ago: it still works, so go on to it.
        const wait = Number(err.details.retry_after_seconds ?? 30)
        onSent(address, { sent: true, expires_in_minutes: 10, resend_after_seconds: wait }, 'A code was sent to this address a moment ago. Use that one, or ask for a new one shortly.')
      } else if (offline(err)) setError('You’re offline, so nothing was sent. Check your connection and try again.')
      else if (err instanceof ApiError && err.code === 'rate_limited') setError(`Too many codes were requested for this address. Try again in ${minutes(Number(err.details.retry_after_seconds ?? 900))}.`)
      else setError(err instanceof ApiError ? sentence(err.message) : 'Something went wrong. Try again.')
      ref.current?.focus()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Step describedBy={`${id}-lead`} title={intro?.title ?? 'A moment to reflect.'} lead={intro?.lead ?? 'Enter your email to continue.'}>
      <form onSubmit={submit} className="mt-7" noValidate={false}>
        <label htmlFor={`${id}-email`} className="block text-sm font-medium">Email</label>
        <input
          ref={ref}
          id={`${id}-email`}
          className="field mt-1.5"
          type="email"
          name="email"
          autoComplete="username email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          aria-describedby={`${id}-lead ${id}-how`}
          aria-invalid={error ? true : undefined}
        />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" variant="primary" size="lg" className="mt-5 w-full" busy={busy}>Send me a code</Button>
        <p id={`${id}-how`} className="quiet mt-4">We’ll email you a six-digit code. There’s no password.{intro ? null : <> Joining a team? Open the link in your invitation email.</>}</p>
        <p className="quiet mt-2">
          Muni uses your email to sign you in, deliver team invitations and send sprint reminders — never for marketing, and it’s never shown with your thoughts.{' '}
          <Link to="/privacy#collect" className="entrance-link">How privacy works</Link>
        </p>
      </form>
    </Step>
  )
}

const CODE_MESSAGES: Record<string, string> = {
  code_expired: 'That code has expired. Send a new one below.',
  code_used: 'That code was already used. Send a new one below.',
  code_locked: 'That code can’t be tried again. Send a new one below.',
  code_format: 'Enter the six digits from the email.',
}

function CodeStep({ email, sent, onResent, onChangeEmail, onVerified }: { email: string; sent: { expires: number; resendAt: number; note: string | null }; onResent: (info: CodeSent, note: string | null) => void; onChangeEmail: () => void; onVerified: (me: Me) => Promise<void> }) {
  const id = useId()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [resending, setResending] = useState(false)
  const [error, setError] = useState('')
  const [focused, setFocused] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const ref = useRef<HTMLInputElement>(null)
  const inFlight = useRef(false)
  useStepFocus(ref, false)
  const wait = Math.max(0, Math.ceil((sent.resendAt - now) / 1000))
  useEffect(() => {
    if (sent.resendAt <= Date.now()) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [sent.resendAt])

  const verify = async (e: FormEvent) => {
    e.preventDefault()
    if (inFlight.current) return // one request at a time, however it was submitted
    if (code.length !== 6) {
      setError('Enter all six digits from the email.')
      ref.current?.focus()
      return
    }
    inFlight.current = true
    setError('')
    setBusy(true)
    try {
      await onVerified(await post<Me>('/api/auth/verify', { email, code }))
    } catch (err) {
      if (offline(err)) setError('You’re offline. Your code is still here — try again when you’re connected.')
      else if (err instanceof ApiError && err.code === 'code_mismatch') {
        const left = Number(err.details.attempts_left ?? 0)
        setError(`That code doesn’t match. Check the newest email from Muni${left ? ` — ${left} ${left === 1 ? 'try' : 'tries'} left` : ''}.`)
      } else if (err instanceof ApiError && err.code === 'rate_limited') setError(`Too many tries. Wait ${minutes(Number(err.details.retry_after_seconds ?? 60))} and try again.`)
      else if (err instanceof ApiError && CODE_MESSAGES[err.code]) setError(CODE_MESSAGES[err.code])
      else setError(err instanceof ApiError ? sentence(err.message) : 'Something went wrong. Try again.')
      ref.current?.select()
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const resend = async () => {
    if (resending || wait > 0) return
    setResending(true)
    setError('')
    try {
      const info = await post<CodeSent>('/api/auth/request-code', { email })
      setCode('')
      setNow(Date.now())
      onResent(info, 'A new code is on its way. Only the newest one works.')
      ref.current?.focus()
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'resend_cooldown' || err.code === 'rate_limited')) {
        const secs = Number(err.details.retry_after_seconds ?? 30)
        setNow(Date.now())
        onResent({ sent: true, expires_in_minutes: sent.expires, resend_after_seconds: secs }, null)
        setError(`You can ask for another code in ${minutes(secs)}.`)
      } else if (offline(err)) setError('You’re offline, so no new code was sent. Try again when you’re connected.')
      else setError(err instanceof ApiError ? sentence(err.message) : 'Couldn’t send a new code. Try again.')
    } finally {
      setResending(false)
    }
  }

  return (
    <Step
      describedBy={`${id}-lead`}
      title="Check your inbox."
      lead={
        <>
          We sent a six-digit code to
          <span className="mt-1 flex flex-wrap items-baseline gap-x-3">
            <span className="email-line">{email}</span>
            <button type="button" className="entrance-link text-sm" onClick={onChangeEmail}>Change email</button>
          </span>
        </>
      }
    >
      <form onSubmit={verify} className="mt-7">
        <label htmlFor={`${id}-code`} className="block text-sm font-medium">Code</label>
        {/* One real input over six capiz panes: typing, paste, autofill, deletion and screen readers
            all use the input; the panes only show it, lighting up as each digit arrives. */}
        <div className="capiz mt-1.5" data-invalid={error ? true : undefined}>
          <input
            ref={ref}
            id={`${id}-code`}
            className="capiz-input"
            type="text"
            name="one-time-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            enterKeyHint="go"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            // Paste "123 456", "123-456" or a whole sentence: only the digits are kept, leading zeros included.
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onPaste={(e) => {
              const digits = e.clipboardData.getData('text').replace(/\D/g, '')
              if (digits.length >= 6) {
                e.preventDefault()
                setCode(digits.slice(0, 6))
              }
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            aria-describedby={`${id}-lead ${id}-expiry`}
            aria-invalid={error ? true : undefined}
            required
          />
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} aria-hidden className="capiz-pane" data-lit={i < code.length || undefined} data-active={(focused && i === Math.min(code.length, 5)) || undefined}>
              {code[i] ?? ''}
            </span>
          ))}
        </div>
        <ErrorText>{error}</ErrorText>
        {sent.note && !error ? <p role="status" className="quiet mt-2">{sent.note}</p> : null}
        <Button type="submit" variant="primary" size="lg" className="mt-5 w-full" busy={busy}>Continue</Button>
        <div className="quiet mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span id={`${id}-expiry`}>The code works once, for {sent.expires} minutes.</span>
          <button type="button" className="entrance-link" onClick={resend} disabled={wait > 0 || resending} aria-disabled={wait > 0 || resending}>
            {resending ? 'Sending…' : wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
          </button>
        </div>
      </form>
    </Step>
  )
}

/** The name teammates see. Asked once, after verifying, only when the account has none. */
export function NameStep({ onDone, footer }: { onDone: (me: Me) => void | Promise<void>; footer?: ReactNode }) {
  const id = useId()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useStepFocus(ref, false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (!name.trim()) {
      setError('Enter the name your teammates know you by.')
      ref.current?.focus()
      return
    }
    setError('')
    setBusy(true)
    try {
      await onDone(await patch<Me>('/api/auth/me', { display_name: name.trim() }))
    } catch (err) {
      setError(offline(err) ? 'You’re offline, so your name wasn’t saved. Try again when you’re connected.' : err instanceof ApiError ? sentence(err.message) : 'Couldn’t save your name. Try again.')
      ref.current?.focus()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Step
      describedBy={`${id}-lead`}
      title="What should we call you?"
      lead="Teammates see this name in your workspace, when it’s your turn to speak in a retro, and on experiments you own. It isn’t shown with your entries or votes."
    >
      <form onSubmit={submit} className="mt-7">
        <label htmlFor={`${id}-name`} className="block text-sm font-medium">Display name</label>
        <input
          ref={ref}
          id={`${id}-name`}
          className="field mt-1.5"
          name="name"
          autoComplete="name"
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-describedby={`${id}-lead`}
          aria-invalid={error ? true : undefined}
          required
        />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" variant="primary" size="lg" className="mt-5 w-full" busy={busy}>Continue</Button>
        {footer}
      </form>
    </Step>
  )
}

/** Server messages are lower-case fragments; show them as sentences. */
function sentence(m: string) {
  const t = m.trim()
  return t ? t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.') : t
}
