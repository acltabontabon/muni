/**
 * Bola's arena: the page opens on the court itself — the sunrise scene edge to edge across the top,
 * LAST GAME painted a metre tall on the wall (Court.tsx) — and the writing panel is set down on the
 * court, overlapping its floor like the scorer's table: straight edges, a painted accent rail, the
 * sprint on a courtside placard. Saved thoughts run alongside as plain panels under jersey-style
 * dates (real dates only).
 *
 * Presentation only: the shared parts (worlds/desk.tsx) and every behaviour (ui/capture.tsx) are
 * the same as the other worlds with their own page. Nothing here keeps score; labels stay literal.
 */
import type { ReactNode } from 'react'
import type { Destination } from '@/lib/local/LocalProvider'
import { useWorld } from '../world'
import { DeskComposer, DeskProviders, DeskSheet } from '../desk'
import { CourtScene } from './Court'

/** A confirmed thought's mark: one short painted stroke. */
function Stroke() {
  return (
    <svg className="bola-okmark" viewBox="0 0 28 14" aria-hidden focusable="false">
      <path d="M2 9c6-3 14-5 24-4" />
    </svg>
  )
}

const look = {
  heading: <>What stayed with you?</>,
  subline: 'Take a seat. There’s room for it here.',
  addedMark: <Stroke />,
}

export function BolaComposer({ dest, choices, onChoose, tab, closed }: { dest: Destination | null; choices: Destination[]; onChoose: (d: Destination) => void; tab: (onSwitch: (d: Destination) => void) => ReactNode; closed?: ReactNode }) {
  return <DeskComposer dest={dest} choices={choices} onChoose={onChoose} tab={tab} closed={closed} look={look} />
}

export function BolaSheet({ tab, title, children }: { tab: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <DeskSheet tab={tab} title={title}>
      {children}
    </DeskSheet>
  )
}

/** An empty collection: a ball resting beside an open spot on the bench. */
export function BolaEmpty() {
  const { voice } = useWorld()
  return (
    <div className="bola-quiet">
      <div className="w-empty-art bola-quiet-art" aria-hidden>
        <svg viewBox="0 0 150 70" focusable="false">
          <path d="M8 34h134M8 42h134M16 42v22M134 42v22M10 18h130M10 26h130M18 18v16M132 18v16" className="bola-quiet-bench" />
          <ellipse cx="44" cy="31" rx="15" ry="2.4" className="bola-quiet-shadow" />
          <circle cx="44" cy="19" r="12" className="bola-quiet-ball" />
          <path d="M32 19h24M44 7v24M35.5 10c5 5 5 13 0 18M52.5 10c-5 5-5 13 0 18" className="bola-quiet-seam" />
          <path d="M86 30h40" className="bola-quiet-spot" />
        </svg>
      </div>
      <p className="bola-quiet-text">
        <span className="w-joke">{voice?.world.empty ?? 'The court is open.'}</span>
        <span className="bola-quiet-sub">There’s a seat on the bench for your first one.</span>
      </p>
    </div>
  )
}

/** The page: the court across the top, the panel set down on it, the collection alongside. */
export function BolaJournal({ notices, book, collection, extras, empty }: { notices?: ReactNode; book: ReactNode; collection: ReactNode; extras?: ReactNode; empty?: boolean; count?: number | null }) {
  return (
    <DeskProviders ns="bola" byDay>
      <div className="bola-arena" data-empty={empty || undefined}>
        <div className="bola-hero">
          <CourtScene />
        </div>
        <div className="bola-floor">
          <div className="bola-desk">
            {notices ? <div className="bola-notices">{notices}</div> : null}
            {book}
          </div>
          <div className="bola-shelf">
            {collection}
            {extras}
          </div>
        </div>
      </div>
    </DeskProviders>
  )
}
