/**
 * The speech worker: Whisper (small, multilingual, 8-bit) through Transformers.js and ONNX
 * Runtime's WebAssembly backend, off the page's main thread. Audio arrives as 16 kHz samples and
 * text goes back; neither is logged, stored or sent anywhere. The only network requests this
 * worker makes are for the model and runtime files, from Muni's own origin.
 *
 * Always `task: 'transcribe'` with `language: 'tl'`. Measured (docs/VOICE.md): with Tagalog set,
 * English speech stays English and mixed speech keeps both languages; with English set, Tagalog
 * speech comes back translated into English, which Muni must never do. Transformers.js has no
 * language detection (an unset language silently becomes English), so this is explicit.
 */
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'
import { dropParts, IntegrityError, MODEL_ID, modelFetch } from './assets'

export type ToWorker =
  | { type: 'load'; wasm: string; mjs: string; threads: number }
  | { type: 'transcribe'; job: number; audio: Float32Array; language: 'tl' | 'en' }
  | { type: 'skip'; job: number }

export type WorkerError = 'download' | 'offline' | 'storage' | 'memory' | 'engine' | 'integrity'

export type FromWorker =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready'; threads: number; loadMs: number }
  | { type: 'result'; job: number; text: string; ms: number }
  | { type: 'error'; job: number | null; code: WorkerError }

type Scope = { postMessage(m: FromWorker): void; onmessage: ((e: MessageEvent<ToWorker>) => void) | null; location: Location; navigator: Navigator }
const scope = self as unknown as Scope
const post = (m: FromWorker) => scope.postMessage(m)

let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null
const skipped = new Set<number>()
let queue: Promise<void> = Promise.resolve()

function classify(e: unknown): WorkerError {
  const msg = String((e as Error)?.message ?? e)
  const name = (e as Error)?.name ?? ''
  if (e instanceof IntegrityError) return 'integrity'
  if (name === 'QuotaExceededError' || /quota/i.test(msg)) return 'storage'
  if (e instanceof RangeError || /out of memory|memory access out of bounds|Aborted\(|bad_alloc|OOM/i.test(msg)) return 'memory'
  if (e instanceof TypeError && /fetch|network|load failed/i.test(msg)) return scope.navigator.onLine === false ? 'offline' : 'download'
  if (/HTTP \d+/.test(msg)) return 'download'
  return 'engine'
}

function load(m: Extract<ToWorker, { type: 'load' }>) {
  if (asr) return asr
  const origin = scope.location.origin
  env.allowLocalModels = false
  env.allowRemoteModels = true
  env.remoteHost = `${origin}/`
  env.remotePathTemplate = '{model}/'
  env.useBrowserCache = true
  env.fetch = modelFetch(origin)
  // The runtime is served by Muni too (hashed, same origin) and loaded straight from its URL:
  // no CDN, and no blob: URLs (the app's content security policy doesn't allow them).
  env.useWasmCache = false
  const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number; proxy?: boolean } }
  if (onnx.wasm) {
    onnx.wasm.wasmPaths = { wasm: m.wasm, mjs: m.mjs }
    onnx.wasm.numThreads = m.threads
    onnx.wasm.proxy = false
  }
  const started = performance.now()
  asr = pipeline('automatic-speech-recognition', MODEL_ID, {
    device: 'wasm',
    dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
    progress_callback: (p: { status: string; loaded?: number; total?: number }) => {
      if (p.status === 'progress_total' && p.total) post({ type: 'progress', loaded: p.loaded ?? 0, total: p.total })
    },
  }) as Promise<AutomaticSpeechRecognitionPipeline>
  asr.then(
    async (pipe) => {
      // One short pass compiles the kernels, so the first real recording isn't slower than the rest.
      await pipe(new Float32Array(16000), { language: 'tl', task: 'transcribe' })
      await dropParts()
      post({ type: 'ready', threads: m.threads, loadMs: Math.round(performance.now() - started) })
    },
    (e) => {
      asr = null
      post({ type: 'error', job: null, code: classify(e) })
    },
  )
  return asr
}

async function transcribe(m: Extract<ToWorker, { type: 'transcribe' }>) {
  if (skipped.delete(m.job)) return
  if (!asr) return post({ type: 'error', job: m.job, code: 'engine' })
  try {
    const pipe = await asr
    if (skipped.delete(m.job)) return
    const t = performance.now()
    const out = await pipe(m.audio, {
      task: 'transcribe',
      language: m.language,
      // Recordings are at most two minutes; longer than 30 s are read in overlapping windows.
      chunk_length_s: 30,
      stride_length_s: 5,
    })
    const text = (Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text) ?? ''
    post({ type: 'result', job: m.job, text, ms: Math.round(performance.now() - t) })
  } catch (e) {
    post({ type: 'error', job: m.job, code: classify(e) })
  }
}

scope.onmessage = (e) => {
  const m = e.data
  if (m.type === 'load') {
    void load(m)?.catch(() => {})
  } else if (m.type === 'skip') {
    skipped.add(m.job)
  } else {
    // One job at a time: two recordings never run the model at once.
    queue = queue.then(() => transcribe(m))
  }
}
