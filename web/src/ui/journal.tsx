/**
 * The capture page's scene: a strip of the entrance's evening across the top of the page — sky,
 * a waterline, the person in the duyan standing on it at the collection's edge, their reflection
 * below — with the page's heading sitting on the horizon. The page's paper is the water beneath it.
 *
 * It stays still while someone writes. It answers only at a few moments: an empty collection (the
 * thought bubble, an invitation), a confirmed save (one light rises and fades), a finished retro
 * (lights kept in the sky). Decoration only: aria-hidden, nothing interactive, no text in it.
 */
import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react'
import { clsx } from 'clsx'
import { onKept } from '@/lib/kept'
import { Land } from './scene'

/** The shore, drawn at 1:1 (scene.tsx), cropped to the palms, the duyan and a little sky. */
const VIEW = { x: 20, y: 30, w: 350, h: 242 }

/** Where the thought bubble sits, over the head under the salakot (shore units). */
function Bubble() {
  return (
    <g className="journal-bubble">
      <circle cx="212" cy="233" r="1.9" />
      <circle cx="219" cy="223" r="2.7" />
      <rect x="222" y="195" width="34" height="19" rx="9.5" />
      <circle cx="232" cy="204.5" r="1.9" className="journal-dot" />
      <circle cx="239" cy="204.5" r="1.9" className="journal-dot" />
      <circle cx="246" cy="204.5" r="1.9" className="journal-dot" />
    </g>
  )
}

const KEPT: [number, number][] = [
  [318, 70],
  [296, 104],
  [346, 96],
  [270, 62],
]

function ShoreArt({ bubble, lights, pulse, gradient }: { bubble: boolean; lights: number; pulse: number; gradient: string }) {
  return (
    <svg className="scene journal-shore" viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`} preserveAspectRatio="xMidYMax meet" aria-hidden focusable="false">
      <Land />
      {bubble ? <Bubble /> : null}
      {KEPT.slice(0, lights).map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="10" fill={`url(#${gradient})`} />
          <circle cx={x} cy={y} r="2" className="journal-light-core" />
        </g>
      ))}
      {pulse ? (
        // One light leaves the bubble and fades into the sky. Keyed, so each save plays once.
        <g key={pulse} className="journal-rise" style={{ '--to-x': '62px', '--to-y': '-128px' } as CSSProperties}>
          <circle cx="239" cy="204" r="11" fill={`url(#${gradient})`} />
          <circle cx="239" cy="204" r="2.2" className="journal-light-core" />
        </g>
      ) : null}
    </svg>
  )
}

/**
 * `world` (with its `art`) replaces the evening with a character's world: the same structure, so the
 * heading and everything beside it stay in place when the world changes; only the picture differs.
 */
export function JournalScene({ children, bubble = false, lights = 0, respond = false, className, world, art }: { children: ReactNode; bubble?: boolean; lights?: number; respond?: boolean; className?: string; world?: string | null; art?: ReactNode }) {
  const u = useId().replace(/:/g, '')
  const gradient = `${u}-light`
  const [pulse, setPulse] = useState(0)
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden)
  useEffect(() => {
    const on = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  useEffect(() => {
    if (!respond || world) return
    return onKept(() => setPulse((n) => n + 1))
  }, [respond, world])
  // The light is gone after its moment; nothing stays animated.
  useEffect(() => {
    if (!pulse) return
    const t = window.setTimeout(() => setPulse(0), 2200)
    return () => window.clearTimeout(t)
  }, [pulse])

  const shore = (reflect: boolean) => (
    <>
      {reflect ? null : (
      <svg width="0" height="0" className="absolute" aria-hidden focusable="false">
        <defs>
          <radialGradient id={gradient}>
            <stop offset="0" style={{ stopColor: 'var(--light)' }} />
            <stop offset="0.35" style={{ stopColor: 'var(--light)', stopOpacity: 0.55 }} />
            <stop offset="1" style={{ stopColor: 'var(--light)', stopOpacity: 0 }} />
          </radialGradient>
        </defs>
      </svg>
      )}
      <ShoreArt bubble={bubble && !reflect} lights={reflect ? 0 : lights} pulse={reflect ? 0 : pulse} gradient={gradient} />
    </>
  )

  return (
    <div className={clsx('journal-scene entrance-art', className)} data-paused={hidden || undefined} data-scene={world || undefined}>
      <div className="journal-sky">
        <div className="journal-inner">
          <div className="journal-head">{children}</div>
          <div className="journal-art" aria-hidden>
            {world ? art : (
              <>
                <span className="journal-sun" />
                {shore(false)}
              </>
            )}
          </div>
        </div>
      </div>
      <div className="journal-water" aria-hidden>
        {world ? null : (
          <div className="journal-inner">
            <div className="journal-art journal-art--reflection">
              <span className="journal-glints" />
              {shore(true)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** The person in the duyan, alone and small, for an empty collection on a narrow screen. */
export function Hammock({ className }: { className?: string }) {
  return (
    <svg className={clsx('scene journal-hammock', className)} viewBox="96 176 176 106" aria-hidden focusable="false">
      <Land />
      <Bubble />
    </svg>
  )
}
