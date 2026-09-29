/**
 * The first evening's one controller (lib/guide.ts has the steps and words). Pages publish what
 * they already know about themselves (`useGuidePage`); this works out the next step and lets one
 * firefly settle on that step's real control, with a note beside it. It holds no control and no
 * status of its own: the note says what the control is for, and doing it is doing the step.
 *
 * Where the person is (prologue, on, hidden, done) belongs to the account, so it's the same on
 * every device; "Later" belongs to this tab.
 */
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router'
import { patch } from '@/api/client'
import type { GuideStage } from '@/api/types'
import { useAuth } from '@/lib/auth'
import { guideFor, type Firefly, type GuidePage, type Spot, type Step } from '@/lib/guide'
import { useToast } from '@/ui'

const Sky = lazy(() => import('./Sky').then((m) => ({ default: m.SkyDialog })))
const Replay = lazy(() => import('@/ui/prologue').then((m) => ({ default: m.PrologueReplay })))

type GuideCtx = {
  stage: GuideStage
  setStage: (s: Exclude<GuideStage, 'prologue'>) => Promise<boolean>
  publish: (token: symbol, page: GuidePage | null) => void
  later: readonly Step[]
  snooze: (s: Step) => void
  openSky: () => void
  replay: () => void
}
const Ctx = createContext<GuideCtx | null>(null)
const NOOP: GuideCtx = { stage: 'done', setStage: async () => true, publish: () => {}, later: [], snooze: () => {}, openSky: () => {}, replay: () => {} }
export const useGuide = () => useContext(Ctx) ?? NOOP

// ── One-shot intent: what the prologue's last choice asked for, carried past the character chooser.
const INTENT = 'muni.guide.intent'
export type Intent = 'new-workspace' | 'write'
export function setIntent(i: Intent) {
  try {
    sessionStorage.setItem(INTENT, i)
  } catch {
    /* private mode: the page just doesn't open the dialog by itself */
  }
}
export function takeIntent(i: Intent): boolean {
  try {
    if (sessionStorage.getItem(INTENT) !== i) return false
    sessionStorage.removeItem(INTENT)
    return true
  } catch {
    return false
  }
}

const laterKey = (account: string) => `muni.guide.later.${account}`
function readLater(account: string | null): Step[] {
  if (!account) return []
  try {
    return JSON.parse(sessionStorage.getItem(laterKey(account)) ?? '[]') as Step[]
  } catch {
    return []
  }
}

export function GuideProvider({ children }: { children: ReactNode }) {
  const { me, refresh } = useAuth()
  const toast = useToast()
  const account = me?.account_id ?? null
  // Changed here, before the account says so: the prologue lifts at once, the firefly goes at once.
  const [over, setOver] = useState<GuideStage | null>(null)
  const stage: GuideStage = over ?? me?.guide ?? 'done'
  const [page, setPage] = useState<{ token: symbol; page: GuidePage | null } | null>(null)
  const [later, setLater] = useState<Step[]>(() => readLater(account))
  const [skyOpen, setSkyOpen] = useState(false)
  const [replaying, setReplaying] = useState(false)
  // Where the sky was opened from: the sky and the prologue replayed from it both hand focus back there.
  const opener = useRef<HTMLElement | null>(null)

  useEffect(() => {
    setLater(readLater(account))
    setOver(null)
  }, [account])
  // Once the account agrees, the local change has done its job.
  useEffect(() => {
    if (over && me?.guide === over) setOver(null)
  }, [me?.guide, over])

  const setStage = useCallback(
    async (s: Exclude<GuideStage, 'prologue'>) => {
      setOver(s)
      try {
        await patch('/api/auth/me', { guide: s })
        await refresh()
        return true
      } catch {
        toast('Couldn’t save that — it’ll ask again next time', 'danger')
        return false
      }
    },
    [refresh, toast],
  )
  const publish = useCallback((token: symbol, p: GuidePage | null) => {
    setPage((cur) => {
      // A page only ever clears its own words, never the next page's.
      if (!p) return cur?.token === token ? null : cur
      if (cur?.token === token && JSON.stringify(cur.page) === JSON.stringify(p)) return cur
      return { token, page: p }
    })
  }, [])
  const snooze = useCallback(
    (s: Step) => {
      setLater((cur) => {
        const next = cur.includes(s) ? cur : [...cur, s]
        try {
          if (account) sessionStorage.setItem(laterKey(account), JSON.stringify(next))
        } catch {
          /* this tab only */
        }
        return next
      })
    },
    [account],
  )

  const value = useMemo<GuideCtx>(
    () => ({
      stage,
      setStage,
      publish,
      later,
      snooze,
      openSky: () => {
        opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        setSkyOpen(true)
      },
      replay: () => setReplaying(true),
    }),
    [stage, setStage, publish, later, snooze],
  )
  const demo = !!me?.workspaces.find((w) => page?.page && 'workspaceId' in page.page && w.id === page.page.workspaceId)?.is_demo
  const firefly = useMemo(() => guideFor({ stage, page: page?.page ?? null, demo, later, now: Date.now() }), [stage, page, demo, later])

  return (
    <Ctx.Provider value={value}>
      {children}
      {me ? <FireflyLayer firefly={firefly} /> : null}
      {skyOpen || replaying ? (
        <Suspense fallback={null}>
          {skyOpen ? <Sky open onClose={() => setSkyOpen(false)} /> : null}
          {replaying ? <Replay onDone={() => setReplaying(false)} returnTo={opener.current} /> : null}
        </Suspense>
      ) : null}
    </Ctx.Provider>
  )
}

