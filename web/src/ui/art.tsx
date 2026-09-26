/**
 * The entrance's evening, carried into the app at a few deliberate moments: a small postcard of
 * the person in the duyan beside "My thoughts", a wider one for empty and finished states, and a
 * strip of horizon for a workspace. Same drawing, same palettes (dusk in light mode, moonlit in
 * dark). All decoration: aria-hidden, nothing interactive, still under prefers-reduced-motion.
 */
import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react'
import { clsx } from 'clsx'
import { DuyanScene, HORIZON, Land } from './scene'

/** Pause every animation while the tab is hidden. */
function usePaused() {
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden)
  useEffect(() => {
    const on = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return hidden
}

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
  const paused = usePaused()
  const progress = lights >= 4 ? 1 : lights >= 2 ? 0.8 : lights >= 1 ? 0.5 : 0.16
  return (
    <div className={clsx('postcard entrance-art', className)} data-paused={paused || undefined} aria-hidden>
      <DuyanScene progress={progress} frame={FRAMES[framing]} />
    </div>
  )
}

/**
 * A strip of evening under a workspace's name: sky, the sun (moon at night) near the horizon,
 * the shore at the far edge, and its reflection. Content sits over the open sky on the left.
 */
export function HorizonBand({ children, className }: { children: ReactNode; className?: string }) {
  const paused = usePaused()
  const u = useId().replace(/:/g, '')
  const id = (n: string) => `${u}-${n}`
  const H = 174 // the band's waterline, in its own units: low, so names sit in open sky
  const s = 0.55
  const tx = 1362
  const ty = H - HORIZON * s
  return (
    <div className={clsx('horizon entrance-art', className)} data-paused={paused || undefined}>
      <svg viewBox="0 0 1600 200" preserveAspectRatio="xMaxYMax slice" aria-hidden focusable="false" className="scene">
        <defs>
          <linearGradient id={id('sky')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--sky-top)' }} />
            <stop offset="0.55" style={{ stopColor: 'var(--sky-top)' }} />
            <stop offset="1" style={{ stopColor: 'color-mix(in oklab, var(--sky-top) 45%, var(--sky-glow))' }} />
          </linearGradient>
          <linearGradient id={id('sea')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--sea-a)' }} />
            <stop offset="1" style={{ stopColor: 'var(--sea-b)' }} />
          </linearGradient>
          <radialGradient id={id('sun')} cx="0.5" cy="0.42" r="0.6">
            <stop offset="0" style={{ stopColor: 'var(--sun-a)' }} />
            <stop offset="1" style={{ stopColor: 'var(--sun-b)' }} />
          </radialGradient>
          <radialGradient id={id('halo')}>
            <stop offset="0" style={{ stopColor: 'var(--halo)', stopOpacity: 0.5 }} />
            <stop offset="1" style={{ stopColor: 'var(--halo)', stopOpacity: 0 }} />
          </radialGradient>
          <clipPath id={id('water')}>
            <rect x="-3000" y={H} width="4800" height="200" />
          </clipPath>
          <clipPath id={id('air')}>
            <rect x="-3000" y="-200" width="4800" height={H + 200} />
          </clipPath>
          <filter id={id('ripple')} x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.012 0.2" numOctaves="2" seed="4" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="6" xChannelSelector="R" yChannelSelector="G" />
          </filter>
          <g id={id('shore')} transform={`translate(${tx} ${ty}) scale(${s})`}>
            <Land />
          </g>
        </defs>
        <rect x="-3000" y="-200" width="4800" height={H + 200} fill={`url(#${id('sky')})`} />
        <g className="scene-stars">
          {[[1010, 40, 1.2], [1090, 22, 0.9], [1160, 58, 1], [1300, 30, 0.8], [940, 70, 0.8], [1460, 18, 1], [860, 30, 0.7], [760, 58, 0.9]].map(([x, y, r], i) => (
            <circle key={i} cx={x} cy={y} r={r} style={{ animationDelay: `${(i * 0.9) % 5}s` } as CSSProperties} />
          ))}
        </g>
        <g clipPath={`url(#${id('air')})`}>
          <circle cx="1478" cy="160" r="46" fill={`url(#${id('halo')})`} />
          <circle cx="1478" cy="160" r="17" fill={`url(#${id('sun')})`} />
        </g>
        <rect x="-3000" y={H} width="4800" height="60" fill={`url(#${id('sea')})`} />
        <g className="scene-glints" transform={`translate(1478 ${H})`}>
          {[26, 18, 30, 14, 22].map((w, i) => (
            <rect key={i} x={-w / 2 + (i % 2 ? 6 : -4)} y={4 + i * 5} width={w} height="1.4" rx="0.7" style={{ animationDelay: `${i * 0.4}s` } as CSSProperties} />
          ))}
        </g>
        <use href={`#${id('shore')}`} />
        <g clipPath={`url(#${id('water')})`}>
          <g transform={`translate(0 ${H * 2}) scale(1 -1)`} className="scene-mirror" filter={`url(#${id('ripple')})`}>
            <use href={`#${id('shore')}`} />
          </g>
        </g>
        <line x1="-3000" x2="1600" y1={H} y2={H} className="scene-horizon" />
      </svg>
      <div className="horizon-text relative">{children}</div>
    </div>
  )
}
