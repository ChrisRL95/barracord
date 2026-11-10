import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ConnectionState, RoomEvent } from 'livekit-client'
import type { Room } from 'livekit-client'
import { decodeSound, encodeSound, soundSampleRate } from './soundboardAudio'
import SoundboardIcon from './SoundboardIcon'
import './Soundboard.css'

type Sound = { id: string; name: string; emoji: string; author: string; owner: string; duration: number }
type Props = { endpoint: string; installationId: string; room: Room | null; deafened: boolean; speaker: string; compact: boolean; volume: number; onPlayingChange: (identity: string | null) => void }
const topic = 'barracord.soundboard.v1'
const soundId = /^[a-f0-9-]{36}$/
const formatTime = (seconds: number) => seconds.toFixed(2).replace('.', ',') + ' s'
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Algo deu errado. Tente novamente.'

function takePlaybackSlot(clock: { current: number }) {
  const now = performance.now()
  if (now - clock.current < 1200) return false
  clock.current = now
  return true
}

async function request(url: URL, options?: RequestInit) {
  const response = await fetch(url, options)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error || 'A biblioteca de sons está indisponível. Confira se a Barraca está aberta.')
  }
  return response
}

async function playOnDevice(audio: HTMLAudioElement, speaker: string) {
  const output = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
  if (speaker !== 'default') await output.setSinkId?.(speaker)
  await audio.play()
}

