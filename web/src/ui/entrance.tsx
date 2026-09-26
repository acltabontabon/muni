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
import { KeyRound } from 'lucide-react'
import { Button, ErrorText } from '@/ui'
import { useAuth } from '@/lib/auth'
import { readPrefs, writePrefs } from '@/lib/prefs'
import { addPasskey, cancelPasskey, isInstalled, describePasskeyError, hasPasskeyHint, hasPlatformAuthenticator, signInWithPasskey, suggestedPasskeyName, supportsAutofill, supportsPasskeys } from '@/lib/passkeys'
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
type FlowStep = 'email' | 'code' | 'new-account' | 'name' | 'offer'

/**
 * Sign in with a passkey or an email code → (name) → (an offer to add a passkey). `onDone`
 * receives the signed-in account once nothing else is needed. `intro` replaces the first step's
 * heading (the invitation page names the invited address).
 *
 * `intent` makes joining explicit: 'signin' is "I already use Muni" — if the code then created a
 * new account, the person is told before going on, so nobody joins a team under a second identity
 * by accident. The server never reveals whether an account exists before the code is verified.
 */
export function AuthFlow({ onDone, intro, onProgress, intent }: { onDone: (me: Me) => void | Promise<void>; intro?: Intro; onProgress?: (p: number) => void; intent?: 'signin' | 'create' }) {
  const [step, setStep] = useState<FlowStep>('email')
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState<{ expires: number; resendAt: number; note: string | null }>({ expires: 10, resendAt: 0, note: null })
  const [first, setFirst] = useState(true)
  const [queue, setQueue] = useState<FlowStep[]>([])
  const [account, setAccount] = useState<Me | null>(null)
  const [offerable, setOfferable] = useState(false)
  useEffect(() => {
    hasPlatformAuthenticator().then(setOfferable)
  }, [])
  const go = (s: FlowStep) => {
    setFirst(false)
    setStep(s)
    onProgress?.(s === 'new-account' || s === 'offer' ? PROGRESS.name : PROGRESS[s])
  }
  /** After any step that finishes with the account: the next one still needed, or done. */
  const advance = async (me: Me, rest: FlowStep[]) => {
    setAccount(me)
    const [next, ...later] = rest
    if (!next) {
      onProgress?.(PROGRESS.done)
      await onDone(me)
      return
    }
    setQueue(later)
    go(next)
  }
  const verified = (me: Me, via: 'email' | 'passkey') => {
    const dismissed = (readPrefs().passkeyOfferDismissedFor ?? []).includes(me.account_id)
    const steps: FlowStep[] = []
    if (intent === 'signin' && me.created) steps.push('new-account')
    if (me.needs_name) steps.push('name')
    if (via === 'email' && offerable && me.passkeys === 0 && !dismissed) steps.push('offer')
    return advance(me, steps)
  }
  if (step === 'email')
    return (
      <EmailStep
        initial={first}
        email={email}
        intro={intro}
        onPasskey={(me) => verified(me, 'passkey')}
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
        onVerified={(me) => verified(me, 'email')}
      />
    )
  if (step === 'new-account' && account) return <NewAccountStep email={account.email} onContinue={() => advance(account, queue)} onDifferent={() => { setQueue([]); setAccount(null); go('email') }} />
  if (step === 'offer' && account) return <PasskeyOffer account={account} onDone={() => advance(account, queue)} />
  return <NameStep onDone={(me) => advance(me, queue)} />
}

