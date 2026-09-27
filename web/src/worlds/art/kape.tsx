/**
 * Kape — the café corner outside of time. A tabletop seen from above: a cup that is always there,
 * pandesal on a small plate, a café stamp, a receipt. After a save, one thin curl of steam rises
 * from the cup and is gone. Decoration only: aria-hidden, no text a person needs.
 */
import { useId } from 'react'
import type { WorldArt } from '../art'
import { useKeptMoment } from '../art'
import { Portrait } from '../portraits'

const INK = 'var(--k-ink)'

/** A cup on its saucer, from above. */
function Cup({ x, y, s = 1, steam = 0 }: { x: number; y: number; s?: number; steam?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <circle r="30" fill="var(--k-ceramic)" stroke={INK} strokeWidth="1" />
      <circle r="23.5" fill="none" stroke="var(--k-ceramic-line)" strokeWidth="1" />
      <rect x="15" y="-4.6" width="13" height="9.2" rx="4.6" fill="var(--k-ceramic)" stroke={INK} strokeWidth="1" />
      <circle r="18.5" fill="var(--k-cup)" stroke={INK} strokeWidth="1" />
      <circle r="14.6" fill="var(--k-coffee)" />
      <path d="M-9.6 -5.4a11.4 11.4 0 0 1 9.4-6.2" fill="none" stroke="var(--k-crema)" strokeWidth="2.4" strokeLinecap="round" opacity="0.8" />
      <circle cx="4.6" cy="4" r="2" fill="var(--k-crema)" opacity="0.35" />
      {/* The spoon: resting, after forty minutes of service. */}
      <g transform="rotate(38) translate(-4 22)">
        <rect x="-1.2" y="0" width="2.4" height="20" rx="1.2" fill="var(--k-metal)" stroke={INK} strokeWidth="0.7" />
        <ellipse cx="0" cy="-2.6" rx="3.4" ry="4.6" fill="var(--k-metal)" stroke={INK} strokeWidth="0.7" />
      </g>
      {steam ? (
        <g key={steam} className="w-sig kape-steam">
          <path d="M-2 -8c-6-8 6-12 0-20s6-12 0-20" fill="none" stroke="var(--k-steam)" strokeWidth="2.2" strokeLinecap="round" pathLength={1} />
        </g>
      ) : null}
    </g>
  )
}

function Pandesal({ x, y, r = 0 }: { x: number; y: number; r?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r})`}>
      <ellipse rx="10.5" ry="7.6" fill="var(--k-bread)" stroke={INK} strokeWidth="0.9" />
      <ellipse rx="7.6" ry="5.2" fill="var(--k-crust)" />
      {[[-3, -1.4], [1.6, 1], [3.8, -2], [-1, 2.4], [-5, 1.6]].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="0.7" fill="var(--k-crumb)" />
      ))}
    </g>
  )
}

/** A café's rubber stamp, a little worn. */
function Stamp({ x, y, r = 15 }: { x: number; y: number; r?: number }) {
  const u = useId().replace(/[^a-zA-Z0-9]/g, '')
  return (
    <g transform={`translate(${x} ${y}) rotate(-12)`} className="kape-stamp" opacity="0.85">
      <path id={`${u}-ring`} d={`M0 ${-r + 4}a${r - 4} ${r - 4} 0 1 1 -0.01 0`} fill="none" />
      <circle r={r} fill="none" stroke="var(--k-stamp)" strokeWidth="1.2" />
      <circle r={r - 7.6} fill="none" stroke="var(--k-stamp)" strokeWidth="0.8" />
      <text fontFamily="DM Mono, ui-monospace, monospace" fontSize="4.2" letterSpacing="0.9" fill="var(--k-stamp)">
        <textPath href={`#${u}-ring`}>KAPE · TABLE 04 · MORNINGS ·</textPath>
      </text>
      <path d="M-3.6 -1.6h5.4v3.4a2.6 2.6 0 0 1-2.6 2.6h-.2a2.6 2.6 0 0 1-2.6-2.6Z M1.8 -.6h1a1.4 1.4 0 0 1 0 2.8h-1" fill="none" stroke="var(--k-stamp)" strokeWidth="0.9" />
    </g>
  )
}

/** Sugar in paper sachets; one already opened, with the evidence. */
function Sachets({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g transform="rotate(-16)">
        <rect x="-14" y="-5" width="28" height="10" rx="1.2" fill="var(--k-sachet)" stroke={INK} strokeWidth="0.8" />
        <path d="M-9-5v10M9-5v10" stroke="var(--k-sachet-line)" strokeWidth="0.8" strokeDasharray="1.2 1.2" />
        <rect x="-5" y="-2.4" width="10" height="4.8" rx="0.6" fill="var(--k-stamp)" opacity="0.7" />
      </g>
      <g transform="translate(10 15) rotate(9)">
        <path d="M-14-5h24l3 2.5-3 2.5 3 2.5-3 2.5h-24Z" fill="var(--k-sachet)" stroke={INK} strokeWidth="0.8" />
        <rect x="-10" y="-2.4" width="10" height="4.8" rx="0.6" fill="var(--k-stamp)" opacity="0.7" />
      </g>
      {[[20, 6], [23, 9], [21.6, 12.6], [26, 7.4], [24.4, 14], [27.4, 11]].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="0.8" fill="var(--k-sugar-grain)" />
      ))}
    </g>
  )
}

