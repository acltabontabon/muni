/**
 * The perfectly rehearsed stop. Biyahe by the open window of a jeepney, bag strap across the chest,
 * one hand almost raised, "para…" fully prepared — and the stop ("Dito sana": this was it) already
 * behind the vehicle. The route placard on the jeepney's side agrees: the line went past Dito sana
 * and branched off to a new character arc. On the ledge, the rehearsal note: final_final_v7.
 *
 * It plays once, the first time it's seen (the hand rises, "para…" appears, the stop's sign slides
 * past above the roof, Biyahe glances back), then rests on that same picture; under reduced motion
 * the resting picture is all there is. Only a few parts move; the page never does. Decoration only
 * (aria-hidden): the route is fiction and says nothing about the person's sprint or where they are.
 * On a phone: Biyahe, the missed stop and the caption.
 */
import { useRef } from 'react'
import { BiyaheFigure } from '../portraits'
import { useNarrow, useOncePlay } from '../desk'

const COND = "'Barlow Condensed', 'Arial Narrow', sans-serif"

/** The skyline: [x, width, height], drawn from the ground line. */
const CITY: [number, number, number][] = [
  [0, 34, 70], [30, 26, 96], [54, 40, 58], [92, 22, 118], [112, 44, 80], [154, 30, 104], [182, 50, 66], [230, 28, 124], [256, 42, 88],
  [296, 36, 110], [330, 52, 72], [380, 30, 132], [408, 46, 94], [452, 26, 70], [476, 40, 116], [514, 34, 84], [546, 48, 104], [592, 28, 76],
  [618, 42, 126], [658, 36, 90], [692, 30, 110], [720, 40, 74],
]
/** Windows lit in the evening: [building index, column, row]. */
const LIT: [number, number, number][] = [[1, 0, 2], [3, 1, 4], [5, 0, 1], [7, 1, 3], [7, 0, 6], [9, 2, 2], [11, 0, 5], [12, 1, 2], [14, 2, 4], [16, 0, 3], [18, 1, 1], [18, 2, 5], [20, 0, 2]]

const GROUND = 252
const WINDOWS: [number, number][] = [[266, 322], [330, 388], [398, 502], [510, 566], [574, 630], [638, 658]]

