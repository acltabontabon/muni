// Types for changelog.mjs, for the web build (vite.config.ts) and the app (src/lib/release.ts).
export type Span = { t: 'text' | 'strong' | 'em'; v: string } | { t: 'link'; v: string; href: string }
export type Section = { title: string; items: Span[][] }
export type Release = { version: string; date: string; prerelease: boolean; intro: Span[][]; sections: Section[]; markdown: string }
export const SEMVER: RegExp
export function isPrerelease(version: string): boolean
export function parseChangelog(text: string): { unreleased: string; releases: Release[] }
export function inline(text: string): Span[]
export function markdown(spans: Span[]): string
export function plain(spans: Span[]): string
