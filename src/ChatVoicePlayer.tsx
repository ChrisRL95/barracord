import { useRef, useState } from 'react'

function clock(seconds: number) {
  const value = Math.floor(seconds)
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
}

export default function ChatVoicePlayer({ src, label, durationHint = 0 }: { src: string; label: string; durationHint?: number }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(durationHint)
  const [speed, setSpeed] = useState(1)
  const [error, setError] = useState(false)

  return <div className="chat-voice-card" role="group" aria-label={label}>
    <audio ref={audio} src={src} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
      onEnded={(event) => {
        setPlaying(false)
        setDuration(event.currentTarget.currentTime)
      }} onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
      onDurationChange={(event) => {
        const length = event.currentTarget.duration
        if (Number.isFinite(length)) setDuration(length)
      }} onError={() => setError(true)} />
    <button type="button" aria-label={playing ? 'Pausar áudio' : 'Reproduzir áudio'} onClick={() => {
      const player = audio.current
      if (!player) return
      if (player.paused) void player.play().catch(() => setError(true))
      else player.pause()
    }}>{playing ? 'Ⅱ' : '▶'}</button>
    <div className="chat-voice-timeline">
      <input type="range" min={0} max={duration || Math.max(1, position)} step={0.1} value={position}
        disabled={!duration} aria-label="Posição do áudio" onChange={(event) => {
          if (audio.current) audio.current.currentTime = Number(event.target.value)
        }} />
      <small>{error ? 'Áudio indisponível' : `${clock(position)}${duration ? ` / ${clock(duration)}` : ''}`}</small>
    </div>
    <button type="button" aria-label={`Velocidade atual: ${speed} vezes. Alterar velocidade`} onClick={() => {
      const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1
      if (audio.current) audio.current.playbackRate = next
      setSpeed(next)
    }}>{speed}×</button>
  </div>
}
