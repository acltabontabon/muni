/**
 * Sibol — a sheltered balcony. An airy writing column with room around it, and a quieter column for
 * the collection on a soft limestone ledge, set a little lower, as if further along the balcony.
 * One botanical contour at the outer edge and a still suggestion of light through leaves. Nothing
 * grows, wilts or waits to be watered.
 */
import type { RoomDef, RoomSlots } from '../room'

/** A calamansi sprig in one fine line: a stem, four leaves. */
function Sprig() {
  return (
    <svg className="sibol-sprig" viewBox="0 0 220 260" aria-hidden focusable="false">
      <path d="M206 6C170 40 150 92 138 150c-8 38-24 72-52 104" />
      <path d="M170 52c-26-2-46 8-58 26 22 6 44-2 58-26Z" />
      <path d="M150 106c14-24 38-34 62-30-10 22-34 34-62 30Z" />
      <path d="M138 150c-30-4-54 8-68 30 26 6 52-4 68-30Z" />
      <path d="M118 204c16-20 40-26 62-18-12 20-36 26-62 18Z" />
    </svg>
  )
}

function SibolPage({ bar, context, writing, collection, extras, notices }: RoomSlots) {
  return (
    <div className="sibol-room">
      <Sprig />
      <div className="sibol-main">
        {notices}
        {/* A limestone plaque by the door: the sprint, and how far it has grown. */}
        <div className="sibol-label">{bar ?? context}</div>
        {writing}
      </div>
      <div className="sibol-side">
        {collection}
        {extras}
      </div>
    </div>
  )
}

export const SIBOL: RoomDef = { Page: SibolPage }
