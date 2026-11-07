const { app, BrowserWindow, clipboard, desktopCapturer, ipcMain, session, shell } = require('electron')
const { execFile, spawn } = require('node:child_process')
const { closeSync, existsSync, mkdirSync, openSync, readFileSync } = require('node:fs')
const { mkdtemp, readFile, writeFile, rm } = require('node:fs/promises')
const { createHash } = require('node:crypto')
const os = require('node:os')
const path = require('node:path')
const { createAppAudioBridge } = require('./app-audio.cjs')
const { createLinuxAudioBridge } = require('./app-audio-linux.cjs')
const appAudio = process.platform === 'linux' ? createLinuxAudioBridge() : createAppAudioBridge({ executable: path.join(app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..'), 'tools', 'app-audio', 'barracord-app-audio.exe'), desktopCapturer })

// Remote call and screen-share audio can arrive after the user has joined a
// room. Electron otherwise applies Chromium's autoplay policy to that late
// audio element, which leaves a perfectly valid LiveKit audio track silent.
// The Barracord is a native call client, so playback is expected once the user
// has explicitly entered a voice channel.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)
const isWindows = process.platform === 'win32'
// Activation messages name the system the person is using.
const theSystem = isWindows ? 'o Windows' : 'o sistema'
const toTheSystem = isWindows ? 'ao Windows' : 'ao sistema'

// Linux has no bundled installer: Tailscale comes from the distribution and
// runs as the tailscaled system service. Elevation goes through polkit (pkexec).
const linuxTailscalePaths = ['/usr/bin/tailscale', '/usr/sbin/tailscale', '/usr/local/bin/tailscale']
const linuxInstallHint = 'Instale a Rede da Barraca (Tailscale) pelo gerenciador de pacotes e ative o serviço. No Fedora: sudo dnf install tailscale && sudo systemctl enable --now tailscaled'

// `tailscale up` must repeat every non-default flag, so activation and
// reconnection share one list. The operator lets this user reconnect later
// without asking for the administrator password again.
function linuxUpFlags() {
  return ['--accept-dns=false', '--accept-routes=false', `--operator=${os.userInfo().username}`]
}

// pkexec exits with 126 when the password dialog is dismissed and 127 when
// polkit refuses the request; in both cases nothing ran as root.
function elevationCancelled(error) {
  return !isWindows && (error?.code === 126 || error?.code === 127)
}
const isDevelopment = !app.isPackaged && process.env.BARRACORD_USE_DIST !== '1'
let pendingShareRequest = null
const preparedShareCaptures = new Map()
let livekitProcess = null
let livekitLogDescriptor = null
let inviteServerInstance = null
let hostState = { state: 'stopped', message: 'A Barraca está fechada.', tailnetIp: null }
let hostRecoveryTimer = null
let hostRecoveryAttempts = 0

function appRole() {
  if (!app.isPackaged) return process.env.BARRACORD_ROLE === 'guest' ? 'guest' : 'host'
  try {
    const metadata = JSON.parse(require('node:fs').readFileSync(path.join(process.resourcesPath, 'barracord-role.json'), 'utf8'))
    return metadata.role === 'guest' ? 'guest' : 'host'
  } catch { return 'host' }
}

function appFilesRoot() {
  return app.isPackaged ? app.getAppPath() : path.resolve(__dirname, '..')
}

function resourceRoot() {
  return app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..')
}

function visibleHostState() {
  return { ...hostState, role: appRole() }
}

function hostStartOnLoginStatus() {
  if (appRole() !== 'host' || !app.isPackaged) return { available: false, enabled: false }
  try { return { available: true, enabled: Boolean(app.getLoginItemSettings().openAtLogin) } }
  catch { return { available: false, enabled: false } }
}

function setHostStartOnLogin(_event, enabled) {
  if (appRole() !== 'host' || !app.isPackaged) return hostStartOnLoginStatus()
  try {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled), openAsHidden: false })
    return hostStartOnLoginStatus()
  } catch { return { available: false, enabled: false } }
}

function setHostState(state, message, tailnetIp = hostState.tailnetIp) {
  hostState = { state, message, tailnetIp }
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('host:status', visibleHostState())
}

function cancelHostRecovery() {
  if (hostRecoveryTimer) clearTimeout(hostRecoveryTimer)
  hostRecoveryTimer = null
  hostRecoveryAttempts = 0
}

