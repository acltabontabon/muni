/**
 * The first evening's prologue: shown once to a new account, right after signing up (or joining a
 * team), before anything else. The entrance's evening goes on: the same shore, the sun settling a
 * little further with each line, each thought kept as a light in the sky. Five lines tell what a
 * sprint in Muni is; the last one asks where to begin. It's never a tour of the screens: the
 * firefly shows those, one at a time, when they're needed.
 *
 * Tap, swipe, → or Space goes on; ← goes back; Skip (or Esc) is always there. Nothing moves under
 * reduced motion, and the scene rests while the tab is hidden.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Mark } from '@/brand/Mark'
import { useGuide, setIntent } from '@/guide/GuideProvider'
import { useAuth } from '@/lib/auth'
import { starsFor } from '@/lib/guide'
import { useResources } from '@/lib/resource'
import type { CaptureTarget } from '@/api/types'
import { Button, useDocumentTitle } from '@/ui'
import { PROGRESS } from './entrance'
import { DuyanScene, useStill } from './scene'

export type Track = 'starter' | 'member'
type Beat = { line: ReactNode; sub: ReactNode; progress: number }

const WRITE: Beat = {
  line: <>Write what happens, <em>while it’s fresh.</em></>,
  sub: 'During the sprint, everyone keeps small notes: what helped, what got in the way, what surprised them.',
  progress: PROGRESS.start,
}
const BEATS: Record<Track, Beat[]> = {
  starter: [
    WRITE,
    { line: <>They wait, <em>unread,</em> until the team sits down together.</>, sub: 'When collection closes, everything is revealed at once, without names, so the team reads it before talking.', progress: PROGRESS.create },
    { line: <>You look back, choose what matters, and <em>talk it through.</em></>, sub: 'Four steps on a shared screen. Muni tells whoever runs it what to say and do next.', progress: PROGRESS.name },
    { line: <>Then you agree on <em>one thing to try.</em></>, sub: 'Small enough to actually do in the next sprint, with someone who looks after it.', progress: PROGRESS.done },
    { line: <>Next sprint, you’ll see <em>if it helped.</em></>, sub: null, progress: PROGRESS.done },
  ],
  member: [
    WRITE,
    { line: <>Then the team looks back together, and agrees on <em>one thing to try.</em></>, sub: 'Everything is revealed at once, without names, before the retro. You vote and answer from your phone.', progress: PROGRESS.name },
    { line: <>Next sprint, you’ll see <em>if it helped.</em></>, sub: null, progress: PROGRESS.done },
  ],
}

/**
 * The prologue itself. `onFinish(choice)` is called once, when the person picks a way on (or skips:
 * choice null). The caller decides where that goes.
 */
export function Prologue({ track, onFinish, finishing, last }: { track: Track; onFinish: (choice: 'start' | 'write' | null) => void; finishing: boolean; last: ReactNode }) {
  useDocumentTitle('The first evening')
  const beats = BEATS[track]
  const [i, setI] = useState(0)
  const final = i === beats.length - 1
  const sceneRef = useRef<HTMLDivElement>(null)
  const still = useStill(sceneRef)
  const nextRef = useRef<HTMLButtonElement>(null)
  const go = useCallback((d: number) => setI((n) => Math.max(0, Math.min(beats.length - 1, n + d))), [beats.length])

  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true })
  }, [])
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      const onButton = !!t?.closest('button, a, input, textarea')
      if (e.key === 'ArrowRight' || (e.key === ' ' && !onButton)) {
        e.preventDefault()
        go(1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        go(-1)
      } else if (e.key === 'Escape' && !finishing) onFinish(null)
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [go, onFinish, finishing])

  // A swipe goes on or back; a tap on the evening itself goes on.
  const down = useRef<{ x: number; y: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    down.current = { x: e.clientX, y: e.clientY }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const d = down.current
    down.current = null
    if (!d) return
    const dx = e.clientX - d.x
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(e.clientY - d.y)) go(dx < 0 ? 1 : -1)
    else if (Math.abs(dx) < 8 && !(e.target as HTMLElement).closest('button, a') && (e.target as HTMLElement).closest('.prologue-scene')) go(1)
  }

  const beat = beats[i]
  return (
    <div className="prologue" data-paused={still || undefined} data-final={final || undefined} onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
      <header className="prologue-top">
        <span className="prologue-wordmark">
          <Mark size={30} reflect={false} title="Muni" />
          <span aria-hidden>muni</span>
        </span>
        {final ? null : (
          <button type="button" className="prologue-skip" onClick={() => onFinish(null)} disabled={finishing}>
            Skip
          </button>
        )}
      </header>
      <main className="prologue-words">
        <h1 className="sr-only">The first evening</h1>
        <p className="prologue-kicker">The first evening <span aria-hidden>·</span> <span>{i + 1} of {beats.length}</span></p>
        <div aria-live="polite" aria-atomic className="prologue-say">
          <p key={`l${i}`} className="prologue-line">{beat.line}</p>
          {beat.sub ? <p key={`s${i}`} className="prologue-sub">{beat.sub}</p> : null}
        </div>
        {final ? (
          <div key="last" className="prologue-last">
            <Evening track={track} />
            {last}
          </div>
        ) : null}
        <nav className="prologue-nav" aria-label="The prologue">
          <ol className="prologue-ticks" aria-hidden>
            {beats.map((_, n) => (
              <li key={n} data-on={n <= i || undefined} data-now={n === i || undefined} />
            ))}
          </ol>
          {i > 0 ? (
            <button type="button" className="prologue-back" onClick={() => go(-1)}>
              Back
            </button>
          ) : null}
          {final ? null : (
            <Button ref={nextRef} variant="primary" size="lg" className="prologue-next" onClick={() => go(1)}>
              Next
            </Button>
          )}
        </nav>
      </main>
      <div className="prologue-scene" ref={sceneRef} aria-hidden>
        <DuyanScene progress={beat.progress} upright />
      </div>
    </div>
  )
}

