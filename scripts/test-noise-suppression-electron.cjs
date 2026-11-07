// Hidden, local-only DSP smoke test. No microphone permission or Barraca login.
const { app, BrowserWindow } = require('electron')
const { mkdtempSync, readFileSync } = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
app.setPath('userData', mkdtempSync(path.join(os.tmpdir(), 'barracord-noise-')))
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
let window, server
const deadline = setTimeout(() => finish(1, 'Noise test timed out'), 30000)
async function finish(code, result) {
  clearTimeout(deadline)
  console.log(result)
  window?.destroy()
  await server?.close()
  app.exit(code)
}
app.whenReady().then(async () => {
  const root = path.resolve(__dirname, '..')
  const voicePath = path.join(root, 'node_modules/.tmp/noise-test-voice.wav')
  // Generates a fixture directly to WAV; never plays through the speakers.
  execFileSync('powershell.exe', ['-NoProfile', '-Command', "$s=New-Object -ComObject SAPI.SpVoice; $f=New-Object -ComObject SAPI.SpFileStream; $f.Open($env:BARRACORD_TEST_VOICE,3,$false); $s.AudioOutputStream=$f; [void]$s.Speak('This is a voice test for the Barraca. The microphone should remain clear while the filter removes background noise.'); $f.Close()"], { windowsHide: true, env: { ...process.env, BARRACORD_TEST_VOICE: voicePath } })
  const { createServer, build } = await import('vite')
  const production = process.argv.includes('--production')
  let sdkUrl
  if (production) {
    await build({ root, base: './', configFile: false, build: { outDir: 'node_modules/.tmp/noise-test-build', rollupOptions: { input: path.join(root, 'scripts/fixtures/noise-suppression.html') } } })
  } else {
  server = await createServer({ root: path.resolve(__dirname, '..'), configFile: false, server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'noise-test', configureServer(s) { s.middlewares.use('/noise-test.html', (_, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Noise test</title>') }) } }] })
  await server.listen()
  const transformed = await server.transformRequest('/src/noiseSuppression.ts')
  sdkUrl = transformed.code.match(/from\s+"([^"]*livekit-client[^"]*)"/)[1]
  }
  const voice = readFileSync(voicePath).toString('base64')
  window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true } })
  window.webContents.on('console-message', event => { if (event.level >= 2) console.log(event.message) })
  if (production) {
    await window.loadFile(path.join(root, 'node_modules/.tmp/noise-test-build/scripts/fixtures/noise-suppression.html'))
    await window.webContents.executeJavaScript('new Promise((resolve,reject)=>{let n=0;const timer=setInterval(()=>{if(window.noiseFixture){clearInterval(timer);resolve()}else if(++n>100){clearInterval(timer);reject(new Error("Fixture did not load"))}},30)})')
  } else await window.loadURL(server.resolvedUrls.local[0] + 'noise-test.html')
  const result = await window.webContents.executeJavaScript(`(async () => {
    const { configureMicrophoneNoise, MicrophoneController } = window.noiseFixture || await import('/src/noiseSuppression.ts');
    const { LocalAudioTrack, Track } = window.noiseFixture || await import(${JSON.stringify(sdkUrl || '')});
    const context = new AudioContext({sampleRate:48000}); await context.resume();
    const buffer = context.createBuffer(1,48000,48000), samples=buffer.getChannelData(0);
    let seed=123; for(let i=0;i<samples.length;i++){seed=(seed*1664525+1013904223)>>>0;samples[i]=(seed/4294967296*2-1)*.08;}
    const source=context.createBufferSource(); source.buffer=buffer;source.loop=true;
    const destination=context.createMediaStreamDestination(); source.connect(destination);source.start();
    const raw=destination.stream.getAudioTracks()[0];
    // Synthetic WebAudio tracks have no hardware AEC/AGC constraints.
    raw.applyConstraints=async()=>{};
    const track=new LocalAudioTrack(raw, undefined, true);track.source=Track.Source.Microphone;track.setAudioContext(context);
    const actual=await configureMicrophoneNoise(track,'rnnoise');
    if(actual!=='rnnoise'||track.mediaStreamTrack===raw)throw new Error('RNNoise initialization fell back');
    const analyser=context.createAnalyser();analyser.fftSize=8192;
    const input=context.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));input.connect(analyser);
    const silent=context.createGain();silent.gain.value=0;analyser.connect(silent);silent.connect(context.destination);
    const monitor=document.createElement('audio');monitor.srcObject=new MediaStream([track.mediaStreamTrack]);monitor.volume=0;document.body.append(monitor);await monitor.play();
    await new Promise(r=>setTimeout(r,1600));
    const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);
    const rms=Math.sqrt(data.reduce((sum,v)=>sum+v*v,0)/data.length);
    const noiseRms=Math.sqrt(samples.reduce((sum,v)=>sum+v*v,0)/samples.length);
    if(!(rms<noiseRms*.3))throw new Error('Noise was not suppressed: '+JSON.stringify({rms,noiseRms}));
    const voiceBytes=Uint8Array.from(atob(${JSON.stringify(voice)}),c=>c.charCodeAt(0));
    const voiceBuffer=await context.decodeAudioData(voiceBytes.buffer);
    const speech=context.createBufferSource();speech.buffer=voiceBuffer;speech.loop=true;speech.connect(destination);speech.start();
    await new Promise(r=>setTimeout(r,700));
    let voiceEnergy=0;
    for(let i=0;i<25;i++){await new Promise(r=>setTimeout(r,40));analyser.getFloatTimeDomainData(data);voiceEnergy=Math.max(voiceEnergy,Math.sqrt(data.reduce((sum,v)=>sum+v*v,0)/data.length));}
    if(!(voiceEnergy>rms*2 && voiceEnergy>.005))throw new Error('Speech did not pass the filter: '+voiceEnergy);
    speech.stop();
    const processor=track.getProcessor(), previous=processor.processedTrack;
    await processor.restart({kind:Track.Kind.Audio,track:raw});
    if(previous.readyState!=='ended'||processor.processedTrack.readyState!=='live'||raw.readyState!=='live')throw new Error('Processor restart failed');
    const filtered=processor.processedTrack;
    await configureMicrophoneNoise(track,'basic');
    if(track.getProcessor()||track.mediaStreamTrack!==raw||raw.readyState!=='live'||filtered.readyState!=='ended')throw new Error('Basic switch did not clean up');
    await configureMicrophoneNoise(track,'off');
    // A released PTT must never publish a microphone after asynchronous setup.
    let published=0,publication;
    const room={localParticipant:{getTrackPublication:()=>publication,createTracks:async()=>{await new Promise(r=>setTimeout(r,20));return[track]},publishTrack:async(t)=>{published++;publication={track:t}},setMicrophoneEnabled:async()=>{}}};
    const controller=new MicrophoneController(room,'off',()=> 'default',()=>{});
    const press=controller.setEnabled(true);await new Promise(r=>setTimeout(r,5));const release=controller.setEnabled(false);await Promise.all([press,release]);
    if(published)throw new Error('Released PTT published an open microphone');controller.dispose();
    track.stop();source.stop();monitor.remove();await context.close();
    return JSON.stringify({result:'PASS',mode:actual,noiseRms,filteredRms:rms,voiceEnergy,reductionDb:20*Math.log10(noiseRms/Math.max(rms,1e-10)),basicAndOff:true,restart:true,rapidPtt:true});
  })().catch(error=>{throw new Error(error?.stack || String(error))})`)
  await finish(0, result)
}).catch(error => finish(1, error?.stack || String(error)))