function disposeHostServices() {
  livekitProcess?.kill()
  inviteServerInstance?.close()
  livekitProcess = null
  if (livekitLogDescriptor !== null) {
    try { closeSync(livekitLogDescriptor) } catch {}
    livekitLogDescriptor = null
  }
  inviteServerInstance = null
}

function openLivekitLog() {
  // In development this stays beside the project; packaged builds use the
  // app's private data folder. It contains server diagnostics only, never
  // invitations, activation keys, or API secrets.
  const directory = path.join(app.isPackaged ? app.getPath('userData') : appFilesRoot(), 'logs')
  mkdirSync(directory, { recursive: true })
  return openSync(path.join(directory, 'livekit.log'), 'a')
}

async function inviteServerAvailable() {
  const { port } = hostSecrets()
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`)
    return response.status > 0
  } catch { return false }
}

function isTrustedOrigin(origin) {
  return origin.startsWith('http://127.0.0.1:5173')
    || origin.startsWith('http://localhost:5173')
    || origin.startsWith('file://')
}

function configureMediaPermissions() {
  session.defaultSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    return isTrustedOrigin(requestingOrigin) && (permission === 'media' || permission === 'display-capture')
  })

  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(isTrustedOrigin(details.requestingUrl || '') && (permission === 'media' || permission === 'display-capture'))
  })

  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    if (!isTrustedOrigin(request.securityOrigin)) return callback({})
    if (process.platform === 'linux') {
      // On Wayland every getSources call opens the desktop portal's own picker
      // and returns only what the person chose there. Ask exactly once, with no
      // thumbnails: a second request, or the short thumbnail stream, races the
      // portal while it is starting the real stream (seen crashing
      // xdg-desktop-portal-kde 6.7). Sound comes from PipeWire instead
      // (app-audio-linux.cjs), so the portal is asked for video only.
      desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
        .then((sources) => callback(sources[0] ? { video: sources[0] } : {}))
        .catch(() => callback({}))
      return
    }
    desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 480, height: 270 },
      })
      .then((sources) => {
        // The focused window can change while Chromium opens the media request.
        // Match the request frame first, otherwise a valid choice can be sent to
        // a different window and the capture remains pending forever.
        const frame = request.frame
        const window = BrowserWindow.getAllWindows().find((candidate) => frame
          && candidate.webContents.mainFrame.processId === frame.processId
          && candidate.webContents.mainFrame.routingId === frame.routingId)
          ?? BrowserWindow.getFocusedWindow()
          ?? BrowserWindow.getAllWindows()[0]
        if (!window) return callback({})
        const prepared = preparedShareCaptures.get(window.webContents.id)
        if (prepared) {
          preparedShareCaptures.delete(window.webContents.id)
          const source = sources.find((item) => item.id === prepared.sourceId)
          return callback(source ? { video: source, ...(prepared.withSystemAudio && process.platform === 'win32' ? { audio: 'loopback' } : {}) } : {})
        }
        if (pendingShareRequest) finishPendingShareRequest(pendingShareRequest, {})
        const shareRequest = {
          callback,
          sources,
          audioRequested: request.audioRequested,
          senderId: window.webContents.id,
          timeout: null,
        }
        // Never leave getDisplayMedia waiting forever if an IPC reply is lost.
        shareRequest.timeout = setTimeout(() => finishPendingShareRequest(shareRequest, {}), 45_000)
        pendingShareRequest = shareRequest
        window.webContents.send('share:request', sources.map((source) => ({
          id: source.id,
          name: source.name,
          thumbnail: source.thumbnail.toDataURL(),
          isScreen: source.id.startsWith('screen:'),
        })))
      })
      .catch(() => callback({}))
  })
}

function finishPendingShareRequest(request, streams) {
  if (request.timeout) clearTimeout(request.timeout)
  if (pendingShareRequest === request) pendingShareRequest = null
  request.callback(streams)
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 980,
    minHeight: 720,
    backgroundColor: '#08130f',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (isDevelopment) window.loadURL('http://127.0.0.1:5173')
  else window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))

  const ownerId = window.webContents.id
  window.webContents.on('destroyed', () => appAudio.stop(ownerId))
  window.webContents.on('render-process-gone', () => appAudio.stop(ownerId))
  window.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) appAudio.stop(ownerId) })

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.on('enter-full-screen', () => window.webContents.send('stream:fullscreen', true))
  window.on('leave-full-screen', () => window.webContents.send('stream:fullscreen', false))
}

const barracordGuestTag = 'tag:barracord-guest'

function privateNetworkStatusFromTailscale(status, extra = {}) {
  const backendState = typeof status.BackendState === 'string' ? status.BackendState : 'Unknown'
  const tags = Array.isArray(status.Self?.Tags) ? status.Self.Tags : []
  const requiresGuestTag = appRole() === 'guest'
  const taggedForBarraca = !requiresGuestTag || tags.includes(barracordGuestTag)
  const running = backendState === 'Running'
  return {
    installed: true,
    connected: running && taggedForBarraca,
    backendState,
    deviceName: status.Self?.DNSName?.replace(/\.$/, '') || null,
    deviceId: typeof status.Self?.ID === 'string' ? status.Self.ID : null,
    tags,
    expectedTag: barracordGuestTag,
    taggedForBarraca,
    diagnostic: !running ? 'starting' : taggedForBarraca ? 'ready' : 'wrong-network',
    ...extra,
  }
}

function unavailablePrivateNetworkStatus(installed, backendState, diagnostic, extra = {}) {
  return { installed, connected: false, backendState, deviceName: null, deviceId: null, tags: [], expectedTag: barracordGuestTag, taggedForBarraca: false, diagnostic, ...extra }
}

async function readTailscaleStatus() {
  const installedPath = tailscaleCliPath()
  const executable = installedPath ?? (isWindows ? 'tailscale.exe' : 'tailscale')
  try {
    const { stdout } = await execFileAsync(executable, ['status', '--json'], { timeout: 5_000, windowsHide: true })
    const status = JSON.parse(stdout)
    return privateNetworkStatusFromTailscale(status)
  } catch (error) {
    const detail = [error?.message, error?.stderr, error?.stdout].filter((value) => typeof value === 'string').join(' ')
    const installed = Boolean(installedPath)
    if (!installed && /ENOENT|not recognized|não é reconhecido/i.test(detail)) {
      return unavailablePrivateNetworkStatus(false, 'NotInstalled', 'not-installed')
    }
    // On Linux the status socket is readable by every user, so a failed
    // connection means the service is stopped rather than access denied.
    if (!isWindows && /failed to connect to local tailscaled|no such file or directory|connection refused/i.test(detail)) {
      return unavailablePrivateNetworkStatus(true, 'ServiceUnavailable', 'service-unavailable')
    }
    if (/access is denied|acesso negado|ProtectedPrefix|failed to connect to local tailscaled/i.test(detail)) {
      return unavailablePrivateNetworkStatus(true, 'AccessDenied', 'access-denied')
    }
    if (/no backend|service unavailable|connection refused|The system cannot find the file specified/i.test(detail)) {
      return unavailablePrivateNetworkStatus(true, 'ServiceUnavailable', 'service-unavailable')
    }
    return unavailablePrivateNetworkStatus(installed, installed ? 'Unknown' : 'NotInstalled', installed ? 'unavailable' : 'not-installed')
  }
}

function localPrivateNetworkIp() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address.address)) return address.address
    }
  }
  return null
}

function tailscaleCliPath() {
  if (!isWindows) return linuxTailscalePaths.find((candidate) => existsSync(candidate)) ?? null
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  const executable = path.join(programFiles, 'Tailscale', 'tailscale.exe')
  return existsSync(executable) ? executable : null
}

async function waitForPrivateNetwork(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let latest = await readTailscaleStatus()
  while (!latest.connected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    latest = await readTailscaleStatus()
  }
  return latest
}

function parseActivationCode(value) {
  const match = typeof value === 'string' ? value.trim().match(/^BARRACA1\.([A-Za-z0-9_-]+)$/i) : null
  if (!match) throw new Error('Use o código de ativação completo que o anfitrião enviou.')
  try {
    const payload = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'))
    if (payload?.version !== 1 || typeof payload.invite !== 'string' || !/^BARRACA-[A-Z0-9]{6}$/i.test(payload.invite) || typeof payload.networkKey !== 'string' || !payload.networkKey.startsWith('tskey-')) throw new Error()
    return payload
  } catch { throw new Error('Esse código de ativação não é válido.') }
}

function activationRecordPath() {
  return path.join(app.getPath('userData'), 'network-activation.json')
}

function activationFingerprint(value) {
  return createHash('sha256').update(value.trim()).digest('hex')
}

async function readActivationRecord() {
  try {
    const record = JSON.parse(await readFile(activationRecordPath(), 'utf8'))
    if (record?.version !== 1 || typeof record?.fingerprint !== 'string' || typeof record?.submittedAt !== 'string') return null
    return record
  } catch { return null }
}

async function rememberActivationSubmission(fingerprint) {
  await writeFile(activationRecordPath(), JSON.stringify({ version: 1, fingerprint, submittedAt: new Date().toISOString() }), { encoding: 'utf8', mode: 0o600 })
}

async function clearActivationSubmission() {
  await rm(activationRecordPath(), { force: true })
}

async function runElevated(executable, argumentsList, timeout) {
  if (!isWindows) return execFileAsync('/usr/bin/pkexec', [executable, ...argumentsList], { timeout })
  const escapePowerShell = (value) => `'${String(value).replace(/'/g, "''")}'`
  const command = `$process = Start-Process -FilePath ${escapePowerShell(executable)} -ArgumentList @(${argumentsList.map(escapePowerShell).join(',')}) -Verb RunAs -Wait -PassThru; exit $process.ExitCode`
  const powerShell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return execFileAsync(powerShell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { timeout, windowsHide: true })
}

