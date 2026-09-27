/**
 * The page's side of the speech worker. One worker per tab, started only when someone chooses
 * to dictate, never at app start. It's stopped (and its memory returned) after a quiet spell,
 * when the account changes, and on sign-out; a job that no longer matters is skipped or its
 * answer ignored.
 */
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url'
import { forgetModel, MODEL_BYTES, modelCached } from './assets'
import { onSignOutElsewhere } from '@/lib/signout'
import { VoiceFailure, type Engine, type Job, type Language, type VoiceError } from './session'
import type { FromWorker, ToWorker, WorkerError } from './whisper.worker'

export type ModelState =
  | { kind: 'unknown' } // not checked yet
  | { kind: 'absent' } // not on this device
  | { kind: 'downloading'; loaded: number; total: number }
  | { kind: 'starting' } // on this device, being loaded into memory
  | { kind: 'ready' }
  | { kind: 'failed'; error: VoiceError }

/** Stop the worker this long after the last transcription, so its memory goes back to the device. */
const IDLE_MS = 90_000

const toVoiceError = (c: WorkerError): VoiceError => (c === 'integrity' ? 'download' : c)

/** What this browser can do. Checked before offering voice at all. */
export function voiceSupport(): { ok: true } | { ok: false; reason: 'insecure' | 'unsupported' } {
  if (typeof window === 'undefined') return { ok: false, reason: 'unsupported' }
  if (!window.isSecureContext) return { ok: false, reason: 'insecure' }
  const ok =
    typeof WebAssembly === 'object' &&
    typeof Worker === 'function' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof AudioContext === 'function' &&
    typeof AudioWorkletNode === 'function'
  return ok ? { ok: true } : { ok: false, reason: 'unsupported' }
}

/** Threads for the runtime: several when the page is cross-origin isolated, else one. */
function threadCount() {
  if (!self.crossOriginIsolated) return 1
  return Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1))
}

type Pending = { resolve(text: string): void; reject(e: unknown): void; job: Job }

class VoiceEngine implements Engine {
  private state: ModelState = { kind: 'unknown' }
  private cached = false
  private accepted = false
  private worker: Worker | null = null
  private ready: Promise<void> | null = null
  private settle: { resolve(): void; reject(e: unknown): void } | null = null
  private jobs = new Map<number, Pending>()
  private nextJob = 1
  private idle: ReturnType<typeof setTimeout> | null = null
  private owner: string | null = null
  private subs = new Set<() => void>()

  get model() {
    return this.state
  }
  subscribe(fn: () => void) {
    this.subs.add(fn)
    return () => void this.subs.delete(fn)
  }
  private set(s: ModelState) {
    this.state = s
    for (const f of this.subs) f()
  }

  /** Looks (without downloading anything) for the model in this device's cache. */
  async check(): Promise<boolean> {
    this.cached = await modelCached(location.origin)
    if (this.state.kind === 'unknown' || this.state.kind === 'absent') this.set(this.cached ? { kind: 'starting' } : { kind: 'absent' })
    if (this.cached && this.state.kind === 'starting' && !this.worker) this.set({ kind: 'ready' })
    return this.cached
  }

  /** The first-use explanation is needed unless the model is here, or on its way. */
  present() {
    return this.cached || this.accepted
  }

  /** Called by each composer: work never crosses from one account to another. */
  bind(account: string | null) {
    if (account === this.owner) return
    this.owner = account
    this.stop('account')
  }

  prepare(): Promise<void> {
    this.accepted = true
    if (this.ready) return this.ready
    this.ready = new Promise<void>((resolve, reject) => {
      this.settle = { resolve, reject }
    })
    this.ready.catch(() => {})
    void this.start()
    return this.ready
  }

  private async start() {
    if (!this.cached) {
      // Room for the model, measured, before starting a 250 MB download.
      try {
        const est = await navigator.storage?.estimate?.()
        if (est?.quota && est.usage !== undefined && est.quota - est.usage < MODEL_BYTES * 1.1) return this.failStart('storage')
      } catch {
        /* unknown: try anyway */
      }
      if (!navigator.onLine) return this.failStart('offline')
      this.set({ kind: 'downloading', loaded: 0, total: MODEL_BYTES })
      // Ask the browser to keep it (it may still evict under pressure; checked on every use).
      navigator.storage?.persist?.().catch(() => false)
    } else {
      this.set({ kind: 'starting' })
    }
    let w: Worker
    try {
      w = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module', name: 'muni-voice' })
    } catch {
      return this.failStart('unsupported')
    }
    this.worker = w
    w.onmessage = (e: MessageEvent<FromWorker>) => this.receive(w, e.data)
    w.onerror = () => this.crash(w, 'engine')
    w.onmessageerror = () => this.crash(w, 'engine')
    const msg: ToWorker = { type: 'load', wasm: new URL(ortWasm, location.href).href, mjs: new URL(ortMjs, location.href).href, threads: threadCount() }
    w.postMessage(msg)
  }

