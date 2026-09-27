/**
 * Writes dist/third-party-licenses.txt: the licence text of every production dependency that the
 * built app redistributes (bundled JavaScript and self-hosted fonts). Run after `vite build`.
 * The project's own licence (Apache-2.0) does not relicense any of these.
 *
 * The package list comes from package-lock.json (production entries only), not from `npm ls`
 * output: npm masks UUID-like strings in what it prints, which breaks paths that contain one.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))

const seen = new Set()
const parts = []
for (const [path, entry] of Object.entries(lock.packages ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
  // "" is the app itself; dev-only packages (build and test tools) are never shipped.
  if (!path || entry.dev || entry.devOptional) continue
  const dir = join(root, path)
  const pkgFile = join(dir, 'package.json')
  if (!existsSync(pkgFile)) continue // an optional package for another platform
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
  // Type definitions are never part of the bundle.
  if (pkg.name.startsWith('@types/') || seen.has(pkg.name)) continue
  seen.add(pkg.name)
  const file = readdirSync(dir).find((f) => /^(licen[sc]e|copying)(\.|$)/i.test(f))
  const text = file ? readFileSync(join(dir, file), 'utf8').trim() : `License: ${pkg.license ?? 'unknown'} (no licence file in the package)`
  parts.push(`${'='.repeat(78)}\n${pkg.name}@${pkg.version} — ${typeof pkg.license === 'string' ? pkg.license : 'see below'}\n${pkg.homepage ?? ''}\n${'-'.repeat(78)}\n${text}\n`)
}
if (!parts.length) throw new Error('no production dependencies found — is node_modules installed?')

const header = `Muni — third-party software and fonts included in this web app

Muni itself is licensed under the Apache License, Version 2.0. The components below are
included under their own licences, reproduced here as they require. ${parts.length} packages.

`
const out = join(root, 'dist', 'third-party-licenses.txt')
if (!existsSync(join(root, 'dist'))) throw new Error('run after `vite build` (dist/ is missing)')
writeFileSync(out, header + parts.join('\n'))
console.log(`third-party-licenses.txt: ${parts.length} packages`)