function Plate({ x, y, s = 1, three = false }: { x: number; y: number; s?: number; three?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse rx="27" ry="22" fill="var(--k-ceramic)" stroke={INK} strokeWidth="1" />
      <ellipse rx="19.6" ry="15.6" fill="none" stroke="var(--k-ceramic-line)" strokeWidth="0.9" />
      <Pandesal x={-6} y={-3} r={-18} />
      <Pandesal x={7} y={5} r={14} />
      {three ? <Pandesal x={9} y={-8} r={-40} /> : null}
    </g>
  )
}

/** A paper napkin, folded twice, under the plate. */
function Napkin({ x, y, r = -8 }: { x: number; y: number; r?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r})`}>
      <rect x="-30" y="-24" width="60" height="48" fill="var(--k-napkin)" stroke="var(--k-sachet-line)" strokeWidth="0.8" />
      <path d="M-30 0H30M0 -24V24" stroke="var(--k-sachet-line)" strokeWidth="0.6" strokeDasharray="1.6 1.6" />
      <path d="M18 -24l12 12V-24Z" fill="var(--k-sachet-line)" opacity="0.35" />
    </g>
  )
}

/**
 * The header. Wide screens: the stamp, pandesal and sugar (the cup waits beside the writing).
 * Narrow screens, where the table below is folded away: the cup, with a little pandesal.
 */
function Header() {
  const steam = useKeptMoment(1800)
  return (
    <>
      <svg className="w-art kape-head kape-head--wide" viewBox="0 0 240 100" preserveAspectRatio="xMaxYMax meet">
        <Stamp x={34} y={40} r={21} />
        <Napkin x={122} y={62} r={-7} />
        <Plate x={116} y={62} s={1.32} three />
        <Sachets x={200} y={46} />
      </svg>
      <svg className="w-art kape-head kape-head--narrow" viewBox="0 0 150 100" preserveAspectRatio="xMaxYMax meet">
        <Plate x={40} y={72} />
        <Cup x={112} y={62} s={1.05} steam={steam} />
      </svg>
    </>
  )
}

/** Beside the writing, on wide screens: the cup, the receipt and one printed coffee ring. */
function Compose() {
  const steam = useKeptMoment(1800)
  return (
    <svg className="w-art kape-table" viewBox="0 0 320 150">
      {/* A ring left by some earlier cup: printed on the table, not moving anywhere. */}
      <g opacity="0.55">
        <circle cx="52" cy="92" r="30" fill="none" stroke="var(--k-ring)" strokeWidth="2.2" opacity="0.55" />
        <path d="M24 100a30 30 0 0 0 44 16" fill="none" stroke="var(--k-ring)" strokeWidth="3.6" strokeLinecap="round" opacity="0.7" />
        <path d="M78 78a30 30 0 0 0-10-12" fill="none" stroke="var(--k-ring)" strokeWidth="1.4" strokeLinecap="round" />
      </g>
      <g transform="rotate(-4 210 80)">
        <path d="M168 26h92v104l-5.75-4-5.75 4-5.75-4-5.75 4-5.75-4-5.75 4-5.75-4-5.75 4-5.75-4-5.75 4-5.75-4-5.75 4-5.75-4-5.75 4-5.75-4-5.75 4-5.75-4Z" fill="var(--k-receipt)" stroke="var(--k-receipt-line)" strokeWidth="1" />
        <g fill="var(--k-receipt-ink)" opacity="0.75">
          <rect x="182" y="40" width="46" height="3" rx="1.5" />
          <rect x="182" y="50" width="30" height="2.4" rx="1.2" />
          <rect x="236" y="50" width="12" height="2.4" rx="1.2" />
          <rect x="182" y="58" width="38" height="2.4" rx="1.2" />
          <rect x="236" y="58" width="12" height="2.4" rx="1.2" />
          <rect x="182" y="66" width="26" height="2.4" rx="1.2" />
          <rect x="236" y="66" width="12" height="2.4" rx="1.2" />
        </g>
        <path d="M182 78h66" stroke="var(--k-receipt-ink)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
        <g fill="var(--k-receipt-ink)" opacity="0.75">
          <rect x="182" y="86" width="22" height="3" rx="1.5" />
          <rect x="230" y="86" width="18" height="3" rx="1.5" />
          <rect x="196" y="104" width="36" height="2.2" rx="1.1" />
        </g>
      </g>
      <Cup x={112} y={78} s={1.25} steam={steam} />
    </svg>
  )
}

/** The empty collection: Kape, the cup, a table edge. */
function Empty() {
  return (
    <div className="kape-empty">
      <Portrait id="kape" size={104} />
      <svg className="w-art" viewBox="0 0 90 70" width="72" height="56">
        <path d="M6 64h78" stroke="var(--line-strong)" strokeWidth="1.4" strokeLinecap="round" />
        <ellipse cx="44" cy="62" rx="26" ry="4" fill="var(--k-ceramic)" stroke={INK} strokeWidth="1" />
        <path d="M26 28h36v22a12 12 0 0 1-12 12H38a12 12 0 0 1-12-12Z" fill="var(--k-cup)" stroke={INK} strokeWidth="1.2" />
        <path d="M62 34c8 0 10 4 10 8s-3 8-10 8" fill="none" stroke={INK} strokeWidth="1.8" />
        <ellipse cx="44" cy="28" rx="18" ry="3.4" fill="var(--k-coffee)" stroke={INK} strokeWidth="1" />
        <path d="M38 20c-3-4 3-6 0-10M48 20c-3-4 3-6 0-10" fill="none" stroke="var(--k-steam)" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </div>
  )
}

const art: WorldArt = { Header, Compose, Empty }
export default art