/** The evening ahead: its stars, none lit yet. Lines join them only as they light (the sky). */
function Evening({ track }: { track: Track }) {
  const stars = starsFor({ track, reached: [] })
  return (
    <div className="prologue-evening">
      <svg viewBox="0 8 64 40" aria-hidden focusable="false" className="evening-sky">
        {stars.map((s, n) => (
          <g key={s.id} className="evening-star" style={{ animationDelay: `${300 + n * 140}ms` }}>
            <circle cx={s.sky[0]} cy={s.sky[1]} r={n === 0 ? 2.2 : 1.5} className={n === 0 ? 'evening-first' : undefined} />
          </g>
        ))}
      </svg>
      <p>
        {track === 'starter' ? 'Seven stars on your first evening. The first lights when you start your team.' : 'Four stars on your first evening. The first lights when you write.'}
      </p>
    </div>
  )
}

/** The branch at the end: where a new person goes from here. */
function StarterLast({ busy, onStart, onInvite }: { busy: boolean; onStart: () => void; onInvite: () => void }) {
  const [invited, setInvited] = useState(false)
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => first.current?.focus({ preventScroll: true }), [])
  if (invited)
    return (
      <div className="prologue-actions">
        <p className="prologue-note">Open the link from your invitation email, or scan your team’s QR code. It brings you straight to your team’s sprint.</p>
        <Button variant="primary" size="lg" busy={busy} onClick={onInvite} autoFocus>
          Go to Muni
        </Button>
        <button type="button" className="prologue-back" onClick={() => setInvited(false)}>Start a team instead</button>
      </div>
    )
  return (
    <div className="prologue-actions">
      <Button ref={first} variant="primary" size="lg" busy={busy} onClick={onStart}>
        Start a team
      </Button>
      <button type="button" className="prologue-alt" onClick={() => setInvited(true)} disabled={busy}>
        I have an invitation
      </button>
    </div>
  )
}

function MemberLast({ busy, writing, onGo }: { busy: boolean; writing: boolean; onGo: () => void }) {
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => first.current?.focus({ preventScroll: true }), [])
  return (
    <div className="prologue-actions">
      <Button ref={first} variant="primary" size="lg" busy={busy} onClick={onGo}>
        {writing ? 'Write your first thought' : 'Go to your team'}
      </Button>
    </div>
  )
}

/**
 * The prologue as a new account's first page. Starters (no team yet) end on starting a team, which
 * opens the new-workspace dialog once the character is chosen; members end on their team's
 * sprint. Either way the guide is switched on: the firefly takes it from there.
 */
export function PrologueGate() {
  const { me } = useAuth()
  const { setStage } = useGuide()
  const nav = useNavigate()
  const { pathname, state } = useLocation()
  const resources = useResources()
  const [busy, setBusy] = useState(false)
  // Someone an invitation just brought here has a team already (even before the account says so).
  const arrived = !!(state as { arrived?: boolean } | null)?.arrived
  const track: Track = arrived || me?.workspaces.some((w) => !w.is_demo) ? 'member' : 'starter'
  // Whether there's a sprint to write in: the same answer Home reads next, from the same cache.
  const [writing, setWriting] = useState(false)
  useEffect(() => {
    if (track !== 'member') return
    let live = true
    resources.load<CaptureTarget>('/api/me/capture-target').then((c) => live && setWriting(c.collecting.length > 0), () => {})
    return () => {
      live = false
    }
  }, [track, resources])

  const finish = async (choice: 'start' | 'write' | null) => {
    if (busy) return
    setBusy(true)
    if (choice === 'start') setIntent('new-workspace')
    await setStage('on')
    // "Write" goes to the field of the sprint that's collecting (Home finds it); otherwise the
    // person stays where they were sent.
    if (choice === 'write') nav('/', { replace: pathname === '/', state: { write: true } })
    else if (state) nav(pathname, { replace: true })
  }
  return (
    <Prologue
      track={track}
      finishing={busy}
      onFinish={finish}
      last={track === 'starter' ? <StarterLast busy={busy} onStart={() => finish('start')} onInvite={() => finish(null)} /> : <MemberLast busy={busy} writing={writing} onGo={() => finish(writing ? 'write' : null)} />}
    />
  )
}

/** Watching it again, from the evening's sky: nothing changes, the page underneath stays. */
export function PrologueReplay({ onDone }: { onDone: () => void }) {
  const { me } = useAuth()
  const track: Track = me?.workspaces.some((w) => !w.is_demo && w.role === 'owner') ? 'starter' : me?.workspaces.some((w) => !w.is_demo) ? 'member' : 'starter'
  return (
    <div className="prologue-over" role="dialog" aria-modal="true" aria-label="The first evening">
      <Prologue
        track={track}
        finishing={false}
        onFinish={onDone}
        last={
          <div className="prologue-actions">
            <Button variant="primary" size="lg" onClick={onDone} autoFocus>
              Back to Muni
            </Button>
          </div>
        }
      />
    </div>
  )
}
