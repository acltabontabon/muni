import { describe, expect, it, vi } from 'vitest'
import { createVoiceSession, VoiceFailure, type Captured, type Context, type Deps, type Language, type RecorderHooks } from './session'
import { SAMPLE_RATE } from './speech'

/** Syllable-like bursts the speech check accepts. */
const speech = (s = 2): Float32Array =>
  Float32Array.from({ length: s * SAMPLE_RATE }, (_, i) => 0.3 * Math.max(0, Math.sin((2 * Math.PI * 4 * i) / SAMPLE_RATE)) * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE))
const silence = (s = 2) => new Float32Array(s * SAMPLE_RATE)

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}
const tick = () => new Promise((r) => setTimeout(r, 0))

function harness(opts: { present?: boolean; audio?: () => Float32Array; openFails?: VoiceFailure; persist?: () => Promise<'device' | 'tab' | 'unsaved' | 'failed'> } = {}) {
  const env = {
    body: '',
    caret: 0,
    focused: false,
    ctx: { account: 'acct-a', draft: 'sprint-1', generation: 0 } as Context,
    micOpen: 0,
    micReleased: 0,
    hooks: null as RecorderHooks | null,
    jobs: [] as { audio: Float32Array; language: Language; job: { cancelled: boolean }; d: ReturnType<typeof deferred<string>> }[],
    prepared: 0,
    persisted: 0,
  }
  let n = 0
  const deps: Deps = {
    async openRecorder(hooks) {
      if (opts.openFails) throw opts.openFails
      env.micOpen++
      env.hooks = hooks
      let live = true
      const release = () => {
        if (live) env.micReleased++
        live = false
      }
      return {
        async stop(): Promise<Captured> {
          release()
          const samples = (opts.audio ?? speech)()
          return { samples, seconds: samples.length / SAMPLE_RATE }
        },
        cancel: release,
      }
    },
    engine: {
      present: () => opts.present ?? true,
      async prepare() {
        env.prepared++
      },
      transcribe(audio, language, job) {
        const d = deferred<string>()
        env.jobs.push({ audio, language, job, d })
        return d.promise
      },
    },
    context: () => env.ctx,
    anchor: () => ({ body: env.body, caret: env.focused ? env.caret : env.body.length }),
    body: () => env.body,
    apply(body, caret) {
      env.body = body
      env.caret = caret
    },
    persist: opts.persist ?? (async () => (env.persisted++, 'device')),
    language: () => 'tl',
    maxChars: 2000,
    maxMs: 120_000,
    now: () => 1000,
    newId: () => `rec-${++n}`,
  }
  const s = createVoiceSession(deps)
  return { s, env }
}

async function record(h: ReturnType<typeof harness>) {
  h.s.tap()
  await tick()
  expect(h.s.phase().kind).toBe('recording')
  h.s.stop()
  await tick()
  await tick()
}

describe('voice session: states', () => {
  it('idle → recording → processing → done, and the draft gets the words', async () => {
    const h = harness()
    h.env.body = 'Existing note.'
    expect(h.s.phase().kind).toBe('idle')
    h.s.tap()
    expect(h.s.phase().kind).toBe('starting')
    await tick()
    expect(h.s.phase()).toMatchObject({ kind: 'recording' })
    h.s.stop()
    await tick()
    await tick()
    expect(h.s.phase().kind).toBe('processing')
    expect(h.env.jobs).toHaveLength(1)
    expect(h.env.jobs[0].language).toBe('tl')
    h.env.jobs[0].d.resolve(' Parang ang bagal ng CI kanina.')
    await tick()
    expect(h.env.body).toBe('Existing note. Parang ang bagal ng CI kanina.')
    await tick()
    expect(h.s.phase()).toMatchObject({ kind: 'done', saved: 'device', text: 'Parang ang bagal ng CI kanina.' })
    expect(h.env.micReleased).toBe(1)
  })

  it('asks before the first download, and records while it downloads', async () => {
    const h = harness({ present: false })
    h.s.tap()
    expect(h.s.phase().kind).toBe('offer')
    expect(h.env.micOpen).toBe(0) // nothing before the person agrees
    h.s.accept()
    expect(h.env.prepared).toBe(1)
    await tick()
    expect(h.s.phase().kind).toBe('recording')
  })

  it('"not now" on the offer leaves everything as it was', () => {
    const h = harness({ present: false })
    h.env.body = 'kept'
    h.s.tap()
    h.s.cancel()
    expect(h.s.phase().kind).toBe('idle')
    expect(h.env.micOpen).toBe(0)
    expect(h.env.body).toBe('kept')
  })

  it('reports silence as no speech, without running the model or touching the draft', async () => {
    const h = harness({ audio: () => silence(3) })
    h.env.body = 'kept'
    await record(h)
    expect(h.s.phase()).toMatchObject({ kind: 'empty', quiet: true })
    expect(h.env.jobs).toHaveLength(0)
    expect(h.env.body).toBe('kept')
  })

  it('treats a phantom phrase as no speech', async () => {
    const h = harness({ audio: () => speech(1) })
    await record(h)
    h.env.jobs[0].d.resolve('Thank you for watching!')
    await tick()
    expect(h.s.phase().kind).toBe('empty')
    expect(h.env.body).toBe('')
  })
})

