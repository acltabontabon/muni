/**
 * Porma — everyday life, unnecessarily well dressed. Fine stationery, a monogram pressed into it,
 * and, under a silver cloche lifted with ceremony, the evening's guest of honour: a parcel.
 * After a save the monogram is pressed once more. No gold. Decoration only (aria-hidden).
 */
import type { WorldArt } from '../art'
import { useKeptMoment } from '../art'
import { Portrait } from '../portraits'

const INK = 'var(--po-ink)'

function Parcel({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x="-18" y="-24" width="36" height="24" rx="1.5" fill="var(--po-kraft)" stroke={INK} strokeWidth="1" />
      <path d="M-18 -16h36" stroke="var(--po-kraft-dark)" strokeWidth="1" />
      <path d="M-3 -24v24M3 -24v24" stroke="var(--po-string)" strokeWidth="1.2" />
      <path d="M0 -24c-7-7-12-2-8 1 2 2 6 0 8-1 2 1 6 3 8 1 4-3-1-8-8-1Z" fill="none" stroke="var(--po-string)" strokeWidth="1.2" />
      <rect x="6" y="-12" width="9" height="6" fill="var(--po-label)" stroke={INK} strokeWidth="0.6" />
    </g>
  )
}

function Header() {
  return (
    <svg className="w-art porma-head" viewBox="0 0 200 100" preserveAspectRatio="xMaxYMax meet">
      {/* The tray. */}
      <ellipse cx="112" cy="90" rx="62" ry="7" fill="var(--po-tray)" stroke={INK} strokeWidth="1" />
      <ellipse cx="112" cy="88.4" rx="52" ry="4.6" fill="none" stroke="var(--po-tray-line)" strokeWidth="0.8" />
      <Parcel x={104} y={88} s={1.1} />
      {/* The cloche, lifted to announce it. */}
      <g transform="rotate(-24 168 54)">
        <path d="M128 58a40 34 0 0 1 80 0Z" fill="var(--po-silver)" stroke={INK} strokeWidth="1" />
        <path d="M136 52a32 26 0 0 1 22-20" fill="none" stroke="var(--po-shine)" strokeWidth="3" strokeLinecap="round" />
        <rect x="124" y="57" width="88" height="4" rx="2" fill="var(--po-silver-dark)" stroke={INK} strokeWidth="0.8" />
        <circle cx="168" cy="22" r="4" fill="var(--po-silver)" stroke={INK} strokeWidth="1" />
      </g>
      {/* A card, propped against the tray: the dress code. */}
      <g transform="rotate(6 44 76)">
        <rect x="26" y="52" width="38" height="44" fill="var(--po-card)" stroke="var(--po-card-line)" strokeWidth="0.8" />
        <rect x="29" y="55" width="32" height="38" fill="none" stroke="var(--po-card-line)" strokeWidth="0.5" />
        <path d="M36 66h18M38 72h14M36 80h18" stroke="var(--po-card-ink)" strokeWidth="1.1" strokeLinecap="round" />
      </g>
    </svg>
  )
}

/** The monogram, pressed into the page. Pressed once more after each save. */
function Title() {
  const press = useKeptMoment(900)
  return (
    <svg className="porma-seal" viewBox="0 0 64 44" data-press={press ? '' : undefined} key={press}>
      <ellipse cx="32" cy="22" rx="29" ry="20" fill="none" stroke="var(--po-emboss-lo)" strokeWidth="1.2" transform="translate(0.6 0.8)" />
      <ellipse cx="32" cy="22" rx="29" ry="20" fill="none" stroke="var(--po-emboss-hi)" strokeWidth="1.2" />
      <ellipse cx="32" cy="22" rx="24" ry="15.5" fill="none" stroke="var(--po-emboss-lo)" strokeWidth="0.6" transform="translate(0.5 0.6)" />
      <text x="32" y="30.5" textAnchor="middle" fontFamily="'Bodoni Moda Variable', Didot, serif" fontStyle="italic" fontSize="23" fill="var(--po-emboss-lo)" transform="translate(0.7 0.9)">P</text>
      <text x="32" y="30.5" textAnchor="middle" fontFamily="'Bodoni Moda Variable', Didot, serif" fontStyle="italic" fontSize="23" fill="var(--po-emboss-mid)">P</text>
    </svg>
  )
}

/** The empty collection: Porma, and a parcel on the mat, framed like a gala. */
function Empty() {
  return (
    <div className="porma-empty">
      <Portrait id="porma" size={104} />
      <svg className="w-art" viewBox="0 0 100 90" width="92" height="82">
        <rect x="3" y="3" width="94" height="84" fill="none" stroke="var(--line-strong)" strokeWidth="1" />
        <rect x="7" y="7" width="86" height="76" fill="none" stroke="var(--line-strong)" strokeWidth="0.5" />
        <rect x="18" y="64" width="64" height="12" rx="2" fill="var(--po-mat)" />
        <path d="M22 70h56" stroke="var(--po-mat-line)" strokeWidth="1" strokeDasharray="2 2" />
        <Parcel x={50} y={66} s={1.15} />
      </svg>
    </div>
  )
}

const art: WorldArt = { Header, Title, Empty }
export default art