  private failStart(error: VoiceError) {
    this.set({ kind: 'failed', error })
    this.settle?.reject(new VoiceFailure(error))
    this.ready = null
    this.settle = null
  }

  private receive(w: Worker, m: FromWorker) {
    if (w !== this.worker) return
    if (m.type === 'progress') {
      if (!this.cached) this.set({ kind: 'downloading', loaded: m.loaded, total: m.total })
    } else if (m.type === 'ready') {
      this.cached = true
      this.set({ kind: 'ready' })
      this.settle?.resolve()
      this.settle = null
    } else if (m.type === 'result') {
      const p = this.jobs.get(m.job)
      this.jobs.delete(m.job)
      p?.resolve(m.text)
      this.armIdle()
    } else if (m.type === 'error') {
      if (m.job === null) return this.crash(w, toVoiceError(m.code))
      const p = this.jobs.get(m.job)
      this.jobs.delete(m.job)
      p?.reject(new VoiceFailure(toVoiceError(m.code)))
      // Out of memory leaves the runtime unusable: start fresh next time.
      if (m.code === 'memory') this.stop('memory')
      else this.armIdle()
    }
  }

  private crash(w: Worker, error: VoiceError) {
    if (w !== this.worker) return
    for (const p of this.jobs.values()) p.reject(new VoiceFailure(error))
    this.jobs.clear()
    w.terminate()
    this.worker = null
    this.ready = null
    void modelCached(location.origin).then((c) => (this.cached = c))
    this.failStart(error)
  }

  transcribe(audio: Float32Array, language: Language, job: Job): Promise<string> {
    const w = this.worker
    if (!w || !this.ready) return Promise.reject(new VoiceFailure('engine'))
    if (this.idle) clearTimeout(this.idle)
    const id = this.nextJob++
    return new Promise<string>((resolve, reject) => {
      this.jobs.set(id, { resolve, reject, job })
      // A copy goes to the worker; the session keeps its own for a retry until it's no longer needed.
      const copy = audio.slice()
      const msg: ToWorker = { type: 'transcribe', job: id, audio: copy, language }
      w.postMessage(msg, [copy.buffer])
      // Cancelled before its turn: skipped without running the model. (Once running it can't be
      // interrupted; its answer is dropped.)
      job.onCancel = () => {
        if (!this.jobs.has(id)) return
        if (this.worker === w) w.postMessage({ type: 'skip', job: id } satisfies ToWorker)
        this.jobs.delete(id)
        reject(new VoiceFailure('engine', 'cancelled'))
        this.armIdle()
      }
    })
  }

  private armIdle() {
    if (this.idle) clearTimeout(this.idle)
    if (this.jobs.size) return
    this.idle = setTimeout(() => this.stop('idle'), IDLE_MS)
  }

  /** Removes the model from this device (Account → Voice). The next use asks again. */
  async forget() {
    this.stop('idle')
    await forgetModel(location.origin)
    this.cached = false
    this.set({ kind: 'absent' })
  }

  /** Ends the worker and everything waiting on it; the model stays cached on the device. */
  stop(_why: 'idle' | 'account' | 'signout' | 'memory') {
    if (this.idle) clearTimeout(this.idle)
    this.idle = null
    for (const p of this.jobs.values()) {
      p.job.cancelled = true
      p.reject(new VoiceFailure('engine', 'stopped'))
    }
    this.jobs.clear()
    this.worker?.terminate()
    this.worker = null
    this.settle?.reject(new VoiceFailure('engine', 'stopped'))
    this.settle = null
    this.ready = null
    this.accepted = false
    if (this.state.kind !== 'failed') this.set(this.cached ? { kind: 'ready' } : { kind: 'absent' })
  }
}

export const voiceEngine = new VoiceEngine()
// Another tab signed out: nothing keeps running for the person who left.
if (typeof window !== 'undefined') onSignOutElsewhere(() => voiceEngine.stop('signout'))
