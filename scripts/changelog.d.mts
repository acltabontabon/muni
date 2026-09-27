// Types for changelog.mjs, for the web build (vite.config.ts) and the app (src/lib/release.ts).
export type Span = { t: 'text' | 'strong' | 'em'; v: string } | { t: 'link'; v: string; href: string }
export type ChangeType = 'Added' | 'Changed' | 'Deprecated' | 'Removed' | 'Fixed' | 'Security'
export type Section = { title: ChangeType; items: Span[][] }
export type Release = { version: string; date: string; prerelease: boolean; sections: Section[]; markdown: string }
export const SEMVER: RegExp
export const TYPES: ChangeType[]
export function isPrerelease(version: string): boolean
export function parseChangelog(text: string): { preamble: string; unreleased: Section[]; releases: Release[]; links: Record<string, string> }
export function inline(text: string): Span[]
export function markdown(spans: Span[]): string
export function plain(spans: Span[]): string
