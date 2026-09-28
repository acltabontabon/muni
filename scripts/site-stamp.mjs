/**
 * Copies the marketing site (site/) to an output folder with every local stylesheet, script and
 * icon it links stamped with a hash of its contents: `styles.css` → `styles.css?v=1a2b3c4d5e`.
 *
 * Why: GitHub Pages (and Cloudflare in front of it) let browsers keep these files for a while.
 * Without a stamp, a visitor right after a publish can get the new page with an old stylesheet —
 * a new section then renders as plain, unstyled text. With it, a page always asks for exactly the
 * files it was published with, and a changed file is never served from cache under its old name.
 *
 *   node scripts/site-stamp.mjs site _site      # what .github/workflows/pages.yml runs
 */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Local files worth stamping: the ones a browser caches and the page can't work without. */
const STAMPED = /\.(css|js|svg)$/

/** `html` with each `href`/`src` that names a local stamped file (relative, no query) given `?v=<hash>`. */
export function stamp(html, readFile) {
  return html.replace(/\b(href|src)="([^"?#:]+)"/g, (whole, attr, path) => {
    if (!STAMPED.test(path) || path.startsWith('/') || path.startsWith('//')) return whole
    const body = readFile(path)
    if (body === null) return whole
    const hash = createHash('sha256').update(body).digest('hex').slice(0, 10)
    return `${attr}="${path}?v=${hash}"`
  })
}

function main([from = 'site', to = '_site'] = []) {
  if (!existsSync(join(from, 'index.html'))) throw new Error(`no ${from}/index.html`)
  rmSync(to, { recursive: true, force: true })
  cpSync(from, to, { recursive: true })
  const read = (p) => (existsSync(join(from, p)) ? readFileSync(join(from, p)) : null)
  const html = readFileSync(join(from, 'index.html'), 'utf8')
  const out = stamp(html, read)
  writeFileSync(join(to, 'index.html'), out)
  const stamped = [...out.matchAll(/\b(?:href|src)="([^"]+\?v=[0-9a-f]{10})"/g)].map((m) => m[1])
  console.log(`stamped ${stamped.length}: ${stamped.join(', ')}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