async function verifyTailscaleStatusWithWindows({ allowReconnect = true } = {}) {
  const regularStatus = await readTailscaleStatus()
  if (!regularStatus.installed || regularStatus.connected) return { ...regularStatus, verification: 'regular' }

  if (!isWindows) return verifyTailscaleStatusOnLinux(regularStatus)
  const executable = tailscaleCliPath()
  if (!executable) return { ...regularStatus, verification: 'elevated-failed' }

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'barracord-status-'))
  const stdoutPath = path.join(temporaryDirectory, 'stdout.txt')
  const stderrPath = path.join(temporaryDirectory, 'stderr.txt')
  const scriptPath = path.join(temporaryDirectory, 'read-status.cmd')
  const escapePowerShell = (value) => `'${String(value).replace(/'/g, "''")}'`
  const powerShell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const quoteCmd = (value) => `"${String(value).replace(/"/g, '""')}"`
  const commandScript = [
    '@echo off',
    `${quoteCmd(executable)} status --json 1> ${quoteCmd(stdoutPath)} 2> ${quoteCmd(stderrPath)}`,
    'exit /b %ERRORLEVEL%',
  ].join('\r\n')
  await writeFile(scriptPath, commandScript, { encoding: 'utf8', mode: 0o600 })
  const command = `$process = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d', '/c', ${escapePowerShell(scriptPath)}) -Verb RunAs -Wait -PassThru; exit $process.ExitCode`

  try {
    await execFileAsync(powerShell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { timeout: 20_000, windowsHide: true })
    const stdout = await readFile(stdoutPath, 'utf8').catch(() => '')
    if (!stdout.trim()) throw new Error(await readFile(stderrPath, 'utf8').catch(() => ''))
    const status = JSON.parse(stdout)
    const elevatedStatus = privateNetworkStatusFromTailscale(status, { verification: 'elevated' })
    if (elevatedStatus.backendState !== 'NoState') return elevatedStatus

    // A node can already exist in the tailnet but its local daemon may not have
    // completed the first connection yet. Retrying `up` without an auth key is
    // safe: it can only reconnect an existing identity and cannot add a device.
    if (!allowReconnect) return { ...elevatedStatus, verification: 'needs-reconnect' }
    try {
      await runElevated(executable, ['up', '--timeout=20s'], 30_000)
      // The normal command can be denied even after Windows has reconnected
      // the daemon, so confirm one more time through the same elevated path.
      return await verifyTailscaleStatusWithWindows({ allowReconnect: false })
    } catch {}
    return { ...elevatedStatus, verification: 'needs-reconnect' }
  } catch (error) {
    const stderr = await readFile(stderrPath, 'utf8').catch(() => '')
    const detail = [error?.message, error?.stderr, stderr].filter((value) => typeof value === 'string').join(' ')
    const verificationError = /cancelled|canceled|user declined|elevation required/i.test(detail) ? 'cancelled' : 'service-error'
    return { ...regularStatus, verification: 'elevated-failed', verificationError }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

async function verifyTailscaleStatusOnLinux(regularStatus) {
  // The regular read is already authoritative on Linux. Only a stopped service
  // or a disconnected node is worth acting on, and neither uses an activation.
  const executable = tailscaleCliPath()
  if (!executable) return { ...regularStatus, verification: 'regular' }
  try {
    if (regularStatus.diagnostic === 'service-unavailable') {
      await runElevated('/usr/bin/systemctl', ['enable', '--now', 'tailscaled'], 60_000)
    } else if (regularStatus.backendState === 'Stopped') {
      const reconnect = ['up', ...linuxUpFlags(), '--timeout=20s']
      try { await execFileAsync(executable, reconnect, { timeout: 30_000 }) }
      catch { await runElevated(executable, reconnect, 30_000) }
    } else return { ...regularStatus, verification: 'regular' }
  } catch (error) {
    return { ...regularStatus, verification: 'elevated-failed', verificationError: elevationCancelled(error) ? 'cancelled' : 'service-error' }
  }
  const status = await waitForPrivateNetwork(15_000)
  return { ...status, verification: status.connected ? 'reconnected' : 'needs-reconnect' }
}

async function installBundledTailscale() {
  if (!isWindows) throw new Error(linuxInstallHint)
  const installer = path.join(resourceRoot(), 'tools', 'tailscale', 'tailscale-setup-1.102.3-amd64.msi')
  if (!existsSync(installer)) throw new Error('O instalador da Rede da Barraca não foi incluído neste Barracord.')
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'barracord-tailscale-install-'))
  const scriptPath = path.join(temporaryDirectory, 'install-tailscale.cmd')
  const powerShell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const escapePowerShell = (value) => `'${String(value).replace(/'/g, "''")}'`
  const command = `$process = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d', '/c', ${escapePowerShell(scriptPath)}) -Verb RunAs -Wait -PassThru; exit $process.ExitCode`
  try {
    const commandScript = `@echo off\r\nmsiexec.exe /i "${installer}" /qn /norestart TS_NOLAUNCH=1 TS_NETWORKDEVICES=hide TS_ADMINCONSOLE=hide TS_EXITNODEMENU=hide TS_PREFERENCESMENU=hide\r\nexit /b %ERRORLEVEL%\r\n`
    await writeFile(scriptPath, commandScript, { encoding: 'utf8', mode: 0o600 })
    await execFileAsync(powerShell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { timeout: 180_000, windowsHide: true })
  } catch (error) {
    if (error?.code !== 3010) throw new Error('A instalação da Rede da Barraca foi cancelada ou não pôde ser concluída pelo Windows.')
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

async function activatePrivateNetwork(_event, activationCode) {
  if (appRole() !== 'guest') return { ok: false, message: 'A ativação automática é usada apenas no cliente convidado.' }
  let activation
  try { activation = parseActivationCode(activationCode) }
  catch (error) { return { ok: false, message: error instanceof Error ? error.message : 'Código de ativação inválido.' } }
  try {
    const fingerprint = activationFingerprint(activationCode)
    const previousActivation = await readActivationRecord()
    let status = await readTailscaleStatus()
    if (status.connected) {
      if (previousActivation?.fingerprint === fingerprint) await clearActivationSubmission()
      return { ok: true, message: 'Rede da Barraca já está conectada.' }
    }
    if (previousActivation?.fingerprint === fingerprint) return { ok: false, message: `Este código já foi enviado ${toTheSystem}. Não o envie novamente: confirme a Rede da Barraca com ${theSystem} ou peça uma nova ativação ao anfitrião.` }
    if (status.diagnostic === 'wrong-network') return { ok: false, message: 'Este PC está conectado a uma rede privada que não é a Rede da Barraca. Desconecte a rede atual antes de usar uma ativação.' }
    if (!status.installed) {
      await installBundledTailscale()
      await new Promise((resolve) => setTimeout(resolve, 4_000))
      status = await readTailscaleStatus()
    }
    const executable = tailscaleCliPath()
    if (!executable) throw new Error('A Rede da Barraca foi instalada, mas ainda não está pronta. Abra o Barracord novamente.')
    if (!isWindows && status.diagnostic === 'service-unavailable') {
      try { await runElevated('/usr/bin/systemctl', ['enable', '--now', 'tailscaled'], 60_000) }
      catch (error) { throw new Error(elevationCancelled(error) ? 'A senha de administrador é necessária para ligar o serviço da Rede da Barraca. Nenhuma ativação foi usada.' : 'Não foi possível ligar o serviço tailscaled. Nenhuma ativação foi usada.') }
      await new Promise((resolve) => setTimeout(resolve, 3_000))
    }
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'barracord-activation-'))
    const keyFile = path.join(temporaryDirectory, 'network-key.txt')
    try {
      await writeFile(keyFile, activation.networkKey, { encoding: 'utf8', mode: 0o600 })
      await rememberActivationSubmission(fingerprint)
      try {
        // Do not reset an existing Windows client here. A reset is useful for
        // manual recovery, but during onboarding it can discard preferences
        // while the local daemon is still settling. Unattended mode keeps the
        // Windows service active independently from the app window.
        const upArguments = isWindows
          ? ['up', `--auth-key=file:${keyFile}`, '--accept-dns=false', '--accept-routes=false', '--unattended', '--timeout=45s']
          : ['up', `--auth-key=file:${keyFile}`, ...linuxUpFlags(), '--timeout=45s']
        await runElevated(executable, upArguments, 60_000)
      } catch (error) {
        // A dismissed polkit dialog means the key never reached tailscaled, so
        // the same code can safely be used again.
        if (elevationCancelled(error)) {
          await clearActivationSubmission()
          throw new Error('A ativação foi cancelada antes de chegar à Rede da Barraca. Você pode usar o mesmo código novamente.')
        }
        throw new Error(`A ativação foi enviada ${toTheSystem}, mas não foi confirmada. Não use este código novamente; confirme o serviço ou peça uma nova ativação ao anfitrião.`)
      }
    } finally { await rm(temporaryDirectory, { recursive: true, force: true }) }
    const connected = await waitForPrivateNetwork()
    if (!connected.connected && connected.diagnostic === 'access-denied') throw new Error(`A ativação foi enviada, mas ${theSystem} bloqueou a confirmação do serviço. Não use este código novamente; confirme a Rede da Barraca com ${theSystem}.`)
    if (!connected.connected) throw new Error(`A ativação foi enviada, mas a Rede da Barraca ainda não confirmou o serviço. Não use este código novamente; confirme com ${theSystem}.`)
    await clearActivationSubmission()
    return { ok: true, message: 'Rede da Barraca conectada. Agora você pode entrar.' }
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : 'Não foi possível conectar a Rede da Barraca.' } }
}

