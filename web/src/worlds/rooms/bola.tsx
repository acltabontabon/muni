/**
 * Bola — the court after everyone leaves, seen from the free-throw line: the one moment in a game
 * that belongs to one person, unhurried, with nobody guarding them. The composer stands in the
 * paint (the lane, a field of sun-faded clay); the free-throw line is its near edge, and the
 * circle bulges from it toward the question. The sprint hangs above like the liga's hand-flipped
 * scoreboard, and saved thoughts line up beneath on painted lines. The light is the low sun that
 * came back before anyone called the last game, or one floodlight at night. Nothing keeps score.
 */
import type { RoomDef, RoomSlots } from '../room'

/**
 * The free-throw circle, in painted line: the solid half outside the lane. Its centre sits on the
 * lane's near edge, so the lane (opaque, drawn over it) hides the other half.
 */
function FreeThrow() {
  return (
    <svg className="bola-circle" viewBox="0 0 200 200" aria-hidden focusable="false">
      <circle cx="100" cy="100" r="98" />
    </svg>
  )
}

function BolaPage({ bar, writing, collection, extras, notices }: RoomSlots) {
  return (
    <div className="bola-room">
      {/* The liga's scoreboard: the sprint's name in board lettering, its periods on flip plates. */}
      {bar}
      {notices}
      <div className="bola-opening">
        <FreeThrow />
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
