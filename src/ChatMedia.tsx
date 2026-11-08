import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import './ChatMedia.css'

type Sticker = { id: string; name: string }
export type ChatMessage = {
  id: string; author: string; installationId: string; body: string; createdAt: string
  media?: { kind: 'sticker'; id: string; name: string } | { kind: 'voice'; id: string }
}
const maxStickerBytes = 5 * 1024 * 1024
const maxVoiceBytes = 1024 * 1024
const voiceMime = 'audio/webm;codecs=opus'
const maxRecordingMs = 60_000

function mediaUrl(endpoint: string, installationId: string, path: string, params: Record<string, string> = {}) {
  const base = endpoint.trim().replace(/\/token\/?$/, '/chat-media')
  return `${base}${path}?${new URLSearchParams({ ...params, installationId })}`
}

export function ChatMessageMedia({ message, endpoint, installationId }: {
  message: NonNullable<ChatMessage['media']>; endpoint: string; installationId: string
}) {
  const id = encodeURIComponent(message.id)
  if (message.kind === 'sticker') return <img className="chat-sticker-message" loading="lazy" decoding="async"
    src={mediaUrl(endpoint, installationId, '/stickers/' + id)} alt={`Figurinha: ${message.name}`} />
  return <audio className="chat-voice-player" controls preload="none"
    src={mediaUrl(endpoint, installationId, '/voice/' + id)} aria-label="Mensagem de voz" />
}

