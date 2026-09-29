/**
 * The first evening's sky: its stars, lit as the team's first sprint goes by (worked out by the
 * server from what has actually happened, GET /api/me/guide), and the closing, once, when the
 * first retro is done: the stars come down onto Muni's mark and the evening is kept.
 */
import { useEffect, useId, useRef, useState } from 'react'
import type { GuideView } from '@/api/types'
import { MARK_ARCHES, MARK_DOT, MARK_REFLECTION } from '@/brand/Mark'
import { starsFor, type Star } from '@/lib/guide'
import { useResource } from '@/lib/resource'
import { Button, Dialog, Spinner } from '@/ui'
import { useStill } from '@/ui/scene'
import { useGuide } from './GuideProvider'

export function Constellation({ stars, className }: { stars: Star[]; className?: string }) {
  const glow = `sky-${useId().replace(/:/g, '')}`
  const lit = stars.filter((s) => s.lit)
  const path = lit.map((s, n) => `${n ? 'L' : 'M'}${s.sky[0]} ${s.sky[1]}`).join(' ')
  return (
    <svg viewBox="0 8 64 40" aria-hidden focusable="false" className={className}>
      <defs>
        <radialGradient id={glow}>
          <stop offset="0" style={{ stopColor: 'var(--light)', stopOpacity: 0.55 }} />
          <stop offset="1" style={{ stopColor: 'var(--light)', stopOpacity: 0 }} />
        </radialGradient>
      </defs>
      {lit.length > 1 ? <path d={path} className="sky-path" /> : null}
      {stars.map((s) => (
        <g key={s.id} className="sky-star" data-lit={s.lit || undefined} data-next={s.next || undefined}>
          {s.lit ? <circle cx={s.sky[0]} cy={s.sky[1]} r={4.6} fill={`url(#${glow})`} /> : null}
          <circle cx={s.sky[0]} cy={s.sky[1]} r={s.lit ? 1.25 : 1.05} className="sky-core" />
        </g>
      ))}
    </svg>
  )
}

/**
 * The evening ahead, as a team's first sprint waits to be set up: its stars over a horizon, the
 * team's already lit and the first sprint's next. (The duyan is in the workspace's opening above;
 * the page doesn't need it twice.)
 */
export function EveningAhead({ className }: { className?: string }) {
  return (
    <div className={`evening-ahead ${className ?? ''}`} aria-hidden>
      <Constellation stars={starsFor({ track: 'starter', reached: ['team'] })} className="evening-ahead-sky" />
    </div>
  )
}

export function SkyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { stage, setStage, replay } = useGuide()
  const view = useResource<GuideView>(open ? '/api/me/guide' : null, { maxAge: 0 })
  const stars = view.data ? starsFor(view.data) : null
  const count = stars?.filter((s) => s.lit).length ?? 0
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={<>The first <em className="sky-em">evening</em></>}
      description={view.data?.track === 'member' ? 'Your first sprint with the team, from the first thought to one thing to try. Each star lights when it happens.' : 'Your team’s first sprint, from starting the team to agreeing on one thing to try. Each star lights when it happens.'}
    >
      {stars ? (
        <div className="sky">
          <div className="sky-night">
            <Constellation stars={stars} className="sky-svg" />
          </div>
          <p className="sky-count">
            {count} of {stars.length} lit
          </p>
          <ol className="sky-list">
            {stars.map((s) => (
              <li key={s.id} data-lit={s.lit || undefined} data-next={s.next || undefined}>
                <span className="sky-mark" aria-hidden />
                <span>{s.label}</span>
                <span className="sr-only">{s.lit ? ' (lit)' : s.next ? ' (next)' : ''}</span>
                {s.next ? <em className="sky-next" aria-hidden>next</em> : null}
              </li>
            ))}
          </ol>
          <p className="sky-acts">
            <button
              type="button"
              onClick={() => {
                onClose()
                replay()
              }}
            >
              Watch the prologue again
            </button>
            {stage === 'hidden' ? (
              <Button size="sm" variant="primary" onClick={() => void setStage('on').then(onClose)}>
                Show the guide
              </Button>
            ) : stage !== 'done' ? (
              <button type="button" onClick={() => void setStage('hidden').then(onClose)}>
                Hide the guide
              </button>
            ) : null}
          </p>
        </div>
      ) : view.error ? (
        <p className="text-ink-soft">The sky can’t be read just now. It’ll be here when you’re back online.</p>
      ) : (
        <div className="grid place-items-center py-10 text-ink-soft"><Spinner /></div>
      )}
    </Dialog>
  )
}