function privateNetworkAppPath() {
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  const application = path.join(programFiles, 'Tailscale', 'tailscale-ipn.exe')
  return existsSync(application) ? application : null
}

function hostSecrets() {
  const envFile = path.join(resourceRoot(), '.env.server')
  try {
    const values = Object.fromEntries(readFileSync(envFile, 'utf8').split(/\r?\n/).map((line) => {
      const [key, ...parts] = line.split('=')
      return [key?.trim(), parts.join('=').trim()]
    }).filter(([key]) => Boolean(key)))
    return { code: values.APP_INVITE_CODE, port: Number(values.TOKEN_SERVER_PORT || 3001) }
  } catch { return { code: '', port: 3001 } }
}

async function openPrivateNetwork() {
  if (!isWindows) {
    if (tailscaleCliPath()) return { ok: false, action: 'open', message: 'No Linux, a Rede da Barraca roda como o serviço tailscaled e não tem janela própria. Confira com: tailscale status' }
    await shell.openExternal('https://tailscale.com/download/linux')
    return { ok: true, action: 'download', message: linuxInstallHint }
  }
  const application = privateNetworkAppPath()
  if (application) {
    const error = await shell.openPath(application)
    return error ? { ok: false, action: 'open', message: 'Não foi possível abrir a Rede da Barraca.' } : { ok: true, action: 'open', message: 'A Rede da Barraca foi aberta.' }
  }
  await shell.openExternal('https://tailscale.com/download/windows')
  return { ok: true, action: 'download', message: 'O download da Rede da Barraca foi aberto no navegador.' }
}

