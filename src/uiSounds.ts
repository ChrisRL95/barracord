// Sons curtos da interface: entrar e sair da call, mutar, silenciar tudo e
// transmissão. Os arquivos ficam em public/sounds e são carregados uma vez,
// para tocar sem atraso. O caminho é relativo porque o app empacotado abre
// pelo file://.

export type UiSound =
  | 'self-join' | 'self-leave'
  | 'user-join' | 'user-leave'
  | 'mic-mute' | 'mic-unmute'
  | 'audio-mute' | 'audio-unmute'
  | 'share-start' | 'share-stop'

type SinkAudio = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }

const players = new Map<UiSound, SinkAudio>()
let outputDevice = 'default'

function player(sound: UiSound) {
  let audio = players.get(sound)
  if (!audio) {
    audio = new Audio(new URL(`sounds/${sound}.wav`, document.baseURI).href) as SinkAudio
    audio.preload = 'auto'
    if (outputDevice !== 'default') void audio.setSinkId?.(outputDevice).catch(() => {})
    players.set(sound, audio)
  }
  return audio
}

export function preloadUiSounds() {
  (['self-join', 'self-leave', 'user-join', 'user-leave', 'mic-mute', 'mic-unmute', 'audio-mute', 'audio-unmute', 'share-start', 'share-stop'] as const).forEach(player)
}

// Segue a saída de áudio escolhida nas configurações, como as vozes da call.
export function setUiSoundOutput(deviceId: string) {
  outputDevice = deviceId || 'default'
  players.forEach((audio) => void audio.setSinkId?.(outputDevice).catch(() => {}))
}

export function playUiSound(sound: UiSound) {
  const audio = player(sound)
  audio.currentTime = 0
  void audio.play().catch(() => {})
}
