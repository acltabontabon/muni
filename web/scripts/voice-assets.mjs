/**
 * Puts the pinned speech model (src/lib/voice/model.json) under public/voice/, so Muni serves it
 * from its own origin: nothing is fetched from Hugging Face by the app, and every visitor's
 * download comes from the same place as the app itself.
 *
 * Each file is downloaded once from the pinned revision, checked against its SHA-256, and split
 * into parts no larger than `partBytes` (Cloudflare serves static files up to 25 MiB). The app
 * reassembles and re-verifies them (src/lib/voice/assets.ts). Idempotent: files already in place
 * with the right size are left alone. Run before `npm run build` when deploying; the files are
 * gitignored and are not part of the service worker's install cache.
 *
 *   node scripts/voice-assets.mjs           # fetch what's missing
 *   node scripts/voice-assets.mjs --check   # verify what's there; exit 1 if anything is missing
 */
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const model = JSON.parse(readFileSync(join(root, 'src/lib/voice/model.json'), 'utf8'))
const out = join(root, 'public', model.dir)
const check = process.argv.includes('--check')

export const partsOf = (bytes, size) => (bytes <= size ? 1 : Math.ceil(bytes / size))
const partName = (path, i, n) => (n === 1 ? path : `${path}.part${i}`)

async function sha256Of(paths) {
  const h = createHash('sha256')
  for (const p of paths) for await (const c of createReadStream(p)) h.update(c)
  return h.digest('hex')
}

async function present(f) {
  const n = partsOf(f.bytes, model.partBytes)
  const files = Array.from({ length: n }, (_, i) => join(out, partName(f.path, i, n)))
  if (!files.every(existsSync)) return false
  if (files.reduce((s, p) => s + statSync(p).size, 0) !== f.bytes) return false
  return check ? (await sha256Of(files)) === f.sha256 : true
}

async function fetchFile(f) {
  const url = `https://huggingface.co/${model.source.repo}/resolve/${model.source.revision}/${f.path}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${f.path}: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length !== f.bytes) throw new Error(`${f.path}: expected ${f.bytes} bytes, got ${buf.length}`)
  const sha = createHash('sha256').update(buf).digest('hex')
  if (sha !== f.sha256) throw new Error(`${f.path}: SHA-256 mismatch (${sha})`)
  const n = partsOf(f.bytes, model.partBytes)
  for (let i = 0; i < n; i++) {
    const dest = join(out, partName(f.path, i, n))
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(`${dest}.tmp`, buf.subarray(i * model.partBytes, Math.min(f.bytes, (i + 1) * model.partBytes)))
    renameSync(`${dest}.tmp`, dest)
  }
  // A file that was stored whole before (or in a different number of parts) doesn't linger.
  if (n > 1) rmSync(join(out, f.path), { force: true })
}

let missing = 0
for (const f of model.files) {
  if (await present(f)) continue
  if (check) {
    console.error(`missing or corrupt: ${model.dir}/${f.path}`)
    missing++
    continue
  }
  process.stdout.write(`fetching ${f.path} (${(f.bytes / 1e6).toFixed(1)} MB)… `)
  await fetchFile(f)
  console.log('verified')
}
const total = model.files.reduce((s, f) => s + f.bytes, 0)
if (check && missing) process.exit(1)
console.log(`voice model ready in public/${model.dir} (${(total / 1e6).toFixed(1)} MB)`)
