const { app, BrowserWindow, ipcMain } = require('electron')
const { spawn } = require('node:child_process')
const { chmodSync, copyFileSync, existsSync, renameSync, rmSync } = require('node:fs')
const os = require('node:os')

// Atualização do convidado: verifica o canal beta no GitHub, baixa sozinho em
// segundo plano e espera um clique para reiniciar na versão nova. Funciona no
// instalador NSIS do Windows e no AppImage do Linux (que se substitui sem
// pedir senha). O RPM ficaria pedindo a senha do sistema, então fica de fora.

function updateSupported(role) {
  if (!app.isPackaged || role !== 'guest') return false
  if (process.platform === 'win32') return true
  return process.platform === 'linux' && Boolean(process.env.APPIMAGE)
}

function registerAppUpdate(role) {
  // Só para testar o fluxo localmente: aponta para uma pasta servida por HTTP
  // com beta-linux.yml/beta.yml e o instalador novo.
  const testFeed = process.env.BARRACORD_UPDATE_FEED
  const enabled = updateSupported(role) || (Boolean(testFeed) && app.isPackaged)
  let state = { phase: enabled ? 'idle' : 'disabled' }
  let updater
  let downloadedFile = null

  function publish(next) {
    state = next
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.webContents.isDestroyed()) window.webContents.send('update:state', state)
    }
  }

  async function download() {
    if (!updater || !['available', 'download-error'].includes(state.phase)) return state
    const { version } = state
    publish({ phase: 'downloading', version, percent: 0 })
    try {
      const files = await updater.downloadUpdate()
      downloadedFile = files.find((file) => file.endsWith('.AppImage')) ?? files[0] ?? null
      publish({ phase: 'ready', version })
    } catch (error) {
      console.warn('[update] Download falhou:', error?.code || error?.name)
      publish({ phase: 'download-error', version })
    }
    return state
  }

  async function check() {
    if (!updater) return
    // Um download que falhou é tentado de novo na próxima verificação.
    if (state.phase === 'download-error') return void download()
    if (state.phase !== 'idle') return
    publish({ phase: 'checking' })
    try {
      const result = await updater.checkForUpdates()
      if (!result?.isUpdateAvailable) return publish({ phase: 'idle' })
      publish({ phase: 'available', version: result.updateInfo.version })
      await download()
    } catch (error) {
      console.warn('[update] Verificação indisponível:', error?.code || error?.name)
      publish({ phase: 'idle' })
    }
  }

  // No Linux, o próprio app troca o AppImage e abre a cópia nova por um bash
  // auxiliar que fecha os arquivos herdados e espera este processo terminar.
  // - O electron-updater abriria a cópia nova direto como filha desta, e ela
  //   herdaria arquivos abertos do AppImage antigo: a montagem antiga (e os
  //   135 MB do arquivo apagado) ficariam presos até fechar o app.
  // - O app.relaunch do Electron marca o processo com "no new privileges", e
  //   aí o fusermount não consegue montar o AppImage ("Cannot mount AppImage").
  function relaunchAppImage(target) {
    const script = [
      'for fd in /proc/$$/fd/*; do n=${fd##*/}; [ "$n" -gt 2 ] 2>/dev/null && eval "exec $n>&-"; done',
      'while kill -0 "$1" 2>/dev/null; do sleep 0.2; done',
      'exec "$2"',
    ].join('\n')
    const shell = existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh'
    const child = spawn(shell, ['-c', script, 'barracord-relaunch', String(process.pid), target], { cwd: os.homedir(), detached: true, stdio: 'ignore' })
    child.unref()
  }

  function installAppImage() {
    const target = process.env.APPIMAGE
    if (!target || !downloadedFile) throw new Error('AppImage indisponível')
    const temporary = `${target}.update`
    try {
      copyFileSync(downloadedFile, temporary)
      chmodSync(temporary, 0o755)
      renameSync(temporary, target)
    } catch (error) {
      rmSync(temporary, { force: true })
      throw error
    }
    rmSync(downloadedFile, { force: true })
    relaunchAppImage(target)
    app.quit()
  }

  ipcMain.handle('update:state', () => state)
  ipcMain.handle('update:download', () => download())
  ipcMain.handle('update:install', () => {
    if (!updater || !['ready', 'install-error'].includes(state.phase)) return state
    const { version } = state
    publish({ phase: 'installing', version })
    // Abre a versão nova logo depois de instalar. No Windows o instalador
    // continua visível, como antes.
    // A cópia nova herda o ambiente e espera este processo terminar antes de
    // pegar a trava de instância única (veja electron/main.cjs).
    process.env.BARRACORD_UPDATE_PREVIOUS_PID = String(process.pid)
    try {
      if (process.platform === 'linux') installAppImage()
      else updater.quitAndInstall(false, true)
    } catch (error) {
      console.warn('[update] Instalação falhou:', error?.code || error?.message)
      publish({ phase: 'install-error', version })
    }
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
  if (testFeed) updater.setFeedURL({ provider: 'generic', url: testFeed, channel: 'beta' })
  updater.on('error', () => {
    if (state.phase === 'installing') publish({ phase: 'install-error', version: state.version })
  })
  updater.on('download-progress', ({ percent }) => {
    if (state.phase === 'downloading') {
      publish({ ...state, percent: Math.max(0, Math.min(100, Math.round(percent))) })
    }
  })
  setTimeout(() => void check(), 2000).unref()
  const interval = setInterval(() => void check(), 60_000)
  app.once('before-quit', () => clearInterval(interval))
  interval.unref()
}

module.exports = { registerAppUpdate }
