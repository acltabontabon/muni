/**
 * Guhit's studio: the writing page and collection as Guhit's working sketchbook, open on a desk.
 *
 * This is a layout, not a skin: the sprint is the index tab on the current section, the heading
 * and the field share one sheet, optional details wait behind two named controls, saved thoughts
 * are the pages already filled, and the barangay master plan grows on the desk. The shared parts
 * (worlds/desk.tsx) and every behaviour (ui/capture.tsx) are the same as any world with its own
 * page; this file is Guhit's look: the marks, the pencil, the tick, the empty page.
 *
 * Character lives in the empty state and a few marks in the margin; labels stay plain. Decoration
 * is aria-hidden and still; the only motion is the heading's underline inked once (CSS), a
 * confirmation tick after a save, and a new page settling into the collection — none of it
 * touches focus or the caret.
 */
import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import type { Destination } from '@/lib/local/LocalProvider'
import { invitationFor } from '../characters'
import { Portrait } from '../portraits'
import { useWorld } from '../world'
import { Desk, DeskComposer, DeskSheet } from '../desk'
import { MasterPlan } from './MasterPlan'

const HAND = "'Caveat Variable', 'Caveat', cursive"

/** A registration mark, as on a proof: Guhit's signature at the sheet's corners. */
function Reg({ className }: { className?: string }) {
  return (
    <svg className={clsx('guhit-reg', className)} viewBox="-8 -8 16 16" aria-hidden focusable="false">
      <circle r="3.6" fill="none" />
      <path d="M-7 0H7M0 -7V7" />
    </svg>
  )
}

/** The pencil from behind Guhit's ear, left on the desk above the sheet. */
function Pencil() {
  return (
    <svg className="guhit-pencil" viewBox="0 0 220 26" aria-hidden focusable="false">
      <g transform="rotate(-4 110 13)">
        <path d="M20 6h150v14H20z" fill="var(--g-yellow)" />
        <path d="M20 10.7h150M20 15.3h150" stroke="var(--g-ink)" strokeOpacity="0.18" strokeWidth="0.8" />
        <path d="M170 6h14v14h-14z" fill="var(--g-metal)" />
        <path d="M174 6v14M179 6v14" stroke="var(--g-ink)" strokeOpacity="0.25" strokeWidth="0.8" />
        <path d="M184 6h12a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4h-12z" fill="var(--accent)" />
        <path d="M20 6L2 13l18 7z" fill="var(--g-wood)" />
        <path d="M8 10.6L2 13l6 2.4z" fill="var(--g-ink)" />
      </g>
    </svg>
  )
}

/** The tick after a save: drawn once, by hand. */
function Tick() {
  return (
    <svg className="guhit-tick" viewBox="0 0 24 20" aria-hidden focusable="false">
      <path d="M3 11.5c2.2 1.4 4 3.3 5.4 5.6C11.6 10 15.8 5 21 2.5" pathLength={1} />
    </svg>
  )
}

const decor = (
  <>
    <Reg className="guhit-reg--tr" />
    <Reg className="guhit-reg--bl" />
  </>
)

/** The composer, as a sheet in Guhit's sketchbook. */
export function GuhitComposer({ dest, choices, onChoose, tab, closed }: { dest: Destination | null; choices: Destination[]; onChoose: (d: Destination) => void; tab: (onSwitch: (d: Destination) => void) => ReactNode; closed?: ReactNode }) {
  const { voice } = useWorld()
  return (
    <DeskComposer
      dest={dest}
      choices={choices}
      onChoose={onChoose}
      tab={tab}
      closed={closed}
      look={{
        topDecor: <Pencil />,
        decor,
        heading: (
          <>
            What’s worth <em>remembering</em>?
          </>
        ),
        subline: voice ? invitationFor(voice) : null,
        addedMark: <Tick />,
      }}
    />
  )
}

/** A sheet with a state on it instead of the composer. */
export function GuhitSheet({ tab, title, children }: { tab: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <DeskSheet tab={tab} title={title} topDecor={<Pencil />} decor={decor}>
      {children}
    </DeskSheet>
  )
}

/** An empty collection: Guhit, considering whether one small note needs a floor plan. */
export function GuhitEmpty() {
  const { voice } = useWorld()
  return (
    <div className="guhit-empty">
      <div className="w-empty-art guhit-empty-art" aria-hidden>
        <Portrait id="guhit" size={76} />
        <svg viewBox="0 0 150 84" className="guhit-empty-plan" focusable="false">
          <g className="guhit-empty-note">
            <rect x="6" y="36" width="30" height="26" />
            <path d="M12 45h17M12 51h12" />
          </g>
          <path className="guhit-empty-arrow" d="M42 48c14-8 26-9 38-4M76 39l5 5-7 2" />
          <g className="guhit-empty-floor">
            <rect x="88" y="24" width="54" height="42" />
            <path d="M106 24v14M106 48v18M88 44h12M112 44h30M124 44v-8" />
          </g>
          <text x="84" y="16" fontFamily={HAND} fontSize="15">floor plan?</text>
          <text x="2" y="80" fontFamily={HAND} fontSize="13">one note</text>
        </svg>
      </div>
      <p className="guhit-empty-text">
        <span className="w-joke">{voice?.world.empty ?? 'A blank page.'}</span>
        <span className="guhit-empty-sub">Your thoughts will settle here, in your own words.</span>
      </p>
    </div>
  )
}

/** The page. On wide screens the desk also holds the master plan, which follows the collection. */
export function GuhitStudio({ count, ...rest }: { notices?: ReactNode; book: ReactNode; collection: ReactNode; extras?: ReactNode; empty?: boolean; /** Thoughts in the collection, once known. */ count?: number | null }) {
  return <Desk ns="guhit" {...rest} scene={count != null ? <MasterPlan count={count} /> : null} />
}
