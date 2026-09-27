/**
 * The barangay master plan: Guhit's lore, drawn on the desk. "Opened a notebook to process one
 * feeling. Accidentally drafted a barangay master plan." Each thought in the collection adds the
 * next unnecessarily ambitious thing — a room, a house, a road, a court (priority), the hall, a
 * mural (phase 2) — and a pencilled ghost shows what the next one will become.
 *
 * Decoration that answers the collection: aria-hidden (the count is already in "My thoughts").
 * Still, except once: what a save adds during this visit inks itself in, then stays put.
 */
import { useState, type ReactNode } from 'react'
import { clsx } from 'clsx'

const HAND = "'Caveat Variable', 'Caveat', cursive"

type Piece = { at: number; name: string; draw: ReactNode }

function Note({ x, y, children, size = 15, rotate = 0 }: { x: number; y: number; children: ReactNode; size?: number; rotate?: number }) {
  return (
    <text x={x} y={y} fontFamily={HAND} fontSize={size} className="guhit-p-note" transform={rotate ? `rotate(${rotate} ${x} ${y})` : undefined}>
      {children}
    </text>
  )
}

/** In order of ambition. `at`: how many thoughts it takes. */
const PIECES: Piece[] = [
  {
    at: 1,
    name: 'a room',
    draw: (
      <>
        <path className="guhit-p-hi" d="M104 74c12-4 22-4 32 0M131 69l6 5-7 3" pathLength={1} />
        <path className="guhit-p-line" d="M150 56h70v54h-70zM150 84h8M168 84h0" pathLength={1} />
        <path className="guhit-p-thin" d="M158 84a10 10 0 0 1 10-10" pathLength={1} />
        <Note x={156} y={128}>a room</Note>
      </>
    ),
  },
  {
    at: 2,
    name: 'another room (why not)',
    draw: (
      <>
        <path className="guhit-p-line" d="M220 56h46v54h-46M232 110v-12" pathLength={1} />
        <Note x={226} y={128} size={13}>+ one more</Note>
      </>
    ),
  },
  {
    at: 3,
    name: 'a whole house',
    draw: (
      <>
        <path className="guhit-p-line" d="M142 58l62-34 70 34" pathLength={1} />
        <path className="guhit-p-thin" d="M244 36v-12h10v17" pathLength={1} />
        <Note x={282} y={34} size={14} rotate={-4}>it's a house now</Note>
      </>
    ),
  },
  {
    at: 4,
    name: 'a main road',
    draw: (
      <>
        <path className="guhit-p-line" d="M24 150h486M24 178h486" pathLength={1} />
        <path className="guhit-p-thin guhit-p-dash" d="M30 164h474" />
        <Note x={30} y={144} size={14}>main road (needed)</Note>
      </>
    ),
  },
  {
    at: 5,
    name: 'trees and a neighbour',
    draw: (
      <>
        <path className="guhit-p-thin" d="M300 96c-9 0-12-10-5-15-3-8 6-14 12-9 5-6 15-2 13 6 7 3 5 14-3 14-3 5-12 6-17 4Z" pathLength={1} />
        <path className="guhit-p-thin" d="M309 110v-12" pathLength={1} />
        <path className="guhit-p-line" d="M338 72h40v38h-40zM334 74l24-18 24 18" pathLength={1} />
        <Note x={318} y={128} size={13}>neighbour (consulted)</Note>
      </>
    ),
  },
  {
    at: 6,
    name: 'a basketball court',
    draw: (
      <>
        <path className="guhit-p-line" d="M404 44h104v66h-104zM456 44v66" pathLength={1} />
        <circle className="guhit-p-thin" cx="456" cy="77" r="11" pathLength={1} />
        <path className="guhit-p-thin" d="M404 64h14v26h-14M508 64h-14v26h14" pathLength={1} />
        <circle className="guhit-p-hi-fill" cx="440" cy="92" r="3.2" />
        <Note x={456} y={128} size={14}>court (priority)</Note>
      </>
    ),
  },
  {
    at: 8,
    name: 'a sari-sari store',
    draw: (
      <>
        <path className="guhit-p-line" d="M36 204h64v48h-64z" pathLength={1} />
        <path className="guhit-p-awning" d="M32 204l6-12h60l6 12z" />
        <path className="guhit-p-thin" d="M46 222h44v10h-44z" pathLength={1} />
        <Note x={34} y={270} size={14}>sari-sari store</Note>
      </>
    ),
  },
  {
    at: 10,
    name: 'the barangay hall',
    draw: (
      <>
        <path className="guhit-p-line" d="M126 214h120v42h-120zM120 214l66-18 66 18" pathLength={1} />
        <path className="guhit-p-thin" d="M146 222v28M166 222v28M206 222v28M226 222v28M178 256v-16h16v16" pathLength={1} />
        <path className="guhit-p-thin" d="M186 196v-18" pathLength={1} />
        <path className="guhit-p-flag" d="M186 178l14 4-14 4z" />
        <Note x={140} y={276} size={14}>barangay hall (ours)</Note>
      </>
    ),
  },
  {
    at: 12,
    name: 'a mural (phase 2)',
    draw: (
      <>
        <path className="guhit-p-line" d="M272 212h124v42h-124z" pathLength={1} />
        <circle cx="298" cy="234" r="11" className="guhit-p-paint-y" />
        <path d="M322 254c6-18 22-28 44-30v30z" className="guhit-p-paint-b" />
        <path d="M278 246c12-9 22-9 34-1" className="guhit-p-paint-r" />
        <Note x={280} y={276} size={14}>mural (phase 2)</Note>
      </>
    ),
  },
  {
    at: 15,
    name: 'a jeepney route',
    draw: (
      <>
        <path className="guhit-p-route" d="M24 170C140 168 240 158 340 166s150 4 180-8c36-14 60-50 100-58" />
        <g transform="translate(418 150)">
          <path className="guhit-p-line" d="M0 6h40v12h-40zM6 6l4-7h22l4 7" pathLength={1} />
          <circle className="guhit-p-thin" cx="9" cy="20" r="3.4" />
          <circle className="guhit-p-thin" cx="31" cy="20" r="3.4" />
        </g>
        <Note x={560} y={92} size={14} rotate={-8}>jeepney route?</Note>
      </>
    ),
  },
  {
    at: 20,
    name: 'a subcommittee',
    draw: (
      <g transform="rotate(-12 618 150)">
        <circle className="guhit-p-stamp" cx="618" cy="150" r="36" />
        <circle className="guhit-p-stamp" cx="618" cy="150" r="30" />
        <text x="618" y="146" textAnchor="middle" className="guhit-p-stamp-text">SUBCOMMITTEE</text>
        <text x="618" y="160" textAnchor="middle" className="guhit-p-stamp-text">FORMED</text>
      </g>
    ),
  },
  {
    at: 30,
    name: 'a monorail',
    draw: (
      <>
        <path className="guhit-p-line" d="M540 40h160M540 46h160M556 46v28M606 46v28M656 46v28" pathLength={1} />
        <path className="guhit-p-thin" d="M600 28h56a6 6 0 0 1 6 6v6h-68v-6a6 6 0 0 1 6-6z" pathLength={1} />
        <Note x={548} y={24} size={13}>phase 4: monorail. don't ask.</Note>
      </>
    ),
  },
]

