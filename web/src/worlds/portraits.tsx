/**
 * The eight portraits, drawn as one family: the same head, neck and shoulders, the same ink for
 * features, one shadow tone per surface, flat colour and (large sizes only) a little paper grain.
 * What tells them apart is what should: silhouette, hair, clothes, one object, and expression.
 *
 * Two cuts of each drawing: the bust (chooser, settings, previews) and, under 56px, an icon cut
 * that crops to the head and draws features heavier, so all eight stay recognisable at 24–40px.
 * Original artwork for Muni (see docs/THIRD-PARTY.md, "Project-original assets").
 *
 * Decoration by default (aria-hidden): whatever shows a portrait names the character in text.
 */
import { useId, type ReactNode } from 'react'
import type { AvatarId } from './characters'

const INK = '#231a14'

type Pal = { bg: string; skin: string; shade: string; hair: string; hairShade?: string }
const PAL: Record<AvatarId, Pal> = {
  kape: { bg: '#c98d52', skin: '#a86b45', shade: '#8a5334', hair: '#2b1c15', hairShade: '#3d2a20' },
  guhit: { bg: '#3d5aa8', skin: '#6e4128', shade: '#56311d', hair: '#1c1411' },
  biyahe: { bg: '#2f6f75', skin: '#d7a47c', shade: '#bb865e', hair: '#1f1a17', hairShade: '#352c27' },
  bola: { bg: '#c4572a', skin: '#5c3620', shade: '#472816', hair: '#15100d', hairShade: '#2a1f19' },
  pahina: { bg: '#6e2d2a', skin: '#c89572', shade: '#ab7a57', hair: '#d4d4cf', hairShade: '#aeafa9' },
  himig: { bg: '#d9a21b', skin: '#9c6a47', shade: '#7f522f', hair: '#221815', hairShade: '#5a4a42' },
  porma: { bg: '#27406b', skin: '#e2b48f', shade: '#c7946d', hair: '#16110e', hairShade: '#3b2f28' },
  sibol: { bg: '#6f8f68', skin: '#8a5a3a', shade: '#6d4328', hair: '#2a1b14', hairShade: '#44302a' },
}
export const portraitBackdrop = (id: AvatarId) => PAL[id].bg

type K = { icon: boolean; p: Pal; u: string }
/** Line weight: heavier in the icon cut so features survive at 24px. */
const w = (k: K, n: number) => (k.icon ? n * 1.7 : n)

// ── Shared construction ──────────────────────────────────────────────────────────────────────

const HEAD = 'M50 28.5C60.4 28.5 66.2 36.3 66.2 46.6C66.2 56.4 60.2 66 50 66C39.8 66 33.8 56.4 33.8 46.6C33.8 36.3 39.6 28.5 50 28.5Z'
const HEAD_SQUARE = 'M50 28.5C60.6 28.5 66.3 36.2 66.3 46.3C66.3 55.5 62 63.4 50 65.6C38 63.4 33.7 55.5 33.7 46.3C33.7 36.2 39.4 28.5 50 28.5Z'

