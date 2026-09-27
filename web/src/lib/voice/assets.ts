/**
 * The speech model's files, as Muni serves them (scripts/voice-assets.mjs): from this origin, in
 * parts of at most 20 MiB. Only model files travel this way; nothing about the person does.
 *
 * `modelFetch` stands in for fetch inside the speech worker. For a model file it fetches the
 * parts (each kept in a cache as it arrives, so an interrupted download resumes where it
 * stopped), joins them into one stream and checks the whole file's SHA-256 before the library
 * sees the end of it; a corrupt or truncated file fails instead of being cached. Anything else
 * under the model's folder is answered 404 without a request (the library asks for optional
 * files, and the app's single-page fallback would otherwise answer with HTML).
 */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import model from './model.json'

export type ModelFile = { path: string; bytes: number; sha256: string }

export const MODEL = model as { dir: string; partBytes: number; files: ModelFile[]; source: { repo: string; revision: string; license: string } }
/** The id Transformers.js loads (resolved against this origin, see whisper.worker.ts). */
export const MODEL_ID = MODEL.dir
export const MODEL_BYTES = MODEL.files.reduce((n, f) => n + f.bytes, 0)
/** Where Transformers.js keeps what it loaded (its default Cache API name). */
export const LIBRARY_CACHE = 'transformers-cache'
/** Parts of a model file still being downloaded; emptied once the model is ready. */
export const PARTS_CACHE = 'muni-voice-parts'

export const partCount = (f: ModelFile, size = MODEL.partBytes) => (f.bytes <= size ? 1 : Math.ceil(f.bytes / size))
export const fileUrl = (origin: string, path: string) => `${origin}/${MODEL.dir}/${path}`

export class IntegrityError extends Error {}

type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>

async function openCache(name: string): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(name)
  } catch {
    return null // e.g. Firefox private windows
  }
}

async function fetchRetrying(fetcher: Fetch, url: string, tries = 3): Promise<Response> {
  let last: unknown
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetcher(url, { cache: 'no-store' })
      if (r.ok) return r
      last = new Error(`HTTP ${r.status}`)
      if (r.status === 404) break
    } catch (e) {
      last = e
    }
    await new Promise((res) => setTimeout(res, 800 * 3 ** i))
  }
  throw last
}

export function modelFetch(origin: string, opts: { fetcher?: Fetch; files?: ModelFile[]; partBytes?: number } = {}): Fetch {
  const fetcher = opts.fetcher ?? ((i, init) => fetch(i, init))
  const size = opts.partBytes ?? MODEL.partBytes
  const byUrl = new Map((opts.files ?? MODEL.files).map((f) => [fileUrl(origin, f.path), f]))
  const folder = `${origin}/${MODEL.dir}/`
  return async (input, init) => {
    const url = String(input)
    const f = byUrl.get(url)
    if (!f) {
      if (url.startsWith(folder)) return new Response(null, { status: 404 })
      return fetcher(url, init)
    }
    // The library asks for a file's size first (a one-byte range request): answered from the
    // pinned manifest, without touching the network.
    const range = new Headers(init?.headers).get('range')
    if (range || init?.method === 'HEAD') {
      return new Response(range ? new Uint8Array(1) : null, {
        status: range ? 206 : 200,
        headers: { 'content-length': range ? '1' : String(f.bytes), ...(range ? { 'content-range': `bytes 0-0/${f.bytes}` } : {}), 'content-type': 'application/octet-stream' },
      })
    }
    const n = partCount(f, size)
    const parts = n > 1 ? await openCache(PARTS_CACHE) : null
    const hash = sha256.create()
    let i = 0
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (i === n) {
            if (bytesToHex(hash.digest()) !== f.sha256) {
              if (parts) await Promise.all(Array.from({ length: n }, (_, k) => parts.delete(`${url}.part${k}`)))
              throw new IntegrityError(`${f.path} did not match its checksum`)
            }
            controller.close()
            return
          }
          const partUrl = n === 1 ? url : `${url}.part${i}`
          let res = parts ? await parts.match(partUrl) : undefined
          if (!res) {
            res = await fetchRetrying(fetcher, partUrl)
            if (parts) {
              const bytes = new Uint8Array(await res.arrayBuffer())
              await parts.put(partUrl, new Response(bytes)).catch(() => {}) // a full disk only costs resuming
              res = new Response(bytes)
            }
          }
          const bytes = new Uint8Array(await res.arrayBuffer())
          hash.update(bytes)
          i++
          controller.enqueue(bytes)
        } catch (e) {
          controller.error(e)
        }
      },
      // Nothing is fetched until someone reads: a response only looked at never downloads a part.
    }, { highWaterMark: 0 })
    return new Response(body, { status: 200, headers: { 'content-length': String(f.bytes), 'content-type': 'application/octet-stream' } })
  }
}

/** Whether every model file is in the library's cache on this device (so it works offline). */
export async function modelCached(origin: string): Promise<boolean> {
  const c = await openCache(LIBRARY_CACHE)
  if (!c) return false
  try {
    const hits = await Promise.all(MODEL.files.map((f) => c.match(fileUrl(origin, f.path))))
    return hits.every(Boolean)
  } catch {
    return false
  }
}

/** Leftover download parts, once the model is whole in the library's cache. */
export async function dropParts() {
  try {
    if (typeof caches !== 'undefined') await caches.delete(PARTS_CACHE)
  } catch {
    /* nothing to drop */
  }
}

/** Removes the model from this device (Account → Voice). Other cached app files are untouched. */
export async function forgetModel(origin: string) {
  await dropParts()
  const c = await openCache(LIBRARY_CACHE)
  if (!c) return
  await Promise.all(MODEL.files.map((f) => c.delete(fileUrl(origin, f.path)).catch(() => false)))
}
