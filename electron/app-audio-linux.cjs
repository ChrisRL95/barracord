const { execFile, spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { readdirSync, readFileSync } = require('node:fs')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

// Linux stream audio through PipeWire. One pw-record node is started with
// autoconnect off, so the session manager links nothing to it. A linker then
// connects the chosen applications' playback streams to it and repeats every
// pass, which also picks up streams an application opens later (a browser
// starting a new video, a game changing scenes). Barracord's own processes are
// never linked, so the call is not sent back to the room.
//
// Output matches the Windows capturer: interleaved PCM16 stereo at 48 kHz, sent
// as `app-audio:pcm` with source index 0. PipeWire mixes the links itself.

const allApplications = 'pipewire:all'
const sourceIdPattern = /^pipewire:[^\0]{1,200}$/
const linkIntervalMs = 1_500

function ownProcessIds() {
  // Electron plays call audio from a utility child process, so the whole
  // process tree under the main process counts as Barracord.
  const parents = new Map()
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, 'utf8')
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
      parents.set(Number(entry), Number(fields[1]))
    } catch { /* process exited while reading */ }
  }
  const own = new Set([process.pid])
  let grew = true
  while (grew) {
    grew = false
    for (const [pid, parent] of parents) {
      if (!own.has(pid) && own.has(parent)) { own.add(pid); grew = true }
    }
  }
  return own
}

async function readGraph() {
  const { stdout } = await execFileAsync('pw-dump', [], { timeout: 5_000, maxBuffer: 64 * 1024 * 1024 })
  const objects = JSON.parse(stdout)
  const nodes = new Map()
  const ports = []
  const links = new Set()
  for (const object of objects) {
    const info = object.info || {}
    const props = info.props || {}
    if (object.type === 'PipeWire:Interface:Node') nodes.set(object.id, props)
    else if (object.type === 'PipeWire:Interface:Port' && !props['port.monitor']) {
      ports.push({ id: object.id, node: Number(props['node.id']), direction: info.direction, channel: props['audio.channel'] || '' })
    } else if (object.type === 'PipeWire:Interface:Link') links.add(`${info['output-port-id']}:${info['input-port-id']}`)
  }
  return { nodes, ports, links }
}

function applicationKey(props) {
  return String(props['application.process.binary'] || props['application.name'] || '').trim()
}

function applicationLabel(props) {
  return String(props['application.name'] || props['application.process.binary'] || '').trim()
}

// Playback streams that belong to other applications, never to Barracord.
function foreignPlaybackStreams(graph) {
  const own = ownProcessIds()
  const streams = []
  for (const [id, props] of graph.nodes) {
    if (props['media.class'] !== 'Stream/Output/Audio') continue
    if (own.has(Number(props['application.process.id']))) continue
    if (/^barracord/i.test(String(props['node.name'] || '')) || /^barracord/i.test(applicationLabel(props))) continue
    const key = applicationKey(props)
    if (key) streams.push({ id, key, label: applicationLabel(props) })
  }
  return streams
}

