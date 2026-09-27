/**
 * Voice capture in the composer: a microphone beside the writing, and one small panel that says
 * what's happening — never a separate screen, never a chat. On a phone the panel is a sheet at
 * the bottom (in reach of a thumb, clear of the keyboard); on wider screens it sits in the
 * composer's tool row, so the field never moves.
 *
 * The ripple and trace are drawn from the microphone's measured level; nothing is simulated.
 * Progress is shown only where it's measured (the model download).
 */
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { clsx } from 'clsx'
import { Copy, Mic, Square, X } from 'lucide-react'
import { MODEL_BYTES } from '@/lib/voice/assets'
import { voiceEngine, type ModelState } from '@/lib/voice/engine'
import type { Phase, Saved, VoiceError, VoiceSession } from '@/lib/voice/session'

export const MAX_MS = 120_000
const mb = (n: number) => `${Math.round(n / 1e6)} MB`
const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function usePhase(session: VoiceSession): Phase {
  return useSyncExternalStore(session.subscribe, session.phase, session.phase)
}
function useModel(): ModelState {
  return useSyncExternalStore(
    (f) => voiceEngine.subscribe(f),
    () => voiceEngine.model,
    () => voiceEngine.model,
  )
}

const ERRORS: Record<VoiceError, string> = {
  unsupported: 'Voice isn’t available in this browser. Typing works as always.',
  insecure: 'Voice needs a secure (https) connection. Typing works as always.',
  denied: 'Muni can’t use the microphone. Allow it for this site in your browser’s settings, then try again.',
  'no-mic': 'No microphone found. Connect one, then try again.',
  'mic-busy': 'Another app is using the microphone. Close it, then try again.',
  'mic-failed': 'The microphone didn’t start. Try again.',
  download: 'The speech model didn’t finish downloading. Your recording is still here.',
  offline: 'You’re offline, and the speech model isn’t on this device yet. Your recording is kept while this page stays open.',
  storage: `There isn’t room on this device for the speech model (${mb(MODEL_BYTES)}). Free some space, then try again.`,
  engine: 'Transcription stopped unexpectedly. Your recording is still here.',
  memory: 'This device ran out of memory while transcribing. Close other apps or tabs, then try again.',
  'too-long': 'That’s more than fits in one thought (2,000 characters), so nothing was added.',
}

const SAVED: Record<Saved, string> = {
  pending: 'Adding to your draft…',
  device: 'Added to your draft · saved on this device, not sent',
  tab: 'Added to your draft · kept in this tab, not sent',
  unsaved: 'Added to your draft · choose a sprint to keep it',
  failed: 'Added to your draft, but this device couldn’t save it. Keep this page open, or save the thought.',
}

/** The microphone in the tool row. When recording it becomes the stop button, in the same place. */
export function VoiceButton({ session, panelId }: { session: VoiceSession; panelId: string }) {
  const phase = usePhase(session)
  const recording = phase.kind === 'recording'
  const busy = phase.kind === 'starting' || phase.kind === 'processing' || phase.kind === 'offer' || phase.kind === 'interrupted'
  return (
    <button
      type="button"
      className={clsx('journal-tool journal-voice-mic', recording && 'is-recording')}
      onClick={() => session.tap()}
      aria-pressed={recording}
      aria-controls={panelId}
      aria-disabled={busy || undefined}
      aria-label={recording ? 'Stop recording' : 'Speak instead of typing'}
      title={recording ? 'Stop recording' : 'Speak instead of typing'}
    >
      {recording ? <Square className="size-3.5 fill-current" aria-hidden /> : <Mic className="size-4" aria-hidden />}
      <span className="journal-voice-mic-label">{recording ? 'Stop' : 'Speak'}</span>
    </button>
  )
}

