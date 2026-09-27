/**
 * Biyahe — thoughts through a moving window. The header is a bus window holding a horizon that
 * stays perfectly still (nothing scrolls behind anyone's words): hills, a distant city, a power
 * line, a lamp. By day the light is low and warm; at night the city's windows are lit.
 * Decoration only (aria-hidden).
 */
import { useId } from 'react'
import type { WorldArt } from '../art'
import { Portrait } from '../portraits'

/** A distant city: [x, width, height] of each building, left to right. */
const CITY: [number, number, number][] = [
  [44, 8, 15], [52, 6, 22], [58, 5, 13], [63, 9, 26], [72, 6, 11], [78, 10, 19], [88, 8, 28], [96, 7, 15], [103, 8, 21], [111, 12, 13], [123, 9, 24], [132, 10, 17], [142, 7, 30], [149, 6, 19], [155, 14, 11], [169, 9, 22], [178, 7, 14],
]

/** The view: sky, sun or moon, hills, a city, a power line. Drawn into any rectangle. */
function View({ w, h, u }: { w: number; h: number; u: string }) {
  const y0 = h * 0.64
  return (
    <>
      <defs>
        <linearGradient id={`${u}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--b-sky-top)' }} />
          <stop offset="1" style={{ stopColor: 'var(--b-sky-low)' }} />
        </linearGradient>
      </defs>
      <rect width={w} height={h} fill={`url(#${u}-sky)`} />
      <circle cx={w * 0.72} cy={y0 - 6} r="9" fill="var(--b-sun)" />
      <circle cx={w * 0.72} cy={y0 - 6} r="15" fill="var(--b-sun)" opacity="0.18" />
      <path d={`M0 ${y0}C${w * 0.18} ${y0 - 14} ${w * 0.3} ${y0 - 6} ${w * 0.46} ${y0 - 10}S${w * 0.8} ${y0 - 4} ${w} ${y0 - 12}V${h}H0Z`} fill="var(--b-hills)" />
      <g fill="var(--b-city)">
        {CITY.map(([x, bw, bh], i) => <rect key={i} x={x} y={y0 + 2 - bh} width={bw} height={bh} />)}
      </g>
      <g className="biyahe-lights" fill="var(--b-lit)">
        {CITY.flatMap(([x, bw, bh], i) =>
          Array.from({ length: Math.floor((bh - 6) / 5) }, (_, k) => ((i * 7 + k * 3) % 3 === 0 ? <rect key={`${i}-${k}`} x={x + (k % 2 ? bw - 4 : 2)} y={y0 + 2 - bh + 4 + k * 5} width="2" height="2" /> : null)),
        )}
      </g>
      <rect y={y0 + 2} width={w} height={h - y0} fill="var(--b-road)" />
      <path d={`M0 ${y0 + 10}H${w}`} stroke="var(--b-road-line)" strokeWidth="1.4" strokeDasharray="10 9" />
      <path d={`M-4 ${h * 0.2}Q${w * 0.3} ${h * 0.34} ${w * 0.62} ${h * 0.22}T${w + 4} ${h * 0.26}`} fill="none" stroke="var(--b-wire)" strokeWidth="0.8" />
      <g className="biyahe-birds" fill="none" stroke="var(--b-wire)" strokeWidth="1" strokeLinecap="round">
        <path d={`M${w * 0.34} ${h * 0.29}q2.2-2.4 4.4 0q2.2-2.4 4.4 0`} />
        <path d={`M${w * 0.4} ${h * 0.3}q1.8-2 3.6 0q1.8-2 3.6 0`} />
      </g>
      <g transform={`translate(${w * 0.9} ${y0 + 2})`}>
        <path d="M0 0v-30q0-4 4-4h6" fill="none" stroke="var(--b-post)" strokeWidth="1.6" />
        <rect x="8" y="-35.6" width="7" height="3" rx="1.2" fill="var(--b-post)" />
        <path d="M9 -32.6l-6 16h17Z" fill="var(--b-lamp-beam)" />
        <circle cx="11.5" cy="-32.4" r="1.6" fill="var(--b-lamp)" />
      </g>
    </>
  )
}

function Header() {
  const u = useId().replace(/[^a-zA-Z0-9]/g, '')
  return (
    <svg className="w-art biyahe-head" viewBox="0 0 240 100" preserveAspectRatio="xMaxYMax meet">
      <defs>
        <clipPath id={`${u}-glass`}>
          <rect x="9" y="9" width="222" height="82" rx="15" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${u}-glass)`}>
        <g transform="translate(9 9)">
          <View w={222} h={82} u={u} />
        </g>
        {/* The glass: a long reflection, and the sliding pane's frame. */}
        <path d="M150 9L118 91M166 9L134 91" stroke="var(--b-glint)" strokeWidth="7" opacity="0.14" />
        <path d="M120 9v82" stroke="var(--b-frame)" strokeWidth="3" />
      </g>
      <rect x="5" y="5" width="230" height="90" rx="19" fill="none" stroke="var(--b-frame)" strokeWidth="8" />
      <rect x="112" y="46" width="16" height="7" rx="3" fill="var(--b-latch)" stroke="var(--b-frame)" strokeWidth="1.2" />
    </svg>
  )
}

/** Beside the writing: a folded route map and a ticket, on wide screens. */
function Compose() {
  return (
    <svg className="w-art biyahe-map" viewBox="0 0 320 150">
      <g transform="rotate(-3 120 80)">
        <path d="M24 22l62-8 64 8 64-8v112l-64 8-64-8-62 8Z" fill="var(--b-map)" stroke="var(--b-map-line)" strokeWidth="1" strokeLinejoin="round" />
        <path d="M86 14v112M150 22v112" stroke="var(--b-map-line)" strokeWidth="1" />
        <path d="M40 104C70 96 74 60 104 58s52 30 82 18" fill="none" stroke="var(--b-route)" strokeWidth="3.4" strokeLinecap="round" />
        <path d="M52 40c20 10 40 12 58 4s36-10 70 6" fill="none" stroke="var(--b-route-2)" strokeWidth="3" strokeLinecap="round" strokeDasharray="1 7" />
        {[[40, 104], [104, 58], [146, 70], [186, 76]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="4.2" fill="var(--b-map)" stroke="var(--b-route)" strokeWidth="2.4" />
        ))}
        <circle cx="104" cy="58" r="8" fill="none" stroke="var(--b-route)" strokeWidth="1" opacity="0.6" />
      </g>
      <g transform="translate(236 60) rotate(8)">
        <rect x="0" y="0" width="70" height="40" rx="4" fill="var(--b-ticket)" stroke="var(--b-map-line)" strokeWidth="1" />
        <path d="M50 0v40" stroke="var(--b-map-line)" strokeWidth="1" strokeDasharray="2.4 2.4" />
        <rect x="8" y="9" width="32" height="3.4" rx="1.7" fill="var(--b-ticket-ink)" opacity="0.8" />
        <rect x="8" y="17" width="22" height="2.6" rx="1.3" fill="var(--b-ticket-ink)" opacity="0.6" />
        <rect x="8" y="25" width="28" height="2.6" rx="1.3" fill="var(--b-ticket-ink)" opacity="0.6" />
        <circle cx="60" cy="20" r="3.4" fill="var(--paper)" stroke="var(--b-map-line)" strokeWidth="0.8" />
      </g>
    </svg>
  )
}

/** The empty collection: Biyahe at the waiting shed, under a lamp. */
function Empty() {
  return (
    <div className="biyahe-empty">
      <Portrait id="biyahe" size={104} />
      <svg className="w-art" viewBox="0 0 100 100" width="88" height="88">
        <path d="M6 96h88" stroke="var(--b-frame)" strokeWidth="2" strokeLinecap="round" />
        <path d="M14 96V40M70 96V40" stroke="var(--b-frame)" strokeWidth="2.4" />
        <path d="M6 42l36-12 36 12Z" fill="var(--accent)" stroke="var(--b-frame)" strokeWidth="1.6" strokeLinejoin="round" />
        <rect x="20" y="70" width="44" height="4" rx="2" fill="var(--b-frame)" />
        <path d="M24 74v22M60 74v22" stroke="var(--b-frame)" strokeWidth="1.6" />
        <g transform="translate(86 96)">
          <path d="M0 0v-62q0-5 -5-5h-5" fill="none" stroke="var(--b-post)" strokeWidth="2" />
          <path d="M-9 -64l-8 22h14Z" fill="var(--b-lamp-beam)" />
          <circle cx="-10" cy="-65" r="2.4" fill="var(--b-lamp)" />
        </g>
      </svg>
    </div>
  )
}

const art: WorldArt = { Header, Compose, Empty }
export default art
