/**
 * The entrance: one shell for signing in with a passkey, creating an account, the "Used Muni
 * before?" email path, choosing a name, and invitations. One decision at a time.
 */
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ApiError, patch, post } from '@/api/client'
import type { CodeSent, Me } from '@/api/types'
import { Mark } from '@/brand/Mark'
import { KeyRound } from 'lucide-react'
import { Button, ErrorText } from '@/ui'
import { addPasskey, describePasskeyError, hasPasskeyHint, isInstalled, signInWithPasskey, signUpWithPasskey, suggestedPasskeyName, supportsPasskeys } from '@/lib/passkeys'
import { EmailSetup } from './email-setup'
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
type View = 'start' | 'create' | 'protect' | 'email' | 'code' | 'name' | 'offer'
const VIEW_PROGRESS: Record<View, number> = { start: PROGRESS.email, email: PROGRESS.email, create: PROGRESS.code, code: PROGRESS.code, name: PROGRESS.name, protect: PROGRESS.name, offer: PROGRESS.name }

/**
 * Passkey first. One primary action, "Continue with a passkey" — no email or username to type.
 * New people create an account with a passkey (no email needed). People whose account predates
 * passkeys use the quiet "Used Muni before?" email path, then add a passkey to that same account.
 *
 * Nothing starts a passkey prompt by itself: after signing out, the old account never signs
 * straight back in, and the browser's own chooser lists every Muni passkey on the device.
 * `intro` replaces the first heading (invitation pages). `startWith: 'email'` opens the email path.
 */
export function AuthFlow({ onDone, intro, onProgress, startWith }: { onDone: (me: Me) => void | Promise<void>; intro?: Intro; onProgress?: (p: number) => void; startWith?: 'email' }) {
  const [view, setView] = useState<View>(startWith === 'email' ? 'email' : 'start')
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState<{ expires: number; resendAt: number; note: string | null }>({ expires: 10, resendAt: 0, note: null })
  const [account, setAccount] = useState<Me | null>(null)
  const [first, setFirst] = useState(true)
  const go = (v: View) => {
    setFirst(false)
    setView(v)
    onProgress?.(VIEW_PROGRESS[v])
  }
  const finish = async (me: Me) => {
    onProgress?.(PROGRESS.done)
    await onDone(me)
  }
  // Whatever signed the person in, a missing name comes first; an email sign-in then offers a passkey.
  const afterSignIn = async (me: Me, via: 'passkey' | 'email') => {
    setAccount(me)
    if (me.needs_name) return go('name')
    if (via === 'email' && me.passkeys === 0 && supportsPasskeys()) return go('offer')
    await finish(me)
  }
  if (view === 'start')
    return <PasskeyStart intro={intro} onSignedIn={(me) => afterSignIn(me, 'passkey')} onCreate={() => go('create')} onEmail={() => go('email')} />
  if (view === 'create')
    return (
      <CreateAccount
        onBack={() => go('start')}
        onCreated={(me) => {
          setAccount(me)
          go('protect')
        }}
      />
    )
  if (view === 'protect' && account) return <ProtectStep account={account} onDone={() => finish(account)} />
  if (view === 'email')
    return (
      <EmailStep
        initial={first}
        email={email}
        onBack={() => go('start')}
        onSent={(address, info, note) => {
          setEmail(address)
          setSent({ expires: info.expires_in_minutes, resendAt: Date.now() + info.resend_after_seconds * 1000, note })
          go('code')
        }}
      />
    )
  if (view === 'code')
    return (
      <CodeStep
        email={email}
        sent={sent}
        onResent={(info, note) => setSent({ expires: info.expires_in_minutes, resendAt: Date.now() + info.resend_after_seconds * 1000, note })}
        onChangeEmail={() => go('email')}
        onNoAccount={() => go('create')}
        onVerified={(me) => afterSignIn(me, 'email')}
      />
    )
  if (view === 'offer' && account) return <PasskeyOffer account={account} onDone={() => finish(account)} />
  return (
    <NameStep
      onDone={async (me) => {
        setAccount(me)
        if (me.passkeys === 0 && supportsPasskeys()) go('offer')
        else await finish(me)
      }}
    />
  )
}

function Note({ note }: { note: { text: string; error: boolean } | null }) {
  if (!note) return null
  return note.error ? <ErrorText>{note.text}</ErrorText> : <p role="status" className="quiet mt-3">{note.text}</p>
}