/** Level ripple and a short trace of the last couple of seconds, from real input. */
function Listening({ session }: { session: VoiceSession }) {
  const ring = useRef<HTMLSpanElement>(null)
  const path = useRef<SVGPathElement>(null)
  const bars = useRef<SVGGElement>(null)
  useEffect(() => {
    const N = 40
    const hist = new Float32Array(N)
    let head = 0
    let frame = 0
    let latest = 0
    const draw = () => {
      frame = 0
      ring.current?.style.setProperty('--lvl', latest.toFixed(3))
      if (path.current) {
        let d = ''
        for (let i = 0; i < N; i++) {
          const v = hist[(head + i) % N]
          d += `${i ? 'L' : 'M'}${(i * 100) / (N - 1)} ${(12 - v * 11).toFixed(2)}`
        }
        path.current.setAttribute('d', d)
      }
      if (bars.current) {
        const rects = bars.current.children
        for (let i = 0; i < rects.length; i++) {
          const v = Math.max(0.06, hist[(head + i * 2) % N])
          rects[i].setAttribute('y', (12 - v * 11).toFixed(2))
          rects[i].setAttribute('height', (v * 22).toFixed(2))
        }
      }
    }
    const off = session.onLevel((l) => {
      latest = l
      hist[head] = l
      head = (head + 1) % N
      if (!frame) frame = requestAnimationFrame(draw)
    })
    return () => {
      off()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [session])
  return (
    <span className="journal-voice-live" aria-hidden>
      <span ref={ring} className="journal-voice-ring" />
      <svg className="journal-voice-trace" viewBox="0 0 100 24" preserveAspectRatio="none">
        <path ref={path} className="journal-voice-line" d="M0 12 L100 12" />
        <g ref={bars} className="journal-voice-bars">
          {Array.from({ length: 20 }, (_, i) => (
            <rect key={i} x={i * 5 + 1} width="2.6" rx="1.3" y="11" height="2" />
          ))}
        </g>
      </svg>
    </span>
  )
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(t)
  }, [])
  const ms = now - since
  const near = ms > MAX_MS - 15_000
  return (
    <span className="journal-voice-time">
      <span className="tabular-nums">{clock(ms)}</span>
      <span className={clsx('journal-voice-limit', near && 'is-near')}> / {clock(MAX_MS)}</span>
    </span>
  )
}

function Download({ model }: { model: ModelState }) {
  if (model.kind === 'downloading') {
    const pct = model.total ? Math.min(100, Math.floor((model.loaded / model.total) * 100)) : 0
    return (
      <span className="journal-voice-dl">
        <span>
          Downloading the speech model · {mb(model.loaded)} of {mb(model.total)}
        </span>
        <span className="journal-voice-bar" role="progressbar" aria-label="Speech model download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <span style={{ width: `${pct}%` }} />
        </span>
      </span>
    )
  }
  if (model.kind === 'starting') return <span className="journal-voice-dl">Getting the speech model ready…</span>
  return null
}

/**
 * Everything else: first-use explanation, recording, transcribing, the result, and failures.
 * `onRestore` puts focus back in the field when a flow ends.
 */
