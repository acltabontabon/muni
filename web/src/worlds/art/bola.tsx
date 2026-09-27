/**
 * Bola — the court after the noise settles. A barangay court at the end of the day: the hoop, the
 * painted arc, somebody's tsinelas, and the ball, resting. After a save the ball settles with one
 * small bounce. No scores, no rankings, nothing counted. Decoration only (aria-hidden).
 */
import type { WorldArt } from '../art'
import { useKeptMoment } from '../art'
import { Portrait } from '../portraits'

const INK = 'var(--bo-ink)'

function Ball({ x, y, r = 10, bounce = 0 }: { x: number; y: number; r?: number; bounce?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cy={r + 1.5} rx={r * 0.95} ry={r * 0.22} fill="var(--bo-shadow)" className={bounce ? 'bola-shadow' : undefined} key={`s${bounce}`} />
      <g className={bounce ? 'bola-bounce' : undefined} key={`b${bounce}`}>
        <circle r={r} fill="var(--bo-ball)" stroke={INK} strokeWidth="1.1" />
        <g fill="none" stroke={INK} strokeWidth="0.9">
          <path d={`M${-r} 0H${r}M0 ${-r}V${r}`} />
          <path d={`M${-r * 0.7} ${-r * 0.72}C${-r * 0.2} ${-r * 0.3} ${-r * 0.2} ${r * 0.3} ${-r * 0.7} ${r * 0.72}`} />
          <path d={`M${r * 0.7} ${-r * 0.72}C${r * 0.2} ${-r * 0.3} ${r * 0.2} ${r * 0.3} ${r * 0.7} ${r * 0.72}`} />
        </g>
        <path d={`M${-r * 0.5} ${-r * 0.55}a${r * 0.7} ${r * 0.7} 0 0 1 ${r * 0.6} ${-r * 0.3}`} stroke="var(--bo-shine)" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      </g>
    </g>
  )
}

function Tsinelas({ x, y }: { x: number; y: number }) {
  const one = (dx: number, r: number) => (
    <g transform={`translate(${dx} 0) rotate(${r})`}>
      <rect x="-3.4" y="-9" width="6.8" height="18" rx="3.4" fill="var(--bo-slipper)" stroke={INK} strokeWidth="0.8" />
      <path d="M-3 -2L0 -6.4L3 -2" fill="none" stroke="var(--bo-strap)" strokeWidth="1.4" strokeLinecap="round" />
    </g>
  )
  return (
    <g transform={`translate(${x} ${y})`}>
      {one(0, -14)}
      {one(10, 22)}
    </g>
  )
}

function Header() {
  const bounce = useKeptMoment(1400)
  return (
    <svg className="w-art bola-head" viewBox="0 0 220 100" preserveAspectRatio="xMaxYMax meet">
      {/* The court floor: clay, the painted arc and the lane. */}
      <path d="M0 74C60 64 140 62 220 66V100H0Z" fill="var(--bo-court)" />
      <path d="M-6 98C30 70 110 62 176 70" fill="none" stroke="var(--bo-line)" strokeWidth="2.4" />
      <path d="M150 100L162 72H214L220 88" fill="var(--bo-lane)" stroke="var(--bo-line)" strokeWidth="2" strokeLinejoin="round" />
      {/* The hoop. */}
      <path d="M204 96V14" stroke={INK} strokeWidth="3" />
      <path d="M204 22H192" stroke={INK} strokeWidth="2" />
      <rect x="170" y="4" width="26" height="22" rx="1.5" fill="var(--bo-board)" stroke={INK} strokeWidth="1.2" />
      <rect x="178" y="12" width="10" height="8" fill="none" stroke="var(--bo-court)" strokeWidth="1.2" />
      <ellipse cx="183" cy="29" rx="8" ry="2.2" fill="none" stroke="var(--bo-rim)" strokeWidth="1.8" />
      <path d="M175.4 29.6L178 42H188L190.6 29.6M179 30l1.6 12M183 31v11M187 30l-1.6 12M176.6 35h12.8" fill="none" stroke="var(--bo-net)" strokeWidth="0.8" />
      <Tsinelas x={32} y={84} />
      <Ball x={112} y={76} r={11} bounce={bounce} />
    </svg>
  )
}

/** Beside the writing: the edge of the key, the free-throw circle, the ball at rest. */
function Compose() {
  const bounce = useKeptMoment(1400)
  return (
    <svg className="w-art bola-key" viewBox="0 0 320 150">
      <path d="M0 150V58H250V150" fill="var(--bo-lane)" opacity="0.35" />
      <path d="M0 58H250V150" fill="none" stroke="var(--bo-line-strong)" strokeWidth="3" />
      <path d="M185 58a65 65 0 0 0 -130 0" fill="none" stroke="var(--bo-line-strong)" strokeWidth="3" />
      <path d="M55 58a65 65 0 0 0 130 0" fill="none" stroke="var(--bo-line-strong)" strokeWidth="3" strokeDasharray="10 9" />
      {[88, 124, 160].map((y) => (
        <path key={y} d={`M250 ${y}h12`} stroke="var(--bo-line-strong)" strokeWidth="3" />
      ))}
      <Ball x={290} y={124} r={17} bounce={bounce} />
    </svg>
  )
}

/** The empty collection: the centre circle, Bola in it, the court open. */
function Empty() {
  return (
    <div className="bola-empty">
      <svg className="w-art bola-circle" viewBox="0 0 200 140" width="200" height="140">
        <path d="M0 70H200" stroke="var(--bo-line-strong)" strokeWidth="3" />
        <circle cx="100" cy="70" r="62" fill="var(--bo-lane)" stroke="var(--bo-line-strong)" strokeWidth="3" />
        <circle cx="100" cy="70" r="20" fill="none" stroke="var(--bo-line-strong)" strokeWidth="2" />
      </svg>
      <Portrait id="bola" size={96} />
    </div>
  )
}

const art: WorldArt = { Header, Compose, Empty }
export default art
