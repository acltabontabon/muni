/**
 * Pahina — a private reading room. Everything sits on a book's measure, centred: a small chapter
 * line for the sprint, the question, a spacious field, and then the thoughts typeset as short
 * entries in a personal anthology, their dates in the margin on a wide screen. A ribbon marks the
 * page. No page turns, no two-page spread.
 */
import type { RoomDef, RoomSlots } from '../room'

/** The ribbon bookmark, hanging from the top of the page. */
function Ribbon() {
  return (
    <svg className="pahina-ribbon" viewBox="0 0 16 84" aria-hidden focusable="false">
      <path d="M0 0h16v84l-8-7-8 7Z" />
    </svg>
  )
}

function PahinaPage({ bar, context, writing, collection, extras, notices }: RoomSlots) {
  return (
    <div className="pahina-room">
      <div className="pahina-page">
        <Ribbon />
        {notices}
        {/* A chapter opener: the sprint's title, and its contents. */}
        <div className="pahina-chapter">{bar ?? context}</div>
        {writing}
      </div>
      <div className="pahina-anthology">
        {collection}
        {extras}
      </div>
    </div>
  )
}

export const PAHINA: RoomDef = { Page: PahinaPage }