function Neck({ k }: { k: K }) {
  return (
    <>
      <path d="M43.6 58h12.8v15.5c-3.8 2.6-9 2.6-12.8 0Z" fill={k.p.skin} />
      <path d="M43.6 60.5c3.6 4.6 9.2 4.6 12.8 0v5.2c-3.8 3.2-9 3.2-12.8 0Z" fill={k.p.shade} />
    </>
  )
}
function Head({ k, square }: { k: K; square?: boolean }) {
  return (
    <>
      <ellipse cx="34.2" cy="49.5" rx="3.1" ry="4.2" fill={k.p.skin} />
      <ellipse cx="65.8" cy="49.5" rx="3.1" ry="4.2" fill={k.p.skin} />
      <path d={square ? HEAD_SQUARE : HEAD} fill={k.p.skin} />
      {/* The one shadow tone: under the hairline and along the jaw's far side. */}
      <path d="M62.8 40c2.6 5.5 2.5 13.5-1.4 19.8-2.8 4.4-6.6 6.2-11.4 6.2 7.8-2.6 12.2-10.4 12.8-26Z" fill={k.p.shade} opacity="0.55" />
    </>
  )
}
function Nose({ k }: { k: K }) {
  return k.icon ? null : <path d="M49.6 51.8c-1.2 2.4-1.5 3.6.9 4" fill="none" stroke={k.p.shade} strokeWidth="1.3" strokeLinecap="round" />
}
function Cheeks({ k, tone = '#d9785f', o = 0.22 }: { k: K; tone?: string; o?: number }) {
  return k.icon ? null : (
    <>
      <ellipse cx="41" cy="55" rx="3.4" ry="2" fill={tone} opacity={o} />
      <ellipse cx="59" cy="55" rx="3.4" ry="2" fill={tone} opacity={o} />
    </>
  )
}
type Eye = 'open' | 'calm' | 'closed' | 'side' | 'smile' | 'down' | 'up'
function Eyes({ k, kind }: { k: K; kind: Eye }) {
  const s = { fill: 'none', stroke: INK, strokeWidth: w(k, 1.3), strokeLinecap: 'round' as const }
  const r = k.icon ? 1.9 : 1.35
  const pair = (f: (x: number) => ReactNode) => (
    <>
      {f(43.4)}
      {f(56.6)}
    </>
  )
  switch (kind) {
    case 'calm': // half-lidded: a heavy lid over a low pupil
      return pair((x) => (
        <g key={x}>
          <path d={`M${x - 3} 48.6Q${x} 47.3 ${x + 3} 48.6`} {...s} />
          <circle cx={x + 0.3} cy="50" r={r * 0.95} fill={INK} />
        </g>
      ))
    case 'closed': // eyes shut, somewhere in a chorus
      return pair((x) => <path key={x} d={`M${x - 2.8} 48.4Q${x} 51 ${x + 2.8} 48.4`} {...s} />)
    case 'smile': // grinning eyes
      return pair((x) => <path key={x} d={`M${x - 2.8} 50.2Q${x} 46.9 ${x + 2.8} 50.2`} {...s} />)
    case 'side': // looking past the window
      return pair((x) => (
        <g key={x}>
          <path d={`M${x - 2.8} 47.6Q${x} 46.5 ${x + 2.9} 47.8`} {...s} strokeWidth={w(k, 1.1)} />
          <circle cx={x + 1.5} cy="49.4" r={r} fill={INK} />
        </g>
      ))
    case 'down': // reading
      return pair((x) => (
        <g key={x}>
          <path d={`M${x - 2.6} 49Q${x} 48.2 ${x + 2.6} 49`} {...s} strokeWidth={w(k, 1.1)} />
          <circle cx={x} cy="50.5" r={r * 0.9} fill={INK} />
        </g>
      ))
    case 'up': // somewhere else entirely
      return pair((x) => <circle key={x} cx={x - 0.9} cy="47.8" r={r} fill={INK} />)
    default:
      return pair((x) => (
        <g key={x}>
          <ellipse cx={x} cy="48.9" rx={r} ry={r * 1.25} fill={INK} />
          {k.icon ? null : <circle cx={x + 0.5} cy="48.3" r="0.45" fill="#fff" />}
        </g>
      ))
  }
}
function Brows({ k, d, color = INK }: { k: K; d: [string, string]; color?: string }) {
  return (
    <>
      <path d={d[0]} fill="none" stroke={color} strokeWidth={w(k, 1.5)} strokeLinecap="round" />
      <path d={d[1]} fill="none" stroke={color} strokeWidth={w(k, 1.5)} strokeLinecap="round" />
    </>
  )
}
const BROWS = {
  level: ['M40.2 43.4Q43.4 42.2 46.4 43.2', 'M53.6 43.2Q56.6 42.2 59.8 43.4'] as [string, string],
  raised: ['M40.2 42.4Q43.4 40.6 46.4 42', 'M53.6 42Q56.6 40.6 59.8 42.4'] as [string, string],
  focus: ['M40.4 42.6Q43.6 42.4 46.6 43.8', 'M53.4 43.8Q56.4 42.4 59.6 42.6'] as [string, string],
  cocky: ['M40.2 43.2Q43.4 42.4 46.4 43.4', 'M53.6 41.6Q56.8 39.8 59.8 41.4'] as [string, string],
  soft: ['M40.4 43.6Q43.4 42.6 46.2 43.4', 'M53.8 43.4Q56.6 42.6 59.6 43.6'] as [string, string],
}
function Mouth({ k, d, fill }: { k: K; d: string; fill?: string }) {
  return <path d={d} fill={fill ?? 'none'} stroke={INK} strokeWidth={w(k, 1.3)} strokeLinecap="round" strokeLinejoin="round" />
}

/** A little paper grain over the whole drawing, at large sizes only. */
function Grain({ k }: { k: K }) {
  if (k.icon) return null
  return (
    <>
      <filter id={`${k.u}-grain`} x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" />
        <feColorMatrix values="0 0 0 0 0.13  0 0 0 0 0.1  0 0 0 0 0.08  0 0 0 0.55 0" />
        <feComposite in2="SourceGraphic" operator="in" />
      </filter>
      <rect width="100" height="100" filter={`url(#${k.u}-grain)`} opacity="0.2" style={{ mixBlendMode: 'multiply' }} />
    </>
  )
}

// ── The eight ────────────────────────────────────────────────────────────────────────────────