describe('voice session: permission and microphone failures', () => {
  it.each(['denied', 'no-mic', 'mic-busy', 'insecure', 'unsupported'] as const)('%s ends in a clear failure and leaves the text alone', async (code) => {
    const h = harness({ openFails: new VoiceFailure(code) })
    h.env.body = 'kept'
    h.s.tap()
    await tick()
    expect(h.s.phase()).toMatchObject({ kind: 'failed', error: code, retry: false })
    expect(h.env.body).toBe('kept')
  })

  it('an interruption stops recording and asks; it never resumes on its own', async () => {
    const h = harness()
    h.s.tap()
    await tick()
    h.env.hooks!.onInterrupt()
    await tick()
    expect(h.s.phase()).toMatchObject({ kind: 'interrupted' })
    expect(h.env.micReleased).toBe(1)
    expect(h.env.micOpen).toBe(1)
    h.s.keep()
    await tick()
    expect(h.env.jobs).toHaveLength(1)
  })

  it('reaching the time limit stops and transcribes', async () => {
    const h = harness()
    h.s.tap()
    await tick()
    h.env.hooks!.onLimit()
    await tick()
    await tick()
    expect(h.s.phase().kind).toBe('processing')
    expect(h.env.micReleased).toBe(1)
  })
})

describe('voice session: cancel, retry, duplicates', () => {
  it('cancel while recording releases the microphone and changes nothing', async () => {
    const h = harness()
    h.env.body = 'kept'
    h.s.tap()
    await tick()
    h.s.cancel()
    expect(h.s.phase().kind).toBe('idle')
    expect(h.env.micReleased).toBe(1)
    expect(h.env.body).toBe('kept')
  })

  it('cancel while the microphone permission prompt is open still releases it afterwards', async () => {
    const h = harness()
    h.s.tap()
    h.s.cancel()
    await tick()
    expect(h.s.phase().kind).toBe('idle')
    expect(h.env.micOpen).toBe(1)
    expect(h.env.micReleased).toBe(1)
  })

  it('cancel while transcribing: the late result never reaches the draft', async () => {
    const h = harness()
    h.env.body = 'kept'
    await record(h)
    h.s.cancel()
    expect(h.env.jobs[0].job.cancelled).toBe(true)
    h.env.jobs[0].d.resolve('late words')
    await tick()
    expect(h.env.body).toBe('kept')
    expect(h.s.phase().kind).toBe('idle')
  })

  it('a failed transcription keeps the audio for a retry, and the retry inserts once', async () => {
    const h = harness()
    await record(h)
    h.env.jobs[0].d.reject(new VoiceFailure('memory'))
    await tick()
    expect(h.s.phase()).toMatchObject({ kind: 'failed', error: 'memory', retry: true })
    h.s.retry()
    await tick()
    expect(h.env.jobs).toHaveLength(2)
    h.env.jobs[1].d.resolve('Isang beses lang.')
    await tick()
    expect(h.env.body).toBe('Isang beses lang.')
    // The first attempt answering late changes nothing.
    h.env.jobs[0].d.resolve('Isang beses lang.')
    await tick()
    expect(h.env.body).toBe('Isang beses lang.')
  })

  it('repeated taps and duplicate stops start one recording and one job', async () => {
    const h = harness()
    h.s.tap()
    h.s.tap()
    h.s.tap()
    await tick()
    expect(h.env.micOpen).toBe(1)
    h.s.stop()
    h.s.stop()
    h.s.tap()
    await tick()
    await tick()
    expect(h.env.jobs).toHaveLength(1)
  })

  it('a new recording supersedes a failed one; the old result is ignored', async () => {
    const h = harness()
    await record(h)
    h.env.jobs[0].d.reject(new VoiceFailure('engine'))
    await tick()
    await record(h)
    h.env.jobs[1].d.resolve('second')
    h.env.jobs[0].d.resolve('first')
    await tick()
    expect(h.env.body).toBe('second')
  })
})

