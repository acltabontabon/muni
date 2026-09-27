/**
 * Bola — the court after everyone leaves. A structured page on strong horizontals: one weighted
 * rule opens it, the sprint and the question stand together on the left, the composer takes the
 * right, and saved thoughts line up beneath in an even grid. One cropped corner of the court —
 * the key and the three-point arc — in painted clay. Nothing keeps score.
 */
import type { RoomDef, RoomSlots } from '../room'

/**
 * A corner of the court in painted clay, to scale: the baseline is the block's left edge, with the
 * corner-three line, the arc, and the top of the key. The basket sits just below the crop.
 */
function Arc() {
  return (
    <svg className="bola-arc" viewBox="0 0 480 192" preserveAspectRatio="xMinYMax meet" aria-hidden focusable="false">
      <path d="M-4 60.4H77.8A175.5 175.5 0 0 1 211.9 196M-4 168.3H150.8V196" />
    </svg>
  )
}

function BolaPage({ bar, writing, collection, extras, notices }: RoomSlots) {
  return (
    <div className="bola-room">
      {/* The scoreboard over the court: the sprint, its three periods, and who calls the next one. */}
      {bar}
      {notices}
      <div className="bola-opening">
        <Arc />
        {writing}
      </div>
      <div className="bola-grid">
        {collection}
        {extras}
      </div>
    </div>
  )
}

export const BOLA: RoomDef = { Page: BolaPage, contextInHead: true }