function Kape({ k, bare }: { k: K; bare?: boolean }) {
  return (
    <>
      {/* Chin-length, wavy, not recently negotiated with. */}
      <path d="M30.8 53C27.4 37 34.4 24.2 49 23.2C63.6 22.2 73.6 31.4 70.6 46.6C69.6 52.6 68.4 58.4 66.6 63.2C64.6 58 64 53 63.8 48.6L36.4 48.6C36 53.4 34.8 58.4 32.6 63C31.8 60 31.2 56.6 30.8 53Z" fill={k.p.hair} />
      <path d="M8 100C10 86.5 22 78.4 38.5 75.6L61.5 75.6C78 78.4 90 86.5 92 100Z" fill="#ece2cf" />
      {/* A loose linen shirt, collar open. */}
      <path d="M38.5 75.6L50 88L61.5 75.6L66 77L58 94L50 88L42 94L34 77Z" fill="#d6c7ab" />
      <path d="M43.4 75.2L50 83L56.6 75.2" fill={k.p.skin} />
      <Neck k={k} />
      <Head k={k} />
      <g className="kape-fig-brows">
        <Brows k={k} d={BROWS.level} />
      </g>
      <Eyes k={k} kind="calm" />
      <Nose k={k} />
      <Cheeks k={k} o={0.14} />
      <Mouth k={k} d="M46 59.8Q49.6 61.2 54 59.2" />
      <path d="M33.2 45.6C33 33.6 40.4 26.4 50 26.4C60 26.4 67.2 33 67 43.4C64.4 40.6 61.8 38.2 58.2 37.2C58.8 40 58 42 56 43.2C55.2 39.6 52.4 37.4 48.4 37.2C47.6 40.2 44.8 42.2 41.4 42.2C42.2 40.4 42.2 38.6 41.4 37.4C37.8 39.2 35.2 42 33.2 45.6Z" fill={k.p.hair} />
      <path d="M48.6 26.8C49.4 22 53.8 20.4 56.8 21.8C53.8 22.8 52.6 24.6 52.4 27.2Z" fill={k.p.hair} />
      {/* Waves that have given up on being combed. Drawn large (the scene), they fall as locks over the ears instead. */}
      {bare ? (
        <path d="M33.6 37.6C29.8 44 29.4 52.4 31.4 60.4C32.8 63.2 35.8 62.6 36.6 60C35.6 54.2 36 47.4 38 41ZM66.4 37.6C70.2 44 70.6 52.4 68.6 60.4C67.2 63.2 64.2 62.6 63.4 60C64.4 54.2 64 47.4 62 41Z" fill={k.p.hair} />
      ) : (
        <path d="M33.4 50c-2.6 3.4-2.2 7.2.4 10.4M36 52.4c-1.8 3-1 6 1.2 8.2M66.6 50c2.6 3.4 2.2 7.2-.4 10.4M64 52.4c1.8 3 1 6-1.2 8.2" fill="none" stroke={k.p.hair} strokeWidth={w(k, 2.6)} strokeLinecap="round" />
      )}
      <path d="M45.6 37.6c-1.6 2.8-.8 5.6 1.6 6.8" fill="none" stroke={k.p.hair} strokeWidth={w(k, 2.2)} strokeLinecap="round" />
      {k.icon ? null : <path d="M44 31.6C47 30.2 52 30 55 31.4M38.2 36C40 34 42 33 44 32.6M60 34.4c2.2 1.4 3.8 3.4 4.6 5.6" stroke={k.p.hairShade} strokeWidth="1.1" fill="none" strokeLinecap="round" />}
      {/* The mug, held close, going nowhere. */}
      {bare ? null : <g>
        <path d="M55.2 76.4h17.4v14.2c0 3.6-2.8 6.2-6.2 6.2h-5c-3.4 0-6.2-2.6-6.2-6.2Z" fill="#f6f1e8" stroke={INK} strokeWidth={w(k, 1.1)} />
        <path d="M72.6 79.4c4.4 0 6.2 2.2 6.2 5s-2 5-6.2 5" fill="none" stroke={INK} strokeWidth={w(k, 1.6)} />
        <path d="M55.2 81.6h17.4" stroke="#b5652f" strokeWidth={w(k, 2.2)} />
        <ellipse cx="63.9" cy="76.4" rx="8.7" ry="1.8" fill="#5a3522" />
        <path d="M51.6 84.6c2.4-2.2 5-2.4 6.4-.8 1 1.4.4 3.4-1.2 4.6-2.4 1.6-5 1.4-6.6.2Z" fill={k.p.skin} />
        <path d="M76.6 90.4c-1.6-2.2-3.8-2.6-5.2-1.4-1.2 1-1 3.2.6 4.4 1.8 1.4 3.8 1.2 4.8.2Z" fill={k.p.skin} />
        {k.icon ? null : <path d="M61.4 72.6c-1.6-2 1.4-3.4-.2-5.4M66.2 72.8c-1.6-2 1.4-3.4-.2-5.4" fill="none" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" opacity="0.85" />}
      </g>}
    </>
  )
}

function Guhit({ k }: { k: K }) {
  const curls: [number, number, number][] = [
    [31.4, 44.6, 5], [29.4, 51.8, 5], [31.4, 58.6, 4.6], [68.6, 44.6, 5], [70.6, 51.8, 5], [68.6, 58.6, 4.6], [37.6, 29.4, 5.4], [45, 24.6, 5.6], [53.6, 23.8, 5.6], [61.8, 27.4, 5.4], [66.6, 34.8, 5], [33.4, 36.4, 5],
  ]
  return (
    <>
      {curls.map(([cx, cy, r], i) => <circle key={i} cx={cx} cy={cy} r={r} fill={k.p.hair} />)}
      {/* A canvas overshirt, open over a tee, flecked with this week's plans. */}
      <path d="M8 100C10 86.5 22 78.4 38.5 75.6L61.5 75.6C78 78.4 90 86.5 92 100Z" fill="#e7dcc6" />
      <path d="M40 75.6h20l-3 24.4H43Z" fill="#2e2a27" />
      <path d="M38.5 75.6L44 100H36L31 78.2Z" fill="#d4c6ab" />
      <path d="M61.5 75.6L56 100H64L69 78.2Z" fill="#d4c6ab" />
      {(k.icon ? [[22, 88, 2.4, '#3d5aa8']] : [[22, 88, 2.2, '#3d5aa8'], [27, 93, 1.3, '#d9482b'], [74, 86, 1.8, '#e3b23c'], [78.5, 92, 1.2, '#3d5aa8'], [17, 95, 1.4, '#e3b23c']]).map(([cx, cy, r, c], i) => (
        <circle key={i} cx={cx as number} cy={cy as number} r={r as number} fill={c as string} />
      ))}
      <Neck k={k} />
      {/* The pencil, filed behind an ear for later. */}
      <g transform="rotate(-34 66 44)">
        <rect x="60" y="42.6" width="19" height="3.2" rx="0.6" fill="#e3b23c" stroke={INK} strokeWidth={w(k, 0.7)} />
        <path d="M79 42.6l3.8 1.6-3.8 1.6Z" fill="#f2dcb3" stroke={INK} strokeWidth={w(k, 0.7)} />
        <rect x="57.6" y="42.6" width="2.6" height="3.2" fill="#c96a5b" stroke={INK} strokeWidth={w(k, 0.7)} />
      </g>
      <Head k={k} />
      <Brows k={k} d={BROWS.focus} />
      <Eyes k={k} kind="open" />
      <Nose k={k} />
      <Cheeks k={k} tone="#b8543e" o={0.2} />
      <Mouth k={k} d="M44.6 57.8Q50 65 55.6 57.8Q50 59.6 44.6 57.8Z" fill="#fff" />
      {/* Bandana: vermilion, white dots, knotted on top. */}
      <path d="M32.6 42C32 30.6 40 24.4 50 24.4C60 24.4 68 30.6 67.4 42C61.8 38.6 56.4 37.2 50 37.2C43.6 37.2 38.2 38.6 32.6 42Z" fill="#d9482b" />
      {k.icon ? null : [[40, 32], [47, 29], [54, 29.4], [61, 32.4], [44, 35], [57, 35.2], [36.4, 37.6], [63.4, 37.6]].map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r="0.9" fill="#fff" opacity="0.9" />)}
      <path d="M60 25.6c3.4-4 8.2-4.4 9.4-1.6-2.2.2-4 1.2-5.4 3Z" fill="#b83a21" />
      <path d="M61.6 27c4.6-1.2 8.6.8 8.2 3.6-2-.8-4.2-.8-6.4 0Z" fill="#b83a21" />
      <circle cx="60.6" cy="27.4" r="2.2" fill="#b83a21" />
    </>
  )
}

