/**
 * Dapithapon: dusk at the shore, the hour for muni-muni. Someone rests in a duyan (hammock) strung
 * between two coconut palms, thoughts drifting up. Each finished step lifts one thought into the sky
 * as a light that stays; the sun (the moon, at night) settles toward the water as the steps go by.
 * Palms, hammock and sun are mirrored in the sea: the reflection in muni-muni.
 *
 * Decoration only: aria-hidden, no text, nothing interactive. Motion is CSS on transforms and
 * opacity, paused while the tab is hidden and still under prefers-reduced-motion.
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type RefObject } from 'react'

export const HORIZON = 272
const SHORE_SCALE = 1.3

/** A palm frond: a drooping crescent from the crown. */
function frond(cx: number, cy: number, deg: number, len: number, droop: number, width: number) {
  const a = (deg * Math.PI) / 180
  const tx = cx + len * Math.cos(a)
  const ty = cy + len * Math.sin(a) + droop
  const c1x = cx + 0.55 * len * Math.cos(a)
  const c1y = cy + 0.55 * len * Math.sin(a) - len * 0.32
  // The underside of the leaf: pulled back toward the crown, a little lower.
  const px = -Math.sin(a) * width
  const py = Math.cos(a) * width
  const f = (n: number) => n.toFixed(1)
  return `M${f(cx)} ${f(cy)} Q${f(c1x)} ${f(c1y)} ${f(tx)} ${f(ty)} Q${f(c1x + px)} ${f(c1y + py + width)} ${f(cx)} ${f(cy + 3)} Z`
}

function Palm({ x, y, topX, topY, lean, className }: { x: number; y: number; topX: number; topY: number; lean: number; className?: string }) {
  const leaves: [number, number, number, number][] = [
    [-170, 78, 26, 9],
    [-138, 86, 20, 10],
    [-100, 66, 10, 8],
    [-62, 70, 12, 8],
    [-25, 88, 22, 10],
    [8, 80, 30, 9],
    [150 + lean, 58, 30, 7],
  ]
  return (
    <g className={className}>
      <path d={`M${x - 9} ${y} Q${(x + topX) / 2 + lean * 0.5} ${(y + topY) / 2 + 20} ${topX - 3} ${topY} L${topX + 4} ${topY + 2} Q${(x + topX) / 2 + lean * 0.5 + 9} ${(y + topY) / 2 + 22} ${x + 9} ${y} Z`} />
      <g className="scene-crown" style={{ transformOrigin: `${topX}px ${topY}px` } as CSSProperties}>
        {leaves.map(([deg, len, droop, w], i) => (
          <path key={i} d={frond(topX, topY, deg, len, droop, w)} />
        ))}
        <circle cx={topX - 5} cy={topY + 7} r={4.5} />
        <circle cx={topX + 4} cy={topY + 8} r={4.5} />
        <circle cx={topX} cy={topY + 13} r={4} />
      </g>
    </g>
  )
}

/** The shore: two palms, the duyan between them, and the person resting in it. */
export function Land() {
  return (
    <g className="scene-land">
      {/* A low bank of sand at the water's edge. */}
      <path d={`M-10 ${HORIZON + 2} Q120 ${HORIZON - 12} 300 ${HORIZON - 2} Q330 ${HORIZON} 360 ${HORIZON + 2} Z`} />
      <Palm x={84} y={HORIZON - 4} topX={118} topY={104} lean={18} className="scene-palm scene-palm--a" />
      <Palm x={286} y={HORIZON - 2} topX={258} topY={128} lean={-14} className="scene-palm scene-palm--b" />
      {/* The other tsinelas, already fallen in the sand. */}
      <rect x={176} y={262} width={13} height={4.2} rx={2.1} transform="rotate(-9 182 264)" />
      <g className="scene-duyan" style={{ transformOrigin: '186px 214px' } as CSSProperties}>
        {/* Ropes to the trunks. */}
        <path d="M99 214 L128 244 M273 212 L244 242" fill="none" strokeWidth="1.6" className="scene-rope" />
        {/* The hammock's bed, woven: fuller in the middle. */}
        <path d="M126 243 Q186 290 246 241 Q186 272 126 243 Z" />
        {/* Resting, a salakot tipped over the face: one hand behind the head, a knee up, the other
            leg over the edge with a tsinelas hanging off the toes. */}
        <circle cx={140} cy={244} r={7.5} />
        <path d="M145 251 Q170 268 200 260" fill="none" strokeWidth="11" strokeLinecap="round" className="scene-limb" />
        <path d="M199 259 L210 240 L224 253" fill="none" strokeWidth="7.5" strokeLinecap="round" strokeLinejoin="round" className="scene-limb" />
        <path d="M195 262 Q209 262 214 271" fill="none" strokeWidth="7" strokeLinecap="round" className="scene-limb" />
        <g className="scene-tsinelas" style={{ transformOrigin: '215px 272px' } as CSSProperties}>
          <rect x={212.5} y={271} width={4.5} height={11} rx={2.2} />
        </g>
        <path d="M137 238 Q127 229 141 229 L150 246" fill="none" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" className="scene-limb" />
        <g transform="translate(145 239) rotate(-32)">
          <path d="M-20 1 Q0 7 20 1 L2.2 -12.5 Q0 -14.5 -2.2 -12.5 Z" />
          <circle cx={0} cy={-14.5} r={1.8} />
        </g>
      </g>
    </g>
  )
}