export function VoicePanel({ session, id, onRestore }: { session: VoiceSession; id: string; onRestore: () => void }) {
  const phase = usePhase(session)
  const model = useModel()
  const stopRef = useRef<HTMLButtonElement>(null)
  const firstRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const [copied, setCopied] = useState(false)

  // Move focus to the control that matters now, so the keyboard follows the flow.
  useEffect(() => {
    if (phase.kind === 'recording') stopRef.current?.focus({ preventScroll: true })
    else if (phase.kind === 'offer' || phase.kind === 'interrupted' || phase.kind === 'failed' || phase.kind === 'empty') firstRef.current?.focus({ preventScroll: true })
  }, [phase.kind])

  // "Added" fades on its own once it's saved; a problem stays until it's dealt with.
  useEffect(() => {
    if (phase.kind !== 'done' || phase.saved === 'pending' || phase.saved === 'failed') return
    const t = window.setTimeout(() => session.dismiss(), 9000)
    return () => window.clearTimeout(t)
  }, [phase, session])

  const end = useCallback(
    (fn: () => void) => () => {
      fn()
      onRestore()
    },
    [onRestore],
  )

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    if (phase.kind === 'recording' || phase.kind === 'starting' || phase.kind === 'processing' || phase.kind === 'offer' || phase.kind === 'interrupted') end(() => session.cancel())()
    else end(() => session.dismiss())()
  }

  let body: ReactNode = null
  let sheet = true
  switch (phase.kind) {
    case 'idle':
      body = null
      break
    case 'offer':
      body = (
        <>
          <p id={titleId} className="journal-voice-title">Speak your thought</p>
          <p className="journal-voice-note">
            Muni turns speech into text on this device; your voice isn’t uploaded. The first time, it downloads a speech model from Muni ({mb(MODEL_BYTES)}, once) and keeps it in this browser.
          </p>
          <p className="journal-voice-note">English, Tagalog and Taglish. Read it over before you save; recognition isn’t perfect.</p>
          <div className="journal-voice-actions">
            <button ref={firstRef} type="button" className="journal-voice-primary" onClick={() => session.accept()}>
              <Mic className="size-4" aria-hidden /> Download and record
            </button>
            <button type="button" className="journal-voice-quiet" onClick={end(() => session.cancel())}>
              Not now
            </button>
          </div>
        </>
      )
      break
    case 'starting':
      body = (
        <div className="journal-voice-row">
          <span className="journal-voice-status">Waiting for the microphone…</span>
          <button type="button" className="journal-voice-quiet ml-auto" onClick={end(() => session.cancel())}>
            Cancel
          </button>
        </div>
      )
      break
    case 'recording':
      body = (
        <>
          <div className="journal-voice-row">
            <button ref={stopRef} type="button" className="journal-voice-stop" onClick={() => session.stop()} aria-label="Stop recording and transcribe">
              <Listening session={session} />
              <Square className="relative size-4 fill-current" aria-hidden />
            </button>
            <span className="journal-voice-rec">
              <span className="journal-voice-dot" aria-hidden /> Recording <Elapsed since={phase.startedAt} />
            </span>
            <button type="button" className="journal-voice-quiet ml-auto" onClick={end(() => session.cancel())} aria-label="Cancel recording">
              <X className="size-4 sm:hidden" aria-hidden />
              <span className="max-sm:sr-only">Cancel</span>
            </button>
          </div>
          <Download model={model} />
        </>
      )
      break
    case 'interrupted':
      body = (
        <>
          <p className="journal-voice-status">Recording stopped when Muni was interrupted ({clock(phase.seconds * 1000)} captured). It won’t restart on its own.</p>
          <div className="journal-voice-actions">
            <button ref={firstRef} type="button" className="journal-voice-primary" onClick={() => session.keep()}>
              Transcribe it
            </button>
            <button type="button" className="journal-voice-quiet" onClick={end(() => session.cancel())}>
              Discard
            </button>
          </div>
        </>
      )
      break
    case 'processing':
      body = (
        <>
          <div className="journal-voice-row">
            <span className="journal-voice-status">
              <span className="journal-voice-think" aria-hidden />
              Transcribing on this device…
            </span>
            <button type="button" className="journal-voice-quiet ml-auto" onClick={end(() => session.cancel())}>
              Cancel
            </button>
          </div>
          <Download model={model} />
        </>
      )
      break
    case 'done':
      sheet = false
      body = (
        <div className="journal-voice-row journal-voice-row--done">
          <span className={clsx('journal-voice-status', phase.saved === 'failed' && 'text-warn')}>
            <span className={clsx('dot', phase.saved === 'failed' ? 'dot--attention' : 'dot--draft')} aria-hidden /> {SAVED[phase.saved]}
          </span>
          {phase.undoable ? (
            <button type="button" className="journal-voice-quiet" onClick={end(() => session.undo())}>
              Undo
            </button>
          ) : null}
        </div>
      )
      break
    case 'empty':
      body = (
        <>
          <p className="journal-voice-status">{phase.quiet ? 'No sound came through. Check that the microphone isn’t muted.' : 'No speech caught, so nothing was added. If you spoke, try again a little closer to the microphone.'}</p>
          <div className="journal-voice-actions">
            <button ref={firstRef} type="button" className="journal-voice-primary" onClick={() => session.tap()}>
              <Mic className="size-4" aria-hidden /> Try again
            </button>
            <button type="button" className="journal-voice-quiet" onClick={end(() => session.dismiss())}>
              Close
            </button>
          </div>
        </>
      )
      break
    case 'failed':
      body = (
        <>
          <p className="journal-voice-status" role="alert">
            {ERRORS[phase.error]}
          </p>
          {phase.text ? <p className="journal-voice-transcript">{phase.text}</p> : null}
          <div className="journal-voice-actions">
            {phase.retry ? (
              <button ref={firstRef} type="button" className="journal-voice-primary" onClick={() => session.retry()}>
                Try transcribing again
              </button>
            ) : phase.text ? (
              <button
                ref={firstRef}
                type="button"
                className="journal-voice-primary"
                onClick={() => {
                  void navigator.clipboard?.writeText(phase.text ?? '').then(() => setCopied(true), () => setCopied(false))
                }}
              >
                <Copy className="size-4" aria-hidden /> {copied ? 'Copied' : 'Copy the text'}
              </button>
            ) : phase.error === 'unsupported' || phase.error === 'insecure' ? null : (
              <button ref={firstRef} type="button" className="journal-voice-primary" onClick={() => session.tap()}>
                <Mic className="size-4" aria-hidden /> Try again
              </button>
            )}
            <button ref={phase.retry || phase.text || (phase.error !== 'unsupported' && phase.error !== 'insecure') ? undefined : firstRef} type="button" className="journal-voice-quiet" onClick={end(() => session.dismiss())}>
              {phase.retry || phase.text ? 'Discard' : 'Close'}
            </button>
          </div>
        </>
      )
      break
  }

  return (
    <>
      <div
        id={id}
        className={clsx('journal-voice', body && 'is-open', sheet ? 'journal-voice--sheet' : 'journal-voice--inline', phase.kind === 'recording' && 'is-recording')}
        role={body && sheet ? 'group' : undefined}
        aria-labelledby={phase.kind === 'offer' ? titleId : undefined}
        aria-label={phase.kind === 'offer' ? undefined : body && sheet ? 'Voice' : undefined}
        onKeyDown={onKey}
        hidden={!body}
      >
        {body}
      </div>
      <Announcer phase={phase} />
    </>
  )
}