export default function ChatMedia({ endpoint, installationId, channel, microphone, disabled, onMessage }: {
  endpoint: string; installationId: string; channel: string; microphone: string; disabled: boolean
  onMessage: (message: ChatMessage) => void
}) {
  const [panel, setPanel] = useState<'stickers' | 'voice' | null>(null)
  const [stickers, setStickers] = useState<Sticker[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [recording, setRecording] = useState(false)
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null)
  const requests = useRef<AbortController | null>(null)
  const capture = useRef<{ recorder: MediaRecorder; stream: MediaStream; timer: number } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    requests.current = controller
    return () => {
      controller.abort()
      const current = capture.current
      if (!current) return
      window.clearTimeout(current.timer)
      current.stream.getTracks().forEach((track) => track.stop())
    }
  }, [])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url) }, [preview])

  async function request(path: string, init?: RequestInit, params?: Record<string, string>) {
    const response = await fetch(mediaUrl(endpoint, installationId, path, params), { ...init, signal: requests.current?.signal })
    const data = await response.json().catch(() => null)
    if (!response.ok) throw new Error(data?.error || 'Mídia indisponível. Confira se o anfitrião está atualizado.')
    return data
  }

  async function openStickers() {
    setError('')
    if (panel === 'stickers') { setPanel(null); return }
    setPanel('stickers')
    setLoading(true)
    try { setStickers((await request('/stickers')).stickers) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível abrir a biblioteca.') }
    finally { setLoading(false) }
  }

  async function uploadSticker(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || busy) return
    const name = file.name.replace(/\.[^.]+$/, '').trim().slice(0, 40) || 'Figurinha'
    if (file.size > maxStickerBytes) { setError('Escolha uma figurinha de até 5 MB.'); return }
    setBusy(true)
    setError('')
    try {
      const result = await request('/stickers', { method: 'POST', body: file }, { name })
      setStickers((items) => [...items, result.sticker].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a figurinha.') }
    finally { setBusy(false) }
  }

  async function send(path: string, body?: Blob) {
    if (busy || disabled) return
    const signal = requests.current?.signal
    setBusy(true)
    setError('')
    try {
      const { message } = await request(path, { method: 'POST', body }, { channel })
      if (signal?.aborted) return
      onMessage(message)
      setPreview(null)
      setPanel(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível enviar a mensagem.') }
    finally { setBusy(false) }
  }

  async function startRecording() {
    if (busy || recording || disabled) return
    setPanel('voice')
    setError('')
    setBusy(true)
    const signal = requests.current?.signal
    let stream: MediaStream | undefined
    try {
      if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported(voiceMime)) {
        throw new Error('A gravação de voz está indisponível neste cliente.')
      }
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, ...(microphone !== 'default' && { deviceId: { exact: microphone } }) },
      })
      if (signal?.aborted) { stream.getTracks().forEach((track) => track.stop()); return }
      const recordingStream = stream
      const recorder = new MediaRecorder(recordingStream, { mimeType: voiceMime, audioBitsPerSecond: 48_000 })
      const chunks: Blob[] = []
      const stop = () => { if (recorder.state !== 'inactive') recorder.stop() }
      recorder.ondataavailable = ({ data }) => { if (data.size) chunks.push(data) }
      recorder.onerror = () => { if (!signal?.aborted) setError('O microfone interrompeu a gravação.') }
      recorder.onstop = () => {
        if (capture.current?.recorder === recorder) {
          window.clearTimeout(capture.current.timer)
          capture.current = null
        }
        recordingStream.getTracks().forEach((track) => track.stop())
        if (signal?.aborted) return
        setRecording(false)
        const blob = new Blob(chunks, { type: 'audio/webm' })
        if (blob.size < 32 || blob.size > maxVoiceBytes) { setError('Grave um áudio válido de até 1 MB.'); return }
        setPreview({ blob, url: URL.createObjectURL(blob) })
      }
      recorder.start()
      capture.current = { recorder, stream: recordingStream, timer: window.setTimeout(stop, maxRecordingMs) }
      setRecording(true)
    } catch (cause) {
      stream?.getTracks().forEach((track) => track.stop())
      setError(cause instanceof DOMException ? 'Não foi possível acessar o microfone.' : (cause as Error).message)
    } finally { setBusy(false) }
  }

  return <>
    <button type="button" className="chat-media-action" disabled={disabled || busy || recording || Boolean(preview)}
      aria-label="Figurinhas" aria-expanded={panel === 'stickers'} title="Figurinhas" onClick={() => void openStickers()}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9m-7 7 7-7h-5a2 2 0 0 0-2 2zM8 9h.01M15 9h.01M8 13c1 2 3 2 4 1" /></svg>
    </button>
    <button type="button" className="chat-media-action" disabled={disabled || busy || recording || Boolean(preview)}
      aria-label="Gravar mensagem de voz" title="Gravar mensagem de voz" onClick={() => void startRecording()}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0m-7 7v3m-3 0h6" /></svg>
    </button>
    {panel && <section className="chat-media-panel" aria-label={panel === 'stickers' ? 'Biblioteca de figurinhas' : 'Mensagem de voz'}>
      {panel === 'stickers' ? <>
        <header><strong>Figurinhas da Barraca</strong><button type="button" onClick={() => setPanel(null)}>Fechar</button></header>
        <label className="chat-sticker-upload">Adicionar figurinha <input type="file" accept="image/png,image/jpeg,image/webp,image/gif"
          disabled={disabled || busy || loading} onChange={(event) => void uploadSticker(event)} /></label>
        {loading && <p>Carregando…</p>}
        {!loading && !stickers.length && <p>Ainda não há figurinhas.</p>}
        <div className="chat-sticker-grid">{stickers.map((sticker) => <button key={sticker.id} type="button"
          disabled={disabled || busy} title={sticker.name} aria-label={`Enviar figurinha ${sticker.name}`}
          onClick={() => void send('/stickers/' + encodeURIComponent(sticker.id) + '/send')}>
          <img src={mediaUrl(endpoint, installationId, '/stickers/' + encodeURIComponent(sticker.id))} alt="" loading="lazy" />
        </button>)}</div>
      </> : <>
        <header><strong>{recording ? 'Gravando mensagem de voz' : 'Prévia da mensagem de voz'}</strong></header>
        {recording && <p>Até 1 minuto. <button type="button" onClick={() => capture.current?.recorder.stop()}>Parar gravação</button></p>}
        {preview && <audio className="chat-voice-player" controls src={preview.url} aria-label="Prévia da gravação" />}
        {!recording && !busy && <footer><button type="button" onClick={() => { setPreview(null); setPanel(null) }}>Descartar</button>
          {preview && <button type="button" disabled={disabled} onClick={() => void send('/voice', preview.blob)}>Enviar áudio</button>}</footer>}
        {busy && <p>{preview ? 'Enviando…' : 'Aguardando microfone…'}</p>}
      </>}
      {error && <p className="chat-media-error" role="alert">{error}</p>}
    </section>}
  </>
}
