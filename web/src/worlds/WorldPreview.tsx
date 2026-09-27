/**
 * A world in miniature, for choosing: the same classes and tokens the real pages use (so it is the
 * real design, not a picture of it), with sample words instead of anyone's thoughts. It renders a
 * header, a writing field and two saved thoughts at a fixed virtual width, scaled to fit.
 * Decoration: hidden from assistive technology; the chooser describes the world in text.
 */
import { useLayoutEffect, useRef, useState } from 'react'
import { categoryMeta } from '@/lib/categories'
import { useWorldArt } from './art'
import { CHARACTERS, type AvatarId } from './characters'

const VIRTUAL = 640
/** What a world with its own page says above its field (Guhit: the day's invitation). */
const OWN_PREVIEW = {
  guhit: { heading: <>What’s worth <em>remembering</em>?</>, subline: null as string | null, kicker: null as string | null },
  kape: { heading: <>What’s on your mind?</>, subline: 'The coffee’s ready. Take your time.', kicker: 'Writing for' },
  bola: { heading: <>What stayed with you?</>, subline: 'Take a seat. There’s room for it here.', kicker: 'Writing for' },
  biyahe: { heading: <>What stayed with you today?</>, subline: 'Some thoughts need a little room.', kicker: 'Writing for' },
}
const SAMPLES = [
  { cat: 'keep', body: 'Pairing on the release checklist saved us a whole day.', n: 2, day: 14, mon: 'Sep', hm: '09:40' },
  { cat: 'improve', body: 'Tickets arrived without acceptance criteria.', n: 1, day: 12, mon: 'Sep', hm: '16:05' },
]

export function WorldPreview({ id, className }: { id: AvatarId; className?: string }) {
  const art = useWorldArt(id)
  const Header = art?.Header
  const Title = art?.Title
  const c = CHARACTERS[id]
  const box = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(0.5)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const fit = () => setZoom(el.clientWidth / VIRTUAL)
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const passages = (
    <ul className="passages mt-3">
      {SAMPLES.map((s) => (
        <li key={s.n} className="passage" data-state="submitted" style={{ ['--tone' as string]: categoryMeta(s.cat).color }}>
          <div className="passage-mark">
            <span className="cat">{categoryMeta(s.cat).label}</span>
            <span className="passage-when">
              <span>{s.hm}</span>
            </span>
            <span className="passage-stamp" data-day={s.day} data-mon={s.mon} data-hm={s.hm} data-n={s.n} data-rn={s.n === 2 ? 'ii' : 'i'} />
          </div>
          <div className="passage-body">
            <p className="passage-text">{s.body}</p>
          </div>
        </li>
      ))}
    </ul>
  )
  // Worlds with their own page (desk.tsx) are previewed with the same classes.
  const own = OWN_PREVIEW[id as keyof typeof OWN_PREVIEW]
  if (own) {
    const ns = id
    return (
      <div ref={box} className={className} aria-hidden>
        <div className="w-scope w-preview" data-world={id} style={{ width: VIRTUAL, zoom }}>
          <div className={`app-bg w-preview-page ${ns}-preview`}>
            <div className={`${ns}-book`}>
              <div className={`${ns}-book-top`}>
                <div className={`${ns}-tab`} data-static>
                  {own.kicker ? <span className={`${ns}-tab-kicker`}>{own.kicker}</span> : null}
                  <span className={`${ns}-tab-name`}>Sprint 14</span>
                  <span className={`${ns}-tab-meta`}>
                    <span className={`${ns}-tab-state`} data-state="collecting">
                      <span className={`${ns}-tab-dot`} />
                      Collecting
                    </span>{' '}
                    · retro Thu 1 Oct
                  </span>
                </div>
              </div>
              <div className={`${ns}-sheet`}>
                <p className={`${ns}-title`}>{own.heading}</p>
                <p className={`${ns}-invite`}>{own.subline ?? c.world.invitations[0]}</p>
                <div className={`${ns}-field`}>Something that happened, helped, or got in the way…</div>
                <div className={`${ns}-actions`}>
                  <span className={`${ns}-opts`}>
                    <span className={`${ns}-opt`}>+ Category</span>
                    <span className={`${ns}-opt`}>+ Context</span>
                  </span>
                  <span className="w-preview-save">Add to sprint</span>
                </div>
              </div>
            </div>
            <section className="mine">
              <p className="mine-title">
                My thoughts <span className="font-normal text-ink-faint">2</span>
              </p>
              <div className={`${ns}-shelf`}>{passages}</div>
            </section>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div ref={box} className={className} aria-hidden>
      <div className="w-scope w-preview" data-world={id} style={{ width: VIRTUAL, zoom }}>
        <div className="app-bg w-preview-page">
          <div className="journal-scene" data-scene={id}>
            <div className="journal-sky">
              <div className="journal-inner">
                <div className="journal-head">
                  <p className="text-sm text-ink-soft">Sprint 14 · Collecting</p>
                  <p className="journal-title mt-2">
                    What’s worth <em>remembering</em>?
                  </p>
                  <p className="w-invite">{c.world.invitations[0]}</p>
                  {Title ? (
                    <div className="w-title-slot">
                      <Title />
                    </div>
                  ) : null}
                </div>
                <div className="journal-art">{Header ? <Header state={{ empty: false, done: false }} /> : null}</div>
              </div>
            </div>
            <div className="journal-water" />
          </div>
          <div className="w-preview-body">
            <div>
              <div className="journal-field w-preview-field">Something that happened, helped, or got in the way…</div>
              <div className="w-preview-tools">
                <span className="w-preview-save">Save thought</span>
              </div>
            </div>
            <section className="mine">
              <header className="mine-head">
                <p className="mine-title font-display text-lg leading-tight">
                  My thoughts <span className="ml-1 font-normal text-ink-faint">2</span>
                </p>
              </header>
              {passages}
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
