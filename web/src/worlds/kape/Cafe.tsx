/**
 * Kape's café table: the writing page as a sheet of café stationery on a tabletop, held
 * indefinitely. A reservation card tucked over its top edge says, literally, which sprint the
 * thought goes to; a cup and saucer sit on the table at the sheet's corner; one faint coffee ring
 * on the table; the café's letterhead printed along the sheet's foot. Saved thoughts are separate
 * café slips. Under the writing, the 40-minute stir (Stir.tsx).
 *
 * Presentation only. The shared parts (worlds/desk.tsx) and every behaviour (ui/capture.tsx) are
 * the same as Guhit's: drafts, the send queue, encryption, submission, editing. Café words stay in
 * the pictures and the empty state; labels are literal ("Add to sprint").
 */
import type { ReactNode } from 'react'
import type { Destination } from '@/lib/local/LocalProvider'
import { Portrait } from '../portraits'
import { useWorld } from '../world'
import { Desk, DeskComposer, DeskSheet } from '../desk'
import { StirScene } from './Stir'

const MONO = "'DM Mono', ui-monospace, monospace"

/** A cup on its saucer, from above, on the table at the sheet's corner. */
function Cup() {
  return (
    <svg className="kape-cup" viewBox="-40 -40 80 80" aria-hidden focusable="false">
      <circle r="34" className="kape-cup-saucer" />
      <circle r="27" className="kape-cup-well" />
      <rect x="17" y="-5.2" width="15" height="10.4" rx="5.2" className="kape-cup-handle" />
      <circle r="21" className="kape-cup-rim" />
      <circle r="16.5" className="kape-cup-coffee" />
      <path d="M-11 -6a13 13 0 0 1 10.6-7" className="kape-cup-crema" />
      <g transform="rotate(-140) translate(-3 24)">
        <rect x="-1.3" y="0" width="2.6" height="20" rx="1.3" className="kape-cup-spoon" />
        <ellipse cx="0" cy="-2.8" rx="3.6" ry="5" className="kape-cup-spoon" />
      </g>
    </svg>
  )
}

/** One faint ring on the table, where a cup stood earlier. Outside the sheet. */
function Ring() {
  return (
    <svg className="kape-ring" viewBox="-40 -40 80 80" aria-hidden focusable="false">
      <path d="M-22 22A31 31 0 1 1 26 16" />
      <path d="M-26 8a27 27 0 0 1 8-30" className="kape-ring-inner" />
    </svg>
  )
}

/** The café's letterhead, printed small along the foot of the sheet. */
const letterhead = (
  <p className="kape-letterhead" aria-hidden>
    <span>Kape</span>
    <span className="kape-letterhead-sep">·</span>
    <span>table for one</span>
    <span className="kape-letterhead-sep">·</span>
    <span>open until further notice</span>
  </p>
)

/** The confirmation's mark: printed, like a café's rubber stamp, not drawn. */
function Stamp() {
  return (
    <svg className="kape-okmark" viewBox="-12 -12 24 24" aria-hidden focusable="false">
      <circle r="10.5" />
      <path d="M-5 0.5l3.4 3.4L5.4-3.4" />
    </svg>
  )
}

const topDecor = (
  <>
    <Ring />
    <Cup />
  </>
)

/** The composer, on Kape's stationery. */
export function KapeComposer({ dest, choices, onChoose, tab, closed }: { dest: Destination | null; choices: Destination[]; onChoose: (d: Destination) => void; tab: (onSwitch: (d: Destination) => void) => ReactNode; closed?: ReactNode }) {
  return (
    <DeskComposer
      dest={dest}
      choices={choices}
      onChoose={onChoose}
      tab={tab}
      closed={closed}
      look={{
        topDecor,
        decor: letterhead,
        heading: <>What’s on your mind?</>,
        subline: 'The coffee’s ready. Take your time.',
        addedMark: <Stamp />,
      }}
    />
  )
}

/** The same stationery with a sprint state on it instead of the composer. */
export function KapeSheet({ tab, title, children }: { tab: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <DeskSheet tab={tab} title={title} topDecor={topDecor} decor={letterhead}>
      {children}
    </DeskSheet>
  )
}

/** An empty collection: the mug, still declining to comment. */
export function KapeEmpty() {
  const { voice } = useWorld()
  return (
    <div className="kape-quiet">
      <div className="w-empty-art kape-quiet-art" aria-hidden>
        <Portrait id="kape" size={64} />
        <svg viewBox="0 0 120 64" className="kape-quiet-slip" focusable="false">
          <path d="M4 8h112v48l-5.6-4-5.6 4-5.6-4-5.6 4-5.6-4-5.6 4-5.6-4-5.6 4-5.6-4-5.6 4-5.6-4-5.6 4-5.6-4-5.6 4-5.6-4-5.6 4-5.6-4-5.6 4-5.6-4-5.6 4L4 56Z" />
          <text x="12" y="24" fontFamily={MONO} fontSize="8">RESERVED</text>
          <text x="12" y="40" fontFamily={MONO} fontSize="8">for your thoughts</text>
        </svg>
      </div>
      <p className="kape-quiet-text">
        <span className="w-joke">{voice?.world.empty ?? 'No thoughts collected yet.'}</span>
        <span className="kape-quiet-sub">Your thoughts will settle here, one slip each.</span>
      </p>
    </div>
  )
}

/** The page: the table, the stationery, the slips, and the scene under the writing. */
export function KapeCafe({ count, ...props }: { notices?: ReactNode; book: ReactNode; collection: ReactNode; extras?: ReactNode; empty?: boolean; count?: number | null }) {
  void count
  return <Desk ns="kape" {...props} scene={<StirScene />} />
}
