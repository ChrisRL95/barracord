import { useEffect, useRef, useState } from 'react'
import './SharePicker.css'
import type { ShareAudioMode, ShareQuality } from './SharePicker'

// Linux chooses the image in the desktop portal's own dialog, which opens after
// this one. Here the person picks only the sound and the quality. Audio comes
// from PipeWire playback streams, so an application is listed while it is
// playing sound; once chosen, it stays linked if it pauses and plays again.

type AudioApplication = { id: string; name: string; streams: number }

type Props = {
  audioMode: ShareAudioMode
  onAudioModeChange: (mode: ShareAudioMode) => void
  quality: ShareQuality
  onQualityChange: (quality: ShareQuality) => void
  onClose: () => void
  onStart: (audioMode: ShareAudioMode, audioSourceIds: string[]) => void
}

export default function LinuxSharePicker({ audioMode, onAudioModeChange, quality, onQualityChange, onClose, onStart }: Props) {
  const [applications, setApplications] = useState<AudioApplication[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [refreshing, setRefreshing] = useState(true)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])

  const listApplications = () => (window.chriscordDesktop?.listAudioApplications() ?? Promise.resolve([])).catch(() => [])

  async function refresh() {
    setRefreshing(true)
    setApplications(await listApplications())
    setRefreshing(false)
  }

  useEffect(() => {
    let active = true
    void listApplications().then((list) => {
      if (!active) return
      setApplications(list)
      setRefreshing(false)
    })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current() }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => { active = false; document.removeEventListener('keydown', onKeyDown, true) }
  }, [])

  // Chosen applications stay listed after they go quiet, so the choice survives
  // a paused song or a game's loading screen while the dialog is open.
  const missing = selectedIds.filter((id) => !applications.some((application) => application.id === id))
  const listed = [...applications, ...missing.map((id) => ({ id, name: id.replace(/^pipewire:/, ''), streams: 0 }))]
  const canStart = audioMode !== 'application' || (selectedIds.length > 0 && selectedIds.length <= 8)
  const audioLabel = audioMode === 'none' ? 'Sem áudio' : audioMode === 'system' ? 'Todo o som, menos a call' : selectedIds.length ? listed.filter((application) => selectedIds.includes(application.id)).map((application) => application.name).join(' + ') : 'Nenhum aplicativo marcado'
  const startHint = canStart ? '' : 'Marque pelo menos um aplicativo ou escolha outra origem de áudio.'

  function toggle(id: string, checked: boolean) {
    setSelectedIds((current) => checked ? [...new Set([...current, id])].slice(0, 8) : current.filter((item) => item !== id))
  }

  return <div className="share-picker-overlay share-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="linux-share-title" aria-describedby="linux-share-description">
    <section className="share-picker share-dialog">
      <header><div><small>COMPARTILHAR NA BARRACA</small><h2 id="linux-share-title">Som e qualidade da transmissão</h2><p id="linux-share-description">Depois de continuar, o sistema pergunta qual tela ou janela compartilhar.</p></div><button type="button" onClick={onClose} aria-label="Cancelar compartilhamento">×</button></header>

      <section className="share-audio-panel" aria-label="Áudio da transmissão">
        <div className="share-audio-choices">
          <label>Origem do áudio<select value={audioMode} onChange={(event) => onAudioModeChange(event.target.value as ShareAudioMode)}>
            <option value="application">Aplicativos escolhidos</option>
            <option value="system">Todo o som do computador</option>
            <option value="none">Sem áudio</option>
          </select></label>
          {audioMode === 'system' && <p>Inclui todos os sons do computador, como música, jogos e notificações. A call do Barracord fica de fora.</p>}
          {audioMode === 'none' && <p>A imagem será compartilhada sem áudio. Seu microfone continua separado.</p>}
          {audioMode === 'application' && <div className="share-audio-apps">
            <div className="share-source-toolbar"><p>Aparecem os aplicativos que estão tocando som agora. Dê play e clique em Atualizar.</p><button className="share-refresh" type="button" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? 'Atualizando…' : '↻ Atualizar'}</button></div>
            <div className="share-audio-app-list" role="group" aria-label="Aplicativos de áudio" aria-busy={refreshing}>
              {listed.map((application) => <label className="share-audio-app-option" key={application.id}><input type="checkbox" checked={selectedIds.includes(application.id)} disabled={!selectedIds.includes(application.id) && selectedIds.length >= 8} onChange={(event) => toggle(application.id, event.target.checked)} /><span title={application.name}>{application.name}{application.streams === 0 ? ' (sem som agora)' : ''}</span></label>)}
              {!listed.length && !refreshing && <p>Nenhum aplicativo está tocando som agora.</p>}
            </div>
            <p>Até 8 aplicativos, misturados numa só trilha. A call do Barracord nunca entra.</p>
          </div>}
        </div>
      </section>

      <div className="share-quality-options" role="group" aria-label="Qualidade da transmissão"><label>Resolução<select value={quality.resolution} onChange={(event) => onQualityChange({ ...quality, resolution: Number(event.target.value) as 720 | 1080 })}><option value="720">720p · HD</option><option value="1080">1080p · Full HD</option></select></label><label>FPS<select value={quality.fps} onChange={(event) => onQualityChange({ ...quality, fps: Number(event.target.value) as 30 | 60 })}><option value="30">30 fps</option><option value="60">60 fps</option></select></label><p>Limites para a próxima transmissão; dependem da janela e da conexão.</p></div>

      <footer className="share-dialog-footer">
        <div className="share-selection-summary" aria-live="polite"><span><b>Áudio</b> {audioLabel}</span><span><b>Perfil</b> Até {quality.resolution}p / {quality.fps} fps</span>{startHint && <p id="linux-share-hint">{startHint}</p>}</div>
        <div className="share-dialog-actions"><button className="share-cancel" type="button" onClick={onClose}>Cancelar</button><button className="share-confirm" type="button" disabled={!canStart} aria-describedby={startHint ? 'linux-share-hint' : undefined} onClick={() => { if (canStart) onStart(audioMode, audioMode === 'application' ? selectedIds : []) }}>Escolher a tela →</button></div>
      </footer>
    </section>
  </div>
}
