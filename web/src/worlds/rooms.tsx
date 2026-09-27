/**
 * Each character's writing page: a dedicated composition (worlds/rooms/<id>.tsx) around the shared
 * room (worlds/room.tsx). Home renders <Room> for anyone whose character theme is on; everyone else
 * keeps Muni's journal.
 *
 * The room's wrapper is keyed by character, so changing character swaps the composition with one
 * short fade. What's being written lives above it (WritingHost), so it never goes with it.
 */
import type { ReactNode } from 'react'
import type { AvatarId } from './characters'
import { RoomProviders, type RoomDef } from './room'
import { KAPE } from './rooms/kape'
import { GUHIT } from './rooms/guhit'
import { BIYAHE } from './rooms/biyahe'
import { BOLA } from './rooms/bola'
import { PAHINA } from './rooms/pahina'
import { HIMIG } from './rooms/himig'
import { PORMA } from './rooms/porma'
import { SIBOL } from './rooms/sibol'

export const ROOMS: Record<AvatarId, RoomDef> = { kape: KAPE, guhit: GUHIT, biyahe: BIYAHE, bola: BOLA, pahina: PAHINA, himig: HIMIG, porma: PORMA, sibol: SIBOL }

export function Room({ world, bar, context, writing, collection, extras, notices, empty, mode }: { world: AvatarId; bar?: ReactNode; context: ReactNode; writing: ReactNode; collection: ReactNode; extras?: ReactNode; notices?: ReactNode; empty?: boolean; mode: 'write' | 'state' }) {
  const def = ROOMS[world]
  const Page = def.Page
  return (
    <RoomProviders def={def} headContext={def.contextInHead ? context : null}>
      <div key={world} className="room" data-room={world} data-mode={mode} data-empty={empty || undefined} data-bar={bar ? '' : undefined}>
        <Page bar={bar ? <div className="room-bar">{bar}</div> : null} context={def.contextInHead ? null : context} writing={writing} collection={collection} extras={extras} notices={notices ? <div className="room-notices">{notices}</div> : null} empty={empty} mode={mode} />
      </div>
    </RoomProviders>
  )
}