function SoundEditor({ cancel, save, speaker }: {
  cancel: () => void
  save: (name: string, emoji: string, volume: number, clip: Blob) => Promise<void>
  speaker: string
}) {
  const [samples, setSamples] = useState<Float32Array>()
  const [filename, setFilename] = useState('')
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('')
  const [volume, setVolume] = useState(80)
  const [range, setRange] = useState({ start: 0, end: 0 })
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState('')
  const preview = useRef<{ audio: HTMLAudioElement; url: string } | null>(null)
  const drag = useRef<'start' | 'end'>('start')
  const duration = Math.floor((samples?.length ?? 0) / soundSampleRate * 100) / 100
  const bars = useMemo(() => {
    if (!samples) return []
    return Array.from({ length: 200 }, (_, index) => {
      const first = Math.floor(index * samples.length / 200)
      const last = Math.floor((index + 1) * samples.length / 200)
      let peak = 0
      for (let i = first; i < last; i++) peak = Math.max(peak, Math.abs(samples[i]))
      return Math.max(2, Math.min(38, peak * 38))
    })
  }, [samples])

  function releasePreview() {
    if (!preview.current) return
    preview.current.audio.pause()
    URL.revokeObjectURL(preview.current.url)
    preview.current = null
  }
  useEffect(() => releasePreview, [])

  function adjustTrim(edge: 'start' | 'end', seconds: number) {
    releasePreview()
    setPlaying(false)
    setRange((previous) => {
      const time = Math.round(seconds * 100) / 100
      if (edge === 'start') {
        const start = Math.max(0, Math.min(duration - 0.1, time))
        return { start, end: Math.max(start + 0.1, Math.min(duration, start + 10, previous.end)) }
      }
      const end = Math.min(duration, Math.max(0.1, time))
      return { start: Math.max(0, end - 10, Math.min(end - 0.1, previous.start)), end }
    })
  }

  async function loadFile(file: File) {
    releasePreview()
    setPlaying(false)
    setSamples(undefined)
    setError('')
    if (file.size > 20 * 1024 * 1024) { setError('Escolha um arquivo de até 20 MB.'); return }
    setBusy(true)
    try {
      const decoded = await decodeSound(file).catch((cause) => {
        if (cause instanceof DOMException) throw new Error('Não consegui ler este arquivo. Experimente MP3, WAV ou OGG.')
        throw cause
      })
      setSamples(decoded)
      setFilename(file.name)
      setName(file.name.replace(/\.[^.]+$/, '').slice(0, 40))
      setRange({ start: 0, end: Math.min(10, Math.floor(decoded.length / soundSampleRate * 100) / 100) })
    } catch (cause) { setError(errorText(cause)) }
    finally { setBusy(false) }
  }

  async function togglePreview() {
    if (!samples) return
    releasePreview()
    if (playing) { setPlaying(false); return }
    const url = URL.createObjectURL(encodeSound(samples, range.start, range.end, volume))
    const audio = new Audio(url)
    preview.current = { audio, url }
    audio.onended = () => { releasePreview(); setPlaying(false) }
    setPlaying(true)
    try {
      await playOnDevice(audio, speaker)
      if (preview.current?.audio !== audio) audio.pause()
    } catch {
      if (preview.current?.audio !== audio) return
      releasePreview()
      setPlaying(false)
      setError('Não foi possível tocar a prévia. Confira a saída de áudio.')
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!samples || !name.trim() || busy) return
    releasePreview()
    setPlaying(false)
    setBusy(true)
    setError('')
    try { await save(name.trim(), emoji.trim(), volume, encodeSound(samples, range.start, range.end)) }
    catch (cause) { setError(errorText(cause)); setBusy(false) }
  }

  function position(svg: SVGSVGElement, clientX: number) {
    const bounds = svg.getBoundingClientRect()
    return (clientX - bounds.left) / bounds.width * duration
  }

  return <form className="sb-editor" onSubmit={(event) => void submit(event)}>
    <label className="sb-file">
      <span>{samples ? filename : 'Escolher arquivo de áudio'}</span>
      <small>MP3, WAV ou OGG · até 20 MB e 3 min</small>
      <input type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac" disabled={busy} onChange={(event) => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (file) void loadFile(file)
      }} />
    </label>
    {samples && <>
      <div className="sb-trim-head"><strong>Recortar áudio</strong><span>{formatTime(range.end - range.start)} / 10 s</span></div>
      <svg className="sb-wave" viewBox="0 0 600 88" preserveAspectRatio="none" aria-hidden="true"
        onPointerDown={(event) => {
          if (busy) return
          const time = position(event.currentTarget, event.clientX)
          drag.current = Math.abs(time - range.start) < Math.abs(time - range.end) ? 'start' : 'end'
          event.currentTarget.setPointerCapture(event.pointerId)
          adjustTrim(drag.current, time)
        }}
        onPointerMove={(event) => {
          if (!busy && event.currentTarget.hasPointerCapture(event.pointerId)) adjustTrim(drag.current, position(event.currentTarget, event.clientX))
        }}>
        <rect x={range.start / duration * 600} y="0" width={(range.end - range.start) / duration * 600} height="88" fill="var(--violet)" />
        {bars.map((height, index) => {
          const time = (index + 0.5) / 200 * duration
          return <line key={index} x1={index * 3 + 1.5} x2={index * 3 + 1.5} y1={44 - height} y2={44 + height}
            stroke={time >= range.start && time <= range.end ? '#d8c4ff' : '#625773'} strokeWidth="1.5" />
        })}
        {[range.start, range.end].map((time, index) => <line key={index} x1={time / duration * 600} x2={time / duration * 600} y1="0" y2="88" stroke="#c39cff" strokeWidth="5" />)}
      </svg>
      <div className="sb-fields">
        <label>Início <output>{formatTime(range.start)}</output><input type="range" step=".01" min="0" max={duration} value={range.start} disabled={busy} onChange={(event) => adjustTrim('start', Number(event.target.value))} /></label>
        <label>Fim <output>{formatTime(range.end)}</output><input type="range" step=".01" min="0" max={duration} value={range.end} disabled={busy} onChange={(event) => adjustTrim('end', Number(event.target.value))} /></label>
      </div>
      <div className="sb-fields sb-metadata">
        <label>Nome do som<input required value={name} maxLength={40} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>
        <label>Emoji <span>(opcional)</span><input value={emoji} placeholder="🎵" maxLength={24} disabled={busy} onChange={(event) => setEmoji(event.target.value)} /></label>
      </div>
      <label className="sb-volume">Volume salvo <output>{volume}%</output><input type="range" min="0" max="100" value={volume} disabled={busy} onChange={(event) => {
        releasePreview(); setPlaying(false); setVolume(Number(event.target.value))
      }} /></label>
      <small>O ajuste vale para todos. O Barracord reduz automaticamente picos e sons muito altos.</small>
    </>}
    {error && <p className="sb-error" role="alert">{error}</p>}
    <footer><button type="button" disabled={busy} onClick={cancel}>Voltar</button>
      <button type="button" disabled={busy || !samples} onClick={() => void togglePreview()}>{playing ? '■ Parar prévia' : '▶ Ouvir prévia'}</button>
      <button className="sb-primary" disabled={busy || !samples || !name.trim()}>{busy ? 'Processando…' : 'Salvar para a turma'}</button></footer>
  </form>
}