/** The one primary action, and quiet help for when it doesn't go as expected. */
function PasskeyStart({ intro, onSignedIn, onCreate, onEmail }: { intro?: Intro; onSignedIn: (me: Me) => void | Promise<void>; onCreate: () => void; onEmail: () => void }) {
  const id = useId()
  const supported = supportsPasskeys()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null)
  const signIn = async () => {
    if (busy) return
    setBusy(true)
    setNote(null)
    try {
      await onSignedIn(await signInWithPasskey())
    } catch (e) {
      const p = describePasskeyError(e)
      setNote({ text: p.message, error: p.kind !== 'cancelled' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Step describedBy={`${id}-lead`} title={intro?.title ?? (hasPasskeyHint() ? 'Welcome back.' : 'A moment to reflect.')} lead={intro?.lead ?? 'Sign in with your passkey. There’s no email or password to remember.'}>
      {supported ? (
        <Button variant="primary" size="lg" className="mt-7 w-full" busy={busy} onClick={signIn} aria-describedby={`${id}-how`}>
          <KeyRound className="size-4" aria-hidden /> Continue with a passkey
        </Button>
      ) : (
        <p role="status" className="mt-7 rounded-2xl bg-[color-mix(in_oklab,var(--warn)_10%,var(--e-panel))] px-4 py-3 text-[15px]">
          This browser can’t use passkeys. Open Muni in a current version of Safari, Chrome, Edge or Firefox — or on your phone.
        </p>
      )}
      <Note note={note} />
      <p id={`${id}-how`} className="quiet mt-4">Your device or password manager unlocks it with your fingerprint, face, PIN or screen lock. Muni never receives your biometric data.</p>
      <details className="entrance-help mt-4">
        <summary>Passkey on another device, or not working?</summary>
        <ul>
          <li><strong>On your phone?</strong> Choose “Continue with a passkey”, then the option to use a phone or tablet. Scan the QR code your browser shows, and unlock the passkey on your phone.</li>
          <li><strong>Cancelled, or nothing happened?</strong> Nothing was shared. Try again whenever you’re ready.</li>
          <li><strong>No passkey on this device?</strong> Use the device where you made it (or its QR option above). If you signed in with email codes before, use email below.</li>
          <li><strong>Switching accounts?</strong> Your browser lists every Muni passkey on this device — choose the one you want.</li>
        </ul>
      </details>
      <p className="mt-6 text-[15px]">
        New to Muni? <button type="button" className="entrance-link" onClick={onCreate}>Create an account</button>
      </p>
      <p className="quiet mt-8 text-[13px]">
        Used Muni before with email codes? <button type="button" className="entrance-link" onClick={onEmail}>Sign in with email</button>
      </p>
    </Step>
  )
}

/** A new account: the name teammates will see, then a passkey. No email needed. */
function CreateAccount({ onCreated, onBack }: { onCreated: (me: Me) => void; onBack: () => void }) {
  const id = useId()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  useStepFocus(ref, false)
  const supported = supportsPasskeys()
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (!name.trim()) {
      setNote({ text: 'Enter the name your teammates know you by.', error: true })
      ref.current?.focus()
      return
    }
    setBusy(true)
    setNote(null)
    try {
      onCreated(await signUpWithPasskey(name.trim()))
    } catch (err) {
      const p = describePasskeyError(err, 'create')
      setNote({ text: p.message, error: p.kind !== 'cancelled' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Step describedBy={`${id}-lead`} title="Create your Muni account." lead="Choose the name your teammates will see, then save a passkey on this device or in your password manager. No email needed.">
      <form onSubmit={submit} className="mt-7">
        <label htmlFor={`${id}-name`} className="block text-sm font-medium">Your name</label>
        <input ref={ref} id={`${id}-name`} className="field mt-1.5" name="name" autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} aria-describedby={`${id}-lead ${id}-seen`} required />
        <p id={`${id}-seen`} className="quiet mt-2">Shown in your workspace and when it’s your turn to speak — never with your thoughts or votes.</p>
        <Note note={note} />
        <Button type="submit" variant="primary" size="lg" className="mt-5 w-full" busy={busy} disabled={!supported}>
          <KeyRound className="size-4" aria-hidden /> Create a passkey
        </Button>
        <p className="quiet mt-4">
          Already have a Muni account? A new one won’t include your teams — <button type="button" className="entrance-link" onClick={onBack}>continue with your passkey</button> instead.
        </p>
      </form>
    </Step>
  )
}

/** Right after creating an account: the passkey is the only way in, so offer a second one or an email. */
function ProtectStep({ account, onDone }: { account: Me; onDone: () => void | Promise<void> }) {
  const id = useId()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null)
  const [emailing, setEmailing] = useState(false)
  const [protectedBy, setProtectedBy] = useState<string | null>(null)
  const second = async () => {
    setBusy(true)
    setNote(null)
    try {
      const made = await addPasskey(suggestedPasskeyName())
      setProtectedBy(made.unlock === 'ready' ? 'A second passkey was added, and it unlocks your encrypted writing too.' : 'A second passkey was added. It signs you in; to let it unlock your encrypted writing as well, confirm with it once in Account → Signing in.')
    } catch (e) {
      const p = describePasskeyError(e, 'add')
      setNote({ text: p.kind === 'exists' ? 'This device already has your passkey. Use another device, a security key or a different password manager — for example, choose the phone option in the prompt.' : p.message, error: p.kind !== 'cancelled' })
    } finally {
      setBusy(false)
    }
  }
  if (protectedBy)
    return (
      <Step describedBy={`${id}-lead`} title="You’re set." lead={`${protectedBy} You can manage passkeys and your recovery email in Account → Signing in.`}>
        <Button variant="primary" size="lg" className="mt-7 w-full" onClick={() => onDone()} autoFocus>Continue</Button>
      </Step>
    )
  return (
    <Step describedBy={`${id}-lead`} title="Keep a way back in." lead={<>Welcome, {account.display_name}. Right now this passkey is the only way into your account. If you lose it, Muni can’t recover the account — there’s no email or password to fall back on.</>}>
      {emailing ? (
        <div className="mt-6">
          <EmailSetup current={null} onChanged={(e) => e && setProtectedBy(`${e} was added for recovery.`)} onCancel={() => setEmailing(false)} />
        </div>
      ) : (
        <div className="mt-7 grid gap-2">
          <Button variant="primary" size="lg" className="w-full" busy={busy} onClick={second} autoFocus>
            <KeyRound className="size-4" aria-hidden /> Add a second passkey
          </Button>
          <Button size="lg" className="w-full" onClick={() => setEmailing(true)}>Add a recovery email</Button>
          <Button variant="ghost" size="lg" className="w-full" onClick={() => onDone()}>Not now</Button>
        </div>
      )}
      <Note note={note} />
      <p className="quiet mt-4">A second passkey can live on another device, a security key or another password manager, and can unlock your encrypted writing as well. An email is optional: it gets you back into your account (not into encrypted writing), and can receive team invitations and sprint reminders.</p>
    </Step>
  )
}

/** "Used Muni before?" — accounts made with email codes before passkeys. */
function EmailStep({ email: initialEmail, initial, onSent, onBack }: { email: string; initial: boolean; onSent: (email: string, info: CodeSent, note: string | null) => void; onBack: () => void }) {
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
    <Step describedBy={`${id}-lead`} title="Sign in with email." lead="For accounts made with an email code before Muni used passkeys. After signing in, add a passkey — then you won’t need codes again.">
      <form onSubmit={submit} className="mt-7">
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
          aria-describedby={`${id}-lead`}
          aria-invalid={error ? true : undefined}
        />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" variant="primary" size="lg" className="mt-5 w-full" busy={busy}>Send me a code</Button>
        <p className="quiet mt-4"><button type="button" className="entrance-link" onClick={onBack}>Back to passkey sign-in</button></p>
      </form>
    </Step>
  )
}

/** After an email sign-in (an account from before passkeys): move it to passkeys, same account. */
export function PasskeyOffer({ account, onDone }: { account: Me; onDone: () => void | Promise<void> }) {
  const id = useId()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null)
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
      title="Add a passkey to your account."
      lead={<>Muni now signs in with passkeys. Add one and you won’t need email codes again — your account, teams and thoughts stay exactly as they are, {account.display_name || 'as you'}.</>}
    >
      <Button variant="primary" size="lg" className="mt-7 w-full" busy={busy} onClick={add} autoFocus>
        <KeyRound className="size-4" aria-hidden /> Add a passkey
      </Button>
      <Note note={note} />
      <Button variant="ghost" size="lg" className="mt-2 w-full" onClick={() => onDone()} disabled={busy}>Not now</Button>
      <p className="quiet mt-4">Your device or password manager keeps the passkey and unlocks it with your fingerprint, face, PIN or screen lock; Muni never receives your biometric data. Your email stays on the account for recovery until you remove it.</p>
    </Step>
  )
}