function Biyahe({ k }: { k: K }) {
  return (
    <>
      <path d="M32 50C29.6 35 37.6 25 50 25C62.6 25 70.6 33.2 69.2 47L66 45.4L36 46.4C35.2 47.6 34.8 48.8 34.6 50Z" fill={k.p.hair} />
      {/* A tee, and the strap of a bag that has seen every route. */}
      <path d="M8 100C10 86.5 22 78.4 38.5 75.6L61.5 75.6C78 78.4 90 86.5 92 100Z" fill="#e2dbcc" />
      <path d="M40.6 75.4C43 79 46.4 80.6 50 80.6C53.6 80.6 57 79 59.4 75.4" fill="none" stroke="#c9bfad" strokeWidth={w(k, 1.6)} />
      <path d="M24 80.4L31 77.6L78 100H63.6Z" fill="#3b3029" />
      {k.icon ? null : <rect x="50.6" y="89" width="7" height="5.2" rx="1" transform="rotate(26 54 91.6)" fill="none" stroke="#b9a27a" strokeWidth="1.3" />}
      <Neck k={k} />
      <Head k={k} square />
      <Brows k={k} d={BROWS.soft} />
      <Eyes k={k} kind="side" />
      <Nose k={k} />
      <Cheeks k={k} o={0.18} />
      <Mouth k={k} d="M46.6 60.2Q50 59.4 53.6 60" />
      {/* Straight hair, blown sideways by an open window. */}
      <path d="M33.6 43.6C34.4 31.6 42 26 51.4 26C59.8 26 66 29 70.2 33.6L76 31.4L71.6 36.2C72.8 37.4 73.4 39 73.2 41L68.6 38.4C64.2 37.4 59 38.4 53.4 41L56 35.8C49.6 39 42.6 41.2 37.4 45.2C36 44.4 34.8 44 33.6 43.6Z" fill={k.p.hair} />
      <path d="M68 27.6L78.4 25.4L73 30.2Z M66.2 24.4L73.8 20.6L70.4 26Z" fill={k.p.hair} />
      {k.icon ? null : <path d="M42 34.4C47 31.4 55 30.6 62 32.6M45.8 38.4C50 36 55 35 59.4 35.4" stroke={k.p.hairShade} strokeWidth="1.1" fill="none" strokeLinecap="round" />}
    </>
  )
}

