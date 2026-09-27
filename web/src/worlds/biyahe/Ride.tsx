/**
 * Biyahe's ride home: the writing page framed like a vehicle window — rounded, with an inset edge
 * and a livery stripe along its foot — around a clean, opaque sheet. The sprint is a destination
 * board mounted on the frame, saying literally where the thought goes. Saved thoughts are stops
 * along a quiet route line, under a heading per day. Under the writing, the missed stop
 * (MissedStop.tsx).
 *
 * Presentation only: the shared parts (worlds/desk.tsx) and every behaviour (ui/capture.tsx) are
 * the same as Guhit's and Kape's. The jokes live in the picture; labels stay literal.
 */
import type { ReactNode } from 'react'
import type { Destination } from '@/lib/local/LocalProvider'
import { useWorld } from '../world'
import { Desk, DeskComposer, DeskSheet } from '../desk'
import { MissedStop } from './MissedStop'

/** A confirmed thought's mark: a stop on a route. */
function StopMark() {
  return (
    <svg className="biyahe-okmark" viewBox="-12 -12 24 24" aria-hidden focusable="false">
      <path d="M-11 0h22" className="biyahe-okmark-line" />
      <circle r="5.4" />
    </svg>
  )
}

const look = {
  heading: <>What stayed with you today?</>,
  subline: 'Some thoughts need a little room.',
  addedMark: <StopMark />,
}

/** The composer, in the window. */
export function BiyaheComposer({ dest, choices, onChoose, tab, closed }: { dest: Destination | null; choices: Destination[]; onChoose: (d: Destination) => void; tab: (onSwitch: (d: Destination) => void) => ReactNode; closed?: ReactNode }) {
  return <DeskComposer dest={dest} choices={choices} onChoose={onChoose} tab={tab} closed={closed} look={look} />
}

/** The same window with a sprint state in it instead of the composer. */
export function BiyaheSheet({ tab, title, children }: { tab: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <DeskSheet tab={tab} title={title}>
      {children}
    </DeskSheet>
  )
}

/** An empty collection: a window seat, kept free. */
export function BiyaheEmpty() {
  const { voice } = useWorld()
  return (
    <div className="biyahe-quiet">
      <div className="w-empty-art biyahe-quiet-art" aria-hidden>
        <svg viewBox="0 0 132 84" focusable="false">
          <rect x="4" y="4" width="124" height="60" rx="14" className="biyahe-quiet-frame" />
          <rect x="12" y="12" width="108" height="44" rx="9" className="biyahe-quiet-sky" />
          <path d="M12 44h108" className="biyahe-quiet-horizon" />
          <path d="M20 44v-8h8v8M34 44v-14h7v14M48 44v-6h10v6M86 44v-12h7v12M100 44v-7h9v7" className="biyahe-quiet-city" />
          <path d="M18 64h96v10a6 6 0 0 1-6 6H24a6 6 0 0 1-6-6Z" className="biyahe-quiet-seat" />
          <path d="M26 70h80" className="biyahe-quiet-stitch" />
        </svg>
      </div>
      <p className="biyahe-quiet-text">
        <span className="w-joke">{voice?.world.empty ?? 'Nothing here yet.'}</span>
        <span className="biyahe-quiet-sub">A seat for whatever’s on your mind.</span>
      </p>
    </div>
  )
}

/** The page: the window, the route of thoughts, and the missed stop under the writing. */
export function BiyaheRide({ count, ...props }: { notices?: ReactNode; book: ReactNode; collection: ReactNode; extras?: ReactNode; empty?: boolean; count?: number | null }) {
  void count
  return <Desk ns="biyahe" byDay {...props} scene={<MissedStop />} />
}
