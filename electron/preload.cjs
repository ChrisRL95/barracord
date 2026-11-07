const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('chriscordDesktop', {
  tailscaleStatus: () => ipcRenderer.invoke('tailscale:status'),
  verifyTailscaleStatus: () => ipcRenderer.invoke('tailscale:verify'),
  openPrivateNetwork: () => ipcRenderer.invoke('tailscale:open'),
  activatePrivateNetwork: (activationCode) => ipcRenderer.invoke('tailscale:activate', activationCode),
  hostStatus: () => ipcRenderer.invoke('host:status'),
  startHost: () => ipcRenderer.invoke('host:start'),
  stopHost: () => ipcRenderer.invoke('host:stop'),
  hostStartOnLogin: () => ipcRenderer.invoke('host:start-on-login'),
  setHostStartOnLogin: (enabled) => ipcRenderer.invoke('host:set-start-on-login', enabled),
  bootstrapHost: (participantName, installationId) => ipcRenderer.invoke('host:bootstrap', { participantName, installationId }),
  hostAdminCode: () => ipcRenderer.invoke('host:admin-code'),
  setStreamFullscreen: (enabled) => ipcRenderer.invoke('stream:set-fullscreen', enabled),
  appVersion: () => ipcRenderer.invoke('app:version'),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),
  onHostStatus: (callback) => {
    const listener = (_event, status) => callback(status)
    ipcRenderer.on('host:status', listener)
    return () => ipcRenderer.removeListener('host:status', listener)
  },
  onStreamFullscreen: (callback) => {
    const listener = (_event, enabled) => callback(Boolean(enabled))
    ipcRenderer.on('stream:fullscreen', listener)
    return () => ipcRenderer.removeListener('stream:fullscreen', listener)
  },
  chooseShareSource: (sourceId) => ipcRenderer.invoke('share:choose', sourceId),
  prepareShareCapture: (sourceId, withSystemAudio) => ipcRenderer.invoke('share:prepare-capture', sourceId, withSystemAudio),
  getShareSources: () => ipcRenderer.invoke('share:sources'),
  startAppAudio: (sourceIds) => ipcRenderer.invoke('app-audio:start', sourceIds),
  stopAppAudio: (id) => ipcRenderer.invoke('app-audio:stop', id),
  onAppAudioPcm: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('app-audio:pcm', listener)
    return () => ipcRenderer.removeListener('app-audio:pcm', listener)
  },
  onAppAudioEnded: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('app-audio:ended', listener)
    return () => ipcRenderer.removeListener('app-audio:ended', listener)
  },
  onShareRequest: (callback) => {
    const listener = (_event, sources) => callback(sources)
    ipcRenderer.on('share:request', listener)
    return () => ipcRenderer.removeListener('share:request', listener)
  },
  isDesktop: true,
})
