/**
 * Plain signal checks around recognition. Nothing here changes what someone said: it decides
 * whether there was speech at all, trims the silence at the edges (where Whisper tends to invent
 * words), and drops the handful of phrases Whisper is known to produce from silence or noise.
 */

export const SAMPLE_RATE = 16000
const FRAME = 480 // 30 ms at 16 kHz

export type SpeechCheck = {
  /** Milliseconds of audio loud enough, relative to the room, to be speech. */
  speechMs: number
  /** Sample range worth sending to recognition (speech plus a little padding), or null. */
  range: [number, number] | null
  /** Loudest frame, dBFS. Very quiet recordings get a hint about the microphone. */
  peakDb: number
}

const db = (rms: number) => (rms > 0 ? 20 * Math.log10(rms) : -120)

/**
 * Energy-based detection at 16 kHz. A frame counts as speech when it is well above this
 * recording's own noise floor and above an absolute level, so steady hiss or hum doesn't pass.
 */
export function detectSpeech(samples: Float32Array, opts: { minSpeechMs?: number; padMs?: number } = {}): SpeechCheck {
  const frames = Math.floor(samples.length / FRAME)
  if (frames === 0) return { speechMs: 0, range: null, peakDb: -120 }
  const levels = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let sum = 0
    for (let i = f * FRAME; i < (f + 1) * FRAME; i++) sum += samples[i] * samples[i]
    levels[f] = db(Math.sqrt(sum / FRAME))
  }
  const sorted = Float32Array.from(levels).sort()
  const floor = sorted[Math.floor(frames * 0.1)]
  const peakDb = sorted[frames - 1]
  const threshold = Math.max(floor + 12, -75)
  // Speech also varies: a frame must stand out from the steady level of the recording.
  const median = sorted[Math.floor(frames * 0.5)]
  let first = -1
  let last = -1
  let count = 0
  for (let f = 0; f < frames; f++) {
    if (levels[f] > threshold && levels[f] > median + 3) {
      count++
      if (first < 0) first = f
      last = f
    }
  }
  const speechMs = count * 30
  if (speechMs < (opts.minSpeechMs ?? 240)) return { speechMs, range: null, peakDb }
  const pad = Math.round(((opts.padMs ?? 400) / 1000) * SAMPLE_RATE)
  return { speechMs, range: [Math.max(0, first * FRAME - pad), Math.min(samples.length, (last + 1) * FRAME + pad)], peakDb }
}

/** Phrases Whisper produces from silence, noise or music. Dropped only when they're the whole result. */
const PHANTOMS = [
  'you',
  'thank you',
  'thanks',
  'thank you for watching',
  'thanks for watching',
  'thank you very much',
  "i'm sorry",
  'sorry',
  'thank you so much for watching',
  'please subscribe',
  'subscribe',
  'bye',
  'salamat',
  'salamat sa panonood',
  'maraming salamat',
  'music',
  'applause',
  'silence',
  'and',
  'so',
  'okay',
]
const bare = (t: string) =>
  t
    .toLowerCase()
    .replace(/[[\]().,!?…"“”'’♪*-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Cleans recognition output without rewriting it:
 * - removes bracketed non-speech tags Whisper emits ("[Music]", "(upbeat music)", "♪");
 * - collapses a decoding loop into one occurrence: a phrase of three or more words repeated back
 *   to back three or more times, or a word or two repeated six or more times. People repeat
 *   themselves ("hindi, hindi"), so shorter repeats are kept exactly as recognised;
 * - treats a lone known phantom phrase from a short recording as no speech.
 */
export function cleanTranscript(text: string, speechMs: number): string {
  let t = text
    .replace(/\[[^\]]*\]|\([^)]*(music|applause|laugh|silence|noise|inaudible)[^)]*\)|♪+/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
  t = collapseLoops(t)
  if (!bare(t)) return ''
  if (speechMs < 2500 && PHANTOMS.includes(bare(t))) return ''
  // Whisper sometimes returns only an ellipsis for noise.
  if (/^[.\s…]+$/.test(t)) return ''
  return t
}

export function collapseLoops(text: string): string {
  const words = text.split(/\s+/)
  if (words.length < 6) return text
  const out: string[] = []
  let i = 0
  const key = (w: string) => bare(w)
  outer: while (i < words.length) {
    for (let n = Math.min(12, Math.floor((words.length - i) / 3)); n >= 1; n--) {
      let reps = 1
      while (i + (reps + 1) * n <= words.length && words.slice(i + reps * n, i + (reps + 1) * n).every((w, k) => key(w) === key(words[i + k]))) reps++
      if (reps >= (n <= 2 ? 6 : 3)) {
        out.push(...words.slice(i, i + n))
        i += reps * n
        continue outer
      }
    }
    out.push(words[i])
    i++
  }
  return out.join(' ')
}

/**
 * Down-mixes are done by the browser; this resamples mono audio to 16 kHz with a windowed-sinc
 * low-pass, for browsers where OfflineAudioContext isn't available or fails.
 */
export function resampleTo16k(input: Float32Array, rate: number): Float32Array {
  if (rate === SAMPLE_RATE) return input
  const ratio = rate / SAMPLE_RATE
  const outLen = Math.floor(input.length / ratio)
  const out = new Float32Array(outLen)
  const cutoff = Math.min(1, 1 / ratio) * 0.95
  const half = 16
  for (let o = 0; o < outLen; o++) {
    const center = o * ratio
    const lo = Math.max(0, Math.ceil(center - half * ratio))
    const hi = Math.min(input.length - 1, Math.floor(center + half * ratio))
    let acc = 0
    let norm = 0
    for (let i = lo; i <= hi; i++) {
      const x = (i - center) * cutoff
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)
      const w = 0.5 + 0.5 * Math.cos((Math.PI * (i - center)) / (half * ratio + 1))
      const k = sinc * w
      acc += input[i] * k
      norm += k
    }
    out[o] = norm ? acc / norm : 0
  }
  return out
}