function Bola({ k }: { k: K }) {
  const braid = (x0: number, dx: number) =>
    Array.from({ length: 7 }, (_, i) => <ellipse key={i} cx={x0 + dx * i} cy={47 + i * 4.6} rx="2.9" ry="3" fill={i % 2 ? k.p.hair : (k.p.hairShade ?? k.p.hair)} />)
  return (
    <>
      {braid(33.2, -0.9)}
      {braid(66.8, 0.9)}
      {braid(36.8, -0.5)}
      {braid(63.2, 0.5)}
      {/* An original jersey: court green, cream trim, and a number that means nothing. */}
      <path d="M8 100C10 86.5 22 78.4 38.5 75.6L61.5 75.6C78 78.4 90 86.5 92 100Z" fill={k.p.skin} />
      <path d="M24.6 100C26 90 27 83 30.2 78.4L38.6 76L50 87L61.4 76L69.8 78.4C73 83 74 90 75.4 100Z" fill="#1f5c4f" />
      <path d="M38.6 76L50 87L61.4 76" fill="none" stroke="#f2e8d5" strokeWidth={w(k, 2.2)} strokeLinejoin="round" />
      <path d="M30.2 78.4C27 83 26 90 24.6 100M69.8 78.4C73 83 74 90 75.4 100" fill="none" stroke="#f2e8d5" strokeWidth={w(k, 1.8)} />
      {k.icon ? null : (
        <g fill="none" stroke="#f2e8d5" strokeWidth="2.2">
          <circle cx="50" cy="92.4" r="2.6" />
          <circle cx="50" cy="97.6" r="3" />
        </g>
      )}
      <Neck k={k} />
      <Head k={k} />
      <Brows k={k} d={BROWS.cocky} />
      <Eyes k={k} kind="smile" />
      <Nose k={k} />
      <Mouth k={k} d="M43.4 56.8Q50 66.4 56.6 56.8Z" fill={INK} />
      <path d="M44.6 57.3Q50 59.4 55.4 57.3L55 58.6Q50 60.6 45 58.6Z" fill="#fff" />
      {/* Braided close at the top, under a headband. */}
      <path d="M33.4 45C33 31.4 41 25.2 50 25.2C59 25.2 67 31.4 66.6 45L63.8 41.6C62.4 36.6 57 34.4 50 34.4C43 34.4 37.6 36.6 36.2 41.6Z" fill={k.p.hair} />
      {k.icon ? null : <path d="M43.6 26.6C45 29.6 45.6 32 45.4 34.6M50 25.4V34.4M56.4 26.6C55 29.6 54.4 32 54.6 34.6" stroke={k.p.hairShade} strokeWidth="1" fill="none" />}
      <path d="M33.2 38.6C39 34.6 61 34.6 66.8 38.6L67 43.4C61 39.6 39 39.6 33 43.4Z" fill="#f2ede2" />
      <path d="M33.1 40.8C39 37 61 37 66.9 40.8" fill="none" stroke="#1f5c4f" strokeWidth={w(k, 1.3)} />
    </>
  )
}