describe('voice session: the draft and the account', () => {
  it('typing during transcription is kept; the words go at the end', async () => {
    const h = harness()
    h.env.body = 'Start.'
    h.env.focused = true
    h.env.caret = 0
    await record(h)
    h.env.body = 'Start. Typed meanwhile.'
    h.env.jobs[0].d.resolve('Spoken.')
    await tick()
    expect(h.env.body).toBe('Start. Typed meanwhile. Spoken.')
  })

  it('a result for another account is never inserted', async () => {
    const h = harness()
    await record(h)
    h.env.ctx = { account: 'acct-b', draft: 'sprint-1', generation: 0 }
    h.env.jobs[0].d.resolve('private words')
    await tick()
    expect(h.env.body).toBe('')
    expect(h.s.phase().kind).not.toBe('done')
  })

  it('a result for another draft (sprint) is never inserted', async () => {
    const h = harness()
    await record(h)
    h.env.ctx = { ...h.env.ctx, draft: 'sprint-2' }
    h.env.jobs[0].d.resolve('for sprint 1 only')
    await tick()
    expect(h.env.body).toBe('')
  })

  it('a result after local data was cleared (sign-out) is never inserted', async () => {
    const h = harness()
    await record(h)
    h.env.ctx = { ...h.env.ctx, generation: 1 }
    h.env.jobs[0].d.resolve('gone')
    await tick()
    expect(h.env.body).toBe('')
  })

  it('dispose (composer gone) stops the microphone and drops pending work', async () => {
    const h = harness()
    h.s.tap()
    await tick()
    h.s.dispose()
    expect(h.env.micReleased).toBe(1)
    const h2 = harness()
    await record(h2)
    h2.s.dispose()
    expect(h2.env.jobs[0].job.cancelled).toBe(true)
    h2.env.jobs[0].d.resolve('late')
    await tick()
    expect(h2.env.body).toBe('')
  })

  it('too long for the draft: nothing is cut, the words stay available', async () => {
    const h = harness()
    h.env.body = 'x'.repeat(1990)
    await record(h)
    h.env.jobs[0].d.resolve('these words do not fit')
    await tick()
    expect(h.env.body).toBe('x'.repeat(1990))
    expect(h.s.phase()).toMatchObject({ kind: 'failed', error: 'too-long', text: 'these words do not fit' })
  })

  it('reports where the draft was actually saved', async () => {
    const tab = harness({ persist: async () => 'tab' })
    await record(tab)
    tab.env.jobs[0].d.resolve('words')
    await tick()
    await tick()
    expect(tab.s.phase()).toMatchObject({ kind: 'done', saved: 'tab' })
    const failed = harness({ persist: async () => 'failed' })
    await record(failed)
    failed.env.jobs[0].d.resolve('words')
    await tick()
    await tick()
    expect(failed.s.phase()).toMatchObject({ kind: 'done', saved: 'failed' })
    expect(failed.env.body).toBe('words') // still on screen
  })

  it('undo takes the words back out only if nothing changed since', async () => {
    const h = harness()
    h.env.body = 'Before.'
    await record(h)
    h.env.jobs[0].d.resolve('Spoken.')
    await tick()
    h.s.undo()
    expect(h.env.body).toBe('Before.')
    const h2 = harness()
    await record(h2)
    h2.env.jobs[0].d.resolve('Spoken.')
    await tick()
    h2.env.body += ' edited'
    h2.s.undo()
    expect(h2.env.body).toBe('Spoken. edited')
    expect(h2.s.phase()).toMatchObject({ kind: 'done', undoable: false })
  })

  it('level updates only reach listeners while recording', async () => {
    const h = harness()
    const levels = vi.fn()
    h.s.onLevel(levels)
    h.s.tap()
    await tick()
    h.env.hooks!.onLevel(0.4)
    expect(levels).toHaveBeenCalledWith(0.4)
    h.s.cancel()
    h.env.hooks!.onLevel(0.5)
    expect(levels).toHaveBeenCalledTimes(1)
  })
})