/**
 * A page says what it knows (only what it has already loaded). Null while it doesn't know yet:
 * the firefly waits rather than point somewhere and move.
 */
export function useGuidePage(page: GuidePage | null) {
  const { publish, stage } = useGuide()
  const [token] = useState(() => Symbol('page'))
  const key = stage === 'on' || stage === 'prologue' ? JSON.stringify(page) : 'null'
  useEffect(() => {
    publish(token, key === 'null' ? null : (JSON.parse(key) as GuidePage))
  }, [publish, token, key])
  useEffect(() => () => publish(token, null), [publish, token])
}

// ─────────────────────────────────────────────────────────────── the firefly

/** Pages the guide never appears on: the cue owns the stage; the phone's room and the themes table are working surfaces. */
const QUIET = /^\/sprints\/[^/]+\/(stage|room|prepare)\b/
const NARROW = '(max-width: 639px)'
const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

type Placed = { el: HTMLElement; spot: Spot }
/** Half the firefly's button: its centre sits this far, and a little more, from anything it mustn't cover. */
const LIGHT = 22

/**
 * The light's centre: beyond the control's top-right corner, else beside its top, above or below
 * its right end, or by its left: the first place where the whole button fits on screen without
 * touching the control. A control too big for any of them keeps the light on its corner.
 */
function outside(r: DOMRect, vw: number, vh: number) {
  const gap = LIGHT + 4
  const clampX = (x: number) => Math.min(Math.max(x, LIGHT + 4), vw - LIGHT - 4)
  const places = [
    { x: r.right + gap, y: r.top - gap },
    { x: r.right + gap, y: r.top + LIGHT },
    { x: clampX(r.right - LIGHT), y: r.top - gap },
    { x: clampX(r.right - LIGHT), y: r.bottom + gap },
    { x: r.left - gap, y: r.top + LIGHT },
  ]
  const fits = (p: { x: number; y: number }) => p.x - LIGHT >= 0 && p.x + LIGHT <= vw && p.y - LIGHT >= 0 && p.y + LIGHT <= vh
  const clear = (p: { x: number; y: number }) => p.x + LIGHT <= r.left || p.x - LIGHT >= r.right || p.y + LIGHT <= r.top || p.y - LIGHT >= r.bottom
  return places.find((p) => fits(p) && clear(p)) ?? { x: r.right - 2, y: r.top + 2 }
}
type Geometry = { light: { x: number; y: number }; note: { x: number; y: number; above: boolean } | null; away: boolean; docked: boolean }

function findSpot(spots: Spot[]): Placed | null {
  for (const spot of spots) {
    for (const el of document.querySelectorAll<HTMLElement>(`[data-guide="${spot}"]`)) {
      const visible = typeof el.checkVisibility === 'function' ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : el.offsetParent !== null
      const r = el.getBoundingClientRect()
      if (visible && r.width > 0 && r.height > 0 && !(el as HTMLButtonElement).disabled) return { el, spot }
    }
  }
  return null
}
/** A dialog (not the guide's own) is open over the page: the firefly waits under it. */
const dialogOpen = () => !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"], .prologue-over')

