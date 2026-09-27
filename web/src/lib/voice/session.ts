/**
 * One composer's voice capture: an explicit state model, and the rules that keep dictation from
 * ever costing or corrupting what's written.
 *
 *   idle ─tap→ (offer ─accept→) starting ─mic open→ recording ─stop→ processing ─→ done
 *                                   │                 │    └─system→ interrupted ─→ processing
 *                                   └─fail→ failed    └─cancel→ idle        └─no speech→ empty
 *                                                                           └─fail→ failed ─retry→ processing
 *
 * - Every recording is tied to the account, the draft (sprint), the local-data generation it
 *   started in, and an attempt number. A result is applied only if all four still match and
 *   the recording is still the one being processed; anything else is dropped unseen.
 * - A recording's words are inserted at most once. Retrying a failed attempt can't duplicate
 *   text, because nothing was inserted, and a late answer to an earlier attempt is ignored.
 * - Audio lives in memory only: until its words are in the draft and the draft is saved, or until
 *   it's discarded. Nothing is written to storage, and nothing leaves the device.
 * - Recording starts only from a person's tap and never restarts on its own.
 */
import { insertTranscript, undoInsertion, type Anchor, type Insertion } from './insert'
import { cleanTranscript, detectSpeech, SAMPLE_RATE } from './speech'

export type Language = 'tl' | 'en'

export type VoiceError =
  | 'unsupported' // this browser can't record or run the model here
  | 'insecure' // not a secure context
  | 'denied' // microphone permission refused (now or earlier)
  | 'no-mic' // no input device
  | 'mic-busy' // another app holds the microphone
  | 'mic-failed' // opening the microphone failed otherwise
  | 'download' // the voice model couldn't be downloaded
  | 'offline' // offline, and the model isn't on this device yet
  | 'storage' // not enough storage for the model
  | 'engine' // the model couldn't start or crashed
  | 'memory' // the device ran out of memory transcribing
  | 'too-long' // the words don't fit in the draft

export class VoiceFailure extends Error {
  constructor(readonly code: VoiceError, detail?: string) {
    super(detail ?? code)
  }
}

export type Saved = 'pending' | 'device' | 'tab' | 'unsaved' | 'failed'

export type Phase =
  | { kind: 'idle' }
  | { kind: 'offer' }
  | { kind: 'starting'; id: string }
  | { kind: 'recording'; id: string; startedAt: number }
  | { kind: 'interrupted'; id: string; seconds: number }
  | { kind: 'processing'; id: string; seconds: number }
  | { kind: 'done'; id: string; text: string; saved: Saved; undoable: boolean }
  | { kind: 'empty'; id: string; quiet: boolean }
  | { kind: 'failed'; id: string | null; error: VoiceError; retry: boolean; text?: string }

export type Captured = { samples: Float32Array; seconds: number }

export type Recorder = {
  /** Stops listening and returns what was heard, mono at 16 kHz. The microphone is released. */
  stop(): Promise<Captured>
  /** Stops listening and throws the audio away. The microphone is released. */
  cancel(): void
}

export type RecorderHooks = {
  maxMs: number
  /** Input level, 0–1, measured from the microphone (for the ripple). */
  onLevel(level: number): void
  /** The limit was reached: stop and transcribe. */
  onLimit(): void
  /** The system took the microphone away or suspended the page. */
  onInterrupt(): void
}

/** One transcription request; `onCancel` is set by the engine so a queued job can be skipped. */
export type Job = { cancelled: boolean; onCancel?: () => void }

export type Engine = {
  /** Whether the model files are on this device (so the first-use explanation can be skipped). */
  present(): boolean
  /** Starts downloading/initialising; resolves when ready to transcribe. */
  prepare(): Promise<void>
  transcribe(audio: Float32Array, language: Language, job: Job): Promise<string>
}

export type Context = { account: string | null; draft: string | null; generation: number }

export type Deps = {
  openRecorder(hooks: RecorderHooks): Promise<Recorder>
  engine: Engine
  context(): Context
  /** The draft's current body and where the cursor is. */
  anchor(): Anchor
  body(): string
  /** Puts new text in the field (the composer saves it as a draft). */
  apply(body: string, caret: number): void
  /** Saves the draft now: where it was kept, or 'unsaved' when there's nowhere to keep it yet. */
  persist(): Promise<Exclude<Saved, 'pending'>>
  language(): Language
  maxChars: number
  maxMs: number
  now(): number
  newId(): string
}

