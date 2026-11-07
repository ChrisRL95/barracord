export type AppAudioCapture = { track: MediaStreamTrack; stop: () => void }

export async function captureAppAudio(sourceIds: string[], onEnded: (message: string) => void): Promise<AppAudioCapture> {
  const desktop = window.chriscordDesktop
  if (!desktop) throw new Error('A captura por aplicativo exige o Barracord para Windows.')
  const context = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })
  let node: AudioWorkletNode | null = null
  let track: MediaStreamTrack | null = null
  let id: string | undefined
  let stopped = false
  let earlyEnd: { id: string; error: string } | undefined
  let removePcm = () => {}
  let removeEnded = () => {}
  const stop = () => {
    if (stopped) return
    stopped = true
    removePcm()
    removeEnded()
    if (id) void desktop.stopAppAudio(id).catch(() => {})
    track?.stop()
    node?.disconnect()
    void context.close().catch(() => {})
  }
  try {
    if (context.sampleRate !== 48000) throw new Error('O dispositivo não aceitou áudio isolado em 48 kHz.')
    await context.audioWorklet.addModule(new URL('./app-audio-worklet.js', import.meta.url).href)
    node = new AudioWorkletNode(context, 'barracord-app-audio', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] })
    const destination = context.createMediaStreamDestination()
    node.connect(destination)
    track = destination.stream.getAudioTracks()[0]
    if (!track) throw new Error('Não foi possível criar a trilha de áudio do aplicativo.')
    await context.resume()
    if (context.state !== 'running') throw new Error('O Windows não liberou a reprodução de áudio isolado.')
    removePcm = desktop.onAppAudioPcm((payload) => {
      if (stopped || payload.id !== id) return
      const pcm = new Uint8Array(payload.pcm)
      node?.port.postMessage({ sourceIndex: payload.sourceIndex, pcm }, [pcm.buffer])
    })
    removeEnded = desktop.onAppAudioEnded((payload) => {
      if (stopped) return
      if (!id) { earlyEnd = payload; return }
      if (payload.id !== id) return
      stop()
      onEnded(payload.error)
    })
    const result = await desktop.startAppAudio(sourceIds)
    if (!result.ok || !result.id) throw new Error(result.error || 'A captura do aplicativo não iniciou.')
    id = result.id
    if (earlyEnd?.id === id) throw new Error(earlyEnd.error)
    return { track, stop }
  } catch (error) {
    stop()
    throw error
  }
}
