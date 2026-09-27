import { describe, expect, it } from 'vitest'
import { cleanTranscript, collapseLoops, detectSpeech, resampleTo16k, SAMPLE_RATE } from './speech'

const seeded = (seed = 7) => {
  let x = seed
  return () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1
}
const secs = (s: number, f: (i: number) => number) => Float32Array.from({ length: Math.round(s * SAMPLE_RATE) }, (_, i) => f(i))
/** Syllable-like bursts: a tone that swells and fades a few times a second, over light noise. */
const speechLike = (s: number, rnd = seeded()) => secs(s, (i) => 0.3 * Math.max(0, Math.sin((2 * Math.PI * 4 * i) / SAMPLE_RATE)) * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE) + rnd() * 0.003)

describe('speech detection', () => {
  it('finds nothing in digital silence', () => {
    expect(detectSpeech(secs(3, () => 0)).range).toBeNull()
  })

  it('finds nothing in steady hiss or hum', () => {
    const rnd = seeded()
    expect(detectSpeech(secs(4, () => rnd() * 0.05)).range).toBeNull()
    expect(detectSpeech(secs(4, (i) => 0.1 * Math.sin((2 * Math.PI * 60 * i) / SAMPLE_RATE))).range).toBeNull()
  })

  it('finds speech and trims the silence around it', () => {
    const quiet = secs(2, () => 0)
    const talk = speechLike(2)
    const all = new Float32Array(quiet.length * 2 + talk.length)
    all.set(quiet, 0)
    all.set(talk, quiet.length)
    all.set(quiet, quiet.length + talk.length)
    const r = detectSpeech(all)
    expect(r.speechMs).toBeGreaterThan(500)
    expect(r.range).not.toBeNull()
    const [a, b] = r.range!
    expect(a).toBeGreaterThan(SAMPLE_RATE * 1.2)
    expect(b).toBeLessThan(SAMPLE_RATE * 4.8)
  })

  it('ignores a single click', () => {
    const a = secs(3, () => 0)
    a[20000] = 0.9
    expect(detectSpeech(a).range).toBeNull()
  })
})

describe('cleaning recognition output', () => {
  it('keeps what was said, including informal words and fillers', () => {
    const said = 'Uhm, parang ang bagal ng CI kanina, like sobrang tagal talaga.'
    expect(cleanTranscript(said, 5000)).toBe(said)
  })

  it('drops phantom phrases Whisper makes up from near-silence', () => {
    expect(cleanTranscript(' Thank you for watching!', 800)).toBe('')
    expect(cleanTranscript('you', 600)).toBe('')
    expect(cleanTranscript('...', 600)).toBe('')
    expect(cleanTranscript('[Music]', 3000)).toBe('')
  })

  it('keeps a real "thank you" from a real recording', () => {
    expect(cleanTranscript('Thank you.', 4000)).toBe('Thank you.')
  })

  it('collapses decoding loops but keeps human repetition', () => {
    expect(collapseLoops('kaya kaya kaya kaya kaya kaya kaya kaya')).toBe('kaya')
    expect(collapseLoops('hindi hindi, sabi ko hindi talaga')).toBe('hindi hindi, sabi ko hindi talaga')
    expect(collapseLoops('we should fix it we should fix it we should fix it we should fix it')).toBe('we should fix it')
    expect(collapseLoops('no no no')).toBe('no no no')
  })
})

describe('resampling', () => {
  it('keeps duration and a low tone, and removes content above 8 kHz', () => {
    const rate = 48000
    const low = Float32Array.from({ length: rate }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / rate))
    const high = Float32Array.from({ length: rate }, (_, i) => Math.sin((2 * Math.PI * 12000 * i) / rate))
    const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length)
    const l = resampleTo16k(low, rate)
    expect(l.length).toBe(16000)
    expect(rms(l.subarray(100, -100))).toBeGreaterThan(0.6)
    expect(rms(resampleTo16k(high, rate).subarray(100, -100))).toBeLessThan(0.05)
  })
})