const CODE_MESSAGES: Record<string, string> = {
  code_expired: 'That code has expired. Send a new one below.',
  code_used: 'That code was already used. Send a new one below.',
  code_locked: 'That code can’t be tried again. Send a new one below.',
  code_format: 'Enter the six digits from the email.',
}

function CodeStep({ email, sent, onResent, onChangeEmail, onVerified, onNoAccount }: { email: string; sent: { expires: number; resendAt: number; note: string | null }; onResent: (info: CodeSent, note: string | null) => void; onChangeEmail: () => void; onVerified: (me: Me) => void | Promise<void>; onNoAccount: () => void }) {
  const id = useId()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [resending, setResending] = useState(false)
  const [error, setError] = useState('')
  const [focused, setFocused] = useState(false)
  const [noAccount, setNoAccount] = useState(false)
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
      if (err instanceof ApiError && err.code === 'no_account') {
        // Said only now that the code proved this mailbox is theirs.
        setNoAccount(true)
        setError('There’s no Muni account with this address.')
      } else if (offline(err)) setError('You’re offline. Your code is still here — try again when you’re connected.')
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
        {noAccount ? (
          <p className="quiet mt-2">New to Muni? <button type="button" className="entrance-link" onClick={onNoAccount}>Create an account with a passkey</button> — no email needed.</p>
        ) : null}
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