/** Where kept thoughts come to rest: open sky over the water, clear of the palms. */
const KEPT: [number, number][] = [
  [548, 158],
  [598, 188],
  [612, 132],
  [560, 214],
]
/** The thought bubble, just above the head under the salakot (in scene units, after scaling). */
const BUBBLE = { x: 229, y: 184 }
const STARS: [number, number, number][] = [
  [300, 150, 1.1], [352, 120, 0.8], [418, 136, 1.2], [470, 112, 0.9], [548, 146, 1.1], [600, 118, 0.8],
  [268, 196, 0.7], [580, 206, 0.9], [620, 170, 0.7], [440, 90, 0.8], [510, 80, 1], [380, 70, 0.7],
]
const FIREFLIES: [number, number][] = [
  [70, 222], [168, 196], [300, 214], [396, 232], [52, 252], [250, 250],
]
const GLINTS: [number, number][] = [
  [-4, 44], [3, 30], [-3, 52], [5, 24], [-4, 38], [1, 18], [4, 30], [-2, 14], [2, 22],
]

/** How the evening is framed: where the sun sets, where kept thoughts come to rest, what is in view. */
type Composition = {
  viewBox: string
  sun: [number, number]
  kept: [number, number][]
  stars: [number, number, number][]
  /** Alitaptap, at night: along the shore, never across the moon. */
  fireflies: [number, number][]
  /** Where the sky's glow begins, and the bottom of the frame (the water ends there, upright). */
  skyTop: number
  bottom: number
}

/** Beside the words on a wide screen: the shore at the left, the sun over open water to the right. */
const WIDE: Composition = { viewBox: '0 0 640 400', sun: [470, 196], kept: KEPT, stars: STARS, fireflies: FIREFLIES, skyTop: -400, bottom: 400 }

/**
 * Held upright (a phone, a tablet in portrait): its own composition, not a crop of the wide one.
 * The palms stand whole and frame the page; the sun sets behind the duyan, between the trunks, so
 * the person resting is the silhouette at the centre; kept thoughts gather in the gap in the
 * canopy; the water below dissolves back into paper, where the actions are.
 */
const UPRIGHT: Composition = {
  viewBox: '34 -44 432 406',
  sun: [300, 228],
  kept: [
    [262, 132],
    [306, 150],
    [224, 118],
    [286, 104],
  ],
  stars: [
    [58, -18, 1], [150, -34, 0.8], [252, -26, 1.1], [352, -38, 0.8], [446, -6, 1],
    [236, 60, 0.9], [270, 92, 0.7], [214, 150, 0.8], [330, 128, 0.9], [446, 150, 0.7], [44, 196, 0.8], [454, 232, 0.9],
  ],
  fireflies: [
    [62, 224], [150, 196], [418, 238], [48, 254], [446, 190], [110, 252],
  ],
  skyTop: -44,
  bottom: 362,
}

/** Matches the stylesheet's compact entrance (styles.css): phones, upright tablets, phones on their side. */
const COMPACT = '(max-width: 899px), (max-height: 560px) and (orientation: landscape)'

