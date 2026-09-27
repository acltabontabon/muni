/**
 * The entrance: one shell for signing in with a passkey, creating an account, choosing a name, and
 * invitations. One decision at a time; explanations only when someone asks or something goes wrong.
 */
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ApiError, patch } from '@/api/client'
import type { Me } from '@/api/types'
import { Mark } from '@/brand/Mark'
import { KeyRound } from 'lucide-react'
import { Button, ErrorText } from '@/ui'
import { addPasskey, describePasskeyError, signInWithPasskey, signUpWithPasskey, suggestedPasskeyName, supportsPasskeys } from '@/lib/passkeys'
import { DuyanScene, useStill } from './scene'

/** How far the evening has gone: start → create → name → in. Drives the sun and the kept lights. */
export const PROGRESS = { start: 0.16, create: 0.5, name: 0.8, done: 1 } as const

/** "muni-muni" in Baybayin (ᜋᜓ mu · ᜈᜒ ni), the pre-colonial Tagalog script. */
const BAYBAYIN = '\u170B\u1713\u1708\u1712 \u170B\u1713\u1708\u1712'

export function EntranceShell({ progress = PROGRESS.start, children }: { progress?: number; children: ReactNode }) {
  // Nothing moves while nobody is looking: a hidden tab, or the scene scrolled away.
  const sceneRef = useRef<HTMLDivElement>(null)
  const still = useStill(sceneRef)
  return (
    <div className="entrance" data-paused={still || undefined}>
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
            <span className="entrance-keep">Keep the <span className="entrance-word"><em>thought</em>.</span></span> <span className="soft">Bring it to the conversation.</span>
          </p>
          <p className="entrance-lede">Capture what matters during the sprint, while it’s still fresh.</p>
          <p className="entrance-kicker"><i lang="tl">muni-muni</i> · Filipino · to reflect; to ponder.</p>
        </div>
        <div className="entrance-scene" ref={sceneRef}>
          <DuyanScene progress={progress} />
        </div>
      </header>
      <div className="entrance-side">
        <main className="entrance-auth">{children}</main>
        <footer className="entrance-footer">
          <nav aria-label="About Muni">
            <Link to="/privacy" className="entrance-link">Privacy &amp; data</Link>
            <a href="https://munimuni.app" className="entrance-link">What is Muni?</a>
          </nav>
        </footer>
      </div>
    </div>
  )
}

/**
 * A step's frame: heading and instructions, with the id the step's input points to. A `greeting`
 * heading ("Welcome back.") is shown beside the scene on a wide screen; on a phone the headline
 * already says it, so it's kept for screen readers only.
 */
export function Step({ title, children, describedBy, lead, greeting }: { title: ReactNode; children?: ReactNode; describedBy?: string; lead?: ReactNode; greeting?: boolean }) {
  return (
    <section className="entrance-step" aria-labelledby={`${describedBy}-title`} data-greeting={greeting || undefined}>
      <h1 id={`${describedBy}-title`}>{title}</h1>
      {lead ? <div id={describedBy} className="instructions">{lead}</div> : null}
      {children}
    </section>
  )
}

const offline = (e: unknown) => e instanceof ApiError && e.status === 0


/** Focus a step's input when the step appears, except on a touch screen's first load (no keyboard jump). */
function useStepFocus(ref: React.RefObject<HTMLInputElement | null>, initial: boolean) {
  useEffect(() => {
    if (initial && !window.matchMedia('(pointer: fine)').matches) return
    ref.current?.focus()
  }, [ref, initial])
}

type Intro = { title: ReactNode; lead: ReactNode }
type View = 'start' | 'create' | 'protect' | 'name'
const VIEW_PROGRESS: Record<View, number> = { start: PROGRESS.start, create: PROGRESS.create, protect: PROGRESS.name, name: PROGRESS.name }

/**
 * A passkey is the only way in. One primary action, "Continue with a passkey" — nothing to type;
 * new people create an account with a passkey. Nothing starts a passkey prompt by itself: after
 * signing out, the old account never signs straight back in, and the browser's own chooser lists
 * every Muni passkey on the device. `intro` replaces the first heading (invitation pages).
 */
export function AuthFlow({ onDone, intro, onProgress }: { onDone: (me: Me) => void | Promise<void>; intro?: Intro; onProgress?: (p: number) => void }) {
  const [view, setView] = useState<View>('start')
  const [account, setAccount] = useState<Me | null>(null)
  const go = (v: View) => {
    setView(v)
    onProgress?.(VIEW_PROGRESS[v])
  }
  const finish = async (me: Me) => {
    onProgress?.(PROGRESS.done)
    await onDone(me)
  }
  if (view === 'start')
    return (
      <PasskeyStart
        intro={intro}
        onSignedIn={async (me) => {
          setAccount(me)
          if (me.needs_name) return go('name')
          await finish(me)
        }}
        onCreate={() => go('create')}
      />
    )
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
  return <NameStep onDone={(me) => finish(me)} />
}

function Note({ note }: { note: { text: string; error: boolean } | null }) {
  if (!note) return null
  return note.error ? <ErrorText>{note.text}</ErrorText> : <p role="status" className="quiet mt-3">{note.text}</p>
}

