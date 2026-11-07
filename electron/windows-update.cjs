const { app, BrowserWindow, ipcMain } = require('electron')

function registerWindowsUpdate(enabled) {
  let state = { phase: enabled ? 'idle' : 'disabled' }
  let updater

  function publish(next) {
    state = next
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.webContents.isDestroyed()) window.webContents.send('update:state', state)
    }
  }

  async function check() {
    if (!updater || state.phase !== 'idle') return
    publish({ phase: 'checking' })
    try {
      const result = await updater.checkForUpdates()
      publish(result?.isUpdateAvailable
        ? { phase: 'available', version: result.updateInfo.version }
        : { phase: 'idle' })
    } catch (error) {
      console.warn('[update] Verificação indisponível:', error.code || error.name)
      publish({ phase: 'idle' })
    }
  }

  ipcMain.handle('update:state', () => state)
  ipcMain.handle('update:download', async () => {
    if (!updater || !['available', 'download-error'].includes(state.phase)) return state
    const { version } = state
    publish({ phase: 'downloading', version, percent: 0 })
    try {
      await updater.downloadUpdate()
      publish({ phase: 'ready', version })
    } catch {
      publish({ phase: 'download-error', version })
    }
    return state
  })
  ipcMain.handle('update:install', () => {
    if (!updater || !['ready', 'install-error'].includes(state.phase)) return state
    const { version } = state
    publish({ phase: 'installing', version })
    try { updater.quitAndInstall(false, true) }
    catch { publish({ phase: 'install-error', version }) }
    return state
  })

  if (!enabled) return
  updater = require('electron-updater').autoUpdater
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.disableWebInstaller = true
  updater.channel = 'beta'
  updater.allowDowngrade = false
  updater.allowPrerelease = true
  updater.on('error', () => {
    if (state.phase === 'installing') publish({ phase: 'install-error', version: state.version })
  })
  updater.on('download-progress', ({ percent }) => {
    if (state.phase === 'downloading') {
      publish({ ...state, percent: Math.max(0, Math.min(100, Math.round(percent))) })
    }
  })
  setTimeout(() => void check(), 2000).unref()
  const interval = setInterval(() => void check(), 30 * 60 * 1000)
  app.once('before-quit', () => clearInterval(interval))
  interval.unref()
}

module.exports = { registerWindowsUpdate }