function Pahina({ k }: { k: K }) {
  return (
    <>
      {/* A cardigan in bookcloth green over a cream tee. */}
      <path d="M8 100C10 86.5 22 78.4 38.5 75.6L61.5 75.6C78 78.4 90 86.5 92 100Z" fill="#2f4a3a" />
      <path d="M40.4 75.4L50 100L59.6 75.4C57 78.4 53.6 80 50 80C46.4 80 43 78.4 40.4 75.4Z" fill="#efe6d2" />
      <path d="M40.4 75.4L50 100M59.6 75.4L50 100" stroke="#243a2d" strokeWidth={w(k, 1.4)} />
      {k.icon ? null : [86, 92.4].map((y) => <circle key={y} cx={50 + (y - 80) * 0.02 + 5.6} cy={y} r="1.1" fill="#d9c7a0" />)}
      <Neck k={k} />
      <Head k={k} square />
      {/* Short silver hair, parted, a little longer than planned. */}
      <path d="M33.4 45.4C32.6 32.4 40.4 25.6 50 25.6C60.4 25.6 67.6 32.6 66.6 45.4L64.8 40.6C63 36.4 58.2 34.2 53.2 34.8C49.2 33.8 43.2 34.6 38.8 37.8C36.4 39.8 34.6 42.4 33.4 45.4Z" fill={k.p.hair} />
      <path d="M53.2 34.8C55.6 31.4 60.8 30 64.6 32.6" fill="none" stroke={k.p.hairShade} strokeWidth={w(k, 1.2)} strokeLinecap="round" />
      <path d="M33.6 45.6L34.6 52.4L36.4 48Z M66.4 45.6L65.4 52.4L63.6 48Z" fill={k.p.hairShade} />
      <Brows k={k} d={BROWS.soft} color="#8e8e88" />
      <Eyes k={k} kind="down" />
      {/* Round glasses. */}
      <g fill="none" stroke={INK} strokeWidth={w(k, 1.1)}>
        <circle cx="43.4" cy="49.6" r="4.8" />
        <circle cx="56.6" cy="49.6" r="4.8" />
        <path d="M48.2 49.2Q50 48 51.8 49.2M38.6 48.8L34.6 47.6M61.4 48.8L65.4 47.6" />
      </g>
      <Nose k={k} />
      {k.icon ? null : <path d="M36.8 52.6L35.2 53.6M63.2 52.6L64.8 53.6M44.6 62.6Q50 64.6 55.4 62.6" stroke={k.p.shade} strokeWidth="0.9" fill="none" strokeLinecap="round" />}
      <Mouth k={k} d="M47.2 60Q50 60.8 52.8 60" />
      {/* The book, held close. */}
      <g transform="rotate(-9 32 88)">
        <rect x="15" y="79" width="30" height="23" rx="1.6" fill="#c8913a" stroke={INK} strokeWidth={w(k, 1)} />
        <rect x="17.4" y="79" width="27.6" height="2.6" fill="#f3ead6" />
        {k.icon ? null : <path d="M20 87.6h14M20 91h10" stroke="#8a5f22" strokeWidth="1.2" strokeLinecap="round" />}
        <path d="M38.6 79v9.4l2-1.6 2 1.6V79" fill="#6e2d2a" />
      </g>
      <path d="M40.6 88.4c2.8-2.2 6-2 7.2-.2 1 1.6.2 3.6-1.8 4.6-2.8 1.4-5.6.8-6.6-.8Z" fill={k.p.skin} />
    </>
  )
}

function Himig({ k }: { k: K }) {
  return (
    <>
      {/* A deep green overshirt, open over a cream tee. */}
      <path d="M8 100C10 86.5 22 78.4 38.5 75.6L61.5 75.6C78 78.4 90 86.5 92 100Z" fill="#1d4d3f" />
      <path d="M41 75.6C43 80 46.4 82.6 50 82.6C53.6 82.6 57 80 59 75.6L57.6 100H42.4Z" fill="#f1ebe0" />
      <path d="M41 75.6L38.2 100M59 75.6L61.8 100" stroke="#153a2f" strokeWidth={w(k, 1.4)} />
      <Neck k={k} />
      {/* Tilted into the chorus. */}
      <g transform="rotate(-7 50 64)">
        <Head k={k} />
        {/* Undercut: close sides, a tall textured top. */}
        <path d="M34.2 47.4C33.6 42 34.2 38.6 36 36.2L38.4 42.4C36.8 44 35.4 45.6 34.2 47.4ZM65.8 47.4C66.4 42 65.8 38.6 64 36.2L61.6 42.4C63.2 44 64.6 45.6 65.8 47.4Z" fill={k.p.hairShade} opacity="0.9" />
        <path d="M36 39.2C34.4 27.4 42.6 19.6 52.6 20.4C62.4 21.2 67.8 28.4 65.2 38.6C61.4 35.2 56 34 50.6 35C46 35.6 40.8 37 36 39.2Z" fill={k.p.hair} />
        {k.icon ? null : <path d="M41.6 30C44.6 25.6 50 23.6 55.4 24.4M45 33.6C48 30 53.4 28.6 58.6 29.6M52.4 21.4C57 21.2 61.8 23.6 63.6 27.6" stroke={k.p.hairShade} strokeWidth="1.1" fill="none" strokeLinecap="round" />}
        <Brows k={k} d={BROWS.raised} />
        <Eyes k={k} kind="closed" />
        <Nose k={k} />
        <Cheeks k={k} o={0.2} />
        <ellipse cx="50.4" cy="60.2" rx={k.icon ? 2.6 : 2.1} ry={k.icon ? 3 : 2.7} fill={INK} />
        {/* Headphones: the band, and two cups with a tomato rim. */}
        <path d="M32 48C31 30 39 19.4 50 19.4C61 19.4 69 30 68 48" fill="none" stroke="#16161a" strokeWidth={w(k, 3.4)} strokeLinecap="round" />
        <rect x="27.2" y="42.2" width="9.4" height="15.6" rx="4.4" fill="#16161a" />
        <rect x="63.4" y="42.2" width="9.4" height="15.6" rx="4.4" fill="#16161a" />
        <rect x="29.2" y="45" width="5.4" height="10" rx="2.7" fill="#c2412d" />
        <rect x="65.4" y="45" width="5.4" height="10" rx="2.7" fill="#c2412d" />
      </g>
      {k.icon ? null : (
        <g fill={INK}>
          <path d="M78 30.4v8.2a2.4 2 0 1 1-1.4-1.8v-9Z" />
          <path d="M82.6 20.4l5 -1.4v6.6a2.2 1.8 0 1 1-1.2-1.6v-3.2l-2.6.8v4.2a2.2 1.8 0 1 1-1.2-1.6Z" />
        </g>
      )}
    </>
  )
}