/** The one primary action; account creation beside it; help only when asked for. */
function PasskeyStart({ intro, onSignedIn, onCreate }: { intro?: Intro; onSignedIn: (me: Me) => void | Promise<void>; onCreate: () => void }) {
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
    <Step describedBy={`${id}-lead`} title={intro?.title ?? 'Welcome back.'} lead={intro?.lead} greeting={!intro}>
      {supported ? (
        <Button variant="primary" size="lg" className="entrance-cta mt-7 w-full" busy={busy} onClick={signIn}>
          <KeyRound className="size-[1.05em]" strokeWidth={1.75} aria-hidden /> Continue with a passkey
        </Button>
      ) : (
        <p role="status" className="entrance-unsupported mt-7">
          This browser can’t use passkeys. Open Muni in a current version of Safari, Chrome, Edge or Firefox — or on your phone.
        </p>
      )}
      <Note note={note} />
      <p className="entrance-new">
        New to Muni? <button type="button" className="entrance-link" onClick={onCreate}>Create an account</button>
      </p>
      <SignInHelp />
    </Step>
  )
}

/** Everything about passkeys, in one quiet disclosure: what they are, other devices, and trouble. */
function SignInHelp() {
  return (
    <details className="entrance-help">
      <summary>Need help signing in?</summary>
      <dl>
        <dt>What’s a passkey?</dt>
        <dd>A sign-in your device keeps for you, unlocked with its fingerprint, face, PIN or screen lock. There’s nothing to type or remember, and Muni never receives your biometric data.</dd>
        <dt>Passkey on your phone?</dt>
        <dd>Choose “Continue with a passkey”, then the option to use a phone or tablet. Scan the code your browser shows and unlock the passkey on your phone.</dd>
        <dt>Cancelled, or nothing happened?</dt>
        <dd>Nothing was shared. Try again whenever you’re ready.</dd>
        <dt>More than one account?</dt>
        <dd>Your browser lists every Muni passkey on this device. Choose the one you want.</dd>
        <dt>Lost your passkey?</dt>
        <dd>A passkey saved in a password manager (such as iCloud Keychain, Google Password Manager or 1Password) is on your other devices too — sign in from one of them. Muni can’t let anyone in without a passkey, so once you’re in, add a second one in Account → Signing in.</dd>
        <dt>Which browsers?</dt>
        <dd>Current Safari, Chrome, Edge and Firefox, on devices with a screen lock.</dd>
      </dl>
    </details>
  )
}

/** A new account: the name teammates will see, then a passkey. */
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
    <Step describedBy={`${id}-seen`} title="Create your account.">
      <form onSubmit={submit} className="mt-7" noValidate>
        <label htmlFor={`${id}-name`} className="block text-sm font-medium">Your name</label>
        <input ref={ref} id={`${id}-name`} className="field mt-1.5" name="name" autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} aria-describedby={`${id}-seen`} aria-invalid={note?.error || undefined} required />
        <p id={`${id}-seen`} className="quiet mt-2">Teammates see this name — never with your thoughts or votes.</p>
        <Note note={note} />
        <Button type="submit" variant="primary" size="lg" className="mt-5 w-full" busy={busy} disabled={!supported}>
          <KeyRound className="size-4" aria-hidden /> Create with a passkey
        </Button>
        <p className="entrance-new">
          Have an account? <button type="button" className="entrance-link" onClick={onBack}>Sign in</button>
        </p>
      </form>
    </Step>
  )
}

/** Right after creating an account: its one passkey is the only way in, so offer a second. */
function ProtectStep({ account, onDone }: { account: Me; onDone: () => void | Promise<void> }) {
  const id = useId()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null)
  const [added, setAdded] = useState<string | null>(null)
  const second = async () => {
    setBusy(true)
    setNote(null)
    try {
      const made = await addPasskey(suggestedPasskeyName())
      setAdded(made.unlock === 'ready' ? 'A second passkey was added. Either one signs you in and opens your encrypted writing.' : 'A second passkey was added. To let it open your encrypted writing too, confirm with it once in Account → Signing in.')
    } catch (e) {
      const p = describePasskeyError(e, 'add')
      setNote({ text: p.kind === 'exists' ? 'This device already has your passkey. Choose the option to use another device in the prompt, or a security key or another password manager.' : p.message, error: p.kind !== 'cancelled' })
    } finally {
      setBusy(false)
    }
  }
  if (added)
    return (
      <Step describedBy={`${id}-lead`} title="You’re set." lead={added}>
        <Button variant="primary" size="lg" className="mt-7 w-full" onClick={() => onDone()} autoFocus>Continue</Button>
      </Step>
    )
  return (
    <Step describedBy={`${id}-lead`} title={`Welcome, ${account.display_name}.`} lead="Your passkey is the only way into this account. A second one — on another device, or a security key — keeps you from being locked out.">
      <div className="mt-7 grid gap-2">
        <Button variant="primary" size="lg" className="w-full" busy={busy} onClick={second} autoFocus>
          <KeyRound className="size-4" aria-hidden /> Add a second passkey
        </Button>
        <Button variant="ghost" size="lg" className="w-full" onClick={() => onDone()}>Not now</Button>
      </div>
      <Note note={note} />
    </Step>
  )
}

/** The name teammates see. Asked once, after signing in, only when the account has none. */
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
