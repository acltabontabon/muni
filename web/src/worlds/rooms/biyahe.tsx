/**
 * Biyahe — a moment by the window. One broad window across the page: the sprint on the slim band
 * along its top, a narrow pane of the view (mist, a thin horizon, the city's distant lights, a small
 * dusk sun half set), and the writing on the wide pane beside it, opaque and clear. The day's
 * thoughts follow below in order, grouped by day on a fine rule that lines up with the view.
 * The scenery never moves.
 */
import type { RoomDef, RoomSlots } from '../room'

/** The view: a small dusk sun half set behind the far edge of the city, and its first lights. */
function Horizon() {
  const lights: [number, number][] = [[15, 74], [33, 71], [52, 76], [71, 69], [88, 74], [118, 72], [141, 67], [163, 75], [196, 73], [214, 76], [229, 71]]
  return (
    <svg className="biyahe-city" viewBox="0 0 240 80" preserveAspectRatio="xMidYMax slice" aria-hidden focusable="false">
      <circle cx="176" cy="80" r="12" className="biyahe-sun" />
      <path className="biyahe-far" d="M0 80V61h14v-6h10v9h12V47h6v-4h4v4h6v19h16v-7h10V45h8v14h14v-5h12v11h10V43h4v-6h2v6h4v22h14v-9h12v5h10V51h10v15h14v-4h12v14h8V80Z" />
      <path className="biyahe-skyline" d="M0 80V70h8v-5h12v7h10V60h9v12h6v-9h14v11h10V58h5v-5h3v5h6v16h9v-6h12v8h14V57h8v-6h6v6h4v19h10v-8h13v10h9V64h11v13h12v-5h10v7h8V80Z" />
      <g className="biyahe-lights">
        {lights.map(([x, y]) => (
          <circle key={x} cx={x} cy={y} r="0.75" />
        ))}
      </g>
    </svg>
  )
}

function BiyahePage({ bar, context, writing, collection, extras, notices }: RoomSlots) {
  return (
    <div className="biyahe-room">
      {notices}
      <div className="biyahe-window">
        {/* The band along the window's top: the sprint as a line of stops, seen passing. */}
        <div className="biyahe-band">{bar ?? context}</div>
        <div className="biyahe-panes">
          <div className="biyahe-view" aria-hidden>
            <Horizon />
          </div>
          <div className="biyahe-pane">{writing}</div>
        </div>
      </div>
      <div className="biyahe-log">
        {collection}
        {extras}
      </div>
    </div>
  )
}

export const BIYAHE: RoomDef = { Page: BiyahePage, byDay: true }
