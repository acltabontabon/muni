/**
 * Muni's service worker (act.munimuni.app only). Built as one classic script by the `muni-sw`
 * plugin in vite.config.ts, which prepends `self.__MUNI_BUILD` = { version, assets }.
 *
 * What it does, deliberately little:
 *  - precaches this build's app shell and versioned assets;
 *  - caches a character world's fonts when the page says that world was chosen, and serves them
 *    from the cache after that (so a person's own world works offline, and nobody downloads all eight);
 *  - removes what older versions cached that nothing uses any more: their app shells, and world
 *    fonts this build doesn't use (on activate);
 *  - serves navigations network-first, falling back to the cached shell when offline;
 *  - never touches /api (no authenticated response is ever cached);
 *  - waits to take over until the page says it is a safe moment (no forced reloads);
 *  - on Background Sync (Chromium only), sends the device's queued thoughts with the same code
 *    the page uses. An enhancement: pages send on open, focus and reconnect regardless.
 */
import { flush } from './lib/local/outbox'
import { deviceStore } from './lib/local/store'

type ExtendableEvent = Event & { waitUntil(p: Promise<unknown>): void }
type FetchEvent = ExtendableEvent & { request: Request; respondWith(r: Promise<Response> | Response): void }
type SyncEvent = ExtendableEvent & { tag: string }
type MessageEv = ExtendableEvent & { data: unknown }
interface Scope {
  __MUNI_BUILD: { version: string; assets: string[]; worlds?: Record<string, string[]> }
  location: Location
  skipWaiting(): Promise<void>
  clients: { claim(): Promise<void>; matchAll(o?: { type?: string; includeUncontrolled?: boolean }): Promise<{ postMessage(m: unknown): void }[]> }
  cookieStore?: { get(name: string): Promise<{ value: string } | null> }
  addEventListener(type: 'install' | 'activate', fn: (e: ExtendableEvent) => void): void
  addEventListener(type: 'fetch', fn: (e: FetchEvent) => void): void
  addEventListener(type: 'sync', fn: (e: SyncEvent) => void): void
  addEventListener(type: 'message', fn: (e: MessageEv) => void): void
}
const sw = self as unknown as Scope
const BUILD = sw.__MUNI_BUILD
const SHELL = `muni-shell-${BUILD.version}`
const PRECACHE = new Set(BUILD.assets)
const FONTS = 'muni-fonts'
const WORLDS = BUILD.worlds ?? {}
const WORLD_FILES = new Set(Object.values(WORLDS).flat())

sw.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', ...BUILD.assets])))
})

sw.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('muni-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      // World fonts this build doesn't use are dropped; the rest are kept.
      .then(() => caches.open(FONTS))
      .then(async (c) => Promise.all((await c.keys()).filter((r) => !WORLD_FILES.has(new URL(r.url).pathname)).map((r) => c.delete(r))))
      .then(() => sw.clients.claim()),
  )
})

sw.addEventListener('message', (e) => {
  if (e.data === 'muni:skip-waiting') e.waitUntil(sw.skipWaiting())
  const d = e.data as { type?: string; world?: string } | null
  if (d && d.type === 'muni:warm' && typeof d.world === 'string' && Object.prototype.hasOwnProperty.call(WORLDS, d.world)) e.waitUntil(warm(WORLDS[d.world]))
})

/** Fetches a world's fonts into the cache, once. Failures are fine: the page falls back to system faces. */
async function warm(files: string[]) {
  const c = await caches.open(FONTS)
  await Promise.all(files.map(async (f) => ((await c.match(f)) ? undefined : c.add(f).catch(() => undefined))))
}

sw.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== sw.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return
  if (req.mode === 'navigate') e.respondWith(navigate(req))
  else if (PRECACHE.has(url.pathname)) e.respondWith(caches.match(url.pathname, { cacheName: SHELL }).then((r) => r ?? fetch(req)))
  else if (WORLD_FILES.has(url.pathname)) e.respondWith(font(req, url.pathname))
})

/** A world's font: from the cache when it's there; otherwise from the network, kept for next time. */
async function font(req: Request, path: string): Promise<Response> {
  const c = await caches.open(FONTS)
  const hit = await c.match(path)
  if (hit) return hit
  const res = await fetch(req)
  if (res.ok) await c.put(path, res.clone()).catch(() => undefined)
  return res
}

async function navigate(req: Request): Promise<Response> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 5000)
    const res = await fetch(req, { signal: ctrl.signal })
    clearTimeout(t)
    return res
  } catch {
    const shell = await caches.match('/', { cacheName: SHELL })
    return shell ?? new Response('<!doctype html><meta charset="utf-8"><title>Muni</title><p style="font:16px system-ui;padding:2rem">Muni needs a connection to open for the first time on this device.</p>', { headers: { 'content-type': 'text/html; charset=utf-8' }, status: 503 })
  }
}

sw.addEventListener('sync', (e) => {
  if (e.tag === 'muni-outbox') e.waitUntil(sendQueued())
})

async function sendQueued() {
  const pages = await sw.clients.matchAll({ type: 'window' })
  // An open page sends with its own session and CSRF token; ask it.
  if (pages.length || !sw.cookieStore) {
    pages.forEach((p) => p.postMessage('muni:flush'))
    return
  }
  // Only a device that chose to keep drafts has anything here; don't create the database otherwise.
  const dbs = await indexedDB.databases?.()
  if (dbs && !dbs.some((d) => d.name === 'muni-device')) return
  const cookies = sw.cookieStore
  const result = await flush({ store: deviceStore(), fetch: (i, init) => fetch(i, init), csrf: async () => (await cookies.get('__Host-muni_csrf'))?.value ?? (await cookies.get('muni_csrf'))?.value ?? null })
  if (result.state === 'offline') throw new Error('still offline') // lets the browser retry the sync later
  new BroadcastChannel('muni-local').postMessage('changed')
}
