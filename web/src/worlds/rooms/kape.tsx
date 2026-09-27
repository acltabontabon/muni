/**
 * Kape — a quiet café journal. The writing surface is the table: warm, matte, the dominant thing on
 * the page, with the sprint's label set on its top edge. Recent thoughts sit in a narrower column
 * beside it, separated by a soft rule, the way a notebook sits beside a cup. One faint ceramic
 * contour at the table's far corner; nothing moves.
 */
import type { RoomDef, RoomSlots } from '../room'

/** A cup on its saucer, seen from above in fine line, mostly outside the table's corner. */
function Ceramic() {
  return (
    <svg className="kape-ceramic" viewBox="0 0 200 200" aria-hidden focusable="false">
      <circle cx="100" cy="100" r="92" />
      <circle cx="100" cy="100" r="74" className="kape-ceramic-soft" />
      <circle cx="100" cy="100" r="52" />
      <circle cx="100" cy="100" r="40" className="kape-ceramic-soft" />
      <path d="M150 88h22a12 12 0 0 1 0 24h-22" />
    </svg>
  )
}

function KapePage({ writing, collection, extras, notices }: RoomSlots) {
  return (
    <div className="kape-room">
      <div className="kape-main">
        {notices}
        <div className="kape-table">
          <Ceramic />
          {writing}
        </div>
      </div>
      <div className="kape-side">
        {collection}
        {extras}
      </div>
    </div>
  )
}

export const KAPE: RoomDef = { Page: KapePage, contextInHead: true }
