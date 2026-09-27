/**
 * Porma — contemporary refinement. A precise, symmetric page: a centred caption for the sprint, one
 * framed writing surface in fine double hairlines, and the collection filed beneath as orderly
 * correspondence. The only ornament is a faint woven texture along the frame's top edge — an
 * abstract nod to sheer, hand-finished cloth, not a pattern with a meaning of its own.
 */
import type { RoomDef, RoomSlots } from '../room'

/** A strip of fine warp and weft, barely there. */
function Weave() {
  return (
    <svg className="porma-weave" aria-hidden focusable="false">
      <defs>
        <pattern id="porma-weave" width="6" height="6" patternUnits="userSpaceOnUse">
          <path d="M0 1.5h6M0 4.5h6" className="porma-weft" />
          <path d="M1.5 0v6M4.5 0v6" className="porma-warp" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#porma-weave)" />
    </svg>
  )
}

function PormaPage({ bar, context, writing, collection, extras, notices }: RoomSlots) {
  return (
    <div className="porma-room">
      {notices}
      {/* The occasion's programme, set above the frame. */}
      <div className="porma-caption">{bar ?? context}</div>
      <div className="porma-frame">
        <Weave />
        {writing}
      </div>
      <div className="porma-archive">
        {collection}
        {extras}
      </div>
    </div>
  )
}

export const PORMA: RoomDef = { Page: PormaPage }
