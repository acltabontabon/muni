/**
 * Himig — the listening room for imaginary music videos. A record sleeve with the record halfway
 * out; after a save the record makes one turn. The waveform under the heading is drawing, not
 * sound: nothing here plays, listens or implies audio. Decoration only (aria-hidden).
 */
import type { WorldArt } from '../art'
import { useKeptMoment } from '../art'
import { Portrait } from '../portraits'

const INK = 'var(--hi-ink)'

function Record({ x, y, r, spin = 0 }: { x: number; y: number; r: number; spin?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className={spin ? 'himig-spin' : undefined} key={spin}>
        <circle r={r} fill="var(--hi-vinyl)" />
        {[0.92, 0.82, 0.72, 0.62, 0.52].map((k) => (
          <circle key={k} r={r * k} fill="none" stroke="var(--hi-groove)" strokeWidth="0.6" />
        ))}
        <path d={`M${-r * 0.8} ${-r * 0.3}A${r * 0.86} ${r * 0.86} 0 0 1 ${-r * 0.2} ${-r * 0.84}`} fill="none" stroke="var(--hi-shine)" strokeWidth="2.4" strokeLinecap="round" />
        <circle r={r * 0.32} fill="var(--hi-label)" />
        <path d={`M${-r * 0.2} ${-r * 0.06}h${r * 0.4}`} stroke="var(--hi-label-ink)" strokeWidth="1.4" strokeLinecap="round" />
        <circle r={r * 0.05} fill="var(--paper)" />
      </g>
    </g>
  )
}

function Sleeve({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={s} height={s} fill="var(--hi-sleeve)" stroke={INK} strokeWidth="1" />
      <circle cx={s * 0.38} cy={s * 0.46} r={s * 0.27} fill="var(--hi-sun)" />
      <path d={`M${s * 0.11} ${s * 0.46}A${s * 0.27} ${s * 0.27} 0 0 0 ${s * 0.65} ${s * 0.46}Z`} fill="var(--hi-tomato)" />
      <circle cx={s * 0.72} cy={s * 0.24} r={s * 0.09} fill="none" stroke={INK} strokeWidth="1.2" />
      <path d={`M${s * 0.08} ${s * 0.86}h${s * 0.46}M${s * 0.08} ${s * 0.92}h${s * 0.3}`} stroke={INK} strokeWidth="2" />
      <path d={`M${s * 0.74} ${s * 0.84}v${s * 0.1}M${s * 0.8} ${s * 0.8}v${s * 0.14}M${s * 0.86} ${s * 0.86}v${s * 0.08}`} stroke="var(--hi-tomato)" strokeWidth="2" strokeLinecap="round" />
    </g>
  )
}

function Header() {
  const spin = useKeptMoment(1300)
  return (
    <svg className="w-art himig-head" viewBox="0 0 200 100" preserveAspectRatio="xMaxYMax meet">
      <Record x={148} y={50} r={44} spin={spin} />
      <Sleeve x={52} y={5} s={90} />
    </svg>
  )
}

/** Under the heading: a waveform that is only a drawing. */
const BARS = [3, 6, 4, 9, 5, 12, 8, 4, 7, 11, 6, 3, 8, 13, 9, 5, 7, 10, 4, 6, 12, 8, 5, 9, 3, 7, 11, 6, 4, 8, 5, 3, 6, 9, 4, 2]
function Title() {
  return (
    <svg className="himig-wave" viewBox={`0 0 ${BARS.length * 6} 14`} preserveAspectRatio="xMinYMid meet">
      {BARS.map((h, i) => (
        <rect key={i} x={i * 6} y={7 - h / 2} width="2.4" height={h} rx="1.2" fill={i < 12 ? 'var(--accent)' : 'var(--line-strong)'} />
      ))}
    </svg>
  )
}

/** Beside the writing: records leaning in a crate. */
function Compose() {
  const spines = ['var(--hi-sun)', 'var(--hi-tomato)', 'var(--hi-green)', 'var(--hi-sleeve-2)', 'var(--hi-sun)', 'var(--hi-green)']
  return (
    <svg className="w-art himig-crate" viewBox="0 0 320 150">
      {spines.map((c, i) => (
        <g key={i} transform={`rotate(${-10 + i * 3} ${60 + i * 16} 136)`}>
          <rect x={30 + i * 16} y={30 + (i % 2) * 6} width="14" height={104 - (i % 2) * 6} fill={c} stroke={INK} strokeWidth="1" />
        </g>
      ))}
      <path d="M20 96h140v44H20Z" fill="var(--hi-crate)" stroke={INK} strokeWidth="1.2" />
      <path d="M20 112h140" stroke={INK} strokeWidth="0.8" opacity="0.5" />
      <g transform="translate(240 86)">
        <Record x={0} y={0} r={46} />
      </g>
    </svg>
  )
}

/** The empty collection: Himig, and a turntable with the arm lifted. */
function Empty() {
  return (
    <div className="himig-empty">
      <Portrait id="himig" size={104} />
      <svg className="w-art" viewBox="0 0 110 90" width="100" height="82">
        <rect x="4" y="18" width="102" height="68" rx="6" fill="var(--hi-deck)" stroke={INK} strokeWidth="1.2" />
        <Record x={46} y={52} r={28} />
        <circle cx="90" cy="30" r="5" fill="var(--hi-sleeve-2)" stroke={INK} strokeWidth="1" />
        <path d="M90 30L96 62l-8 10" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="84" y="70" width="8" height="5" rx="1" transform="rotate(-40 88 72)" fill="var(--hi-tomato)" />
      </svg>
    </div>
  )
}

const art: WorldArt = { Header, Title, Compose, Empty }
export default art
