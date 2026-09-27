// Runs on the audio thread. Copies microphone samples (mono) to the page in batches, with the
// batch's loudness for the level ripple. Plain JavaScript: audio worklets load as-is.
class MuniCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buf = new Float32Array(2048)
    this.n = 0
    this.on = true
    this.port.onmessage = (e) => {
      if (e.data === 'stop') this.on = false
    }
  }
  process(inputs) {
    if (!this.on) return false
    const ch = inputs[0]
    if (!ch || !ch.length) return true
    const a = ch[0]
    for (let i = 0; i < a.length; i++) {
      let v = a[i]
      // Down-mix: average the channels the device gives us.
      for (let c = 1; c < ch.length; c++) v += ch[c][i]
      this.buf[this.n++] = ch.length > 1 ? v / ch.length : v
      if (this.n === this.buf.length) {
        let sum = 0
        for (let k = 0; k < this.n; k++) sum += this.buf[k] * this.buf[k]
        const out = this.buf
        this.port.postMessage({ samples: out, rms: Math.sqrt(sum / this.n) }, [out.buffer])
        this.buf = new Float32Array(2048)
        this.n = 0
      }
    }
    return true
  }
}
registerProcessor('muni-capture', MuniCapture)
