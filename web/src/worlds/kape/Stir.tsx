/**
 * The 40-minute stir. Kape at a small café table, stirring the same cup with complete
 * seriousness, and around that calm centre the evidence that this has been going on for a while:
 * the clock says 7:42 and the receipt says 07:02; a tent card has an opinion about who is ready;
 * the spoon from the first shift is asleep on a folded sugar packet; the table is reserved until
 * further notice; two notes on the floor, blank, abandoned.
 *
 * It plays once, the first time it's seen in a visit (a couple of slow stirs, a curl of steam
 * that briefly becomes a question mark, raised eyebrows), then stays still for good. Under reduced
 * motion it is simply the finished picture. Decoration only (aria-hidden): no real status here.
 * On a phone, the same drawing framed on Kape, the cup and the tent card (the side jokes stay on wide screens).
 */
import { useRef } from 'react'
import { KapeFigure } from '../portraits'
import { useNarrow, useOncePlay } from '../desk'

const MONO = "'DM Mono', ui-monospace, monospace"
export function StirScene() {
  const ref = useRef<SVGSVGElement>(null)
  const { phase, paused } = useOncePlay(ref, 'kape')
  const narrow = useNarrow()
  return (
    <svg ref={ref} className="kape-stir" data-play={phase === 'play' || undefined} data-paused={paused || undefined} data-narrow={narrow || undefined} viewBox={narrow ? '250 34 352 276' : '0 0 720 330'} aria-hidden focusable="false">
      <defs>
        <radialGradient id="kape-lamp-pool" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" className="kape-s-pool-a" />
          <stop offset="1" className="kape-s-pool-b" />
        </radialGradient>
        <clipPath id="kape-wall-clip">
          <rect x="0" y="0" width="720" height="158" />
        </clipPath>
        {/* Only the portrait's head and neck: the body is drawn for the scene. */}
        <clipPath id="kape-head-clip">
          <rect x="0" y="0" width="720" height="150" />
        </clipPath>
      </defs>

      {/* The room: a wall, morning light through a window we don't see, the floor. */}
      <rect x="0" y="0" width="720" height="300" className="kape-s-wall" />
      <g clipPath="url(#kape-wall-clip)" className="kape-s-sun">
        <path d="M34 10h58l-40 120h-58Z" />
        <path d="M104 10h58l-40 120h-58Z" />
      </g>
      {/* A café's green wainscot, and its rail. */}
      <rect x="0" y="160" width="720" height="140" className="kape-s-wainscot" />
      <path d="M0 160h720" className="kape-s-rail" />
      <rect x="0" y="300" width="720" height="30" className="kape-s-floor" />
      <path d="M0 300h720" className="kape-s-line" />
      <ellipse cx="400" cy="130" rx="200" ry="120" fill="url(#kape-lamp-pool)" className="kape-s-pool" />

      {/* A lamp over the table. */}
      <path d="M392 0v26" className="kape-s-line" />
      <path d="M374 26h36l10 16h-56Z" className="kape-s-shade" />
      <ellipse cx="392" cy="43" rx="6" ry="2.4" className="kape-s-bulb" />

      {/* The clock: 7:42. (The receipt says 07:02.) */}
      <g transform="translate(484 76)">
        <circle r="28" className="kape-s-clock" />
        {Array.from({ length: 12 }, (_, i) => (
          <path key={i} d="M0 -23v4" transform={`rotate(${i * 30})`} className="kape-s-tick" />
        ))}
        <path d="M0 0v-12" transform="rotate(231)" className="kape-s-hand" />
        <path d="M0 0v-19" transform="rotate(252)" className="kape-s-hand kape-s-hand--min" />
        <circle r="2" className="kape-s-pin" />
      </g>

      {/* A notice on the wall. */}
      <g transform="translate(566 38)" className="kape-s-wide">
        <rect x="0" y="0" width="126" height="68" rx="3" className="kape-s-notice" />
        <circle cx="63" cy="7" r="2.6" className="kape-s-tack" />
        <text x="63" y="27" textAnchor="middle" fontFamily={MONO} fontSize="8" className="kape-s-notice-k">TABLE 04</text>
        <text x="63" y="44" textAnchor="middle" fontSize="15" className="kape-s-notice-h">Reserved</text>
        <text x="63" y="58" textAnchor="middle" fontFamily={MONO} fontSize="7.5" className="kape-s-notice-k">until further notice</text>
      </g>

      {/* The chair, behind Kape. */}
      <path d="M262 214c-6-36 4-70 30-86M398 214c6-36-4-70-30-86" className="kape-s-chair" />

      {/* Kape: the portrait's head, on a body drawn for the scene. */}
      <g clipPath="url(#kape-head-clip)">
        <g transform="translate(245 21) scale(1.7)">
          <KapeFigure />
        </g>
      </g>
      {/* The linen shirt, short sleeves, collar open. */}
      <path d="M312 136C299 138 287 141 279 147C270 153 266 165 266 177L282 179C283 188 284 196 285 204H375C376 196 377 188 378 179L394 177C394 165 390 153 381 147C373 141 361 138 348 136L330 155Z" className="kape-s-shirt" />
      <path d="M312 136L321 150M348 136L339 150" className="kape-s-collar" />
      {/* The resting arm: elbow down, forearm along the table's edge. */}
      <path d="M266 177L282 179C283 186 285 190 290 191H313C322 191 326 195 324 199C322 202 317 203 312 203H277C269 203 265 196 266 177Z" className="kape-s-skin" />
      <path d="M316 192c3 1 5 3 5 6" className="kape-s-crease" />
      {/* The stirring arm, upper half: it stays; the forearm turns at the elbow. */}
      <path d="M378 179L394 177C396 186 398 194 398 200H384C380 194 379 186 378 179Z" className="kape-s-skin" />

      {/* Under the table: the chair's seat, knees, tsinelas, and two notes that didn't make it. */}
      <path d="M264 224h132M272 224v76M388 224v76" className="kape-s-chair" />
      <path d="M298 229c0-6 5-9 11-9s11 3 11 9v61h-22ZM338 229c0-6 5-9 11-9s11 3 11 9v61h-22Z" className="kape-s-leg" />
      <path d="M296 292h26a5 5 0 0 1 0 9h-26a5 5 0 0 1 0-9ZM336 292h26a5 5 0 0 1 0 9h-26a5 5 0 0 1 0-9Z" className="kape-s-slipper" />
      <g className="kape-s-wide">
        <path d="M198 300l14-10 12 6-8 8Z" className="kape-s-note" />
        <path d="M226 304l10-12 16 4-4 10Z" className="kape-s-note" />
      </g>

      {/* The table. */}
      <path d="M228 200h412v9H228Z" className="kape-s-top" />
      <path d="M430 209v84M404 300c0-7 12-9 26-9s26 2 26 9Z" className="kape-s-stand" />

      {/* The receipt, hanging off the edge. */}
      <g transform="translate(222 206)" className="kape-s-wide">
        <path d="M0 0h72v88l-6-4-6 4-6-4-6 4-6-4-6 4-6-4-6 4-6-4-6 4-6-4L0 88Z" className="kape-s-receipt" />
        {['07:02  TABLE 04', '1 kapeng barako', 'stirred   40 min', '- - - - - - - - -', 'conclusion:', '     pending'].map((t, i) => (
          <text key={i} x="5" y={13 + i * 12} fontFamily={MONO} fontSize="6.4" className="kape-s-receipt-t">{t}</text>
        ))}
      </g>

      {/* The cup, on its saucer. */}
      <ellipse cx="452" cy="199" rx="30" ry="4.6" className="kape-s-saucer" />
      <path d="M432 170h40l-4 24c-.6 3-3 5-6 5h-20c-3 0-5.4-2-6-5Z" className="kape-s-cup" />
      <path d="M472 176c9 0 11 4 11 8s-3 8-12 8" className="kape-s-handle" />
      <ellipse cx="452" cy="170" rx="20" ry="3.6" className="kape-s-coffee" />
      <path d="M433 180h38" className="kape-s-band" />

      {/* The steam: a curl, which for a moment has a question. */}
      <path d="M452 162c-7-8 6-13 0-21s6-13 0-21" className="kape-s-steam" pathLength={1} />
      <g className="kape-s-q">
        <path d="M444 110c0-7 4-11 10-11s10 4 10 9c0 7-9 8-9 15" />
        <circle cx="455" cy="131" r="1.8" />
      </g>

      {/* The stirring forearm, from the elbow: the spoon, then the hand that holds it. */}
      <g className="kape-arm">
        <path d="M449 172L435 154" className="kape-s-spoon" />
        <path d="M385 200C385 194 391 191 397 192L425 167C429 162 437 161 440 165C443 169 442 174 438 176L404 203C398 207 385 206 385 200Z" className="kape-s-skin" />
        <path d="M430 163c3-3 8-3 10 0" className="kape-s-crease" />
      </g>

      {/* A tent card, with an opinion. */}
      <g transform="translate(500 164)">
        <path d="M0 36l6-36h78l6 36Z" className="kape-s-tent" />
        <text x="45" y="16" textAnchor="middle" fontFamily={MONO} fontSize="7.6" className="kape-s-tent-t">COFFEE: ready</text>
        <text x="45" y="28" textAnchor="middle" fontFamily={MONO} fontSize="7.6" className="kape-s-tent-t">KAPE: processing</text>
      </g>

      {/* The first shift's spoon, asleep on a folded sugar packet. */}
      <g transform="translate(594 186)" className="kape-s-wide">
        <path d="M0 6c0-4 3-7 7-7h26c4 0 7 3 7 7v6H0Z" className="kape-s-sugar" />
        <path d="M8 3h24" className="kape-s-sugar-line" />
        <path d="M-4 12.5h36" className="kape-s-spoon kape-s-spoon--rest" />
        <ellipse cx="35" cy="10" rx="6" ry="4" className="kape-s-spoon-bowl" />
        <text x="36" y="-5" fontFamily={MONO} fontSize="9" className="kape-s-z">z</text>
        <text x="44" y="-13" fontFamily={MONO} fontSize="7" className="kape-s-z">z</text>
      </g>
    </svg>
  )
}