async function readTailscaleIp() {
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  const paths = isWindows ? [path.join(programFiles, 'Tailscale', 'tailscale.exe'), 'tailscale.exe'] : [tailscaleCliPath() ?? 'tailscale']
  for (const executable of paths) {
    try {
      const { stdout } = await execFileAsync(executable, ['ip', '-4'], { timeout: 5_000, windowsHide: true })
      const ip = stdout.trim().split(/\s+/)[0]
      if (ip) return ip
    } catch {
      // Try the next known executable location.
    }
  }
  return localPrivateNetworkIp()
}

function stopHost() {
  if (appRole() !== 'host') return { ...visibleHostState(), state: 'error', message: 'Este cliente não hospeda a Barraca.' }
  cancelHostRecovery()
  disposeHostServices()
  setHostState('stopped', 'A Barraca está fechada.', null)
  return visibleHostState()
}

function scheduleHostRecovery(reason, tailnetIp = hostState.tailnetIp) {
  if (appRole() !== 'host' || hostState.state === 'stopped' || hostRecoveryTimer) return
  if (hostRecoveryAttempts >= 3) {
    setHostState('error', 'A Barraca não conseguiu se recuperar. Tente abrir novamente.', tailnetIp)
    return
  }

  const delay = [1_500, 4_000, 9_000][hostRecoveryAttempts] ?? 9_000
  hostRecoveryAttempts += 1
  disposeHostServices()
  setHostState('starting', `${reason} Recuperando automaticamente (${hostRecoveryAttempts}/3)…`, tailnetIp)
  hostRecoveryTimer = setTimeout(async () => {
    hostRecoveryTimer = null
    if (hostState.state !== 'starting') return
    hostState = { state: 'stopped', message: 'Preparando recuperação.', tailnetIp }
    const state = await startHost()
    if (state.state === 'running') {
      hostRecoveryAttempts = 0
      return
    }
    if (state.state !== 'stopped') scheduleHostRecovery('A recuperação anterior não respondeu.', tailnetIp)
  }, delay)
}