function Porma({ k }: { k: K }) {
  return (
    <>
      {/* A sheer, barong-inspired shirt over a plain undershirt; an invented embroidery panel. */}
      <path d="M8 100C10 86.5 22 78.4 38.5 75.6L61.5 75.6C78 78.4 90 86.5 92 100Z" fill="#fbf8f2" />
      <path d="M8 100C10 86.5 22 78.4 38.5 75.6L61.5 75.6C78 78.4 90 86.5 92 100Z" fill="#e9dfcb" opacity="0.72" />
      <path d="M41.4 76.6C43.6 80 46.6 81.4 50 81.4C53.4 81.4 56.4 80 58.6 76.6" fill="none" stroke="#fff" strokeWidth={w(k, 1.6)} opacity="0.9" />
      <path d="M43.2 81.4H56.8L55 100H45Z" fill="#f7f1e3" />
      {k.icon ? null : (
        <g stroke="#bfae8c" strokeWidth="0.7" fill="none" opacity="0.95">
          <path d="M44.2 83.6L50 89.4L55.8 83.6M44.6 89.6L50 95L55.4 89.6M45 95.4L50 100.6L55 95.4" />
          <path d="M50 83.6V100M44.6 86.4H55.4M45 92.2H55M45.2 98H54.8" opacity="0.55" />
          <circle cx="50" cy="86.4" r="0.8" fill="#bfae8c" />
          <circle cx="50" cy="92.2" r="0.8" fill="#bfae8c" />
        </g>
      )}
      <path d="M38.4 75.4L44 84.6L50 78.6L56 84.6L61.6 75.4L57.4 74.2L50 78.6L42.6 74.2Z" fill="#f4eee1" stroke="#cdbf9f" strokeWidth={w(k, 0.8)} strokeLinejoin="round" />
      <Neck k={k} />
      <Head k={k} square />
      <Brows k={k} d={BROWS.raised} />
      <Eyes k={k} kind="up" />
      <Nose k={k} />
      <Cheeks k={k} o={0.16} />
      <Mouth k={k} d="M46.6 59.6Q50 61.2 53.6 59.4" />
      {/* Swept back and up. Every hair has been briefed. */}
      <path d="M33.6 45C32.4 33 38.6 25 48 23.6C58.4 22 67.4 28.6 66.8 42.4L64.8 38C62.6 33.4 57.6 31 51 31.4C44.6 31.8 39.2 34.6 36 40.4C35 41.8 34.2 43.4 33.6 45Z" fill={k.p.hair} />
      <path d="M36.8 36.6C38.4 26.4 46 20 55.6 20.4C62 20.6 66.4 24.6 67.4 30C62 25.6 55.2 24.8 48.8 26.8C43.8 28.4 39.8 31.8 36.8 36.6Z" fill={k.p.hair} />
      {k.icon ? null : (
        <>
          <path d="M41.4 29.8C45.6 25.6 52.4 23.6 58.8 24.4" stroke={k.p.hairShade} strokeWidth="1.3" fill="none" strokeLinecap="round" />
          {/* The shine of a man who owns a comb for each day of the week. */}
          <path d="M44 27.2C47.6 24.4 52 23.2 56 23.4" stroke="#fff" strokeWidth="1.1" fill="none" strokeLinecap="round" opacity="0.45" />
        </>
      )}
      <path d="M33.8 45.2L34.6 51.8L36.2 46.6Z M66.2 45.2L65.4 51.8L63.8 46.6Z" fill={k.p.hair} />
    </>
  )
}

