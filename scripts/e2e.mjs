#!/usr/bin/env node
/**
 * Runs the browser suites in web/e2e against a server that is already up, each into its own log,
 * then prints a summary and exits non-zero if any suite failed or timed out. CI's e2e job
 * (.github/workflows/ci.yml) runs it against `wrangler dev` serving web/dist; locally, the same:
 *
 *   MUNI_URL=http://localhost:8787 node scripts/e2e.mjs              every suite CI runs
 *   MUNI_URL=http://localhost:8787 node scripts/e2e.mjs sprint offline
 *
 * Environment:
 *   MUNI_URL         the server (default http://localhost:8787); it must serve a production build
 *                    and the development-only /api/dev/session (worker/wrangler.jsonc does both)
 *   MUNI_DIST        the build directory that server serves (default web/dist), for `offline`
 *   E2E_LOGS         where logs and the offline suite's video go (default web/e2e-artifacts/ci)
 *   E2E_JOBS         suites run at once (default 1)
 *   E2E_TIMEOUT_MIN  minutes one suite may take before it counts as failed (default 15)
 *
 * `worlds-offline` is e2e/worlds.mjs with OFFLINE=1 (its service-worker part). `offline` always
 * runs last and alone: it rewrites the served sw.js to look like a newer build, which any suite
 * running beside it would see as an update.
 */
import { spawn } from 'node:child_process'
import { appendFileSync, createWriteStream, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ALL = ['retro', 'sprint', 'capture', 'rooms', 'themes', 'workspace', 'worlds', 'worlds-offline', 'encryption', 'departure', 'entrance', 'offline']
const web = fileURLToPath(new URL('../web/', import.meta.url))
const url = process.env.MUNI_URL ?? 'http://localhost:8787'
const logs = path.resolve(process.env.E2E_LOGS ?? path.join(web, 'e2e-artifacts', 'ci'))
const jobs = Math.max(1, Number(process.env.E2E_JOBS) || 1)
const timeoutMs = (Number(process.env.E2E_TIMEOUT_MIN) || 15) * 60_000

const wanted = process.argv.slice(2)
const unknown = wanted.filter((s) => !ALL.includes(s))
if (unknown.length) {
  console.error(`Unknown suite: ${unknown.join(', ')}. Suites: ${ALL.join(', ')}`)
  process.exit(2)
}
const suites = wanted.length ? wanted : ALL
mkdirSync(logs, { recursive: true })

/** One suite as a child process: its output goes to its log and, prefixed, to this one's. */
function run(name) {
  const file = name === 'worlds-offline' ? 'worlds' : name
  const env = { ...process.env, MUNI_URL: url, ...(name === 'worlds-offline' ? { OFFLINE: '1' } : {}) }
  const args = [`e2e/${file}.mjs`, ...(name === 'offline' ? [path.join(logs, 'offline')] : [])]
  const log = createWriteStream(path.join(logs, `${name}.log`))
  const started = Date.now()
  console.log(`▶ ${name}`)
  return new Promise((done) => {
    // Its own process group, so a timeout also ends the browsers it started.
    const child = spawn(process.execPath, args, { cwd: web, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let tail = ''
    const out = (chunk) => {
      log.write(chunk)
      const text = chunk.toString()
      tail = (tail + text).slice(-4000)
      process.stdout.write(jobs > 1 ? text.replace(/^(?=.)/gm, `[${name}] `) : text)
    }
    child.stdout.on('data', out)
    child.stderr.on('data', out)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }, timeoutMs)
    child.on('close', (code) => {
      clearTimeout(timer)
      log.end()
      const counts = [...tail.matchAll(/(\d+)\/(\d+) passed/g)].at(-1)
      const ok = code === 0 && !timedOut
      const seconds = Math.round((Date.now() - started) / 1000)
      const detail = timedOut ? `timed out after ${timeoutMs / 60_000} min` : counts ? `${counts[1]}/${counts[2]} passed` : `exit ${code}`
      console.log(`${ok ? '✓' : '✗'} ${name} — ${detail} (${seconds} s)`)
      done({ name, ok, detail, seconds })
    })
  })
}

const results = []
const queue = suites.filter((s) => s !== 'offline')
await Promise.all(
  Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    while (queue.length) results.push(await run(queue.shift()))
  }),
)
if (suites.includes('offline')) results.push(await run('offline'))

const failed = results.filter((r) => !r.ok)
const lines = results.map((r) => `| ${r.ok ? '✓' : '✗'} | ${r.name} | ${r.detail} | ${r.seconds} s |`)
console.log(`\n${results.length - failed.length}/${results.length} suites passed${failed.length ? ` — failed: ${failed.map((r) => r.name).join(', ')}` : ''}. Logs: ${logs}`)
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, ['### Browser e2e', '', '| | suite | result | time |', '| --- | --- | --- | --- |', ...lines, ''].join('\n') + '\n')
}
process.exit(failed.length ? 1 : 0)
