/**
 * The sun has returned. The barangay court at first light, edge to edge across the top of Bola's
 * page: last night's bunting still up, the court wall with LAST GAME painted on it in letters a
 * metre tall — and "extended (basta)" slapped on underneath — the chain-link fence in front of it,
 * the hoop, a bench with the referee asleep on it (whistle on the lanyard), a rooster reporting for
 * the morning shift, and Bola in front of the lettering: ball at the hip, one finger up. One more.
 *
 * It plays once, the first time it's seen (one relaxed bounce, the ball back in the hand, the
 * rooster steps in, the finger goes up, the referee opens one eye and thinks better of it), then
 * rests on that picture; under reduced motion the picture is all there is. Nothing keeps score.
 * Decoration only (aria-hidden). On a phone, its own framing: the mural, Bola, the bench, the rooster.
 */
import { useRef } from 'react'
import { BolaFigure } from '../portraits'
import { useNarrow, useOncePlay } from '../desk'

const WIDE = "'Archivo Variable', 'Arial Black', sans-serif"
const W = 1440
const H = 440
const WALL = 196
const FLOOR = 336

/** Houses peeking over the wall: [x, width, wall height, roof rise]. */
const HOUSES: [number, number, number, number][] = [
  [0, 90, 50, 24], [100, 70, 64, 18], [186, 110, 44, 28], [312, 76, 70, 20], [404, 120, 54, 26], [540, 70, 80, 16], [626, 96, 50, 26],
  [738, 84, 66, 20], [840, 120, 48, 28], [976, 72, 74, 18], [1062, 110, 52, 24], [1340, 100, 60, 22],
]
/** Bunting along the sagging string (a quadratic from (0,58), control (720,190), to (1440,70)). */
const FLAGS = Array.from({ length: 34 }, (_, i) => {
  const t = (i + 0.5) / 34
  return [W * t, (1 - t) ** 2 * 58 + 2 * (1 - t) * t * 190 + t * t * 70] as const
})