function Sibol({ k }: { k: K }) {
  const leaf = (x: number, y: number, r: number, s = 1) => (
    <path key={`${x}-${y}`} transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`} d="M0 0C-3.6-1.6-5.4-5.4-3.6-8.2-2.2-10.2 0-9.4 0-7.6 0-9.4 2.2-10.2 3.6-8.2 5.4-5.4 3.6-1.6 0 0Z" fill="#4c7a45" stroke="#35572f" strokeWidth={w(k, 0.5)} />
  )
  return (
    <>
      {/* The bun and its leaf clip. */}
      <circle cx="58.4" cy="22.6" r="8" fill={k.p.hair} />
      <path d="M52 18.6C55 15 61.4 14.6 64.4 18" fill="none" stroke={k.p.hairShade} strokeWidth={w(k, 1.1)} />
      <path d="M31.6 54C29.4 40 36 28 49.6 27C63.4 26 71 36.2 68.6 50.4C67.2 47 66 44.6 64.2 42.8L36.2 43.4C34 46.2 32.6 50 31.6 54Z" fill={k.p.hair} />
      {/* A linen blouse; the pothos has made itself at home on one shoulder. */}
      <path d="M8 100C10 86.5 22 78.4 38.5 75.6L61.5 75.6C78 78.4 90 86.5 92 100Z" fill="#e6d6bf" />
      <path d="M40.6 75.4L50 87.4L59.4 75.4" fill={k.p.skin} />
      <path d="M40.6 75.4L50 87.4L59.4 75.4" fill="none" stroke="#cdb897" strokeWidth={w(k, 1.2)} />
      <Neck k={k} />
      <Head k={k} />
      <Brows k={k} d={BROWS.soft} />
      <Eyes k={k} kind="open" />
      <Nose k={k} />
      <Cheeks k={k} tone="#c9705a" o={0.24} />
      <Mouth k={k} d="M46 58.8Q50 62.2 54 58.8" />
      {k.icon ? null : <path d="M59.6 57.2c1.4-.6 2.6-.2 3.2.8" stroke="#4a2e1c" strokeWidth="1.1" fill="none" strokeLinecap="round" opacity="0.6" />}
      {/* Loose waves, pinned up, a few escaping to frame the face. */}
      <path d="M33 47.4C32.4 34.6 40.2 27.4 50 27.4C60.4 27.4 67.8 34.4 67 47C64.8 42 61.4 38.4 56.4 37.4C51.4 39.8 45 40 40.4 38.2C37 40.6 34.8 43.6 33 47.4Z" fill={k.p.hair} />
      <path d="M36.2 44C34.8 48.6 36.6 51.6 35.2 56.4M63.8 44C65.4 48.4 63.4 52 65.2 56.6" fill="none" stroke={k.p.hair} strokeWidth={w(k, 2)} strokeLinecap="round" />
      {leaf(63.6, 17.4, 38, k.icon ? 1 : 0.8)}
      {/* Pothos, trailing over the left shoulder. */}
      <path d="M6 64C14 70 18 80 26 84C30 86 34 85.6 36.4 83" fill="none" stroke="#35572f" strokeWidth={w(k, 1.2)} />
      {(k.icon ? [[14, 71, -40, 1.1], [27, 85, -110, 1.1]] : [[10, 67, -30, 1], [16, 74, -60, 1.1], [22, 81, -85, 1], [29, 85.4, -120, 0.9], [35, 83.6, -150, 0.8]]).map(([x, y, r, s]) => leaf(x, y, r, s))}
    </>
  )
}

const DRAW: Record<AvatarId, (p: { k: K }) => ReactNode> = { kape: Kape, guhit: Guhit, biyahe: Biyahe, bola: Bola, pahina: Pahina, himig: Himig, porma: Porma, sibol: Sibol }

/**
 * Kape with both hands free — the portrait's drawing without the mug — for the café scene
 * (worlds/kape/Stir.tsx), in the portrait's 100×100 units. The brows are one group, for the pause.
 */
export function KapeFigure() {
  const k: K = { icon: false, p: PAL.kape, u: 'kape-fig' }
  return <Kape k={k} bare />
}

/**
 * A character's portrait in its round frame. `size` in CSS pixels picks the cut: under 56px, the
 * icon (cropped to the head, heavier features); from 56px, the bust.
 */
export function Portrait({ id, size = 64, className }: { id: AvatarId; size?: number; className?: string }) {
  const u = `p${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const icon = size < 56
  const k: K = { icon, p: PAL[id], u }
  const Draw = DRAW[id]
  // The icon cut: a tighter circle around the head.
  const view = icon ? { x: 16, y: 13, s: 68 } : { x: 0, y: 0, s: 100 }
  const c = { cx: view.x + view.s / 2, cy: view.y + view.s / 2, r: view.s / 2 }
  return (
    <svg className={className} width={size} height={size} viewBox={`${view.x} ${view.y} ${view.s} ${view.s}`} aria-hidden focusable="false" data-portrait={id}>
      <defs>
        <clipPath id={`${u}-c`}>
          <circle cx={c.cx} cy={c.cy} r={c.r} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${u}-c)`}>
        <rect x={view.x} y={view.y} width={view.s} height={view.s} fill={PAL[id].bg} />
        <Draw k={k} />
        <Grain k={k} />
      </g>
    </svg>
  )
}