/**
 * Once, on the sprint's page when the first retro is done: the evening's stars come down onto
 * Muni's mark — two arches drawn through them, the last star becoming the dot — and the guide
 * retires. A guide the person had hidden simply ends, without any of this.
 */
export function FirstEveningClosing() {
  const { stage, setStage } = useGuide()
  const [playing] = useState(() => stage === 'on' || stage === 'prologue')
  const [gone, setGone] = useState(false)
  const view = useResource<GuideView>(playing ? '/api/me/guide' : null, { maxAge: 0 })
  const ref = useRef<HTMLElement>(null)
  const still = useStill(ref)
  const ended = useRef(false)
  useEffect(() => {
    if (ended.current || stage === 'done') return
    if (!playing) {
      ended.current = true
      void setStage('done')
      return
    }
    if (!view.data) return
    ended.current = true
    const t = window.setTimeout(() => void setStage('done'), 1200)
    return () => window.clearTimeout(t)
  }, [playing, stage, view.data, setStage])
  if (!playing || gone || !view.data) return null
  const stars = starsFor({ track: view.data.track, reached: ['team', 'sprint', 'people', 'thought', 'reveal', 'retro', 'agreed'] })
  const last = stars.length - 1
  return (
    <section ref={ref} className="first-evening" aria-labelledby="first-evening" data-paused={still || undefined}>
      <svg viewBox="0 6 64 70" className="first-evening-art" aria-hidden focusable="false">
        <defs>
          <radialGradient id="fe-dusk">
            <stop offset="0" style={{ stopColor: 'var(--sky-glow)', stopOpacity: 0.55 }} />
            <stop offset="1" style={{ stopColor: 'var(--sky-glow)', stopOpacity: 0 }} />
          </radialGradient>
        </defs>
        <circle cx="32" cy="38" r="34" fill="url(#fe-dusk)" className="fe-dusk" />
        <g className="fe-mark">
          {MARK_ARCHES.map((d) => (
            <path key={d} d={d} pathLength={1} className="fe-arch" />
          ))}
        </g>
        <line x1="2" x2="62" y1="46.5" y2="46.5" className="fe-water" />
        <g className="fe-reflection" transform="translate(0 92) scale(1 -1)">
          {MARK_REFLECTION.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
        {stars.map((s, n) => (
          <g
            key={s.id}
            className="fe-star"
            data-dot={n === last || undefined}
            style={{ '--dx': `${s.sky[0] - s.mark[0]}px`, '--dy': `${s.sky[1] - s.mark[1]}px`, animationDelay: `${n * 90}ms` } as React.CSSProperties}
          >
            <circle cx={s.mark[0]} cy={s.mark[1]} r={4.4} className="fe-halo" />
            <circle cx={s.mark[0]} cy={s.mark[1]} r={n === last ? MARK_DOT.r : 1.8} className="fe-core" />
          </g>
        ))}
      </svg>
      <div className="first-evening-words">
        <h2 id="first-evening" className="first-evening-title">The first evening, <em>kept.</em></h2>
        <p className="first-evening-text">
          {view.data.track === 'starter' ? 'Your team has held its first retro in Muni.' : 'Your first retro with the team is done.'} What you agreed to try comes back at the next one, to see if it helped. The guide rests here; everything it pointed at stays where it is.
        </p>
        <button type="button" className="first-evening-close" onClick={() => setGone(true)}>
          Close
        </button>
      </div>
    </section>
  )
}