export default function Soundboard({ endpoint, installationId, room, deafened, speaker, compact, volume, onPlayingChange }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const activeAudio = useRef<HTMLAudioElement | null>(null)
  const volumeRef = useRef(volume)
  useEffect(() => {
    volumeRef.current = volume
    if (activeAudio.current) activeAudio.current.volume = volume / 100
  }, [volume])
  const lastPlay = useRef(-Infinity)
  const [sounds, setSounds] = useState<Sound[]>([])
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  const positionPanel = useCallback(() => {
    if (!trigger.current || !panel.current) return
    const anchor = trigger.current.getBoundingClientRect()
    const width = Math.min(490, window.innerWidth - 16)
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8))
    const spaceAbove = anchor.top - 16
    const spaceBelow = window.innerHeight - anchor.bottom - 16
    const above = spaceAbove >= 240 || spaceAbove >= spaceBelow
    const style = panel.current.style
    style.left = left + 'px'
    style.width = width + 'px'
    style.maxHeight = Math.max(0, Math.min(480, above ? spaceAbove : spaceBelow)) + 'px'
    style.top = above ? 'auto' : anchor.bottom + 8 + 'px'
    style.bottom = above ? window.innerHeight - anchor.top + 8 + 'px' : 'auto'
  }, [])

  useEffect(() => {
    window.addEventListener('resize', positionPanel)
    return () => window.removeEventListener('resize', positionPanel)
  }, [positionPanel])

  function openEditor() {
    panel.current?.hidePopover()
    setEditing(true)
    dialog.current?.showModal()
  }

  function returnToLibrary() {
    dialog.current?.close()
    positionPanel()
    panel.current?.showPopover()
  }

  const url = useCallback((suffix = '') => {
    const target = new URL(endpoint.trim(), window.location.href)
    target.pathname = target.pathname.replace(/\/token\/?$/, '/soundboard') + suffix
    target.search = ''
    target.searchParams.set('installationId', installationId)
    return target
  }, [endpoint, installationId])

  const stopPlayback = useCallback(() => {
    const audio = activeAudio.current
    activeAudio.current = null
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
    }
    onPlayingChange(null)
  }, [onPlayingChange])

  const play = useCallback(async (id: string, identity: string) => {
    stopPlayback()
    const audio = new Audio(url('/' + id + '/audio').href)
    audio.volume = volumeRef.current / 100
    activeAudio.current = audio
    const report = (playing: boolean) => {
      if (activeAudio.current === audio) onPlayingChange(playing ? identity : null)
    }
    audio.addEventListener('playing', () => report(true))
    for (const event of ['pause', 'waiting', 'ended', 'error']) {
      audio.addEventListener(event, () => report(false))
    }
    try {
      await playOnDevice(audio, speaker)
      if (activeAudio.current !== audio) audio.pause()
    } catch (error) {
      if (activeAudio.current === audio) {
        stopPlayback()
        throw error
      }
    }
  }, [onPlayingChange, speaker, stopPlayback, url])

  useEffect(() => {
    if (!room || deafened) return
    const receive = (bytes: Uint8Array, participant?: { identity: string }, _kind?: unknown, eventTopic?: string) => {
      if (!participant || participant.identity === installationId || eventTopic !== topic || bytes.length !== 36) return
      const id = new TextDecoder().decode(bytes)
      if (!soundId.test(id) || !takePlaybackSlot(lastPlay)) return
      void play(id, participant.identity).catch(() => {})
    }
    room.on(RoomEvent.DataReceived, receive)
    room.on(RoomEvent.Disconnected, stopPlayback)
    room.on(RoomEvent.Reconnecting, stopPlayback)
    return () => {
      room.off(RoomEvent.DataReceived, receive)
      room.off(RoomEvent.Disconnected, stopPlayback)
      room.off(RoomEvent.Reconnecting, stopPlayback)
      stopPlayback()
    }
  }, [room, deafened, installationId, play, stopPlayback])

  async function refresh() {
    setLoading(true)
    setError('')
    try {
      const { sounds: library } = await (await request(url())).json()
      if (!Array.isArray(library)) throw new Error('A Barraca não retornou uma biblioteca de sons válida.')
      setSounds(library)
    }
    catch (cause) { setError(errorText(cause)) }
    finally { setLoading(false) }
  }

  async function save(name: string, emoji: string, volume: number, clip: Blob) {
    const target = url()
    target.searchParams.set('name', name)
    target.searchParams.set('emoji', emoji)
    target.searchParams.set('volume', String(volume))
    const { sound } = await (await request(target, { method: 'POST', body: clip })).json()
    setSounds((previous) => [sound, ...previous])
    setQuery('')
    returnToLibrary()
  }

  async function remove(sound: Sound) {
    if (!window.confirm('Remover “' + sound.name + '” da biblioteca da turma?')) return
    try {
      await request(url('/' + sound.id), { method: 'DELETE' })
      setSounds((previous) => previous.filter(({ id }) => id !== sound.id))
    } catch (cause) { setError(errorText(cause)) }
  }

  async function send(sound: Sound) {
    if (!room || room.state !== ConnectionState.Connected || deafened || !takePlaybackSlot(lastPlay)) return
    setError('')
    try {
      await Promise.all([play(sound.id, installationId), room.localParticipant.publishData(new TextEncoder().encode(sound.id), { reliable: true, topic })])
    } catch { setError('Não foi possível tocar este som. Atualize a lista e confira a saída de áudio.') }
  }

  const canSend = Boolean(room && room.state === ConnectionState.Connected && !deafened)
  const filtered = sounds.filter((sound) => (sound.name + ' ' + sound.author + ' ' + sound.emoji).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <>
    <button ref={trigger} className={compact ? 'round-control sb-call-control' : 'sb-launch'} type="button"
      title="Soundboard" aria-label="Menu do Soundboard" popoverTarget="sb-library"
      onClick={positionPanel}>
      <SoundboardIcon />
      {!compact && <span>Soundboard</span>}
    </button>
    <div ref={panel} id="sb-library" className="sb-library" popover="auto" role="region" aria-label="Soundboard da turma"
      onToggle={(event) => {
        if (!event.currentTarget.matches(':popover-open')) return
        search.current?.focus()
        void refresh()
      }}>
      <div className="sb-tools">
        <input ref={search} type="search" placeholder="Encontre um som…" aria-label="Buscar som" value={query} onChange={(event) => setQuery(event.target.value)} />
        <button type="button" className="sb-primary" onClick={openEditor}>+ Adicionar som</button>
      </div>
      <div className="sb-library-content">
          <div className="sb-library-label"><strong>Sons da Barraca</strong>
            <button type="button" disabled={loading} onClick={() => void refresh()}>{loading ? 'Carregando…' : 'Atualizar'}</button></div>
          {!canSend && <p className="sb-hint">{deafened ? 'Volte a ouvir a call para tocar um som.' : 'Entre em um canal de voz para tocar sons para a turma.'}</p>}
          {error && <p className="sb-error" role="alert">{error}</p>}
          {!loading && !filtered.length && <p className="sb-empty">{query ? 'Nenhum som encontrado.' : 'A biblioteca está vazia. Adicione o primeiro som da turma.'}</p>}
          <ul className="sb-grid">{filtered.map((sound) => <li key={sound.id} className="sb-tile">
            <button type="button" className="sb-sound" disabled={!canSend} aria-label={'Tocar ' + sound.name + ' na call'} title={sound.name + ' · ' + sound.author} onClick={() => void send(sound)}>
              <span className="sb-sound-icon" aria-hidden="true">{sound.emoji || '♫'}</span>
              <span className="sb-sound-details"><strong>{sound.name}</strong><small>{formatTime(sound.duration)}</small></span>
            </button>
            {sound.owner === installationId && <button type="button" className="sb-delete" aria-label={'Remover ' + sound.name} onClick={() => void remove(sound)}>×</button>}
          </li>)}</ul>
      </div>
    </div>
    <dialog ref={dialog} className="sb-dialog" aria-labelledby="sb-title" onClose={() => setEditing(false)}>
      <header className="sb-header"><div><small>SONS DA BARRACA</small><h2 id="sb-title">Adicionar som</h2>
        <p>Escolha o trecho e ouça como ele vai ficar salvo.</p></div>
        <button type="button" aria-label="Fechar editor de som" onClick={() => dialog.current?.close()}>×</button></header>
      <div className="sb-body">
        {editing && <SoundEditor cancel={returnToLibrary} save={save} speaker={speaker} />}
      </div>
    </dialog>
  </>
}
