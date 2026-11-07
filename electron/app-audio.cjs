const { spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const { randomUUID } = require('node:crypto')

// Each renderer owns at most one capture. Tokens prevent late IPC messages or
// cleanup from an old share affecting a new share in the same window.
function createAppAudioBridge({ executable, desktopCapturer }) {
  const sessions = new Map()
  function stop(owner, id) {
    const state = sessions.get(owner)
    if (!state || (id && state.id !== id)) return false
    sessions.delete(owner)
    state.stopping = true
    clearTimeout(state.timeout)
    state.child?.stdin.end()
    state.child?.kill()
    state.finish?.({ ok: false, error: 'A captura de áudio foi cancelada.' })
    return true
  }
  async function start(sender, sourceIds) {
    stop(sender.id)
    if (process.platform !== 'win32' || !existsSync(executable)) {
      return { ok: false, error: 'A captura por aplicativo não está disponível. Execute npm run audio:build no Windows.' }
    }
    const requested = typeof sourceIds === 'string' ? [sourceIds] : Array.isArray(sourceIds) ? Array.from(sourceIds) : sourceIds
    if (!Array.isArray(requested) || !requested.length || requested.length > 8 || requested.some((id) => typeof id !== 'string' || !/^window:\d+:\d+$/.test(id))) {
      return { ok: false, error: 'Escolha de 1 a 8 aplicativos para o áudio.' }
    }
    const uniqueIds = [...new Set(requested)]
    const state = { id: randomUUID(), child: null, stopping: false, timeout: null, finish: null }
    sessions.set(sender.id, state)
    let sources
    try { sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } }) }
    catch { stop(sender.id, state.id); return { ok: false, error: 'O Windows não conseguiu listar os aplicativos.' } }
    if (sessions.get(sender.id) !== state || sender.isDestroyed()) return { ok: false, error: 'A captura foi cancelada.' }
    if (uniqueIds.some((id) => !sources.some((source) => source.id === id))) {
      stop(sender.id, state.id)
      return { ok: false, error: 'A janela de áudio foi fechada. Escolha o aplicativo novamente.' }
    }
    return new Promise((resolve) => {
      let resolved = false
      let ready = false
      let pending = Buffer.alloc(0)
      let status = ''
      state.finish = (result) => {
        if (resolved) return
        resolved = true
        clearTimeout(state.timeout)
        resolve(result)
      }
      const send = (channel, payload) => {
        if (!sender.isDestroyed() && sessions.get(sender.id) === state) sender.send(channel, payload)
      }
      const failed = () => {
        if (!state.stopping && ready) send('app-audio:ended', { id: state.id, error: 'A captura de um dos aplicativos terminou. Compartilhe novamente para selecionar os aplicativos.' })
        state.finish({ ok: false, error: 'O Windows não iniciou o áudio isolado. Verifique se o aplicativo está aberto e se o Windows é compatível.' })
        stop(sender.id, state.id)
      }
      try { state.child = spawn(executable, uniqueIds.map((id) => /^window:(\d+):\d+$/.exec(id)[1]), { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }) }
      catch { failed(); return }
      state.timeout = setTimeout(failed, 12000)
      state.child.stdin.on('error', () => {})
      state.child.on('error', failed)
      state.child.on('exit', failed)
      state.child.stderr.on('data', (chunk) => {
        status = (status + chunk.toString()).slice(-2048)
        if (!ready && /(?:^|\n)READY 48000 2 MULTI1\r?\n/.test(status)) {
          ready = true
          state.finish({ ok: true, id: state.id })
        }
      })
      state.child.stdout.on('data', (chunk) => {
        if (state.stopping || sessions.get(sender.id) !== state) return
        // Header: source index + byte count, then PCM16. Native code serializes
        // packets from each independently captured process.
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk
        while (pending.length >= 8) {
          const sourceIndex = pending.readUInt32LE(0)
          const count = pending.readUInt32LE(4)
          if (sourceIndex >= 8 || count === 0 || count % 4 || count > 1048576) { failed(); return }
          if (pending.length < count + 8) break
          send('app-audio:pcm', { id: state.id, sourceIndex, pcm: pending.subarray(8, count + 8) })
          pending = pending.subarray(count + 8)
        }
      })
    })
  }
  return { start, stop, stopAll: () => { for (const owner of sessions.keys()) stop(owner) } }
}

module.exports = { createAppAudioBridge }
