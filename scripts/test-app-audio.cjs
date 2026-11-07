const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { spawn } = require('node:child_process')
const vm = require('node:vm')
const path = require('node:path')
const { createAppAudioBridge } = require('../electron/app-audio.cjs')

test('PCM worklet: stereo, silence on starvation, bounded backlog', () => {
  let Processor
  const scope = { Float32Array, Uint8Array, DataView,
    AudioWorkletProcessor: class { constructor() { this.port = {} } },
    registerProcessor: (_name, processor) => { Processor = processor } }
  vm.runInNewContext(readFileSync(path.join(__dirname, '../src/app-audio-worklet.js'), 'utf8'), scope)
  const processor = new Processor()
  const output = [new Float32Array(128), new Float32Array(128)]
  processor.process([], [output])
  assert.ok(output[0].every((n) => n === 0))
  const pcm = new Uint8Array(2400 * 4)
  const view = new DataView(pcm.buffer)
  for (let offset = 0; offset < pcm.length; offset += 4) { view.setInt16(offset, 16384, true); view.setInt16(offset + 2, -8192, true) }
  processor.port.onmessage({ data: pcm })
  processor.process([], [output])
  assert.ok(output[0].every((n) => n === .5))
  assert.ok(output[1].every((n) => n === -.25))
  for (let i = 0; i < 10; i++) processor.port.onmessage({ data: pcm })
  assert.equal(processor.size, processor.capacity)
  processor.port.onmessage({ data: new Uint8Array(3) })
  assert.equal(processor.size, processor.capacity)
  while (processor.size) processor.process([], [output])
  processor.process([], [output])
  assert.ok(output[0].every((n) => n === 0))
})

test('PCM worklet mixes sources and limits peaks without clipping', () => {
  let Processor
  const scope = { Float32Array, Uint8Array, DataView,
    AudioWorkletProcessor: class { constructor() { this.port = {} } },
    registerProcessor: (_name, processor) => { Processor = processor } }
  vm.runInNewContext(readFileSync(path.join(__dirname, '../src/app-audio-worklet.js'), 'utf8'), scope)
  const processor = new Processor()
  function packet(index, value) {
    const pcm = new Uint8Array(2400 * 4), view = new DataView(pcm.buffer)
    for (let i = 0; i < pcm.length; i += 2) view.setInt16(i, value, true)
    processor.port.onmessage({ data: { sourceIndex: index, pcm } })
  }
  packet(0,8192);packet(1,8192)
  const output=[new Float32Array(128),new Float32Array(128)]
  processor.process([],[output])
  assert.ok(output.every(channel=>channel.every(value=>value===.5)))
  packet(2,32767);packet(3,32767)
  processor.process([],[output])
  assert.ok(output.every(channel=>channel.every(value=>value>.9&&value<=.980001)))
  processor.port.onmessage({data:{sourceIndex:8,pcm:new Uint8Array(16)}})
  assert.equal(processor.sources.size,4,'reject out-of-range source index')
})

// Real Windows integration test: independent processes render 660/1110 Hz.
// Only the selected process may appear in the captured PCM (not the mixer).
test('Windows: selected process is captured; other application is excluded', { skip: process.platform !== 'win32', timeout: 20000 }, async (t) => {
  const root = path.resolve(__dirname, '..', 'tools', 'app-audio')
  const children = []
  const bridge = createAppAudioBridge({ executable: path.join(root, 'barracord-app-audio.exe'), desktopCapturer: { getSources: async () => sources } })
  const sources = []
  t.after(() => { bridge.stopAll(); for (const child of children) { child.stdin.end(); child.kill() } })
  const tone = (frequency) => new Promise((resolve, reject) => {
    const child = spawn(path.join(root, 'test-tone.exe'), [String(frequency)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    children.push(child)
    let text = ''
    child.on('error', reject)
    child.stdin.on('error', () => {})
    child.on('exit', (code) => reject(new Error(`Tone fixture exited (${code}); check Windows audio output.`)))
    child.stdout.on('data', (chunk) => {
      text += chunk.toString()
      if (/^\d+\r?\n/.test(text)) resolve(`window:${text.trim()}:0`)
    })
  })
  const first = await tone(660)
  const second = await tone(1110)
  sources.push({ id: first }, { id: second })
  const packets = []
  const events = []
  const sender = { id: 77, isDestroyed: () => false, send: (channel, payload) => {
    if (channel === 'app-audio:pcm') packets.push(Buffer.from(payload.pcm))
    else events.push({ channel, payload })
  } }
  assert.equal((await bridge.start(sender, 'screen:0:0')).ok, false)
  assert.equal((await bridge.start(sender, 'window:999999999:0')).ok, false)
  const capture = await bridge.start(sender, first)
  assert.equal(capture.ok, true, capture.error)
  await new Promise((resolve) => setTimeout(resolve, 2200))
  assert.equal(bridge.stop(sender.id, 'stale-id'), false)
  assert.equal(bridge.stop(sender.id, capture.id), true)
  assert.equal(events.length, 0, 'intentional stop must not report capture failure')
  const pcm = Buffer.concat(packets)
  assert.ok(pcm.length >= 48000 * 4, 'at least one second of PCM must arrive')
  const count = 48000
  const offset = Math.max(0, Math.floor(pcm.length / 4) - count)
  function amplitude(frequency) {
    let real = 0, imaginary = 0
    for (let i = 0; i < count; i++) {
      const value = pcm.readInt16LE((offset + i) * 4) / 32768
      const angle = 2 * Math.PI * frequency * i / 48000
      real += value * Math.cos(angle)
      imaginary += value * Math.sin(angle)
    }
    return 2 * Math.hypot(real, imaginary) / count
  }
  const selected = amplitude(660), excluded = amplitude(1110)
  console.log(`Selected amplitude=${selected.toFixed(6)}, excluded=${excluded.toFixed(6)}`)
  assert.ok(selected > .001, 'selected application must contain audible samples')
  assert.ok(excluded < selected * .03, 'other application must be at least 30 dB quieter')
  const sizeAfterStop = packets.length
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(packets.length, sizeAfterStop, 'no samples may arrive after stop')
  const restarted = await bridge.start(sender, first)
  assert.equal(restarted.ok, true, restarted.error)
  assert.equal(bridge.stop(sender.id, capture.id), false, 'old capture token must not stop a new capture')
  children[0].stdin.end()
  for (let i = 0; i < 20 && events.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(events.length, 1, 'closing the selected application must report capture end')
  assert.equal(events[0].payload.id, restarted.id)
})
