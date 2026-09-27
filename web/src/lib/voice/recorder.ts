/**
 * The microphone, for one recording. Raw samples are captured with an AudioWorklet (no
 * MediaRecorder, so there's no compressed format to decode and nothing differs by browser),
 * kept in memory only, and resampled to 16 kHz when recording stops. The microphone is released
 * the moment recording stops or is cancelled, and the audio thread with it.
 *
 * Recording stops on its own (and is never restarted) when the page is hidden, the system
 * suspends audio (a call, the screen locking), or the microphone goes away.
 */
// A real file, never an inlined data: URL (the content security policy allows scripts from 'self' only).
import workletUrl from './capture-worklet.js?url&no-inline'
import { resampleTo16k, SAMPLE_RATE } from './speech'
import { VoiceFailure, type Captured, type Recorder, type RecorderHooks } from './session'

function micError(e: unknown): VoiceFailure {
  const name = (e as DOMException)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return new VoiceFailure('denied')
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return new VoiceFailure('no-mic')
  if (name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError') return new VoiceFailure('mic-busy')
  return new VoiceFailure('mic-failed')
}

async function to16k(chunks: Float32Array[], length: number, rate: number): Promise<Float32Array> {
  const all = new Float32Array(length)
  let o = 0
  for (const c of chunks) {
    all.set(c, o)
    o += c.length
  }
  if (rate === SAMPLE_RATE || length === 0) return all
  try {
    const ctx = new OfflineAudioContext(1, Math.ceil((length * SAMPLE_RATE) / rate), SAMPLE_RATE)
    const buf = ctx.createBuffer(1, length, rate)
    buf.copyToChannel(all, 0)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    src.start()
    return (await ctx.startRendering()).getChannelData(0)
  } catch {
    return resampleTo16k(all, rate)
  }
}

export async function openRecorder(hooks: RecorderHooks): Promise<Recorder> {
  if (!window.isSecureContext) throw new VoiceFailure('insecure')
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode !== 'function') throw new VoiceFailure('unsupported')
  // Created before the first await, while the tap still counts as a user gesture (Safari).
  const ctx = new AudioContext({ latencyHint: 'interactive' })
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  } catch (e) {
    void ctx.close().catch(() => {})
    throw micError(e)
  }
  const chunks: Float32Array[] = []
  let length = 0
  let done = false
  let node: AudioWorkletNode | null = null
  let source: MediaStreamAudioSourceNode | null = null
  let limit: ReturnType<typeof setTimeout> | null = null
  const track = stream.getAudioTracks()[0]

  const teardown = () => {
    if (done) return
    done = true
    if (limit) clearTimeout(limit)
    document.removeEventListener('visibilitychange', onHidden)
    window.removeEventListener('pagehide', onHidden)
    ctx.onstatechange = null
    if (track) track.onended = null
    try {
      node?.port.postMessage('stop')
      node?.port.close()
      node?.disconnect()
      source?.disconnect()
    } catch {
      /* already gone */
    }
    for (const t of stream.getTracks()) t.stop()
    void ctx.close().catch(() => {})
  }
  const onHidden = (e: Event) => {
    if (e.type === 'pagehide' || document.visibilityState === 'hidden') hooks.onInterrupt()
  }

  try {
    await ctx.audioWorklet.addModule(workletUrl)
    if (ctx.state === 'suspended') await ctx.resume()
    source = ctx.createMediaStreamSource(stream)
    node = new AudioWorkletNode(ctx, 'muni-capture', { numberOfInputs: 1, numberOfOutputs: 0 })
    node.port.onmessage = (e: MessageEvent<{ samples: Float32Array; rms: number }>) => {
      if (done) return
      chunks.push(e.data.samples)
      length += e.data.samples.length
      // Speech sits around 0.01–0.2 RMS; a gentle curve makes quiet voices visible too.
      hooks.onLevel(Math.min(1, Math.sqrt(e.data.rms * 6)))
    }
    source.connect(node)
  } catch {
    teardown()
    throw new VoiceFailure('unsupported')
  }

  if (track) track.onended = () => hooks.onInterrupt()
  ctx.onstatechange = () => {
    // Safari reports 'interrupted' (calls, Siri, the screen locking); others suspend.
    if ((ctx.state as string) === 'interrupted' || ctx.state === 'suspended') hooks.onInterrupt()
  }
  document.addEventListener('visibilitychange', onHidden)
  window.addEventListener('pagehide', onHidden)
  limit = setTimeout(() => hooks.onLimit(), hooks.maxMs)

  return {
    async stop(): Promise<Captured> {
      const rate = ctx.sampleRate
      teardown()
      const samples = await to16k(chunks, length, rate)
      chunks.length = 0
      return { samples, seconds: samples.length / SAMPLE_RATE }
    },
    cancel() {
      teardown()
      chunks.length = 0
    },
  }
}
