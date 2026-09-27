/**
 * The page's scene, in whichever world the person is in: Muni's evening by default, or their
 * character's world. The heading and context lines passed in are the same in every world; the
 * world adds a picture and, where someone is about to write, the day's invitation beside them.
 */
import type { ReactNode } from 'react'
import { JournalScene } from '@/ui/journal'
import { useWorldArt } from './art'
import { invitationFor } from './characters'
import { useWorld } from './world'

export function WorldScene({ children, bubble = false, lights = 0, respond = false, invite = false }: { children: ReactNode; bubble?: boolean; lights?: number; respond?: boolean; invite?: boolean }) {
  const { world, voice } = useWorld()
  const art = useWorldArt(world)
  const Header = art?.Header
  const Title = art?.Title
  return (
    <JournalScene bubble={bubble} lights={lights} respond={respond} world={world} art={Header ? <Header state={{ empty: bubble, done: lights > 0 }} /> : null}>
      {children}
      {invite && voice ? <p className="w-invite">{invitationFor(voice)}</p> : null}
      {Title ? (
        <div className="w-title-slot" aria-hidden>
          <Title />
        </div>
      ) : null}
    </JournalScene>
  )
}

/** A decorative slot beside real content: its world's piece, or nothing. Never wraps content. */
export function WorldSlot({ part }: { part: 'Compose' | 'Collection' | 'Page' }) {
  const { world } = useWorld()
  const art = useWorldArt(world)
  const Piece = art?.[part]
  return Piece ? (
    <div className={`w-slot w-slot--${part.toLowerCase()}`} aria-hidden>
      <Piece />
    </div>
  ) : null
}

/** The empty collection's picture: the world's, or Muni's person in the duyan. */
export function WorldEmptyArt({ fallback }: { fallback: ReactNode }) {
  const { world } = useWorld()
  const art = useWorldArt(world)
  const Empty = art?.Empty
  if (!world) return <>{fallback}</>
  return (
    <div className="w-empty-art" aria-hidden>
      {Empty ? <Empty /> : null}
    </div>
  )
}