function EmailStep({ email: initialEmail, initial, intro, onSent, onPasskey }: { email: string; initial: boolean; intro?: Intro; onSent: (email: string, info: CodeSent, note: string | null) => void; onPasskey: (me: Me) => void | Promise<void> }) {
  const id = useId()
  const [email, setEmail] = useState(initialEmail)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [passkeyBusy, setPasskeyBusy] = useState(false)
  const [passkeyNote, setPasskeyNote] = useState<{ text: string; error: boolean } | null>(null)
  // Someone who used a passkey in this browser before sees it first; email stays one tap away.
  const supported = supportsPasskeys()
  const [showEmail, setShowEmail] = useState(() => !(supported && hasPasskeyHint()) || !!initialEmail)
  const [round, setRound] = useState(0)
  const ref = useRef<HTMLInputElement>(null)
  useStepFocus(ref, initial || !showEmail)
  const done = useRef(onPasskey)
  useEffect(() => {
    done.current = onPasskey
  }, [onPasskey])

  // Progressive enhancement: saved passkeys also appear in the email field's autofill. The browser
  // shows nothing if there are none; the explicit button and email always remain.
  useEffect(() => {
    if (!showEmail) return
    let live = true
    supportsAutofill().then((ok) => {
      if (!ok || !live) return
      signInWithPasskey({ conditional: true })
        .then((me) => live && done.current(me))
        .catch((e) => {
          if (!live) return
          const p = describePasskeyError(e)
          if (p.kind === 'cancelled') return
          setPasskeyNote({ text: p.message, error: p.kind !== 'expired' })
          if (p.kind === 'expired' || p.kind === 'unknown') setRound((n) => n + 1)
        })
    })
    return () => {
      live = false
      cancelPasskey()
    }
  }, [showEmail, round])

  const usePasskey = async () => {
    if (passkeyBusy) return
    setPasskeyBusy(true)
    setPasskeyNote(null)
    setError('')
    try {
      await onPasskey(await signInWithPasskey())
    } catch (e) {
      const p = describePasskeyError(e)
      setPasskeyNote({ text: p.message, error: p.kind !== 'cancelled' })
      setRound((n) => n + 1) // the button cancelled any autofill request; offer it again
    } finally {
      setPasskeyBusy(false)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const address = email.trim()
    setError('')
    setPasskeyNote(null)
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
  const note = passkeyNote ? (
    passkeyNote.error ? <ErrorText>{passkeyNote.text}</ErrorText> : <p role="status" className="quiet mt-3">{passkeyNote.text}</p>
  ) : null

  if (!showEmail)
    return (
      <Step describedBy={`${id}-lead`} title={intro?.title ?? 'Welcome back.'} lead={intro?.lead ?? 'Unlock with your passkey to continue.'}>
        <Button variant="primary" size="lg" className="mt-7 w-full" busy={passkeyBusy} onClick={usePasskey} aria-describedby={`${id}-pk`}>
          <KeyRound className="size-4" aria-hidden /> Continue with a passkey
        </Button>
        {note}
        <p id={`${id}-pk`} className="quiet mt-4">Your device or password manager unlocks it — with your fingerprint, face, PIN or screen lock. Muni never receives your biometric data.</p>
        <p className="quiet mt-4">
          <button type="button" className="entrance-link" onClick={() => { cancelPasskey(); setPasskeyNote(null); setShowEmail(true) }}>Use email instead</button>
        </p>
      </Step>
    )
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
          autoComplete="username webauthn"
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
        {supported ? (
          <>
            <div className="entrance-or" aria-hidden><span>or</span></div>
            <Button type="button" size="lg" className="w-full" busy={passkeyBusy} onClick={usePasskey}>
              <KeyRound className="size-4" aria-hidden /> Continue with a passkey
            </Button>
            {note}
          </>
        ) : null}
        <p id={`${id}-how`} className="quiet mt-4">We’ll email you a six-digit code. There’s no password.{intro ? null : <> Joining a team? Open the link in your invitation email.</>}</p>
        <p className="quiet mt-2">
          Muni uses your email to sign you in, deliver team invitations and send sprint reminders — never for marketing, and it’s never shown with your thoughts.{' '}
          <Link to="/privacy#collect" className="entrance-link">How privacy works</Link>
        </p>
      </form>
    </Step>
  )
}

/** Told only after the code proved the mailbox is theirs: this address had no account until now. */
function NewAccountStep({ email, onContinue, onDifferent }: { email: string; onContinue: () => void; onDifferent: () => void }) {
  const id = useId()
  const { signOutLocal } = useAuth()
  const [busy, setBusy] = useState(false)
  return (
    <Step
      describedBy={`${id}-lead`}
      title="This is a new Muni account."
      lead={<>There wasn’t an account for <span className="email-line">{email}</span>, so one was just created. If you already use Muni with another address, use that one instead — your teams and thoughts stay together.</>}
    >
      <Button variant="primary" size="lg" className="mt-7 w-full" onClick={onContinue} autoFocus>Continue with this new account</Button>
      <p className="quiet mt-4">
        <button
          type="button"
          className="entrance-link"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await post('/api/auth/logout')
            } catch {
              /* a fresh, empty account: nothing to lose if this fails */
            }
            signOutLocal()
            onDifferent()
          }}
        >
          Use a different address
        </button>
      </p>
    </Step>
  )
}

