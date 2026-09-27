/**
 * Pahina — a private reading room. A stack of books, folded glasses, a lamp that is on in the
 * evening. A ribbon bookmark hangs over whichever part of the page you're in (writing, or your
 * collection) and glides when you move between them. Decoration only (aria-hidden).
 */
import type { WorldArt } from '../art'
import { Portrait } from '../portraits'

const INK = 'var(--pa-ink)'

function Book({ x, y, w, h, fill, band, r = 0 }: { x: number; y: number; w: number; h: number; fill: string; band?: string; r?: number }) {
  return (
    <g transform={`rotate(${r} ${x + w / 2} ${y + h / 2})`}>
      <rect x={x} y={y} width={w} height={h} rx="1.4" fill={fill} stroke={INK} strokeWidth="0.9" />
      <rect x={x + 3} y={y + 1.2} width={w - 6} height={h - 2.4} fill="none" stroke="var(--pa-gilt)" strokeWidth="0.5" opacity="0.8" />
      {band ? <rect x={x + w * 0.62} y={y} width={w * 0.07} height={h} fill={band} opacity="0.85" /> : null}
    </g>
  )
}

function Lamp({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M-20 -58l-34 58h68Z" fill="var(--pa-lamp-light)" className="pahina-beam" />
      <ellipse cx="0" cy="-1" rx="14" ry="3" fill={INK} />
      <path d="M0 -2V-44M0 -44l-18-10" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M-30 -62l18 6-6 18-20-8Z" fill="var(--pa-shade)" stroke={INK} strokeWidth="1" strokeLinejoin="round" />
      <circle cx="-20" cy="-50" r="3" fill="var(--pa-bulb)" />
    </g>
  )
}

function Header() {
  return (
    <svg className="w-art pahina-head" viewBox="0 0 200 100" preserveAspectRatio="xMaxYMax meet">
      <Lamp x={168} y={98} />
      <Book x={40} y={84} w={84} h={13} fill="var(--pa-cloth)" band="var(--pa-gilt)" />
      <Book x={48} y={71} w={70} h={13} fill="var(--pa-ox)" r={-2} />
      <Book x={36} y={60} w={78} h={11} fill="var(--pa-ochre)" band="var(--pa-ink-soft)" r={1.5} />
      {/* The ribbon of the top book, hanging over its edge. */}
      <path d="M100 60v16l3-3 3 3V60" fill="var(--pa-ribbon)" />
      {/* Folded glasses, set down mid-sentence. */}
      <g transform="translate(76 52) rotate(-8)" fill="none" stroke={INK} strokeWidth="1.2">
        <circle cx="-7" cy="0" r="5.4" fill="var(--pa-lens)" />
        <circle cx="7" cy="0" r="5.4" fill="var(--pa-lens)" />
        <path d="M-1.6 -0.6q1.6-1.4 3.2 0M-12.4 -1l-6 3M12.4 -1l6 3" />
      </g>
    </svg>
  )
}

/** A thin rule under the heading, with a small diamond: a book's ornament, not a flourish. */
function Title() {
  return (
    <svg className="pahina-rule" viewBox="0 0 240 10" preserveAspectRatio="xMinYMid meet">
      <path d="M0 5h108M132 5h108" stroke="var(--line-strong)" strokeWidth="1" />
      <path d="M120 1l4 4-4 4-4-4Z" fill="var(--accent)" />
      <circle cx="112" cy="5" r="1.2" fill="var(--line-strong)" />
      <circle cx="128" cy="5" r="1.2" fill="var(--line-strong)" />
    </svg>
  )
}

/** The ribbon bookmark, keeping your place. CSS moves it to the part of the page you're in. */
function Page() {
  return (
    <svg className="pahina-ribbon" viewBox="0 0 16 84" width="16" height="84">
      <path d="M0 0h16v84l-8-9-8 9Z" fill="var(--pa-ribbon)" />
      <path d="M3 0v70M13 0v70" stroke="var(--pa-ribbon-line)" strokeWidth="0.6" />
    </svg>
  )
}

/** The empty collection: Pahina, a closed book, the lamp. */
function Empty() {
  return (
    <div className="pahina-empty">
      <Portrait id="pahina" size={104} />
      <svg className="w-art" viewBox="0 0 110 90" width="96" height="78">
        <path d="M4 88h102" stroke="var(--line-strong)" strokeWidth="1.4" />
        <Book x={14} y={74} w={58} h={13} fill="var(--pa-cloth)" band="var(--pa-gilt)" />
        <path d="M58 74v12l2.6-2.6 2.6 2.6V74" fill="var(--pa-ribbon)" />
        <Lamp x={92} y={88} />
      </svg>
    </div>
  )
}

const art: WorldArt = { Header, Title, Page, Empty }
export default art