async function startHost() {
  if (appRole() !== 'host') return { ...visibleHostState(), state: 'error', message: 'Este cliente não hospeda a Barraca.' }
  if (hostState.state === 'running' && await inviteServerAvailable()) return visibleHostState()
  if (hostState.state === 'running') stopHost()
  if (hostState.state === 'starting') return visibleHostState()
  const tailnetIp = await readTailscaleIp()
  if (!tailnetIp) {
    setHostState('error', 'Conecte a rede privada antes de abrir a Barraca.', null)
    return visibleHostState()
  }

  const filesRoot = appFilesRoot()
  const resources = resourceRoot()
  const livekit = path.join(resources, 'tools', 'livekit', isWindows ? 'livekit-server.exe' : 'livekit-server')
  const inviteServer = path.join(filesRoot, 'server', 'host-server.cjs')
  const envFile = path.join(resources, '.env.server')
  if (!existsSync(livekit) || !existsSync(inviteServer) || !existsSync(envFile)) {
    setHostState('error', 'Os componentes do anfitrião não estão disponíveis neste app.', tailnetIp)
    return visibleHostState()
  }

  setHostState('starting', 'Abrindo a Barraca…', tailnetIp)
  livekitLogDescriptor = openLivekitLog()
  const childOptions = { cwd: resources, windowsHide: true, stdio: ['ignore', livekitLogDescriptor, livekitLogDescriptor] }
  livekitProcess = spawn(livekit, ['--dev', '--bind', '0.0.0.0', '--node-ip', tailnetIp], childOptions)
  try {
    process.env.BARRACORD_ENV_FILE = envFile
    process.env.BARRACORD_DATA_DIR = path.join(app.getPath('userData'), 'data')
    inviteServerInstance = require(inviteServer).startHostServer()
  } catch {
    livekitProcess?.kill()
    livekitProcess = null
    if (livekitLogDescriptor !== null) {
      try { closeSync(livekitLogDescriptor) } catch {}
      livekitLogDescriptor = null
    }
    setHostState('error', 'Não foi possível iniciar o servidor de convites.', tailnetIp)
    return visibleHostState()
  }

  const handleExit = (name) => (_code) => {
    if (livekitLogDescriptor !== null) {
      try { closeSync(livekitLogDescriptor) } catch {}
      livekitLogDescriptor = null
    }
    if (hostState.state === 'stopped') return
    scheduleHostRecovery(`${name} parou.`, tailnetIp)
  }
  livekitProcess.once('exit', handleExit('O servidor de mídia'))
  livekitProcess.once('error', () => scheduleHostRecovery('O servidor de mídia encontrou um problema.', tailnetIp))
  inviteServerInstance.once('error', () => scheduleHostRecovery('O servidor de convites encontrou um problema.', tailnetIp))
  inviteServerInstance.once('close', () => {
    if (hostState.state !== 'stopped') scheduleHostRecovery('O servidor de convites parou.', tailnetIp)
  })

  await new Promise((resolve) => setTimeout(resolve, 900))
  if (hostState.state === 'starting' && await inviteServerAvailable()) setHostState('running', 'A Barraca está aberta.', tailnetIp)
  else if (hostState.state === 'starting') setHostState('error', 'O servidor de convites não respondeu. Tente abrir a Barraca novamente.', tailnetIp)
  return visibleHostState()
}