function FireflyLayer({ firefly }: { firefly: Firefly | null }) {
  const { pathname } = useLocation()
  const { snooze, setStage, openSky } = useGuide()
  const quiet = QUIET.test(pathname)
  const wanted = quiet ? null : firefly
  // The step has to hold still for a moment before the firefly goes to it: pages settle as they
  // load, and a light that hops about is worse than none.
  const [shown, setShown] = useState<Firefly | null>(null)
  const wantedKey = wanted ? `${wanted.step}:${wanted.spots.join(',')}` : ''
  useEffect(() => {
    if (!wanted) return setShown(null)
    const t = window.setTimeout(() => setShown(wanted), 700)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key is the step
  }, [wantedKey])

  const [placed, setPlaced] = useState<Placed | null>(null)
  const [hidden, setHidden] = useState(false)
  const [folded, setFolded] = useState(false)
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches)
  const [geo, setGeo] = useState<Geometry | null>(null)
  const [glide, setGlide] = useState(false)
  const noteRef = useRef<HTMLElement>(null)
  const noteId = useId()
  const prevEl = useRef<HTMLElement | null>(null)

  // A new step opens its note again (or leaves it folded, when the page already asks).
  useEffect(() => setFolded(!!shown?.rest), [shown?.step, shown?.rest])

  useEffect(() => {
    const m = window.matchMedia(NARROW)
    const on = () => setNarrow(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])

  // Find the step's control, again whenever the page may have changed under it: a click (the
  // phone's Details fold, a menu), a key, a resize. A control not there yet (a page still loading)
  // is looked for a few more times, then left.
  useEffect(() => {
    if (!shown) {
      setPlaced(null)
      return
    }
    let tries = 0
    let timer = 0
    let frame = 0
    const resolve = () => {
      const p = findSpot(shown.spots)
      setHidden(dialogOpen())
      setPlaced((cur) => (cur?.el === p?.el && cur?.spot === p?.spot ? cur : p))
      if (!p && tries++ < 10) timer = window.setTimeout(resolve, 300)
    }
    const soon = () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
      tries = 8
      frame = requestAnimationFrame(() => requestAnimationFrame(resolve))
    }
    resolve()
    const events = ['click', 'keyup', 'toggle', 'resize'] as const
    for (const e of events) window.addEventListener(e, soon, true)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
      for (const e of events) window.removeEventListener(e, soon, true)
    }
  }, [shown, pathname])

  // The control is described by the note while the firefly is on it.
  useEffect(() => {
    const el = placed?.el
    if (!el || !shown) return
    const had = el.getAttribute('aria-describedby')
    el.setAttribute('aria-describedby', [had, noteId].filter(Boolean).join(' '))
    el.setAttribute('data-guide-on', '')
    return () => {
      if (had) el.setAttribute('aria-describedby', had)
      else el.removeAttribute('aria-describedby')
      el.removeAttribute('data-guide-on')
    }
  }, [placed, shown, noteId])

  // Where the light and the note go. The light rests just outside the control, by its top-right
  // corner, so it never covers what it points at or takes its taps; the note beside the control,
  // below it when there's room, docked at the bottom on a phone.
  const measure = useCallback(() => {
    if (!placed) return setGeo(null)
    const r = placed.el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const field = placed.spot === 'writer'
    const light = outside(r, vw, vh)
    const away = r.bottom < 56 || r.top > vh - 24
    // On a phone the note docks at the bottom, unless the control is down there itself.
    const low = r.bottom > vh * 0.62
    const docked = away || (narrow && !low)
    let note: Geometry['note'] = null
    const n = noteRef.current
    if (!docked && n) {
      const w = n.offsetWidth
      const h = n.offsetHeight
      const x = Math.min(Math.max(12, field ? r.right - w : r.left + r.width / 2 - w / 2), vw - w - 12)
      // Clear of the light too, where it sits above or below the control.
      const below = Math.max(r.bottom, light.y + LIGHT) + 18
      const above = Math.min(r.top, light.y - LIGHT) - 18 - h
      note = below + h <= vh - 12 || above < 64 ? { x, y: below, above: false } : { x, y: above, above: true }
    }
    const next = { light, note, away, docked }
    setGeo((cur) => (cur && JSON.stringify(cur) === JSON.stringify(next) ? cur : next))
  }, [placed, narrow])
  useLayoutEffect(() => {
    measure()
  }, [measure, folded, shown])
  // The note is measured once it's there to measure.
  useLayoutEffect(() => {
    if (geo && !geo.note && !geo.docked && noteRef.current) measure()
  }, [geo, measure])
  useEffect(() => {
    if (!placed) return
    let frame = 0
    const on = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    window.addEventListener('scroll', on, { capture: true, passive: true })
    window.addEventListener('resize', on)
    // The control resizing, or the page around it (content arriving above it moves it).
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(on) : null
    ro?.observe(placed.el)
    ro?.observe(document.body)
    // A page still settling (fonts, pictures, a late section): follow it for a moment, then rest.
    const until = performance.now() + 1500
    let settle = 0
    const follow = () => {
      measure()
      if (performance.now() < until) settle = requestAnimationFrame(follow)
    }
    settle = requestAnimationFrame(follow)
    return () => {
      cancelAnimationFrame(settle)
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', on, true)
      window.removeEventListener('resize', on)
      ro?.disconnect()
    }
  }, [placed, measure])

  // Moving to a new control, the firefly flies there; following a scroll, it simply stays put on it.
  useEffect(() => {
    const el = placed?.el ?? null
    if (!el || el === prevEl.current) return
    const moved = !!prevEl.current
    prevEl.current = el
    if (!moved || reduced()) return
    setGlide(true)
    const t = window.setTimeout(() => setGlide(false), 900)
    return () => window.clearTimeout(t)
  }, [placed])

  // Typing in the step's own field (or, on a phone, any field) folds the note to its light; so does Esc.
  useEffect(() => {
    if (!placed) return
    const onFocus = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null
      if (!t) return
      if (placed.el.contains(t) || (narrow && t.matches('input, textarea, [contenteditable="true"]'))) setFolded(true)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !dialogOpen()) setFolded(true)
    }
    document.addEventListener('focusin', onFocus)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('keydown', onKey)
    }
  }, [placed, narrow])

  if (!shown || !placed || hidden || !geo) return null
  const where = placed.spot === 'details' ? ' It’s under Details.' : placed.spot === 'more' ? ' It’s under More.' : ''
  const docked = geo.docked
  const later = () => snooze(shown.step)
  // On <body>, above the page's own layers: nothing the page does to its boxes can move the light.
  return createPortal(
    <div className="guide-layer" data-glide={glide || undefined}>
      <button
        type="button"
        className="firefly"
        data-away={geo.away || undefined}
        style={{ transform: `translate3d(${geo.light.x}px, ${geo.light.y}px, 0)` }}
        aria-label="Guide"
        aria-expanded={!folded}
        aria-controls={noteId}
        onClick={() => setFolded((f) => !f)}
      >
        <span className="firefly-body" aria-hidden>
          <span className="firefly-glow" />
          <span className="firefly-core" />
        </span>
      </button>
      {folded ? (
        <span id={noteId} className="sr-only">
          {shown.line} {shown.text}
        </span>
      ) : (
        <aside
          ref={noteRef}
          id={noteId}
          role="note"
          aria-label="Guide"
          data-guide-note={shown.step}
          className="guide-note"
          data-docked={docked || undefined}
          data-above={geo.note?.above || undefined}
          style={!docked && geo.note ? { transform: `translate3d(${geo.note.x}px, ${geo.note.y}px, 0)` } : !docked ? { visibility: 'hidden' } : undefined}
        >
          <p className="guide-note-kicker">The first evening</p>
          <p className="guide-note-line">{shown.line}</p>
          <p className="guide-note-text">
            {shown.text}
            {where}
          </p>
          <p className="guide-note-acts">
            {geo.away ? (
              <button type="button" onClick={() => placed.el.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' })}>
                Show me
              </button>
            ) : null}
            <button type="button" onClick={later}>Later</button>
            <button type="button" onClick={openSky}>The whole evening</button>
            <button type="button" className="guide-note-hide" onClick={() => void setStage('hidden')}>Hide the guide</button>
          </p>
        </aside>
      )}
    </div>,
    document.body,
  )
}
