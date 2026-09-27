/**
 * Himig — a listening room in print. Laid out like liner notes: a narrow rail of credits on the
 * left (the sprint, its state, the retro), the writing offset beside it and given the most room,
 * and saved thoughts below with a steady rhythm and a column of small credits each. A few grooves
 * of a record, cropped by the rail. Silent: nothing plays, nothing spins.
 */
import type { RoomDef, RoomSlots } from '../room'

/** Half a record, as if drawn from the sleeve at the rail's edge: fine grooves, a small label. */
function Grooves() {
  const rings = [44, 52, 60, 68, 76, 84, 92, 100, 108]
  return (
    <svg className="himig-grooves" viewBox="120 0 120 240" aria-hidden focusable="false">
      {rings.map((r) => (
        <circle key={r} cx="120" cy="120" r={r} />
      ))}
      <circle cx="120" cy="120" r="30" className="himig-label" />
      <circle cx="120" cy="120" r="2.5" className="himig-spindle" />
    </svg>
  )
}

function HimigPage({ context, writing, collection, extras, notices }: RoomSlots) {
  return (
    <div className="himig-room">
      <div className="himig-rail">
        {context}
        <Grooves />
      </div>
      <div className="himig-main">
        {notices}
        <div className="himig-sheet">{writing}</div>
        <div className="himig-notes">
          {collection}
          {extras}
        </div>
      </div>
    </div>
  )
}

export const HIMIG: RoomDef = { Page: HimigPage }
