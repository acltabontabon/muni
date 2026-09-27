/**
 * Sibol — a small balcony with room to grow. A railing, clay pots (monstera, snake plant, a
 * calamansi), a pothos trailing down from above, soft light through the leaves. After a save one
 * leaf at the end of the pothos unfurls. Plants never wilt here and nothing keeps count.
 * Decoration only (aria-hidden).
 */
import type { WorldArt } from '../art'
import { useKeptMoment } from '../art'
import { Portrait } from '../portraits'

const INK = 'var(--si-ink)'

/** A heart-shaped pothos leaf, pointing along its stem (rotation in degrees). */
function Leaf({ x, y, r = 0, s = 1, fill = 'var(--si-leaf)', className }: { x: number; y: number; r?: number; s?: number; fill?: string; className?: string }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`}>
      <g className={className}>
        <path d="M0 0C-5-1.6-7.6-6.4-5.2-10.4-3.4-13 0-12 0-9.4 0-12 3.4-13 5.2-10.4 7.6-6.4 5-1.6 0 0Z" fill={fill} stroke="var(--si-leaf-line)" strokeWidth="0.6" />
        <path d="M0 -1V-9" stroke="var(--si-leaf-line)" strokeWidth="0.5" />
      </g>
    </g>
  )
}

function Pot({ x, y, w = 22, h = 18 }: { x: number; y: number; w?: number; h?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d={`M${-w / 2} ${-h}h${w}l-${w * 0.12} ${h}h-${w * 0.76}Z`} fill="var(--si-clay)" stroke={INK} strokeWidth="0.9" strokeLinejoin="round" />
      <rect x={-w / 2 - 1.6} y={-h - 3.6} width={w + 3.2} height="4.2" rx="1" fill="var(--si-clay-rim)" stroke={INK} strokeWidth="0.9" />
    </g>
  )
}

function Monstera({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M0 0C-2-10 -8-18 -16-24M0 0C2-12 8-20 18-26M0 0V-30" fill="none" stroke="var(--si-stem)" strokeWidth="1.2" />
      {[[-18, -30, -30], [20, -34, 24], [0, -40, 0]].map(([lx, ly, r], i) => (
        <g key={i} transform={`translate(${lx} ${ly}) rotate(${r})`}>
          <path d="M0 14C-12 12-16 0-12-8S0-16 0-14C0-16 8-16 12-8S12 12 0 14Z" fill="var(--si-leaf-deep)" stroke="var(--si-leaf-line)" strokeWidth="0.6" />
          <path d="M-12-2l6 1M-10 5l5-1M12-2l-6 1M10 5l-5-1M0 12V-12" stroke="var(--paper)" strokeWidth="1.1" strokeLinecap="round" />
        </g>
      ))}
    </g>
  )
}

function Calamansi({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M0 0V-14M0 -8l-6-6M0 -10l5-5" stroke="var(--si-stem)" strokeWidth="1.3" fill="none" />
      <circle cx="0" cy="-22" r="12" fill="var(--si-leaf)" />
      <circle cx="-8" cy="-17" r="7" fill="var(--si-leaf-deep)" />
      <circle cx="7" cy="-16" r="7.4" fill="var(--si-leaf-deep)" />
      {[[-4, -24], [5, -21], [-9, -15], [2, -29], [8, -13]].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="1.9" fill={i % 2 ? 'var(--si-fruit)' : 'var(--si-fruit-green)'} stroke="var(--si-leaf-line)" strokeWidth="0.3" />
      ))}
    </g>
  )
}

function SnakePlant({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {[[-5, -30, -6], [0, -38, 0], [5, -28, 7], [-1, -24, -2]].map(([dx, h, r], i) => (
        <path key={i} transform={`rotate(${r})`} d={`M${dx - 2.4} 0Q${dx - 3} ${h * 0.6} ${dx} ${h}Q${dx + 3} ${h * 0.6} ${dx + 2.4} 0Z`} fill={i % 2 ? 'var(--si-leaf-deep)' : 'var(--si-snake)'} stroke="var(--si-leaf-line)" strokeWidth="0.5" />
      ))}
    </g>
  )
}

function Header() {
  const grow = useKeptMoment(1600)
  return (
    <svg className="w-art sibol-head" viewBox="0 0 220 100" preserveAspectRatio="xMaxYMax meet">
      {/* The pothos, trailing down from somewhere above. */}
      <path d="M214 -4C212 14 200 22 196 36S190 58 178 64" fill="none" stroke="var(--si-stem)" strokeWidth="1.1" />
      {[[212, 8, 160], [205, 22, 120], [197, 36, 150], [194, 48, 110], [186, 60, 140]].map(([x, y, r], i) => (
        <Leaf key={i} x={x} y={y} r={r} s={1.15} fill={i % 2 ? 'var(--si-leaf)' : 'var(--si-leaf-deep)'} />
      ))}
      <Leaf x={178} y={64} r={125} s={1.2} fill="var(--si-leaf-new)" className={grow ? 'sibol-unfurl' : undefined} key={grow} />
      {/* The railing, and the pots along it. */}
      <Monstera x={46} y={70} />
      <Pot x={46} y={88} w={26} h={20} />
      <SnakePlant x={96} y={70} />
      <Pot x={96} y={88} w={18} h={16} />
      <Calamansi x={140} y={70} />
      <Pot x={140} y={88} w={22} h={18} />
      <path d="M0 88H220" stroke="var(--si-rail)" strokeWidth="3" />
      <path d="M0 98H220" stroke="var(--si-rail)" strokeWidth="1.6" />
      {Array.from({ length: 12 }, (_, i) => (
        <path key={i} d={`M${8 + i * 18.5} 88V98`} stroke="var(--si-rail)" strokeWidth="1.4" />
      ))}
    </svg>
  )
}

/** Beside the writing: a small pot, a watering can, a plant tag with nothing on it yet. */
function Compose() {
  return (
    <svg className="w-art sibol-sill" viewBox="0 0 320 150">
      <path d="M10 140H300" stroke="var(--line-strong)" strokeWidth="1.4" strokeLinecap="round" />
      <g transform="translate(80 140)">
        <path d="M0 -26C-2-40 -12-48 -22-52M0 -26C4-42 14-50 26-54M0 -26C0-40 2-52 0-62" fill="none" stroke="var(--si-stem)" strokeWidth="1.3" />
        <Leaf x={-22} y={-52} r={-60} s={1.6} fill="var(--si-leaf-deep)" />
        <Leaf x={26} y={-54} r={60} s={1.6} />
        <Leaf x={0} y={-62} r={0} s={1.7} fill="var(--si-leaf-new)" />
        <Pot x={0} y={0} w={40} h={28} />
        <g transform="translate(16 -8) rotate(8)">
          <rect x="0" y="-26" width="12" height="18" rx="2" fill="var(--si-tag)" stroke={INK} strokeWidth="0.7" />
          <path d="M6 -8v14" stroke={INK} strokeWidth="0.7" />
          <path d="M3 -20h6M3 -16h4" stroke="var(--si-tag-ink)" strokeWidth="1" strokeLinecap="round" />
        </g>
      </g>
      <g transform="translate(200 140)">
        <path d="M-26 0V-30a4 4 0 0 1 4-4H18a4 4 0 0 1 4 4V0Z" fill="var(--si-can)" stroke={INK} strokeWidth="1" />
        <path d="M22 -24L50 -46" stroke={INK} strokeWidth="4" strokeLinecap="round" />
        <path d="M22 -24L50 -46" stroke="var(--si-can)" strokeWidth="2.2" strokeLinecap="round" />
        <rect x="47" y="-51" width="9" height="6" rx="1.5" transform="rotate(-38 51 -48)" fill="var(--si-can)" stroke={INK} strokeWidth="0.8" />
        <path d="M-22 -34C-22 -52 14 -52 14 -34" fill="none" stroke={INK} strokeWidth="1.6" />
      </g>
    </svg>
  )
}

/** The empty collection: Sibol, and a pot with a pothos in it, doing well. */
function Empty() {
  return (
    <div className="sibol-empty">
      <Portrait id="sibol" size={104} />
      <svg className="w-art" viewBox="0 0 90 90" width="84" height="84">
        <path d="M45 58C40 44 30 36 20 34M45 58C48 46 58 36 70 34M45 58V28" fill="none" stroke="var(--si-stem)" strokeWidth="1.3" />
        <Leaf x={20} y={34} r={-70} s={1.7} fill="var(--si-leaf-deep)" />
        <Leaf x={70} y={34} r={70} s={1.7} />
        <Leaf x={45} y={28} r={0} s={1.8} fill="var(--si-leaf-new)" />
        <path d="M50 58C58 64 64 72 62 84" fill="none" stroke="var(--si-stem)" strokeWidth="1.1" />
        <Leaf x={62} y={84} r={170} s={1.3} />
        <Pot x={45} y={86} w={36} h={26} />
      </svg>
    </div>
  )
}

const art: WorldArt = { Header, Compose, Empty }
export default art
