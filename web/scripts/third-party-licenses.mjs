/**
 * Writes dist/third-party-licenses.txt: the licence text of every production dependency that the
 * built app redistributes (bundled JavaScript and self-hosted fonts). Run after `vite build`.
 * The project's own licence (Apache-2.0) does not relicense any of these.
 */
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const dirs = execSync('npm ls --omit=dev --all --parseable', { cwd: root, maxBuffer: 1e8 })
  .toString()
  .split('\n')
  .filter((d) => d && d !== root.replace(/\/$/, '') && d.includes('node_modules'))

const seen = new Set()
const parts = []
for (const dir of dirs.sort()) {
  const pkgFile = join(dir, 'package.json')
  if (!existsSync(pkgFile)) continue
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
  // Type definitions are never part of the bundle.
  if (pkg.name.startsWith('@types/') || seen.has(pkg.name)) continue
  seen.add(pkg.name)
  const file = readdirSync(dir).find((f) => /^(licen[sc]e|copying)(\.|$)/i.test(f))
  const text = file ? readFileSync(join(dir, file), 'utf8').trim() : `License: ${pkg.license ?? 'unknown'} (no licence file in the package)`
  parts.push(`${'='.repeat(78)}\n${pkg.name}@${pkg.version} — ${typeof pkg.license === 'string' ? pkg.license : 'see below'}\n${pkg.homepage ?? ''}\n${'-'.repeat(78)}\n${text}\n`)
}

const header = `Muni — third-party software and fonts included in this web app

Muni itself is licensed under the Apache License, Version 2.0. The components below are
included under their own licences, reproduced here as they require. ${parts.length} packages.

`
const out = join(root, 'dist', 'third-party-licenses.txt')
if (!existsSync(join(root, 'dist'))) throw new Error('run after `vite build` (dist/ is missing)')
writeFileSync(out, header + parts.join('\n'))
console.log(`third-party-licenses.txt: ${parts.length} packages`)
