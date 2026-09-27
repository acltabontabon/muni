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

// Transformers.js also depends on its Node.js backends (native ONNX Runtime, sharp for images).
// The browser build never includes them, so neither they nor what only they pull in are listed.
const NODE_ONLY = new Set(['onnxruntime-node', 'sharp'])
const shipped = new Set()
const reach = (name, from = '') => {
  // npm's resolution: nearest node_modules up the tree.
  let dir = from
  for (;;) {
    const key = `${dir ? `${dir}/` : ''}node_modules/${name}`
    if (lock.packages[key]) {
      if (NODE_ONLY.has(name) || shipped.has(key)) return
      shipped.add(key)
      const e = lock.packages[key]
      for (const d of Object.keys({ ...e.dependencies, ...e.optionalDependencies })) reach(d, key)
      return
    }
    if (!dir) return
    dir = dir.includes('/node_modules/') ? dir.slice(0, dir.lastIndexOf('/node_modules/')) : ''
  }
}
for (const d of Object.keys(lock.packages[''].dependencies ?? {})) reach(d)

const seen = new Set()
const parts = []
for (const [path, entry] of Object.entries(lock.packages ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
  // "" is the app itself; dev-only packages (build and test tools) are never shipped.
  if (!path || entry.dev || entry.devOptional || !shipped.has(path)) continue
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

// The speech model's weights aren't an npm package, but they're served to people who use voice.
const model = JSON.parse(readFileSync(join(root, 'src/lib/voice/model.json'), 'utf8'))
parts.push(`${'='.repeat(78)}
Whisper small (speech model, ${model.source.repo}@${model.source.revision.slice(0, 7)}) — MIT
https://github.com/openai/whisper — served from /${model.dir}/ to people who use voice
${'-'.repeat(78)}
MIT License

Copyright (c) 2022 OpenAI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`)

const header = `Muni — third-party software and fonts included in this web app

Muni itself is licensed under the Apache License, Version 2.0. The components below are
included under their own licences, reproduced here as they require. ${parts.length} packages.

`
const out = join(root, 'dist', 'third-party-licenses.txt')
if (!existsSync(join(root, 'dist'))) throw new Error('run after `vite build` (dist/ is missing)')
writeFileSync(out, header + parts.join('\n'))
console.log(`third-party-licenses.txt: ${parts.length} packages`)