/** Short spoken updates for screen readers, one per change of state. */
function Announcer({ phase }: { phase: Phase }) {
  const text =
    phase.kind === 'recording'
      ? 'Recording. Press Stop when you’re done.'
      : phase.kind === 'processing'
        ? 'Recording stopped. Transcribing on this device.'
        : phase.kind === 'done' && phase.saved !== 'pending'
          ? SAVED[phase.saved]
          : phase.kind === 'empty'
            ? 'No speech caught. Nothing was added.'
            : phase.kind === 'interrupted'
              ? 'Recording stopped when Muni was interrupted.'
              : ''
  return (
    <span className="sr-only" aria-live="polite">
      {text}
    </span>
  )
}

/** Account → Voice: whether the speech model is on this device, and a way to remove it. */
export function VoiceDeviceSetting() {
  const [state, setState] = useState<'checking' | 'absent' | 'present' | 'removing'>('checking')
  const [offline, setOffline] = useState(false)
  useEffect(() => {
    let live = true
    void (async () => {
      const here = await voiceEngine.check()
      const runtime = here ? await voiceRuntimeCached() : false
      if (!live) return
      setState(here ? 'present' : 'absent')
      setOffline(here && runtime)
    })()
    return () => {
      live = false
    }
  }, [])
  if (state === 'checking') return null
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <p className="text-ink">
        {state === 'absent'
          ? `The speech model isn’t on this device. It downloads (${mb(MODEL_BYTES)}, once) the first time you choose Speak.`
          : `The speech model is on this device (${mb(MODEL_BYTES)})${offline ? ' and works offline' : ''}.`}
      </p>
      {state === 'present' || state === 'removing' ? (
        <button
          type="button"
          className="rounded-lg px-2.5 py-1.5 text-ink-soft underline-offset-4 hover:bg-ink/5 hover:text-ink hover:underline"
          disabled={state === 'removing'}
          onClick={async () => {
            setState('removing')
            await voiceEngine.forget()
            setState('absent')
            setOffline(false)
          }}
        >
          Remove it from this device
        </button>
      ) : null}
    </div>
  )
}

/** Whether the service worker holds the voice runtime (so recognition works without a connection). */
async function voiceRuntimeCached(): Promise<boolean> {
  try {
    if (!navigator.serviceWorker?.controller) return false
    const c = await caches.open('muni-voice')
    return (await c.keys()).length >= 3
  } catch {
    return false
  }
}