/** After an email sign-in: add a passkey now, while the sign-in is fresh. Optional, once per account here. */
export function PasskeyOffer({ account, onDone }: { account: Me; onDone: () => void | Promise<void> }) {
  const id = useId()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null)
  const notNow = () => {
    const cur = readPrefs().passkeyOfferDismissedFor ?? []
    writePrefs({ passkeyOfferDismissedFor: [...cur.filter((a) => a !== account.account_id), account.account_id] })
    return onDone()
  }
  const add = async () => {
    if (busy) return
    setBusy(true)
    setNote(null)
    try {
      await addPasskey(suggestedPasskeyName())
      await onDone()
    } catch (e) {
      const p = describePasskeyError(e, 'add')
      if (p.kind === 'exists') await onDone()
      else setNote({ text: p.message, error: p.kind !== 'cancelled' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Step
      describedBy={`${id}-lead`}
      title="Skip the code next time?"
      lead="Add a passkey and return by unlocking this device — with your fingerprint, face, PIN or screen lock. Your device keeps that; Muni never receives your biometric data."
    >
      <Button variant="primary" size="lg" className="mt-7 w-full" busy={busy} onClick={add} autoFocus>
        <KeyRound className="size-4" aria-hidden /> Add a passkey
      </Button>
      {note ? note.error ? <ErrorText>{note.text}</ErrorText> : <p role="status" className="quiet mt-3">{note.text}</p> : null}
      <Button variant="ghost" size="lg" className="mt-2 w-full" onClick={notNow} disabled={busy}>Not now</Button>
      <p className="quiet mt-4">A passkey may sync to your other devices through your password manager. Email codes keep working, and you can manage passkeys from your account.</p>
    </Step>
  )
}

const CODE_MESSAGES: Record<string, string> = {
  code_expired: 'That code has expired. Send a new one below.',
  code_used: 'That code was already used. Send a new one below.',
  code_locked: 'That code can’t be tried again. Send a new one below.',
  code_format: 'Enter the six digits from the email.',
}

function CodeStep({ email, sent, onResent, onChangeEmail, onVerified }: { email: string; sent: { expires: number; resendAt: number; note: string | null }; onResent: (info: CodeSent, note: string | null) => void; onChangeEmail: () => void; onVerified: (me: Me) => void | Promise<void> }) {
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
      await onVerified(await post<Me>('/api/auth/verify', { email, code, installed: isInstalled() }))
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

/**
 * An invitation's first question, before any email is typed: someone who already uses Muni signs
 * in (passkey or code) instead of accidentally starting a second account.
 */
export function JoinDoors({ title, lead, onChoose }: { title: ReactNode; lead: ReactNode; onChoose: (intent: 'signin' | 'create') => void }) {
  const id = useId()
  return (
    <Step describedBy={`${id}-lead`} title={title} lead={lead}>
      <div className="entrance-choice" role="group" aria-label="How would you like to continue?">
        <button type="button" onClick={() => onChoose('signin')} autoFocus>
          <strong>I already use Muni</strong>
          <span>Continue with a passkey or an email code, so you join as you.</span>
        </button>
        <button type="button" onClick={() => onChoose('create')}>
          <strong>I’m new to Muni</strong>
          <span>Create an account with your email address. We’ll send a code to confirm it’s yours.</span>
        </button>
      </div>
    </Step>
  )
}