export function CourtScene() {
  const ref = useRef<SVGSVGElement>(null)
  const { phase, paused } = useOncePlay(ref, 'bola')
  const narrow = useNarrow()
  return (
    <svg
      ref={ref}
      className="bola-court"
      data-armed={phase === 'armed' || undefined}
      data-play={phase === 'play' || undefined}
      data-paused={paused || undefined}
      data-narrow={narrow || undefined}
      viewBox={narrow ? '742 64 660 400' : `0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMax slice"
      aria-hidden
      focusable="false"
    >
      <defs>
        <linearGradient id="bola-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="bola-c-sky-a" />
          <stop offset="0.62" className="bola-c-sky-b" />
          <stop offset="1" className="bola-c-sky-c" />
        </linearGradient>
        <linearGradient id="bola-floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="bola-c-floor-a" />
          <stop offset="1" className="bola-c-floor-b" />
        </linearGradient>
        <radialGradient id="bola-sunglow">
          <stop offset="0" className="bola-c-glow-a" />
          <stop offset="1" className="bola-c-glow-b" />
        </radialGradient>
        <pattern id="bola-chain" width="14" height="14" patternUnits="userSpaceOnUse">
          <path d="M0 0L14 14M14 0L0 14" className="bola-c-chain" />
        </pattern>
        {/* Paint wears where feet and weather have been: a scatter of flecks in the wall's colour. */}
        <pattern id="bola-wear" width="64" height="52" patternUnits="userSpaceOnUse">
          <path d="M5 7h2v1H5ZM37 14h3v1h-3ZM22 29h1v2h-1ZM52 37h2v1h-2ZM11 44h3v1h-3Z" className="bola-c-fleck" />
        </pattern>
      </defs>

      {/* First light over the neighbourhood. */}
      <rect x="0" y="0" width={W} height={FLOOR} fill="url(#bola-sky)" />
      <circle cx="1236" cy="150" r="240" fill="url(#bola-sunglow)" />
      <circle cx="1236" cy="150" r="44" className="bola-c-sun" />
      {HOUSES.map(([x, w, h, r], i) => (
        <g key={i} className="bola-c-house">
          <path d={`M${x} ${WALL + 4}V${WALL + 4 - h}L${x + w / 2} ${WALL + 4 - h - r}L${x + w} ${WALL + 4 - h}V${WALL + 4}Z`} />
          <rect x={x + w * 0.22} y={WALL + 4 - h + 14} width="11" height="12" className="bola-c-win" />
        </g>
      ))}

      {/* The court wall, and what somebody painted on it. */}
      <rect x="0" y={WALL} width={W} height={FLOOR - WALL} className="bola-c-wall" />
      <path d={`M0 ${WALL}H${W}`} className="bola-c-coping" />
      <g className="bola-c-mural bola-c-mural--wide">
        <text x="117" y="323" fontFamily={WIDE} fontSize="138" fontWeight="900" className="bola-c-mural-s">LAST GAME</text>
        <text x="112" y="318" fontFamily={WIDE} fontSize="138" fontWeight="900" className="bola-c-mural-t">LAST GAME</text>
        <rect x="100" y="200" width="940" height="130" fill="url(#bola-wear)" />
        <g transform="rotate(-5 420 324)">
          <path d="M300 336c70-8 170-10 262-2" className="bola-c-swoosh" />
          <text x="306" y="326" fontFamily={WIDE} fontSize="40" fontStyle="italic" fontWeight="800" className="bola-c-extended">extended</text>
          <text x="518" y="326" fontFamily={WIDE} fontSize="21" fontStyle="italic" fontWeight="700" className="bola-c-extended">(basta)</text>
        </g>
      </g>
      <g className="bola-c-mural bola-c-mural--narrow">
        <text x="751" y="303" fontFamily={WIDE} fontSize="68" fontWeight="900" className="bola-c-mural-s">LAST</text>
        <text x="1141" y="303" fontFamily={WIDE} fontSize="68" fontWeight="900" className="bola-c-mural-s">GAME</text>
        <text x="748" y="300" fontFamily={WIDE} fontSize="68" fontWeight="900" className="bola-c-mural-t">LAST</text>
        <text x="1138" y="300" fontFamily={WIDE} fontSize="68" fontWeight="900" className="bola-c-mural-t">GAME</text>
        <rect x="740" y="214" width="660" height="96" fill="url(#bola-wear)" />
        <g transform="rotate(-5 1260 330)">
          <text x="1196" y="332" fontFamily={WIDE} fontSize="28" fontStyle="italic" fontWeight="800" className="bola-c-extended">extended</text>
        </g>
      </g>

      {/* Last night's bunting, still up. */}
      <path d="M0 58Q720 190 1440 70" className="bola-c-string" />
      {FLAGS.map(([x, y], i) => (
        <path key={i} d={`M${x - 8} ${y}h16l-8 15Z`} className={`bola-c-flag bola-c-flag--${i % 3}`} />
      ))}

      {/* The fence in front of the wall. */}
      <rect x="0" y="176" width={W} height={FLOOR - 176} fill="url(#bola-chain)" />
      <path d={`M0 176H${W}${Array.from({ length: 10 }, (_, i) => `M${20 + i * 160} 176V${FLOOR}`).join('')}`} className="bola-c-fence" />

      {/* The court: concrete, a painted baseline right across, the key, one long arc. */}
      <rect x="0" y={FLOOR} width={W} height={H - FLOOR} fill="url(#bola-floor)" />
      <path d={`M0 ${FLOOR + 14}H${W}`} className="bola-c-baseline" />
      <path d={`M40 ${FLOOR + 14}h220l40 ${H - FLOOR - 14}H0V${FLOOR + 14}Z`} className="bola-c-key" />
      <path d="M-40 452C300 368 1100 360 1480 420" className="bola-c-arc" />

      {/* The hoop. */}
      <path d={`M70 ${FLOOR + 60}V112M70 126H108`} className="bola-c-pole" />
      <rect x="108" y="90" width="8" height="74" rx="1" className="bola-c-board" />
      <path d="M116 150h36" className="bola-c-rim" />
      <path d="M118 151l7 26M129 151l2 26M141 151l-2 26M150 151l-7 26M121 161h28M123 170h22" className="bola-c-net" />

      {/* The bench, and the referee on it, asleep. */}
      <g transform="translate(640 100)">
        <g className="bola-c-bench">
          <path d="M150 262h124M150 268h124M156 268v32M268 268v32M154 236h116M154 244h116M160 236v26M264 236v26" />
        </g>
        <g className="bola-c-ref">
          <path d="M204 266h14v30h-14ZM226 266h14v30h-14Z" className="bola-c-trousers" />
          <path d="M200 298h20a3 3 0 0 1 0 6h-22ZM224 298h20a3 3 0 0 1 0 6h-22Z" className="bola-c-shoe" />
          <path d="M198 266c-2-20 2-40 10-50h28c8 10 12 30 10 50Z" className="bola-c-refshirt" />
          <path d="M209 218v48M219 216v50M229 216v50M239 220v46" className="bola-c-stripes" />
          <path d="M200 240c10 8 34 8 46-2l-2 10c-12 8-32 8-42 0Z" className="bola-c-refskin" />
          <path d="M214 214l8 20 8-20" className="bola-c-lanyard" />
          <rect x="217" y="232" width="10" height="5" rx="2.5" className="bola-c-whistle" />
          <g transform="rotate(-18 222 200)">
            <circle cx="222" cy="198" r="13" className="bola-c-refskin" />
            <path d="M209 194c2-10 22-12 26 0Z" className="bola-c-refhair" />
            <path d="M214 200q3 2 6 0M225 200q3 2 6 0" className="bola-c-shut" />
            <circle cx="228" cy="200" r="1.6" className="bola-c-peek" />
            <ellipse cx="222" cy="206" rx="2" ry="1.6" className="bola-c-snore" />
          </g>
          <text x="244" y="186" fontFamily={WIDE} fontSize="12" fontWeight="700" className="bola-c-z">z</text>
          <text x="255" y="173" fontFamily={WIDE} fontSize="9" fontWeight="700" className="bola-c-z">z</text>
        </g>
      </g>

      {/* Bola, in front of the lettering. The portrait's bust on a body drawn for the court. */}
      <g transform="translate(560 100)">
        <ellipse cx="490" cy="302" rx="52" ry="6" className="bola-c-shadow" />
        <path d="M462 248h14v48h-14ZM500 248h14v48h-14Z" className="bola-c-skin" />
        <path d="M461 282h16v10h-16ZM499 282h16v10h-16Z" className="bola-c-sock" />
        <path d="M456 292h24a5 5 0 0 1 5 5v4h-31ZM494 292h24a5 5 0 0 1 5 5v4h-31Z" className="bola-c-sneaker" />
        <path d="M457 206H518L522 250H493L488 232L483 250H453Z" className="bola-c-shorts" />
        <path d="M458 208l-4 40M517 208l4 40" className="bola-c-trim" />
        <path d="M458 154H517L515 209H460Z" className="bola-c-jersey" />
        <g transform="translate(430 40) scale(1.15)">
          <BolaFigure />
        </g>
        {/* The ball at the hip: it bounces once, then comes back. */}
        <g className="bola-c-ball">
          <circle cx="444" cy="215" r="17" className="bola-c-ballfill" />
          <path d="M427 215h34M444 198v34M432 203c7 7 7 17 0 24M456 203c-7 7-7 17 0 24" className="bola-c-seam" />
        </g>
        <path d="M439 155C436 170 437 182 441 192L456 189C456 179 457 167 458 155Z" className="bola-c-skin" />
        <path d="M441 190C438 199 441 207 449 211L460 205C457 200 456 195 456 189Z" className="bola-c-skin" />
        <ellipse cx="452" cy="207" rx="8" ry="6" className="bola-c-skin" transform="rotate(-24 452 207)" />
        {/* The other arm: one finger up. One more. */}
        <g className="bola-c-arm">
          <path d="M516 155C530 150 548 150 564 155L562 170C548 167 531 167 518 170Z" className="bola-c-skin" />
          <path d="M553 169L556 125C556 120 568 120 568 125L570 169Z" className="bola-c-skin" />
          <rect x="556.6" y="93" width="6.4" height="22" rx="3.2" className="bola-c-skin" />
          <rect x="552" y="107" width="19" height="18" rx="6" className="bola-c-skin" />
          <ellipse cx="552.6" cy="116" rx="3.2" ry="4.6" className="bola-c-skin" />
        </g>
      </g>

      {/* The rooster, reporting for the morning shift. */}
      <g transform="translate(560 100)">
        <g className="bola-c-marker-g">
          <path d="M792 300V262" className="bola-c-stake" />
          <rect x="766" y="236" width="52" height="29" rx="2" className="bola-c-marker" />
          <text x="792" y="248.5" textAnchor="middle" fontFamily={WIDE} fontSize="8.4" fontWeight="700" className="bola-c-marker-t">MORNING</text>
          <text x="792" y="259" textAnchor="middle" fontFamily={WIDE} fontSize="8.4" fontWeight="700" className="bola-c-marker-t">SHIFT</text>
        </g>
        <g className="bola-c-rooster">
          <path d="M676 272l-3 26M686 272l3 26M668 298h10M684 298h10" className="bola-c-legs" />
          <path d="M660 262c-10-6-14-18-8-30 4 10 10 14 16 16-4-10-2-20 6-24-2 10 2 18 8 20Z" className="bola-c-tail" />
          <ellipse cx="680" cy="268" rx="20" ry="14" className="bola-c-body" />
          <path d="M668 266c6 6 16 6 22 0" className="bola-c-wing" />
          <path d="M688 262c2-10 4-16 8-18" className="bola-c-neck" />
          <circle cx="698" cy="246" r="8" className="bola-c-body" />
          <path d="M692 238c0-6 3-8 5-5 1-5 5-5 6-1 2-3 5-1 4 3-4 2-10 3-15 3Z" className="bola-c-comb" />
          <path d="M705 245l8 2-8 3Z" className="bola-c-beak" />
          <path d="M702 250c2 4 0 7-2 7s-2-4-1-7Z" className="bola-c-comb" />
          <circle cx="700" cy="244" r="1.3" className="bola-c-eye" />
        </g>
      </g>
    </svg>
  )
}