function useUpright() {
  const [upright, setUpright] = useState(() => typeof window !== 'undefined' && window.matchMedia(COMPACT).matches)
  useEffect(() => {
    const m = window.matchMedia(COMPACT)
    const on = () => setUpright(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return upright
}

/**
 * The water's surface, drawn still: the reflection is cut into bands that lean alternately, each a
 * little more with depth. It reads as ripples the way the animated filter did on the wide scene,
 * but it is painted once — nothing re-rasterises while the duyan rocks.
 */
const BANDS = [0, 3, 7, 12, 18, 25, 33, 42, 52, 63, 75, 88, 102, 118]
const LEAN = 1.7

/** Whether a scene should hold still: the tab is hidden, or the scene is scrolled out of view. */
export function useStill(ref: RefObject<Element | null>) {
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden)
  const [away, setAway] = useState(false)
  useEffect(() => {
    const on = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setAway(!e.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [ref])
  return hidden || away
}

/** `frame` crops the same drawing for the app's small postcards (a viewBox in scene units). */
export function DuyanScene({ progress, className, frame, upright: force }: { progress: number; className?: string; frame?: string; upright?: boolean }) {
  // `upright` holds the scene upright at any width (a tall column beside words).
  const compact = useUpright()
  const upright = (force || compact) && !frame
  const c = upright ? UPRIGHT : WIDE
  // 0 → 1 across the steps: the sun (or moon) settles, and one light is kept per finished step.
  const kept = progress >= 1 ? 4 : progress >= 0.8 ? 2 : progress >= 0.5 ? 1 : 0
  const [sunX, sunY] = c.sun
  // Ids are per instance, so the scene can appear more than once on a page.
  const u = useId().replace(/:/g, '')
  const id = (n: string) => `${u}-${n}`
  // Each finished step lets the evening breathe again (the motion is finite; see styles.css).
  const svg = useRef<SVGSVGElement>(null)
  const seen = useRef(progress)
  useEffect(() => {
    if (seen.current === progress) return
    seen.current = progress
    // Back to the start, and nothing more: a finished animation runs again by itself, and one the
    // stylesheet holds (paused while nobody's looking) stays held. play() would override that pause.
    for (const a of svg.current?.getAnimations?.({ subtree: true }) ?? []) {
      if ((a as CSSAnimation).animationName === 'keep') continue
      a.currentTime = 0
    }
  }, [progress])
  const mirror = `translate(0 ${HORIZON * 2}) scale(1 -1)`
  // The shore, drawn at 1:1 and shown 1.3× larger, anchored on the waterline.
  const shore = `translate(0 ${-HORIZON * (SHORE_SCALE - 1)}) scale(${SHORE_SCALE})`
  return (
    <svg ref={svg} className={`scene${upright ? ' scene--upright' : ''} ${className ?? ''}`} viewBox={frame ?? c.viewBox} preserveAspectRatio={frame ? 'xMidYMid slice' : 'xMidYMax meet'} aria-hidden focusable="false">
      <defs>
        <linearGradient id={id("glow")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--sky-top)', stopOpacity: 0 }} />
          <stop offset="1" style={{ stopColor: 'var(--sky-glow)' }} />
        </linearGradient>
        <linearGradient id={id("sea")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--sea-a)' }} />
          <stop offset="1" style={{ stopColor: 'var(--sea-b)' }} />
        </linearGradient>
        <radialGradient id={id("halo")}>
          <stop offset="0" style={{ stopColor: 'var(--halo)', stopOpacity: 0.55 }} />
          <stop offset="1" style={{ stopColor: 'var(--halo)', stopOpacity: 0 }} />
        </radialGradient>
        <radialGradient id={id("light")}>
          <stop offset="0" style={{ stopColor: 'var(--light)' }} />
          <stop offset="0.35" style={{ stopColor: 'var(--light)', stopOpacity: 0.6 }} />
          <stop offset="1" style={{ stopColor: 'var(--light)', stopOpacity: 0 }} />
        </radialGradient>
        <clipPath id={id("sky")}>
          <rect x="-960" y="-400" width="2560" height={HORIZON + 400} />
        </clipPath>
        <clipPath id={id("water")}>
          <rect x="-960" y={HORIZON} width="2560" height={400 - HORIZON + 200} />
        </clipPath>
        {upright ? (
          <>
            {/* Alternate bands of the water, for the still reflection. */}
            {[0, 1].map((side) => (
              <clipPath key={side} id={id(`band${side}`)}>
                {BANDS.slice(0, -1).map((top, i) => (i % 2 === side ? <rect key={i} x="-960" y={HORIZON + top} width="2560" height={BANDS[i + 1] - top} /> : null))}
              </clipPath>
            ))}
            {/* The water gives way to the page. */}
            <linearGradient id={id("calm")} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: 'var(--e-bg)', stopOpacity: 0 }} />
              <stop offset="1" style={{ stopColor: 'var(--e-bg)' }} />
            </linearGradient>
          </>
        ) : (
          <filter id={id("ripple")} x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.01 0.16" numOctaves="2" seed="7" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        )}
        {upright ? null : (
          <g id={id("shore")} transform={shore}>
            <Land />
          </g>
        )}
      </defs>

      {/* Sky: the glow gathers at the horizon; stars at night, birds by day. Upright, the glow
          starts clear at the top of the frame, so the page's own sky runs on into it. */}
      <rect x="-960" y={c.skyTop} width="2560" height={HORIZON - c.skyTop} fill={`url(#${id("glow")})`} />
      <g className="scene-stars">
        {c.stars.map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} style={{ animationDelay: `${(i * 0.73) % 5}s` } as CSSProperties} />
        ))}
      </g>
      {upright ? null : (
        <g className="scene-birds" fill="none" strokeWidth="1.6" strokeLinecap="round">
          <path d="M430 118 q6 -6 12 0 q6 -6 12 0" />
          <path d="M468 100 q4 -4 8 0 q4 -4 8 0" />
        </g>
      )}

      {/* The sun (moon at night), settling as steps are done, and its path of light on the water. */}
      <g clipPath={`url(#${id("sky")})`}>
        <g className="scene-sun" style={{ transform: `translateY(${progress * 52}px)` }}>
          <circle cx={sunX} cy={sunY} r="80" fill={`url(#${id("halo")})`} />
          <circle cx={sunX} cy={sunY} r="34" style={{ fill: 'var(--sun-disc)' }} />
        </g>
      </g>
      <rect x="-960" y={HORIZON} width="2560" height={400 - HORIZON + 200} fill={`url(#${id("sea")})`} />
      <g className="scene-glints" transform={`translate(${sunX} ${HORIZON})`}>
        {GLINTS.map(([offset, w], i) => {
          const width = w * (1 + i * 0.12)
          // Ripples vary around the same vertical path of light, directly beneath the sun.
          return <rect key={i} x={offset - width / 2} y={6 + i * 11} width={width} height="1.6" rx="0.8" style={{ animationDelay: `${i * 0.37}s` } as CSSProperties} />
        })}
      </g>

      {/* The shore and its reflection. Upright, the shore is drawn in place, not through <use>: a
          <use> copy is a shadow tree the upright motion rules can't reach, so its palms and
          tsinelas would go on moving for twenty seconds. */}
      {upright ? (
        <g transform={shore} className="scene-shore">
          <Land />
        </g>
      ) : (
        <use href={`#${id("shore")}`} className="scene-shore" />
      )}
      {upright ? (
        <g className="scene-mirror scene-still">
          {[1, -1].map((dir, side) => (
            <g key={side} clipPath={`url(#${id(`band${side}`)})`}>
              <g transform={`translate(0 ${HORIZON}) skewX(${dir * LEAN}) translate(0 ${-HORIZON}) ${mirror}`}>
                <g transform={shore}>
                  <Land />
                </g>
              </g>
            </g>
          ))}
        </g>
      ) : (
        <g clipPath={`url(#${id("water")})`}>
          <g transform={mirror} className="scene-mirror" filter={`url(#${id("ripple")})`}>
            <use href={`#${id("shore")}`} />
          </g>
        </g>
      )}
      <line x1="-960" x2="1600" y1={HORIZON} y2={HORIZON} className="scene-horizon" />
      {upright ? (
        <>
          <rect x="-960" y={HORIZON + 16} width="2560" height={c.bottom - HORIZON - 16} fill={`url(#${id("calm")})`} />
          <rect x="-960" y={c.bottom - 0.5} width="2560" height="400" style={{ fill: 'var(--e-bg)' }} />
        </>
      ) : null}

      {/* Thoughts, drifting up from the duyan. */}
      <g className="scene-thought">
        <circle cx="194" cy="221" r="2.4" />
        <circle cx="203" cy="208" r="3.4" />
        <g className="scene-bubble">
          <rect x="207" y="172" width="44" height="25" rx="12.5" />
          <circle cx="220" cy="184.5" r="2.4" className="scene-dot" />
          <circle cx="229" cy="184.5" r="2.4" className="scene-dot" style={{ animationDelay: '0.25s' }} />
          <circle cx="238" cy="184.5" r="2.4" className="scene-dot" style={{ animationDelay: '0.5s' }} />
        </g>
      </g>

      {/* Alitaptap: fireflies along the shore at night. */}
      <g className="scene-fireflies">
        {c.fireflies.map(([x, y], i) => (
          <g key={i} style={{ animationDelay: `${i * 1.3}s`, animationDuration: `${7 + (i % 3) * 2}s` } as CSSProperties}>
            <circle cx={x} cy={y} r="5" className="scene-firefly-glow" />
            <circle cx={x} cy={y} r="2" />
          </g>
        ))}
      </g>

      {/* Kept thoughts: each finished step lifts one from the bubble to its place in the sky. */}
      <g className="scene-kept">
        {c.kept.slice(0, kept).map(([x, y], i) => (
          <g key={i} className="scene-keep" style={{ '--from-x': `${BUBBLE.x - x}px`, '--from-y': `${BUBBLE.y - y}px` } as CSSProperties}>
            <circle cx={x} cy={y} r="11" fill={`url(#${id("light")})`} />
            <circle cx={x} cy={y} r="2.2" className="scene-keep-core" />
          </g>
        ))}
      </g>
    </svg>
  )
}
