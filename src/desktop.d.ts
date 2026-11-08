type BarracordUpdateState =
  | { phase: 'disabled' | 'idle' | 'checking' }
  | { phase: 'available' | 'download-error' | 'ready' | 'install-error' | 'installing'; version: string }
  | { phase: 'downloading'; version: string; percent: number }

interface Window {
  chriscordDesktop?: {
    isDesktop: boolean
    platform: string
    registerCallShortcuts: (bindings: { id: string; accelerator: string }[]) => Promise<void>
    onCallShortcut: (callback: (id: string) => void) => () => void
    onCallShortcutRejected: (callback: (ids: string[]) => void) => () => void
    tailscaleStatus: () => Promise<{
      installed: boolean
      connected: boolean
      backendState: string
      deviceName: string | null
      deviceId: string | null
      tags: string[]
      diagnostic: 'ready' | 'starting' | 'wrong-network' | 'access-denied' | 'service-unavailable' | 'unavailable' | 'not-installed'
      expectedTag: string
      taggedForBarraca: boolean
    }>
    verifyTailscaleStatus: () => Promise<{
      installed: boolean
      connected: boolean
      backendState: string
      deviceName: string | null
      deviceId: string | null
      tags: string[]
      diagnostic: 'ready' | 'starting' | 'wrong-network' | 'access-denied' | 'service-unavailable' | 'unavailable' | 'not-installed'
      expectedTag: string
      taggedForBarraca: boolean
      verification: 'regular' | 'elevated' | 'elevated-failed' | 'reconnected' | 'needs-reconnect'
      verificationError?: 'cancelled' | 'service-error'
    }>
    openPrivateNetwork: () => Promise<{ ok: boolean; action: 'open' | 'download'; message: string }>
    activatePrivateNetwork: (activationCode: string) => Promise<{ ok: boolean; message: string }>
    hostStatus: () => Promise<{ state: 'stopped' | 'starting' | 'running' | 'error'; message: string; tailnetIp: string | null; role: 'host' | 'guest' }>
    startHost: () => Promise<{ state: 'stopped' | 'starting' | 'running' | 'error'; message: string; tailnetIp: string | null; role: 'host' | 'guest' }>
    stopHost: () => Promise<{ state: 'stopped' | 'starting' | 'running' | 'error'; message: string; tailnetIp: string | null; role: 'host' | 'guest' }>
    hostStartOnLogin: () => Promise<{ available: boolean; enabled: boolean }>
    setHostStartOnLogin: (enabled: boolean) => Promise<{ available: boolean; enabled: boolean }>
    bootstrapHost: (participantName: string, installationId: string) => Promise<{ ok: boolean; error?: string }>
    hostAdminCode: () => Promise<string>
    setStreamFullscreen: (enabled: boolean) => Promise<boolean>
    appVersion: () => Promise<string>
    updateState: () => Promise<BarracordUpdateState>
    downloadUpdate: () => Promise<BarracordUpdateState>
    installUpdate: () => Promise<BarracordUpdateState>
    onUpdateState: (callback: (state: BarracordUpdateState) => void) => () => void
    writeClipboard: (text: string) => Promise<boolean>
    onHostStatus: (callback: (status: { state: 'stopped' | 'starting' | 'running' | 'error'; message: string; tailnetIp: string | null; role: 'host' | 'guest' }) => void) => () => void
    onStreamFullscreen: (callback: (enabled: boolean) => void) => () => void
    chooseShareSource: (sourceId: string | null) => Promise<{ ok: boolean; error?: string }>
    prepareShareCapture: (sourceId: string, withSystemAudio: boolean) => Promise<{ ok: boolean }>
    getShareSources: () => Promise<Array<{ id: string; name: string; thumbnail: string; isScreen: boolean; appIcon?: string }>>
    startAppAudio: (sourceIds: string[]) => Promise<{ ok: boolean; id?: string; error?: string }>
    stopAppAudio: (id: string) => Promise<boolean>
    listAudioApplications: () => Promise<Array<{ id: string; name: string; streams: number }>>
    onAppAudioPcm: (callback: (payload: { id: string; sourceIndex: number; pcm: Uint8Array }) => void) => () => void
    onAppAudioEnded: (callback: (payload: { id: string; error: string }) => void) => () => void
    onShareRequest: (callback: (sources: Array<{ id: string; name: string; thumbnail: string; isScreen: boolean }>) => void) => () => void
  }
}
