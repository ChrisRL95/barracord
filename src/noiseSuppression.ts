import { LocalAudioTrack, Track } from 'livekit-client'
import type { AudioCaptureOptions, AudioProcessorOptions, Room, TrackProcessor } from 'livekit-client'
import workletSource from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?raw'
import wasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url&inline'
import simdWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url&inline'

export type NoiseMode = 'off' | 'basic' | 'rnnoise'
export const noiseModeLabels: Record<NoiseMode, string> = { off: 'Desligado', basic: 'Básico', rnnoise: 'RNNoise' }
export function loadNoiseMode(): NoiseMode {
  const saved = localStorage.getItem('barracord.noiseSuppression')
  return saved === 'off' || saved === 'basic' ? saved : 'rnnoise'
}
export function microphoneCaptureOptions(mode: NoiseMode, deviceId = 'default'): AudioCaptureOptions {
  return { ...(deviceId === 'default' ? {} : { deviceId: { exact: deviceId } }),
    sampleRate: 48000, channelCount: 1, echoCancellation: true, autoGainControl: true,
    voiceIsolation: false, noiseSuppression: mode === 'basic' }
}

let assets: Promise<{ library: typeof import('@sapphi-red/web-noise-suppressor'); binary: ArrayBuffer }> | undefined
let moduleUrl: string | undefined
function loadAssets() {
  assets ??= (async () => {
    const library = await import('@sapphi-red/web-noise-suppressor')
    // The WASM URLs are bundled data URLs, including for file:// installers.
    const binary = await library.loadRnnoise({ url: wasmUrl, simdUrl: simdWasmUrl })
    await WebAssembly.compile(binary)
    return { library, binary }
  })().catch((error) => { assets = undefined; throw error })
  return assets
}

function monitoredWorkletUrl() {
  // Adapter for the pinned 0.4.1 worklet: initialization there is asynchronous
  // and has no public ready message. Acknowledge its initialized processor
  // before swapping LiveKit's sender; also start its destroy-message port.
  moduleUrl ??= URL.createObjectURL(new Blob([`((registerProcessor) => {\n${workletSource}\n})((name, Base) => globalThis.registerProcessor(name, class extends Base {
    constructor(options) { super(options); this.port.start(); this.barracordReady = false; }
    process(...args) {
      if (this.processor && !this.barracordReady) { this.barracordReady = true; this.port.postMessage('barracord-ready'); }
      return super.process(...args);
    }
  }));`], { type: 'text/javascript' }))
  return moduleUrl
}

export class RNNoiseProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name = 'barracord-rnnoise'
  processedTrack?: MediaStreamTrack
  private context?: AudioContext
  private source?: MediaStreamAudioSourceNode
  private node?: import('@sapphi-red/web-noise-suppressor').RnnoiseWorkletNode
  private destination?: MediaStreamAudioDestinationNode
  private generation = 0
  private abortReady?: () => void
  private onFailure: () => void
  constructor(onFailure: () => void = () => {}) { this.onFailure = onFailure }

  async init(options: AudioProcessorOptions) {
    const generation = ++this.generation
    const { library, binary } = await loadAssets()
    if (generation !== this.generation) throw new Error('Inicialização do filtro cancelada.')
    const context = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })
    this.context = context
    try {
      if (context.sampleRate !== 48000) throw new Error('O dispositivo não aceitou 48 kHz para RNNoise.')
      await context.audioWorklet.addModule(monitoredWorkletUrl())
      if (generation !== this.generation) throw new Error('Inicialização do filtro cancelada.')
      const node = new library.RnnoiseWorkletNode(context, { maxChannels: 1, wasmBinary: binary })
      this.node = node
      node.channelCount = 1
      node.channelCountMode = 'explicit'
      let initialized = false
      const ready = new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => { reject(new Error('RNNoise não iniciou em 5 segundos.')) }, 5000)
        this.abortReady = () => { window.clearTimeout(timeout); reject(new Error('Inicialização do filtro cancelada.')) }
        node.port.onmessage = ({ data }) => {
          if (data !== 'barracord-ready') return
          window.clearTimeout(timeout)
          initialized = true
          this.abortReady = undefined
          resolve()
        }
        node.onprocessorerror = () => {
          window.clearTimeout(timeout)
          if (!initialized) reject(new Error('RNNoise não conseguiu processar o áudio.'))
          else if (generation === this.generation) this.onFailure()
        }
      })
      this.source = context.createMediaStreamSource(new MediaStream([options.track]))
      this.destination = context.createMediaStreamDestination()
      this.destination.channelCount = 1
      this.source.connect(node)
      node.connect(this.destination)
      // Start resume without waiting indefinitely for an autoplay permission.
      void context.resume().catch(() => this.abortReady?.())
      await ready
      if (generation !== this.generation) throw new Error('Inicialização do filtro cancelada.')
      this.processedTrack = this.destination.stream.getAudioTracks()[0]
      if (!this.processedTrack) throw new Error('RNNoise não devolveu áudio.')
    } catch (error) { await this.destroy(); throw error }
  }
  async restart(options: AudioProcessorOptions) { await this.destroy(); await this.init(options) }
  async destroy() {
    ++this.generation
    this.abortReady?.()
    this.abortReady = undefined
    const context = this.context, node = this.node
    this.context = undefined
    this.node = undefined
    if (node) { node.onprocessorerror = null; node.port.onmessage = null; node.destroy(); node.disconnect() }
    this.source?.disconnect()
    this.source = undefined
    this.destination?.stream.getTracks().forEach((track) => track.stop())
    this.destination = undefined
    this.processedTrack = undefined
    await context?.close().catch(() => {})
    node?.port.close()
  }
}