type Take = {
  id: string
  ctx: Context
  anchor: Anchor
  audio: Captured | null
  attempt: number
  job: Job | null
  inserted: Extract<Insertion, { ok: true }> | null
  recorder: Recorder | null
  cancelled: boolean
}

export type VoiceSession = {
  phase(): Phase
  subscribe(fn: () => void): () => void
  onLevel(fn: (level: number) => void): () => void
  /** The microphone button. */
  tap(): void
  /** First use: the person agreed to the download. Recording starts straight away. */
  accept(): void
  stop(): void
  cancel(): void
  /** After an interruption: transcribe what was captured. */
  keep(): void
  retry(): void
  /** Take the last dictation back out (only while the draft is exactly as it left it). */
  undo(): void
  dismiss(): void
  dispose(): void
}

const same = (a: Context, b: Context) => a.account === b.account && a.draft === b.draft && a.generation === b.generation

export function createVoiceSession(deps: Deps): VoiceSession {
  let phase: Phase = { kind: 'idle' }
  let take: Take | null = null
  let disposed = false
  const subs = new Set<() => void>()
  const levelSubs = new Set<(l: number) => void>()

  const set = (p: Phase) => {
    phase = p
    for (const f of subs) f()
  }
  const current = (t: Take) => !disposed && take === t && !t.cancelled
  const stillHere = (t: Take) => current(t) && same(t.ctx, deps.context())

  /** Forget the recording: microphone, audio, pending job. */
  const release = (t: Take | null) => {
    if (!t) return
    t.cancelled = true
    if (t.job) {
      t.job.cancelled = true
      t.job.onCancel?.()
    }
    t.recorder?.cancel()
    t.recorder = null
    t.audio = null
    if (take === t) take = null
  }

  async function begin() {
    if (disposed) return
    release(take)
    const ctx = deps.context()
    const t: Take = { id: deps.newId(), ctx, anchor: deps.anchor(), audio: null, attempt: 0, job: null, inserted: null, recorder: null, cancelled: false }
    take = t
    set({ kind: 'starting', id: t.id })
    try {
      const rec = await deps.openRecorder({
        maxMs: deps.maxMs,
        onLevel: (l) => {
          if (current(t)) for (const f of levelSubs) f(l)
        },
        onLimit: () => {
          if (current(t) && phase.kind === 'recording') void finish(t)
        },
        onInterrupt: () => {
          if (current(t) && phase.kind === 'recording') void interrupt(t)
        },
      })
      if (!current(t)) {
        rec.cancel()
        return
      }
      t.recorder = rec
      set({ kind: 'recording', id: t.id, startedAt: deps.now() })
    } catch (e) {
      if (!current(t)) return
      take = null
      set({ kind: 'failed', id: null, error: e instanceof VoiceFailure ? e.code : 'mic-failed', retry: false })
    }
  }

  async function capture(t: Take): Promise<Captured | null> {
    const rec = t.recorder
    t.recorder = null
    if (!rec) return null
    try {
      return await rec.stop()
    } catch {
      return null
    }
  }

  async function finish(t: Take) {
    set({ kind: 'processing', id: t.id, seconds: 0 })
    const audio = await capture(t)
    if (!current(t)) return
    if (!audio) return fail(t, 'mic-failed', false)
    t.audio = audio
    set({ kind: 'processing', id: t.id, seconds: audio.seconds })
    await process(t)
  }

  async function interrupt(t: Take) {
    const audio = await capture(t)
    if (!current(t)) return
    if (!audio || audio.seconds < 0.5) {
      release(t)
      return set({ kind: 'idle' })
    }
    t.audio = audio
    set({ kind: 'interrupted', id: t.id, seconds: audio.seconds })
  }

  function fail(t: Take, error: VoiceError, retry: boolean) {
    if (!retry) t.audio = null
    set({ kind: 'failed', id: t.id, error, retry: retry && !!t.audio })
  }

  async function process(t: Take) {
    const audio = t.audio
    if (!audio) return fail(t, 'mic-failed', false)
    const check = detectSpeech(audio.samples)
    if (!check.range) {
      release(t)
      return set({ kind: 'empty', id: t.id, quiet: check.peakDb < -45 })
    }
    const attempt = ++t.attempt
    if (t.job) {
      t.job.cancelled = true
      t.job.onCancel?.()
    }
    const job: Job = { cancelled: false }
    t.job = job
    let raw: string
    try {
      await deps.engine.prepare()
      if (!current(t) || t.attempt !== attempt) return
      raw = await deps.engine.transcribe(audio.samples.subarray(check.range[0], check.range[1]), deps.language(), job)
    } catch (e) {
      if (!current(t) || t.attempt !== attempt) return
      const code = e instanceof VoiceFailure ? e.code : 'engine'
      return fail(t, code, code !== 'unsupported')
    }
    // Late: cancelled, retried, another recording started, signed out, or a different draft.
    if (!current(t) || t.attempt !== attempt || job.cancelled) return
    if (!stillHere(t)) return release(t)
    const text = cleanTranscript(raw, check.speechMs)
    if (!text) {
      release(t)
      return set({ kind: 'empty', id: t.id, quiet: false })
    }
    if (t.inserted) return // never twice
    const ins = insertTranscript(deps.body(), t.anchor, text, deps.maxChars)
    if (!ins.ok) {
      if (ins.reason === 'empty') {
        release(t)
        return set({ kind: 'empty', id: t.id, quiet: false })
      }
      // Kept on screen (and the audio kept) so nothing is lost; the draft is untouched.
      return set({ kind: 'failed', id: t.id, error: 'too-long', retry: false, text })
    }
    t.inserted = ins
    deps.apply(ins.body, ins.end)
    set({ kind: 'done', id: t.id, text, saved: 'pending', undoable: true })
    let saved: Exclude<Saved, 'pending'>
    try {
      saved = await deps.persist()
    } catch {
      saved = 'failed'
    }
    if (take !== t || disposed) return
    // Saved (or kept in this tab, as all drafts are there): the audio has done its job.
    if (saved === 'device' || saved === 'tab') t.audio = null
    if (phase.kind === 'done' && phase.id === t.id) set({ ...phase, saved })
  }

  return {
    phase: () => phase,
    subscribe(fn) {
      subs.add(fn)
      return () => void subs.delete(fn)
    },
    onLevel(fn) {
      levelSubs.add(fn)
      return () => void levelSubs.delete(fn)
    },
    tap() {
      if (disposed) return
      switch (phase.kind) {
        case 'recording':
          return this.stop()
        case 'starting':
        case 'processing':
        case 'interrupted':
        case 'offer':
          return // one thing at a time; repeated taps do nothing
        default:
          if (take && phase.kind === 'failed' && phase.retry) release(take)
          if (!deps.engine.present()) return set({ kind: 'offer' })
          void begin()
      }
    },
    accept() {
      if (phase.kind !== 'offer') return
      // The download starts now, while the person speaks; failures surface when transcribing.
      deps.engine.prepare().catch(() => {})
      void begin()
    },
    stop() {
      if (phase.kind !== 'recording' || !take) return
      void finish(take)
    },
    cancel() {
      if (phase.kind === 'idle' || phase.kind === 'done') return
      release(take)
      set({ kind: 'idle' })
    },
    keep() {
      if (phase.kind !== 'interrupted' || !take) return
      const t = take
      set({ kind: 'processing', id: t.id, seconds: phase.seconds })
      void process(t)
    },
    retry() {
      if (phase.kind !== 'failed' || !phase.retry || !take?.audio) return
      const t = take
      set({ kind: 'processing', id: t.id, seconds: t.audio!.seconds })
      void process(t)
    },
    undo() {
      if (phase.kind !== 'done' || !take?.inserted) return
      const back = undoInsertion(deps.body(), take.inserted)
      if (back === null) return set({ ...phase, undoable: false })
      deps.apply(back, take.inserted.from)
      release(take)
      set({ kind: 'idle' })
      void deps.persist().catch(() => {})
    },
    dismiss() {
      if (phase.kind === 'recording' || phase.kind === 'starting' || phase.kind === 'processing') return
      release(take)
      set({ kind: 'idle' })
    },
    dispose() {
      if (disposed) return
      release(take)
      disposed = true
      subs.clear()
      levelSubs.clear()
    },
  }
}

export const audioSeconds = (samples: Float32Array) => samples.length / SAMPLE_RATE