async function listSources() {
  const graph = await readGraph()
  const byKey = new Map()
  for (const stream of foreignPlaybackStreams(graph)) {
    const current = byKey.get(stream.key)
    byKey.set(stream.key, { id: `pipewire:${stream.key}`, name: current?.name || stream.label || stream.key, streams: (current?.streams || 0) + 1 })
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// Front channels go to the matching side and mono goes to both. Surround
// channels are left out instead of being folded into the stereo image.
function targetChannels(channel) {
  if (channel === 'FL' || channel === 'FR') return [channel]
  if (channel === 'MONO' || channel === '') return ['FL', 'FR']
  return []
}

function createLinuxAudioBridge() {
  const sessions = new Map()

  function stop(owner, id) {
    const state = sessions.get(owner)
    if (!state || (id && state.id !== id)) return false
    sessions.delete(owner)
    state.stopping = true
    clearTimeout(state.timeout)
    clearInterval(state.linker)
    state.child?.kill()
    state.finish?.({ ok: false, error: 'A captura de áudio foi cancelada.' })
    return true
  }

  async function linkPass(state) {
    if (state.linking || state.stopping) return
    state.linking = true
    try {
      const graph = await readGraph()
      const captureNode = [...graph.nodes].find(([, props]) => props['node.name'] === state.nodeName)?.[0]
      if (captureNode === undefined) return false
      const inputs = new Map(graph.ports.filter((port) => port.node === captureNode && port.direction === 'input').map((port) => [port.channel, port.id]))
      if (!inputs.has('FL') || !inputs.has('FR')) return false
      const wanted = foreignPlaybackStreams(graph).filter((stream) => state.everything || state.keys.has(stream.key))
      for (const stream of wanted) {
        for (const port of graph.ports) {
          if (port.node !== stream.id || port.direction !== 'output') continue
          for (const channel of targetChannels(port.channel)) {
            const input = inputs.get(channel)
            if (input === undefined || graph.links.has(`${port.id}:${input}`)) continue
            // A stream can vanish between the dump and the link; the next pass
            // simply sees the new graph.
            await execFileAsync('pw-link', [String(port.id), String(input)], { timeout: 3_000 }).catch(() => {})
          }
        }
      }
      return true
    } catch { return false }
    finally { state.linking = false }
  }

  async function start(sender, sourceIds) {
    stop(sender.id)
    const requested = typeof sourceIds === 'string' ? [sourceIds] : Array.isArray(sourceIds) ? Array.from(sourceIds) : []
    if (!requested.length || requested.length > 8 || requested.some((id) => typeof id !== 'string' || !sourceIdPattern.test(id))) {
      return { ok: false, error: 'Escolha de 1 a 8 aplicativos para o áudio.' }
    }
    const everything = requested.includes(allApplications)
    const state = {
      id: randomUUID(),
      nodeName: `barracord-share-audio-${randomUUID().slice(0, 8)}`,
      everything,
      keys: new Set(everything ? [] : requested.map((id) => id.slice('pipewire:'.length))),
      child: null, linker: null, timeout: null, finish: null, stopping: false, linking: false,
    }
    sessions.set(sender.id, state)

    return new Promise((resolve) => {
      let resolved = false
      let ready = false
      let pending = Buffer.alloc(0)
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
        if (!state.stopping && ready) send('app-audio:ended', { id: state.id, error: 'A captura de áudio do PipeWire terminou. A transmissão continua sem som.' })
        state.finish({ ok: false, error: 'O PipeWire não iniciou a captura de áudio. Confira se o pacote pipewire-utils está instalado.' })
        stop(sender.id, state.id)
      }
      try {
        state.child = spawn('pw-record', [
          '--raw', '--format', 's16', '--rate', '48000', '--channels', '2',
          '-P', `{ node.autoconnect = false, node.name = "${state.nodeName}", node.description = "Barracord: áudio da transmissão", media.role = "Production" }`,
          '-',
        ], { stdio: ['ignore', 'pipe', 'ignore'] })
      } catch { failed(); return }
      state.timeout = setTimeout(failed, 12_000)
      state.child.on('error', failed)
      state.child.on('exit', failed)
      state.child.stdout.on('data', (chunk) => {
        if (state.stopping || sessions.get(sender.id) !== state) return
        // Forward whole stereo frames only; keep a partial frame for later.
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk
        const usable = pending.length - (pending.length % 4)
        if (!usable) return
        send('app-audio:pcm', { id: state.id, sourceIndex: 0, pcm: pending.subarray(0, usable) })
        pending = pending.subarray(usable)
      })

      // Ready once the capture node exists and the first links are in place.
      const firstPass = async () => {
        for (let attempt = 0; attempt < 20 && !state.stopping; attempt++) {
          if (await linkPass(state)) {
            ready = true
            state.linker = setInterval(() => void linkPass(state), linkIntervalMs)
            state.finish({ ok: true, id: state.id })
            return
          }
          await new Promise((wait) => setTimeout(wait, 250))
        }
        failed()
      }
      void firstPass()
    })
  }

  return {
    start,
    stop,
    stopAll: () => { for (const owner of [...sessions.keys()]) stop(owner) },
    listSources: () => listSources().catch(() => []),
  }
}

module.exports = { createLinuxAudioBridge, allApplications }
