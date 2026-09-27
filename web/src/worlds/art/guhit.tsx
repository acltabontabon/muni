/**
 * Guhit — the gloriously unfinished studio. A sketchbook desk: a jar of brushes and pencils, a
 * floor plan taped down mid-thought, paint where paint shouldn't be. The heading's underline is
 * drawn most of the way; the first save of the visit finishes it. Decoration only (aria-hidden).
 */
import { useEffect, useState } from 'react'
import { onKept } from '@/lib/kept'
import type { WorldArt } from '../art'
import { Portrait } from '../portraits'

const INK = 'var(--g-ink)'
const HAND = "'Caveat Variable', 'Caveat', cursive"

/** A registration mark, as on a proof. */
function Reg({ x, y, r = 5 }: { x: number; y: number; r?: number }) {
  return (
    <g transform={`translate(${x} ${y})`} stroke="var(--g-mark)" strokeWidth="0.8" fill="none">
      <circle r={r * 0.6} />
      <path d={`M${-r} 0H${r}M0 ${-r}V${r}`} />
    </g>
  )
}

function Tape({ x, y, w = 22, r = -6 }: { x: number; y: number; w?: number; r?: number }) {
  return <rect x={x - w / 2} y={y - 3.4} width={w} height="6.8" transform={`rotate(${r} ${x} ${y})`} fill="var(--g-tape)" />
}

