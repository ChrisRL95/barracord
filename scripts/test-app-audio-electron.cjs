// Isolated hidden Electron smoke test: native PCM -> preload IPC -> worklet ->
// MediaStream -> WebRTC -> receiving analyser. Does not open the real Barraca.
const { app, BrowserWindow, ipcMain } = require('electron')
const { createServer } = require('node:http')
const { spawn } = require('node:child_process')
const { readFileSync, mkdtempSync } = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const ts = require('typescript')
const { createAppAudioBridge } = require('../electron/app-audio.cjs')

const root = path.resolve(__dirname, '..')
app.setPath('userData', mkdtempSync(path.join(os.tmpdir(), 'barracord-audio-smoke-')))
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
let window, server, bridge
const children = []
const timeout = setTimeout(() => finish(1, 'Electron audio test timed out'), 25000)
function finish(code, message) {
  clearTimeout(timeout)
  console.log(message)
  bridge?.stopAll()
  for (const child of children) { child.stdin.end(); child.kill() }
  window?.destroy()
  server?.close()
  app.exit(code)
}
const tone = (frequency, twoWindows = false) => new Promise((resolve, reject) => {
  const child = spawn(path.join(root, 'tools/app-audio/test-tone.exe'), [String(frequency), ...(twoWindows ? ['--two-windows'] : [])], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  children.push(child)
  child.stdin.on('error', () => {})
  child.once('error', reject)
  child.once('exit', (code) => reject(new Error(`Tone fixture exited (${code})`)))
  let text = ''
  child.stdout.on('data', (chunk) => { text += chunk.toString(); if (/^[\d ]+\r?\n/.test(text)) { const windows = text.trim().split(/\s+/).map(handle=>`window:${handle}:0`); resolve(twoWindows ? windows : windows[0]) } })
})
app.whenReady().then(async () => {
  const [selected, alias] = await tone(660, true)
  const included = await tone(1110)
  const excluded = await tone(1680)
  bridge = createAppAudioBridge({ executable: path.join(root, 'tools/app-audio/barracord-app-audio.exe'), desktopCapturer: { getSources: async () => [{ id: selected }, { id: alias }, { id: included }, { id: excluded }] } })
  ipcMain.handle('app-audio:start', (event, sourceId) => bridge.start(event.sender, sourceId))
  ipcMain.handle('app-audio:stop', (event, id) => bridge.stop(event.sender.id, id))
  const module = ts.transpileModule(readFileSync(path.join(root, 'src/appAudio.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
  server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/' ? 'text/html' : 'text/javascript')
    if (request.url === '/') response.end('<!doctype html><title>Isolated audio test</title>')
    else if (request.url === '/appAudio.js') response.end(module)
    else if (request.url === '/app-audio-worklet.js') response.end(readFileSync(path.join(root, 'src/app-audio-worklet.js')))
    else { response.statusCode = 404; response.end() }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  window = new BrowserWindow({ show: false, webPreferences: { preload: path.join(root, 'electron/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } })
  await window.loadURL(`http://127.0.0.1:${server.address().port}`)
  const result = await window.webContents.executeJavaScript(`(async () => {
    const { captureAppAudio } = await import('/appAudio.js');
    let ended = '';
    let pcmBytes=0, pcmPeak=0;
    const removeDebug=window.chriscordDesktop.onAppAudioPcm(({pcm})=>{ pcmBytes+=pcm.length; const v=new DataView(pcm.buffer,pcm.byteOffset,pcm.byteLength); for(let i=0;i+1<pcm.length;i+=2)pcmPeak=Math.max(pcmPeak,Math.abs(v.getInt16(i,true))); });
    const capture = await captureAppAudio(${JSON.stringify([selected, alias, included])}, (message) => { ended = message });
    const tx = new RTCPeerConnection({iceServers: []});
    const rx = new RTCPeerConnection({iceServers: []});
    const audio = new AudioContext({sampleRate: 48000});
    try {
      const received = new Promise((resolve) => { rx.ontrack = (event) => resolve(event.track) });
      tx.addTrack(capture.track, new MediaStream([capture.track]));
      async function gather(pc, description) {
        await pc.setLocalDescription(description);
        if (pc.iceGatheringState !== 'complete') await new Promise((resolve) => {
          pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') resolve() });
        });
      }
      await gather(tx, await tx.createOffer());
      await rx.setRemoteDescription(tx.localDescription);
      await gather(rx, await rx.createAnswer());
      await tx.setRemoteDescription(rx.localDescription);
      const track = await received;
      const element=document.createElement('audio'); element.srcObject=new MediaStream([track]); element.volume=0; document.body.append(element); await element.play();
      const analyser = audio.createAnalyser();
      analyser.fftSize = 16384;
      const input = audio.createMediaStreamSource(new MediaStream([track]));
      const silent = audio.createGain(); silent.gain.value = 0;
      input.connect(analyser); analyser.connect(silent); silent.connect(audio.destination);
      await audio.resume();
      await new Promise(resolve => setTimeout(resolve, 1800));
      const data = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(data);
      function amplitude(frequency) {
        let real=0, imaginary=0, weight=0;
        for (let i=0; i<data.length; i++) {
          const w=.5-.5*Math.cos(2*Math.PI*i/(data.length-1));
          const angle=2*Math.PI*frequency*i/audio.sampleRate;
          real+=data[i]*w*Math.cos(angle); imaginary+=data[i]*w*Math.sin(angle); weight+=w;
        }
        return 2*Math.hypot(real,imaginary)/weight;
      }
      const selected=amplitude(660), included=amplitude(1110), excluded=amplitude(1680);
      if (ended) throw new Error(ended);
      if (!(selected>.001 && included>.001 && excluded<Math.min(selected,included)*.03 && selected<included*1.4 && included<selected*1.4)) {
        const stats=[]; (await rx.getStats()).forEach(s=>{if(s.type==='inbound-rtp')stats.push({type:s.type, packets:s.packetsReceived, energy:s.totalAudioEnergy, samples:s.totalSamplesReceived})});
        throw new Error('Received audio isolation failed: '+JSON.stringify({selected, included, excluded, stats, pcmBytes, pcmPeak, context: audio.state, settings: capture.track.getSettings(), captureMuted: capture.track.muted, receiverMuted: track.muted}));
      }
      return {selected, included, excluded, captureState: capture.track.readyState, receiverState: track.readyState};
    } finally { removeDebug(); capture.stop(); tx.close(); rx.close(); await audio.close() }
  })()`)
  finish(0, `PASS Electron/WebRTC isolated audio: ${JSON.stringify(result)}`)
}).catch((error) => finish(1, error.stack || String(error)))
