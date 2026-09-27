/**
 * A world in miniature, for choosing: the character's real page composition (worlds/rooms), with
 * sample words instead of anyone's thoughts, drawn at a fixed virtual width and scaled to fit.
 * Decoration: hidden from assistive technology; the chooser describes the world in text.
 */
import { useLayoutEffect, useRef, useState } from 'react'
import { categoryMeta } from '@/lib/categories'
import { CHARACTERS, type AvatarId } from './characters'
import { ROOMS } from './rooms'
import { PreviewWriter, RoomProviders } from './room'

const VIRTUAL = 1180
const SAMPLES = [
  { cat: 'keep', body: 'Pairing on the release checklist saved us a whole day.', when: '09:40' },
  { cat: 'improve', body: 'Tickets arrived without acceptance criteria, so we guessed twice.', when: 'Yesterday' },
  { cat: 'try', body: 'A quiet hour on Wednesdays — no meetings, just heads-down work.', when: 'Mon' },
]

export function WorldPreview({ id, className }: { id: AvatarId; className?: string }) {
  const c = CHARACTERS[id]
  const def = ROOMS[id]
  const Page = def.Page
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
  const context = (
    <div className="room-tab" data-static>
      <span className="room-tab-kicker">Writing for</span>
      <span className="room-tab-name">Sprint 14</span>
      <span className="room-tab-meta">
        <span className="room-tab-state" data-state="collecting">
          <span className="room-tab-dot" />
          Collecting
        </span>
        <span className="room-tab-sep"> · </span>
        <span>Retro Thu 1 Oct</span>
      </span>
    </div>
  )
  const collection = (
    <section className="mine">
      <header className="mine-head">
        <p className="mine-title font-display text-lg leading-tight">
          My thoughts <span className="ml-2 font-normal text-ink-faint">3</span>
        </p>
        <p className="mt-0.5 text-sm text-ink-soft">Yours to edit until collection closes.</p>
      </header>
      <ul className="passages mt-4">
        {def.byDay ? (
          <li className="passages-day">
            <h3>Today</h3>
          </li>
        ) : null}
        {SAMPLES.map((s) => (
          <li key={s.body} className="passage" data-state="submitted" style={{ ['--tone' as string]: categoryMeta(s.cat).color }}>
            <div className="passage-mark">
              <span className="cat">{categoryMeta(s.cat).label}</span>
              <span className="passage-when">{s.when}</span>
            </div>
            <div className="passage-body">
              <p className="passage-text">{s.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
  return (
    <div ref={box} className={className} aria-hidden>
      <div className="w-scope w-preview" data-world={id} style={{ width: VIRTUAL, zoom }} inert>
        <div className="app-bg w-preview-page">
          <RoomProviders def={def} headContext={def.contextInHead ? context : null}>
            <div className="room" data-room={id} data-mode="write">
              <Page context={def.contextInHead ? null : context} writing={<PreviewWriter heading={c.world.heading} lede={c.world.invitations[0]} />} collection={collection} mode="write" />
            </div>
          </RoomProviders>
        </div>
      </div>
    </div>
  )
}
