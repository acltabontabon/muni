/**
 * The entrance's evening, carried into the app at a few deliberate moments: a small postcard of
 * the person in the duyan beside "My thoughts", a wider one for empty and finished states, and a
 * workspace's horizon, set on the rule under its name. Same drawing, same palettes (dusk in light mode, moonlit in
 * dark). All decoration: aria-hidden, nothing interactive, still under prefers-reduced-motion.
 */
import { useId, useRef } from 'react'
import { clsx } from 'clsx'
import { DuyanScene, HORIZON, Land, useStill } from './scene'

const FRAMES = {
  // The hammock, the person and their thought bubble; the palms' trunks at the edges.
  close: '124 124 252 168',
  // The whole evening: palms, the sun (or moon), room in the sky for kept lights.
  wide: '10 40 630 300',
}

/**
 * A postcard from the entrance. `lights` (0–4) are thoughts kept as lights in the sky — used once
 * a retro is complete, never as a count of anyone's contributions.
 */
export function Postcard({ framing = 'close', lights = 0, className }: { framing?: keyof typeof FRAMES; lights?: 0 | 1 | 2 | 4; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const paused = useStill(ref)
  const progress = lights >= 4 ? 1 : lights >= 2 ? 0.8 : lights >= 1 ? 0.5 : 0.16
  return (
    <div ref={ref} className={clsx('postcard entrance-art', className)} data-paused={paused || undefined} aria-hidden>
      <DuyanScene progress={progress} frame={FRAMES[framing]} />
    </div>
  )
}

/**
 * The workspace's horizon: the opening's rule is the waterline, and at its far end the shore sits
 * on it — the two palms and the duyan — with the sun (the moon, at night) half set beside them and a
 * little light on the water below. Drawn once, still: no filter, no motion. Sized by its container.
 */
export function HorizonMark({ className }: { className?: string }) {
  const u = useId().replace(/:/g, '')
  const H = HORIZON
  return (
    <div className={clsx('horizon-mark', className)} aria-hidden>
      <svg viewBox={`-150 70 520 ${H - 70 + 26}`} preserveAspectRatio="xMaxYMax meet" focusable="false" className="scene scene-still">
        <defs>
          <clipPath id={`${u}-air`}>
            <rect x="-400" y="0" width="1000" height={H} />
          </clipPath>
        </defs>
        <g className="horizon-mark-stars">
          {[[-96, 96, 1.6], [-40, 128, 1.2], [8, 90, 1.4], [330, 110, 1.2]].map(([x, y, r], i) => (
            <circle key={i} cx={x} cy={y} r={r} />
          ))}
        </g>
        <g clipPath={`url(#${u}-air)`}>
          <circle cx="-62" cy={H + 6} r="58" className="horizon-mark-halo" />
          <circle cx="-62" cy={H + 6} r="30" className="horizon-mark-sun" />
        </g>
        <g className="horizon-mark-glints" transform={`translate(-62 ${H})`}>
          {[34, 22, 14].map((w, i) => (
            <rect key={i} x={-w / 2 + (i % 2 ? 5 : -3)} y={6 + i * 6} width={w} height="2" rx="1" />
          ))}
        </g>
        <Land />
      </svg>
    </div>
  )
}