export async function configureMicrophoneNoise(track: LocalAudioTrack, mode: NoiseMode, onFailure?: () => void): Promise<NoiseMode> {
  if (track.source !== Track.Source.Microphone) throw new Error('O supressor só pode ser aplicado ao microfone.')
  const current = track.getProcessor()
  if (mode === 'rnnoise' && current instanceof RNNoiseProcessor) return mode
  if (current) await track.stopProcessor()
  const constraints = { noiseSuppression: mode === 'basic', voiceIsolation: false, echoCancellation: true, autoGainControl: true }
  await track.applyConstraints(constraints)
  if (mode !== 'rnnoise') return mode
  const processor = new RNNoiseProcessor(onFailure)
  try {
    await track.setProcessor(processor)
    return 'rnnoise'
  } catch {
    await processor.destroy()
    if (track.getProcessor() === processor) await track.stopProcessor()
    await track.applyConstraints({ ...constraints, noiseSuppression: true })
    return 'basic'
  }
}

// Serialize mode changes and rapid push-to-talk actions. A release while the
// first model is loading must not publish an open microphone afterwards.
export class MicrophoneController {
  private queue: Promise<unknown> = Promise.resolve()
  private desiredEnabled = false
  private disposed = false
  private preparing?: LocalAudioTrack
  readonly room: Room
  private mode: NoiseMode
  private device: () => string
  private onFallback: () => void
  constructor(room: Room, mode: NoiseMode, device: () => string, onFallback: () => void) {
    this.room = room; this.mode = mode; this.device = device; this.onFallback = onFallback
  }
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => {}).then(action)
    this.queue = next
    return next
  }
  private async configure(track: LocalAudioTrack) {
    const requested = this.mode
    const actual = await configureMicrophoneNoise(track, requested, () => { void this.setMode('basic').then(() => { if (!this.disposed) this.onFallback() }).catch(() => {}) })
    if (requested !== actual && requested === this.mode && !this.disposed) { this.mode = actual; this.onFallback() }
    return actual
  }
  setMode(mode: NoiseMode) {
    this.mode = mode
    return this.enqueue(async () => {
      if (this.disposed) return this.mode
      const track = this.room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track
      return track instanceof LocalAudioTrack ? this.configure(track) : this.mode
    })
  }
  setEnabled(enabled: boolean) {
    this.desiredEnabled = enabled
    return this.enqueue(async () => {
      if (this.disposed) return false
      if (!this.desiredEnabled) { await this.room.localParticipant.setMicrophoneEnabled(false); return false }
      const current = this.room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track
      let track = current instanceof LocalAudioTrack ? current : undefined
      if (!track) {
        const tracks = await this.room.localParticipant.createTracks({ audio: microphoneCaptureOptions(this.mode, this.device()) })
        track = tracks.find((item): item is LocalAudioTrack => item instanceof LocalAudioTrack)
        if (!track) { tracks.forEach((item) => item.stop()); throw new Error('O Windows não devolveu o microfone.') }
        this.preparing = track
        try {
          await this.configure(track)
          if (this.disposed || !this.desiredEnabled) { track.stop(); return false }
          await this.room.localParticipant.publishTrack(track, { source: Track.Source.Microphone })
        } catch (error) { track.stop(); throw error }
        finally { this.preparing = undefined }
      } else await this.configure(track)
      if (this.disposed || !this.desiredEnabled) { await track.mute(); return false }
      await this.room.localParticipant.setMicrophoneEnabled(true)
      return !track.isMuted
    })
  }
  dispose() {
    this.disposed = true
    this.desiredEnabled = false
    this.preparing?.stop()
    this.room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.stop()
  }
}
