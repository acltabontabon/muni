/**
 * Guhit — an artist's working folio. An asymmetric editorial grid: a slim margin holds the sprint
 * and the section labels; a broad, clean sheet holds the writing; saved thoughts are laid out below
 * it as a folio, in the sheet's own columns. One controlled ink stroke under the question, two fine
 * registration marks on the sheet, and a handwritten line where a note in the margin would be.
 */
import type { RoomDef, RoomSlots } from '../room'

/** A registration mark, as on a proof. */
function Reg({ at }: { at: 'tl' | 'br' }) {
  return (
    <svg className={`guhit-reg guhit-reg--${at}`} viewBox="-8 -8 16 16" aria-hidden focusable="false">
      <circle r="3.4" />
      <path d="M-7 0H7M0 -7V7" />
    </svg>
  )
}

/** One stroke of ink, laid down once under the question. */
function Stroke() {
  return (
    <svg className="guhit-stroke" viewBox="0 0 240 14" preserveAspectRatio="none" aria-hidden focusable="false">
      <path d="M3 9.2C38 6.4 74 5.1 112 5.6c33 .4 71 1.9 110 .6 6-.2 12 .4 15 1.4-4 1.2-10 1.8-17 2-40 1.3-78 .2-111-.2-36-.4-70 .8-104 3.2-2 .1-3.4-.5-2-1.4Z" />
    </svg>
  )
}

function GuhitPage({ context, writing, collection, extras, notices }: RoomSlots) {
  return (
    <div className="guhit-room">
      <div className="guhit-margin">
        {context}
      </div>
      <div className="guhit-work">
        {notices}
        <div className="guhit-sheet">
          <Reg at="tl" />
          <Reg at="br" />
          {writing}
        </div>
      </div>
      <div className="guhit-folio">
        {collection}
        <div className="guhit-extras">{extras}</div>
      </div>
    </div>
  )
}

export const GUHIT: RoomDef = { Page: GuhitPage, Accent: Stroke }
