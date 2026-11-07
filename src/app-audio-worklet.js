// Independent bounded PCM queues preserve each application's timeline. Sources
// are mixed into one stereo track with a peak limiter, never local playback.
class AppAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.capacity = 9600 // 200 ms per source; discard stale backlog
    this.sources = new Map()
    this.gain = 1
    this.port.onmessage = ({ data }) => {
      const pcm = data instanceof Uint8Array ? data : data?.pcm
      const index = data instanceof Uint8Array ? 0 : data?.sourceIndex
      if (!(pcm instanceof Uint8Array) || pcm.byteLength % 4 || !Number.isInteger(index) || index < 0 || index >= 8) return
      let source = this.sources.get(index)
      if (!source) {
        source = { left: new Float32Array(this.capacity), right: new Float32Array(this.capacity), read: 0, write: 0, size: 0, primed: false }
        this.sources.set(index, source)
      }
      const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
      for (let offset = 0; offset < pcm.byteLength; offset += 4) {
        if (source.size === this.capacity) { source.read = (source.read + 1) % this.capacity; source.size-- }
        source.left[source.write] = view.getInt16(offset, true) / 32768
        source.right[source.write] = view.getInt16(offset + 2, true) / 32768
        source.write = (source.write + 1) % this.capacity
        source.size++
      }
    }
  }
  get size() { let size = 0; for (const source of this.sources.values()) size += source.size; return size }
  process(_inputs, outputs) {
    const output = outputs[0]
    if (!output?.[0]) return true
    for (const channel of output) channel.fill(0)
    for (const source of this.sources.values()) {
      if (!source.primed && source.size >= 1920) source.primed = true
      if (!source.primed) continue
      for (let i = 0; i < output[0].length; i++) {
        if (!source.size) { source.primed = false; break }
        output[0][i] += source.left[source.read]
        if (output[1]) output[1][i] += source.right[source.read]
        source.read = (source.read + 1) % this.capacity
        source.size--
      }
    }
    let peak = 0
    for (const channel of output) for (const value of channel) peak = Math.max(peak, Math.abs(value))
    const target = peak > .98 ? .98 / peak : 1
    this.gain = target < this.gain ? target : Math.min(target, this.gain + .005)
    if (this.gain < 1) for (const channel of output) for (let i = 0; i < channel.length; i++) channel[i] *= this.gain
    return true
  }
}
registerProcessor('barracord-app-audio', AppAudioProcessor)
