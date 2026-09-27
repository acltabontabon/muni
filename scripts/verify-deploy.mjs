#!/usr/bin/env node
/**
 * Checks a Muni deployment from the outside, the way a person's browser meets it.
 *
 *   node scripts/verify-deploy.mjs <origin> <version> [<commit>] [--wait <seconds>]
 *     passes when the Worker reports that version (and commit), its database answers, and the page,
 *     service worker and scripts it serves belong to the same build. Retries until --wait runs out
 *     (default 180 s): a new Worker version takes a little while to reach every location.
 *
 *   node scripts/verify-deploy.mjs <origin> <version> [<commit>] --state
 *     prints one word and never fails: `live` (already serving exactly this), `older` (serving an
 *     earlier version, or none yet), `newer` (serving a later version — deploying would roll it
 *     back), or `unknown` (unreachable, or the same version from another commit).
 *
 * Used by .github/workflows/release.yml and by hand (docs/RELEASING.md). No dependencies.
 */
import { SEMVER } from './changelog.mjs'

/** Semver precedence: -1, 0 or 1. */
export function compare(a, b) {
  const pa = SEMVER.exec(a)
  const pb = SEMVER.exec(b)
  if (!pa || !pb) throw new Error(`not a version: ${!pa ? a : b}`)
  for (let i = 1; i <= 3; i++) if (Number(pa[i]) !== Number(pb[i])) return Number(pa[i]) < Number(pb[i]) ? -1 : 1
  if (pa[4] === pb[4]) return 0
  if (pa[4] === undefined) return 1
  if (pb[4] === undefined) return -1
  const xa = pa[4].split('.')
  const xb = pb[4].split('.')
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    if (xa[i] === undefined) return -1
    if (xb[i] === undefined) return 1
    const na = /^\d+$/.test(xa[i])
    const nb = /^\d+$/.test(xb[i])
    if (na && nb && Number(xa[i]) !== Number(xb[i])) return Number(xa[i]) < Number(xb[i]) ? -1 : 1
    if (na !== nb) return na ? -1 : 1
    if (!na && xa[i] !== xb[i]) return xa[i] < xb[i] ? -1 : 1
  }
  return 0
}

const get = async (url, as = 'text') => {
  const r = await fetch(url, { headers: { 'cache-control': 'no-cache', 'user-agent': 'muni-release-check' }, redirect: 'follow' })
  const body = as === 'json' ? await r.json().catch(() => null) : await r.text()
  return { status: r.status, type: r.headers.get('content-type') ?? '', body }
}

/** One look at the deployment; returns the problems found (none: it's serving this build). */
export async function inspect(origin, version, commit) {
  const problems = []
  const v = await get(`${origin}/api/version`, 'json')
  if (v.status !== 200 || !v.body) return [`/api/version answered ${v.status}`]
  if (v.body.version !== version) problems.push(`the Worker reports ${v.body.version}, not ${version}`)
  if (commit && v.body.commit !== commit) problems.push(`the Worker reports commit ${v.body.commit ?? 'none'}, not ${commit}`)
  const h = await get(`${origin}/api/health`, 'json')
  if (h.status !== 200 || h.body?.database !== 'ok') problems.push(`/api/health answered ${h.status} (${h.body?.database ?? 'no database status'})`)
  const page = await get(`${origin}/`)
  const meta = /<meta name="muni-version" content="([^"]+)"/.exec(page.body)?.[1]
  if (page.status !== 200 || !page.type.includes('text/html')) problems.push(`the page answered ${page.status} ${page.type}`)
  else if (meta !== version) problems.push(`the page is version ${meta ?? 'unknown'}, not ${version}`)
  // Every script and stylesheet the page names must exist: a page from one build with assets from
  // another is how an app gets stuck.
  for (const src of [...page.body.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1])) {
    const a = await get(`${origin}${src}`)
    if (a.status !== 200 || a.type.includes('text/html')) problems.push(`${src} answered ${a.status} ${a.type}`)
  }
  const sw = await get(`${origin}/sw.js`)
  if (sw.status !== 200 || !sw.body.includes('__MUNI_BUILD')) problems.push(`/sw.js answered ${sw.status} without a build manifest`)
  return problems
}

export async function state(origin, version, commit) {
  try {
    const v = await get(`${origin}/api/version`, 'json')
    if (v.status === 404 || (v.status === 200 && v.body && !v.body.version)) return 'older'
    if (v.status !== 200 || !v.body?.version) return 'unknown'
    const c = compare(v.body.version, version)
    if (c < 0) return 'older'
    if (c > 0) return 'newer'
    if (commit && v.body.commit !== commit) return 'unknown'
    return (await inspect(origin, version, commit)).length ? 'unknown' : 'live'
  } catch {
    return 'unknown'
  }
}

async function main() {
  const args = process.argv.slice(2)
  const wait = args.includes('--wait') ? Number(args[args.indexOf('--wait') + 1]) : 180
  const pos = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--wait')
  const [origin, version, commit] = pos
  if (!/^https?:\/\/[^/]+$/.test(origin ?? '') || !SEMVER.test(version ?? '')) {
    console.error('usage: verify-deploy.mjs <https://host> <version> [<commit>] [--wait <seconds>] [--state]')
    process.exit(2)
  }
  if (args.includes('--state')) return console.log(await state(origin, version, commit))
  const until = Date.now() + wait * 1000
  let last = []
  for (;;) {
    last = await inspect(origin, version, commit).catch((e) => [String(e?.message ?? e)])
    if (!last.length) {
      console.log(`✓ ${origin} serves ${version}${commit ? ` (${commit.slice(0, 12)})` : ''}: Worker, database, page, scripts and service worker agree`)
      return
    }
    if (Date.now() > until) break
    await new Promise((r) => setTimeout(r, 10_000))
  }
  for (const p of last) console.error(`✗ ${p}`)
  process.exit(1)
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
