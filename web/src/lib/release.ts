/**
 * This build's version and the released notes, both fixed at build time from the root
 * package.json and CHANGELOG.md (vite.config.ts). Only released entries are here — never the
 * Unreleased notes or maintainer comments.
 */
import type { Release, Span } from '../../../scripts/changelog.d.mts'

export type { Release, Span }
export type ReleaseNotes = Omit<Release, 'markdown'>

declare const __MUNI_VERSION__: string
declare const __MUNI_RELEASES__: ReleaseNotes[]

export const APP_VERSION: string = __MUNI_VERSION__
/** Newest first. */
export const RELEASES: ReleaseNotes[] = __MUNI_RELEASES__

/** "2026-09-28" → "28 September 2026", read as a calendar date (no timezone shift). */
export function releaseDate(d: string, locale?: string): string {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}
