export const soundSampleRate = 32000

export async function decodeSound(file: File) {
  const context = new OfflineAudioContext(1, 1, soundSampleRate)
  const buffer = await context.decodeAudioData(await file.arrayBuffer())
  if (buffer.duration < 0.1 || buffer.duration > 180) throw new Error('Escolha um áudio entre 0,1 segundo e 3 minutos.')
  const mono = new Float32Array(buffer.length)
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel)
    for (let i = 0; i < mono.length; i++) mono[i] += samples[i] / buffer.numberOfChannels
  }
  return mono
}

export function encodeSound(samples: Float32Array, start: number, end: number, previewVolume?: number) {
  const selection = samples.subarray(Math.round(start * soundSampleRate), Math.round(end * soundSampleRate))
  const bytes = new ArrayBuffer(44 + selection.length * 2)
  const wav = new DataView(bytes)
  wav.setUint32(0, 0x52494646)
  wav.setUint32(4, bytes.byteLength - 8, true)
  wav.setUint32(8, 0x57415645)
  wav.setUint32(12, 0x666d7420)
  wav.setUint32(16, 16, true)
  wav.setUint16(20, 1, true)
  wav.setUint16(22, 1, true)
  wav.setUint32(24, soundSampleRate, true)
  wav.setUint32(28, soundSampleRate * 2, true)
  wav.setUint16(32, 2, true)
  wav.setUint16(34, 16, true)
  wav.setUint32(36, 0x64617461)
  wav.setUint32(40, selection.length * 2, true)
  let peak = 0
  let energy = 0
  for (let i = 0; i < selection.length; i++) {
    const fade = Math.min(1, i / 96, (selection.length - 1 - i) / 96)
    const sample = Math.round(Math.max(-1, Math.min(1, selection[i])) * 32767 * fade)
    wav.setInt16(44 + i * 2, sample, true)
    peak = Math.max(peak, Math.abs(sample))
    energy += sample * sample
  }
  if (previewVolume !== undefined) {
    // Match the server's saved peak and average-level ceilings.
    const gain = previewVolume / 100 * Math.min(1, 24576 / Math.max(1, peak), 7209 / Math.max(1, Math.sqrt(energy / selection.length)))
    for (let offset = 44; offset < bytes.byteLength; offset += 2) wav.setInt16(offset, Math.round(wav.getInt16(offset, true) * gain), true)
  }
  return new Blob([bytes], { type: 'audio/wav' })
}