export function MissedStop() {
  const ref = useRef<SVGSVGElement>(null)
  const { phase, paused } = useOncePlay(ref, 'biyahe')
  const narrow = useNarrow()
  return (
    <svg
      ref={ref}
      className="biyahe-ride"
      data-armed={phase === 'armed' || undefined}
      data-play={phase === 'play' || undefined}
      data-paused={paused || undefined}
      data-narrow={narrow || undefined}
      viewBox={narrow ? '150 24 460 316' : '0 0 760 340'}
      aria-hidden
      focusable="false"
    >
      <defs>
        <linearGradient id="biyahe-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="biyahe-r-sky-a" />
          <stop offset="0.62" className="biyahe-r-sky-b" />
          <stop offset="1" className="biyahe-r-sky-c" />
        </linearGradient>
        <clipPath id="biyahe-seat">
          <rect x="398" y="124" width="104" height="74" rx="9" />
        </clipPath>
      </defs>

      {/* The sky between afternoon and evening, wires, one pole, the city. */}
      <rect x="0" y="0" width="760" height={GROUND} fill="url(#biyahe-sky)" />
      <circle cx="648" cy="58" r="19" className="biyahe-r-sun" />
      <path d="M0 38Q190 58 380 42T760 50M0 52Q200 74 420 58T760 66" className="biyahe-r-wire" />
      <path d="M118 22V252M104 34h28" className="biyahe-r-pole" />
      {CITY.map(([x, w, h], i) => (
        <rect key={i} x={x} y={GROUND - h} width={w} height={h} className={i % 3 ? 'biyahe-r-city' : 'biyahe-r-city biyahe-r-city--far'} />
      ))}
      {LIT.map(([b, c, r], i) => {
        const [x, , h] = CITY[b]
        return <rect key={i} x={x + 5 + c * 9} y={GROUND - h + 8 + r * 11} width="5" height="6" className="biyahe-r-lit" />
      })}
      <rect x="0" y={GROUND - 8} width="760" height="8" className="biyahe-r-curb" />
      <rect x="0" y={GROUND} width="760" height={340 - GROUND} className="biyahe-r-road" />
      <path d="M0 300h54M104 300h54M208 300h54M312 300h54M416 300h54M520 300h54M624 300h54M728 300h54" className="biyahe-r-lane" />

      {/* The stop that was the plan: a shelter and its sign, now behind the jeepney. */}
      <g className="biyahe-r-stop">
        <path d="M36 176h144v8H36Z" className="biyahe-r-shelter-roof" />
        <path d="M46 184v60M170 184v60" className="biyahe-r-shelter-post" />
        <path d="M58 222h100v6H58Z" className="biyahe-r-shelter-bench" />
        <path d="M58 228v16M152 228v16" className="biyahe-r-shelter-post biyahe-r-shelter-post--thin" />
        <path d="M208 98V244" className="biyahe-r-pole" />
        <rect x="166" y="58" width="84" height="40" rx="5" className="biyahe-r-sign" />
        <text x="208" y="80" textAnchor="middle" fontFamily={COND} fontSize="15" fontWeight="600" className="biyahe-r-sign-t">DITO SANA</text>
        <text x="208" y="92" textAnchor="middle" fontFamily={COND} fontSize="8.5" className="biyahe-r-sign-s">(this was it)</text>
      </g>

      {/* The jeepney, heading right: a long cabin of open windows, a visor, and the hood in front. */}
      <ellipse cx="492" cy="294" rx="276" ry="7" className="biyahe-r-shadow" />
      <path d="M226 102h456l-8 14H226Z" className="biyahe-r-roof" />
      <path d="M252 102v-6M330 102v-6M410 102v-6M490 102v-6M570 102v-6M650 102v-6M246 96h410" className="biyahe-r-rack" />
      <path d="M236 116h428v142H236Z" className="biyahe-r-body" />
      {WINDOWS.map(([a, b]) => (
        <rect key={a} x={a} y="124" width={b - a} height="74" rx="9" className="biyahe-r-inside" />
      ))}
      <path d="M266 134h392" className="biyahe-r-rail" />
      <path d="M240 124h18v126h-18Z" className="biyahe-r-inside" />
      <path d="M243 128v118M230 254h34" className="biyahe-r-rail" />
      {/* Someone else, asleep, as one is. */}
      <path d="M590 198c0-16 8-24 18-24s18 8 18 24ZM604 170a10 10 0 1 1 1 0Z" className="biyahe-r-other" transform="rotate(-8 606 176)" />

      {/* Biyahe, by the window: eyes past the glass, bag strap across, one hand almost up. */}
      <g clipPath="url(#biyahe-seat)">
        <rect x="398" y="124" width="104" height="74" className="biyahe-r-inside" />
        <g transform="translate(385 89) scale(1.3)">
          <BiyaheFigure />
          <g className="biyahe-r-arm">
            <path d="M80.4 90.5L76.9 62.6C76.6 59.6 82.4 58.4 83.4 61.4L88.8 89.2Z" className="biyahe-r-skin" />
            {/* An open hand, the way you'd hail a stop. */}
            <ellipse cx="76.4" cy="56.2" rx="1.7" ry="3.3" transform="rotate(-28 76.4 56.2)" className="biyahe-r-skin" />
            <rect x="76.6" y="45.6" width="8.6" height="14.2" rx="4.2" className="biyahe-r-skin" />
            <path d="M79.4 47.6v4.6M82.4 47.6v4.6" className="biyahe-r-fingers" />
          </g>
        </g>
      </g>
      <path d="M392 198h116" className="biyahe-r-ledge" />

      {/* Lower body: chrome, livery, the route placard. */}
      <path d="M236 198h428" className="biyahe-r-chrome" />
      <path d="M258 203h406v5H258Z" className="biyahe-r-stripe-a" />
      <path d="M258 211h406v2.5H258Z" className="biyahe-r-stripe-b" />
      <g className="biyahe-r-wide">
        <rect x="352" y="220" width="304" height="33" rx="4" className="biyahe-r-placard" />
        <path d="M368 237H512" className="biyahe-r-route" />
        <path d="M512 237H640" className="biyahe-r-route biyahe-r-route--plan" />
        <path d="M512 237C530 237 536 228.5 554 228.5" className="biyahe-r-route biyahe-r-route--arc" />
        <circle cx="382" cy="237" r="3.6" className="biyahe-r-stopdot" />
        <circle cx="464" cy="237" r="3.6" className="biyahe-r-stopdot biyahe-r-stopdot--missed" />
        <circle cx="548" cy="229.4" r="3.4" className="biyahe-r-here" />
        <text x="382" y="249.5" textAnchor="middle" fontFamily={COND} fontSize="8" className="biyahe-r-placard-t">CUBAO</text>
        <text x="464" y="249.5" textAnchor="middle" fontFamily={COND} fontSize="8" className="biyahe-r-placard-t">DITO SANA</text>
        <text x="646" y="249.5" textAnchor="end" fontFamily={COND} fontSize="8" className="biyahe-r-placard-t biyahe-r-placard-t--faint">HOME</text>
        <text x="557" y="232.4" fontFamily={COND} fontSize="8.4" fontWeight="600" className="biyahe-r-placard-arc">NEW CHARACTER ARC →</text>
      </g>
      <path d="M258 254h406v4H258Z" className="biyahe-r-stripe-c" />

      {/* The front: windshield, the long hood, a small chrome horse, the grille and lamp. */}
      <path d="M664 116h12l18 58h-30Z" className="biyahe-r-glass" />
      <path d="M664 174h48c20 0 34 10 38 26l4 58h-90Z" className="biyahe-r-body" />
      <path d="M720 174l2-9-3-4 5-3 3 3 7 1 1 6-3 6Z" className="biyahe-r-chrome-fill" />
      <rect x="744" y="200" width="13" height="52" rx="3" className="biyahe-r-bumper" />
      <path d="M748 206v40M752 206v40" className="biyahe-r-grille" />
      <circle cx="736" cy="206" r="6.5" className="biyahe-r-lamp" />
      <path d="M660 252h100v8H660Z" className="biyahe-r-bumper" />

      {/* Wheels, the front one under a flared fender. */}
      <path d="M282 258a30 30 0 0 1 60 0ZM674 258a30 30 0 0 1 60 0Z" className="biyahe-r-well" />
      <circle cx="312" cy="266" r="24" className="biyahe-r-tire" />
      <circle cx="312" cy="266" r="9" className="biyahe-r-hub" />
      <circle cx="704" cy="266" r="24" className="biyahe-r-tire" />
      <circle cx="704" cy="266" r="9" className="biyahe-r-hub" />
      <path d="M668 256c2-26 18-40 36-40s34 14 36 40" className="biyahe-r-fender" />

      {/* The rehearsal, on the ledge. */}
      <g transform="rotate(-5 430 198)" className="biyahe-r-wide">
        <path d="M404 196h54v28h-54Z" className="biyahe-r-note" />
        <path d="M404 204h54" className="biyahe-r-note-fold" />
        <text x="410" y="202" fontFamily={COND} fontSize="6.4" className="biyahe-r-note-t">REHEARSAL</text>
        <text x="410" y="214" fontFamily={COND} fontSize="9" className="biyahe-r-note-t">“para po”</text>
        <text x="410" y="221.5" fontFamily={COND} fontSize="6.4" className="biyahe-r-note-t">final_final_v7</text>
      </g>

      {/* Prepared. */}
      <g className="biyahe-r-bubble">
        <circle cx="404" cy="104" r="3" />
        <circle cx="394" cy="95" r="4" />
        <rect x="324" y="62" width="72" height="28" rx="14" />
        <text x="360" y="81" textAnchor="middle" fontFamily={COND} fontSize="15" fontStyle="italic">para…</text>
      </g>

      {/* The subtitle. */}
      <text x="380" y="318" textAnchor="middle" fontFamily={COND} fontSize="14" fontStyle="italic" className="biyahe-r-caption">Nakapag-practice. Hindi nakababa.</text>
      <text x="380" y="332" textAnchor="middle" fontFamily={COND} fontSize="10" className="biyahe-r-caption biyahe-r-caption--en">Practised it. Didn’t get off.</text>
    </svg>
  )
}