async function bootstrapHost(_event, payload) {
  if (appRole() !== 'host') return { ok: false, error: 'Este cliente não hospeda a Barraca.' }
  const participantName = typeof payload?.participantName === 'string' ? payload.participantName.trim() : ''
  const installationId = typeof payload?.installationId === 'string' ? payload.installationId : ''
  if (participantName.length < 2 || !installationId) return { ok: false, error: 'Informe seu nome para preparar o computador do anfitrião.' }
  const state = await startHost()
  if (state.state !== 'running') return { ok: false, error: state.message }
  const secrets = hostSecrets()
  if (!secrets.code) return { ok: false, error: 'A chave interna do anfitrião não está disponível.' }
  try {
    const response = await fetch(`http://127.0.0.1:${secrets.port}/host/bootstrap`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ participantName, installationId, hostCode: secrets.code }) })
    const body = await response.json()
    return response.ok && body.ok ? { ok: true } : { ok: false, error: body.error || 'Não foi possível preparar este computador.' }
  } catch { return { ok: false, error: 'A Barraca ainda não respondeu. Tente novamente em alguns segundos.' } }
}

ipcMain.handle('tailscale:status', readTailscaleStatus)
ipcMain.handle('tailscale:verify', verifyTailscaleStatusWithWindows)
ipcMain.handle('tailscale:open', openPrivateNetwork)
ipcMain.handle('tailscale:activate', activatePrivateNetwork)
ipcMain.handle('host:status', visibleHostState)
ipcMain.handle('host:start', startHost)
ipcMain.handle('host:stop', stopHost)
ipcMain.handle('host:start-on-login', hostStartOnLoginStatus)
ipcMain.handle('host:set-start-on-login', setHostStartOnLogin)
ipcMain.handle('host:bootstrap', bootstrapHost)
ipcMain.handle('host:admin-code', () => appRole() === 'host' ? hostSecrets().code : '')
ipcMain.handle('stream:set-fullscreen', (event, enabled) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) return false
  window.setFullScreen(Boolean(enabled))
  return window.isFullScreen()
})
ipcMain.handle('app:version', () => app.getVersion())
ipcMain.handle('clipboard:write', (_event, text) => {
  if (typeof text !== 'string' || text.length > 50_000) return false
  clipboard.writeText(text)
  return true
})
ipcMain.handle('share:choose', (event, sourceId) => {
  if (!pendingShareRequest) return { ok: false, error: 'A seleção de tela expirou. Abra o seletor novamente.' }
  if (pendingShareRequest.senderId !== event.sender.id) return { ok: false, error: 'A seleção pertence a outra janela do Barracord. Feche o seletor e tente novamente.' }
  const request = pendingShareRequest
  const source = request.sources.find((item) => item.id === sourceId)
  if (sourceId !== null && !source) return { ok: false, error: 'A tela escolhida não está mais disponível. Abra o seletor novamente.' }
  finishPendingShareRequest(request, source ? { video: source, ...(request.audioRequested && process.platform === 'win32' ? { audio: 'loopback' } : {}) } : {})
  return { ok: true }
})
ipcMain.handle('share:prepare-capture', (event, sourceId, withSystemAudio) => {
  const origin = event.senderFrame?.url || event.sender.getURL()
  if (!isTrustedOrigin(origin) || typeof sourceId !== 'string' || !sourceId) return { ok: false }
  preparedShareCaptures.set(event.sender.id, { sourceId, withSystemAudio: Boolean(withSystemAudio) })
  return { ok: true }
})
ipcMain.handle('app-audio:start', (event, sourceIds) => {
  if (!isTrustedOrigin(event.senderFrame?.url || event.sender.getURL())) return { ok: false, error: 'Origem não autorizada.' }
  return appAudio.start(event.sender, sourceIds)
})
ipcMain.handle('app-audio:list', (event) => {
  if (!isTrustedOrigin(event.senderFrame?.url || event.sender.getURL())) return []
  return appAudio.listSources ? appAudio.listSources() : []
})
ipcMain.handle('app-audio:stop', (event, id) => {
  if (!isTrustedOrigin(event.senderFrame?.url || event.sender.getURL()) || typeof id !== 'string') return false
  return appAudio.stop(event.sender.id, id)
})
ipcMain.handle('share:sources', async (event) => {
  const origin = event.senderFrame?.url || event.sender.getURL()
  if (!isTrustedOrigin(origin)) return []
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 480, height: 270 },
    fetchWindowIcons: true,
  })
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL(),
    isScreen: source.id.startsWith('screen:'),
    appIcon: source.appIcon?.toDataURL(),
  }))
})

app.whenReady().then(() => {
  configureMediaPermissions()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', stopHost)
app.on('before-quit', () => appAudio.stopAll())