/** The floor plan: one feeling, a few rooms later. */
function Plan({ x, y, s = 1, r = -3 }: { x: number; y: number; s?: number; r?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`}>
      <rect x="-34" y="-26" width="68" height="52" fill="var(--g-sheet)" stroke="var(--g-sheet-line)" strokeWidth="0.8" />
      <g stroke={INK} strokeWidth="1.1" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M-26 -18h52v36h-52Z" />
        <path d="M-4 -18v14M-4 4v14M-26 2h16M8 2h18M8 2v-6" />
        <path d="M-20 -10h8M16 12h6" strokeWidth="0.8" />
      </g>
      <circle cx="-15" cy="10" r="4.4" fill="var(--g-blue)" opacity="0.75" />
      <path d="M11 -12l9 7" stroke="var(--g-red)" strokeWidth="1.3" strokeLinecap="round" />
      <Tape x={-22} y={-26} w={18} r={-10} />
      <Tape x={24} y={-25} w={16} r={8} />
    </g>
  )
}

function Jar({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M-4 -28l-8-26" stroke="var(--g-yellow)" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M-10.6 -52.6l-1.8-5.6" stroke={INK} strokeWidth="3.2" strokeLinecap="round" />
      <path d="M3 -28l4-30" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M7 -58c-3-2-3-8 0-12 3 4 3 10 0 12Z" fill="var(--g-red)" stroke={INK} strokeWidth="0.8" />
      <path d="M9 -28l10-22" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M19 -50c-1-4 1-8 5-9 1 4-1 8-5 9Z" fill="var(--g-blue)" stroke={INK} strokeWidth="0.8" />
      <path d="M-14 -30h30l-3 30h-24Z" fill="var(--g-glass)" stroke={INK} strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M-12 -20h26" stroke={INK} strokeWidth="0.7" opacity="0.4" />
    </g>
  )
}

function Header() {
  return (
    <svg className="w-art guhit-head" viewBox="0 0 220 100" preserveAspectRatio="xMaxYMax meet">
      <Reg x={10} y={12} />
      <Reg x={210} y={12} />
      <circle cx="58" cy="86" r="6" fill="var(--g-blue)" opacity="0.5" />
      <circle cx="66" cy="92" r="2.4" fill="var(--g-red)" opacity="0.7" />
      <Plan x={96} y={58} s={0.92} />
      <text x="34" y="30" fontFamily={HAND} fontSize="12" fill="var(--g-note)" transform="rotate(-6 34 30)">draft 14</text>
      <path d="M58 32c10 2 16 8 18 14" fill="none" stroke="var(--g-note)" strokeWidth="1" strokeLinecap="round" />
      <path d="M72 43l4 3.4 1-5" fill="none" stroke="var(--g-note)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
      <Jar x={176} y={98} />
      <path d="M146 94c4-3 10-3 13 1" fill="none" stroke="var(--g-yellow)" strokeWidth="3" strokeLinecap="round" opacity="0.8" />
    </svg>
  )
}

/** The heading's underline: nearly finished. The first save of the visit finishes it. */
function Title() {
  const [done, setDone] = useState(false)
  useEffect(() => onKept(() => setDone(true)), [])
  return (
    <svg className="guhit-flourish" viewBox="0 0 300 20" preserveAspectRatio="none" data-done={done || undefined}>
      <path d="M3 13C40 6 92 5 140 9s96 7 128-1c9-2 16-6 21-10-6 9-16 15-30 16" fill="none" stroke="var(--g-red)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" pathLength={1} />
    </svg>
  )
}

/** Beside the writing on wide screens: how one feeling became a mural, in three sketches. */
function Compose() {
  return (
    <svg className="w-art guhit-margin" viewBox="0 0 320 170">
      <Reg x={8} y={8} r={6} />
      <g transform="translate(40 70)">
        <path d="M-18 4c0-12 8-20 18-20s18 8 18 20c0 8-6 14-12 16l-6 6-6-6c-6-2-12-8-12-16Z" fill="var(--g-sheet)" stroke={INK} strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M-6 2c4 4 8 4 12 0" fill="none" stroke={INK} strokeWidth="1.2" strokeLinecap="round" />
      </g>
      <text x="14" y="122" fontFamily={HAND} fontSize="15" fill="var(--g-note)">one feeling</text>
      <path d="M72 70c14-6 24-6 34 0" fill="none" stroke="var(--g-note)" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M101 64l6 6-8 2" fill="none" stroke="var(--g-note)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <Plan x={152} y={72} s={0.78} r={2} />
      <text x="126" y="122" fontFamily={HAND} fontSize="15" fill="var(--g-note)">a floor plan</text>
      <path d="M190 70c12-6 22-6 32 0" fill="none" stroke="var(--g-note)" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M217 64l6 6-8 2" fill="none" stroke="var(--g-note)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <g transform="translate(236 44)">
        <rect width="72" height="54" fill="var(--g-sheet)" stroke={INK} strokeWidth="1.1" />
        <g stroke="var(--g-grid-line)" strokeWidth="0.6">
          <path d="M18 0v54M36 0v54M54 0v54M0 18h72M0 36h72" />
        </g>
        <circle cx="24" cy="30" r="12" fill="var(--g-yellow)" opacity="0.85" />
        <path d="M36 54c6-16 18-24 36-26v26Z" fill="var(--g-blue)" opacity="0.8" />
        <path d="M6 46c10-8 18-8 26 0" fill="none" stroke="var(--g-red)" strokeWidth="2" strokeLinecap="round" />
      </g>
      <text x="238" y="122" fontFamily={HAND} fontSize="15" fill="var(--g-note)">a mural (phase 2)</text>
    </svg>
  )
}

/** The empty collection: Guhit, and a canvas already gridded for something enormous. */
function Empty() {
  return (
    <div className="guhit-empty">
      <Portrait id="guhit" size={104} />
      <svg className="w-art" viewBox="0 0 90 100" width="80" height="90">
        <path d="M20 96L38 10M70 96L52 10M45 6v90" stroke={INK} strokeWidth="2" strokeLinecap="round" />
        <rect x="16" y="18" width="58" height="46" fill="var(--g-sheet)" stroke={INK} strokeWidth="1.3" />
        <g stroke="var(--g-grid-line)" strokeWidth="0.7">
          <path d="M30.5 18v46M45 18v46M59.5 18v46M16 33.3h58M16 48.6h58" />
        </g>
        <path d="M12 66h66" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
        <path d="M58 40l9-9" stroke="var(--g-red)" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </div>
  )
}

const art: WorldArt = { Header, Title, Compose, Empty }
export default art