export function MasterPlan({ count }: { count: number }) {
  // What was already on the plan when the page opened is simply there; only what a save adds
  // during this visit draws itself in.
  const [base] = useState(count)
  const next = PIECES.find((p) => p.at > count)
  const built = PIECES.filter((p) => p.at <= count).length
  return (
    <div className="guhit-plan" aria-hidden>
      <svg viewBox="0 0 720 300" focusable="false">
        <defs>
          <pattern id="guhit-p-grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M20 0H0V20" className="guhit-p-grid" />
          </pattern>
        </defs>
        <g transform="rotate(-0.8 360 150)">
          <rect x="8" y="10" width="704" height="282" className="guhit-p-paper" />
          <rect x="8" y="10" width="704" height="282" fill="url(#guhit-p-grid)" />
          <rect x="30" y="4" width="46" height="14" className="guhit-p-tape" transform="rotate(-6 53 11)" />
          <rect x="640" y="4" width="46" height="14" className="guhit-p-tape" transform="rotate(5 663 11)" />

          {/* One feeling: where it all started. */}
          <g transform="rotate(-3 68 76)">
            <rect x="40" y="50" width="56" height="50" className="guhit-p-sticky" />
            <path className="guhit-p-thin" d="M48 64h38M48 74h30M48 84h34" />
          </g>
          <Note x={40} y={122}>one feeling</Note>

          {PIECES.filter((p) => p.at <= count).map((p) => (
            <g key={p.at} className={clsx('guhit-p-piece', p.at > base && 'guhit-p-new')}>
              {p.draw}
            </g>
          ))}
          {next ? (
            <g className="guhit-p-ghost">
              {next.draw}
            </g>
          ) : null}

          {/* The title block, as on any serious drawing. */}
          <g className="guhit-p-block">
            <rect x="520" y="222" width="180" height="58" />
            <path d="M520 244h180M620 244v36" />
          </g>
          <text x="530" y="238" className="guhit-p-block-title">BARANGAY MASTER PLAN</text>
          <text x="530" y="263" fontFamily={HAND} fontSize="14" className="guhit-p-note">rev. {count}</text>
          <text x="530" y="276" fontFamily={HAND} fontSize="12" className="guhit-p-note">by Guhit</text>
          <text x="628" y="262" fontFamily={HAND} fontSize="12" className="guhit-p-note">approved:</text>
          <text x="628" y="275" fontFamily={HAND} fontSize="12" className="guhit-p-note">{built >= 6 ? 'pending (hall)' : 'nobody yet'}</text>
          {next ? (
            <Note x={556} y={212} size={14} rotate={-2}>next thought: {next.name}</Note>
          ) : (
            <Note x={540} y={212} size={14} rotate={-2}>complete. (it is never complete.)</Note>
          )}
        </g>
      </svg>
    </div>
  )
}
