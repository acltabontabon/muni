/**
 * Worlds that compose the writing page themselves (see desk.tsx). Home asks here first; any world
 * not listed keeps Muni's journal, dressed in its colours and art.
 */
import type { ComponentType, ReactNode } from 'react'
import type { Destination } from '@/lib/local/LocalProvider'
import type { AvatarId } from './characters'
import { GuhitComposer, GuhitEmpty, GuhitSheet, GuhitStudio } from './guhit/Studio'
import { KapeCafe, KapeComposer, KapeEmpty, KapeSheet } from './kape/Cafe'
import { BiyaheComposer, BiyaheEmpty, BiyaheRide, BiyaheSheet } from './biyahe/Ride'
import { BolaComposer, BolaEmpty, BolaJournal, BolaSheet } from './bola/Journal'

export type OwnPage = {
  Page: ComponentType<{ notices?: ReactNode; book: ReactNode; collection: ReactNode; extras?: ReactNode; empty?: boolean; count?: number | null }>
  Composer: ComponentType<{ dest: Destination | null; choices: Destination[]; onChoose: (d: Destination) => void; tab: (onSwitch: (d: Destination) => void) => ReactNode; closed?: ReactNode }>
  Sheet: ComponentType<{ tab: ReactNode; title: ReactNode; children?: ReactNode }>
  Empty: ComponentType
  /** A small printed line over the sprint's name while writing; literal about where it goes. */
  kicker?: string
}

export const OWN_PAGES: Partial<Record<AvatarId, OwnPage>> = {
  guhit: { Page: GuhitStudio, Composer: GuhitComposer, Sheet: GuhitSheet, Empty: GuhitEmpty },
  kape: { Page: KapeCafe, Composer: KapeComposer, Sheet: KapeSheet, Empty: KapeEmpty, kicker: 'Writing for' },
  bola: { Page: BolaJournal, Composer: BolaComposer, Sheet: BolaSheet, Empty: BolaEmpty, kicker: 'Writing for' },
  biyahe: { Page: BiyaheRide, Composer: BiyaheComposer, Sheet: BiyaheSheet, Empty: BiyaheEmpty, kicker: 'Writing for' },
}
