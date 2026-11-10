import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import ChatVoicePlayer from './ChatVoicePlayer'
import './ChatMedia.css'

type Sticker = { id: string; name: string }
type StickerMessage = Sticker & { kind: 'sticker' }
export type ChatMessage = {
  id: string; author: string; installationId: string; body: string; createdAt: string
  media?: StickerMessage | { kind: 'voice'; id: string; duration?: number } | { kind: 'image'; id: string }
  reactions?: { emoji: string; count: number; mine: boolean; names: string[] }[]
  replyTo?: string
  replyPreview?: { author: string; body: string; sticker?: StickerMessage } | null
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
  if (message.kind === 'image') {
    const src = mediaUrl(endpoint, installationId, '/images/' + id)
    return <a href={src} target="_blank" rel="noreferrer"><img className="chat-image-message" loading="lazy" src={src} alt="Imagem anexada ao chat" /></a>
  }
  return <ChatVoicePlayer src={mediaUrl(endpoint, installationId, '/voice/' + id)} label="Mensagem de voz" durationHint={message.duration} />
}

export default function ChatMedia({ endpoint, installationId, channel, microphone, disabled, replyTo, pastedImage, onDiscardImage, onMessage }: {
  endpoint: string; installationId: string; channel: string; microphone: string; disabled: boolean
  onMessage: (message: ChatMessage) => void
  replyTo?: string
  pastedImage?: File
  onDiscardImage: () => void
}) {
  const [panel, setPanel] = useState<'stickers' | 'voice' | null>(null)
  const [stickers, setStickers] = useState<Sticker[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [recording, setRecording] = useState(false)
  const [preview, setPreview] = useState<{ blob: Blob; url: string; duration: number } | null>(null)
  const [caption, setCaption] = useState('')
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
  const attachImagePreview = useCallback((element: HTMLImageElement | null) => {
    if (!element || !pastedImage) return
    const url = URL.createObjectURL(pastedImage)
    element.src = url
    return () => URL.revokeObjectURL(url)
  }, [pastedImage])

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

  async function send(path: string, body?: Blob, params?: Record<string, string>) {
    if (busy || disabled) return
    const signal = requests.current?.signal
    setBusy(true)
    setError('')
    try {
      const { message } = await request(path, { method: 'POST', body }, { ...params, channel, ...(replyTo && { replyTo }) })
      if (signal?.aborted) return
      onMessage(message)
      setPreview(null)
      setPanel(null)
      if (path === '/images') { setCaption(''); onDiscardImage() }
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
      const startedAt = performance.now()
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
        setPreview({ blob, url: URL.createObjectURL(blob), duration: Math.min(maxRecordingMs, performance.now() - startedAt) / 1000 })
      }
      recorder.start()
      capture.current = { recorder, stream: recordingStream, timer: window.setTimeout(stop, maxRecordingMs) }
      setRecording(true)
    } catch (cause) {
      stream?.getTracks().forEach((track) => track.stop())
      setError(cause instanceof DOMException ? 'Não foi possível acessar o microfone.' : (cause as Error).message)
    } finally { setBusy(false) }
  }

  const showImage = Boolean(pastedImage && !recording && !preview && !(panel === 'voice' && busy))
  return <>
    <button type="button" className="chat-media-action" disabled={disabled || busy || recording || Boolean(preview || pastedImage)}
      aria-label="Figurinhas" aria-expanded={panel === 'stickers'} title="Figurinhas" onClick={() => void openStickers()}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9m-7 7 7-7h-5a2 2 0 0 0-2 2zM8 9h.01M15 9h.01M8 13c1 2 3 2 4 1" /></svg>
    </button>
    <button type="button" className="chat-media-action" disabled={disabled || busy || recording || Boolean(preview || pastedImage)}
      aria-label="Gravar mensagem de voz" title="Gravar mensagem de voz" onClick={() => void startRecording()}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0m-7 7v3m-3 0h6" /></svg>
    </button>
    {showImage && <section className="chat-media-panel" aria-label="Prévia da imagem">
      <header><strong>Prévia da imagem</strong></header>
      <img className="chat-image-message" ref={attachImagePreview} alt="Prévia do anexo" />
      <input aria-label="Legenda da imagem" placeholder="Legenda opcional" value={caption} maxLength={1000}
        onChange={(event) => setCaption(event.target.value)} onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); void send('/images', pastedImage, { caption }) }
        }} />
      {error && <p role="alert">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={() => { setCaption(''); setError(''); onDiscardImage() }}>Descartar</button>
        <button type="button" disabled={busy || disabled} onClick={() => void send('/images', pastedImage, { caption })}>Enviar imagem</button></footer>
    </section>}
    {!showImage && panel && <section className="chat-media-panel" aria-label={panel === 'stickers' ? 'Biblioteca de figurinhas' : 'Mensagem de voz'}>
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
        {preview && <ChatVoicePlayer key={preview.url} src={preview.url} label="Prévia da gravação" durationHint={preview.duration} />}
        {!recording && !busy && <footer><button type="button" onClick={() => { setPreview(null); setPanel(null) }}>Descartar</button>
          {preview && <button type="button" disabled={disabled} onClick={() => void send('/voice', preview.blob, { duration: String(preview.duration) })}>Enviar áudio</button>}</footer>}
        {busy && <p>{preview ? 'Enviando…' : 'Aguardando microfone…'}</p>}
      </>}
      {error && <p className="chat-media-error" role="alert">{error}</p>}
    </section>}
  </>
}
