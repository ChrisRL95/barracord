import { useEffect, useRef, useState } from 'react'
import './SharePicker.css'

export type ShareSource = { id: string; name: string; thumbnail: string; isScreen: boolean; appIcon?: string }
export type ShareAudioMode = 'application' | 'system' | 'none'
export type ShareQuality = { resolution: 720 | 1080; fps: 30 | 60 }

type Props = {
  sources: ShareSource[]
  audioMode: ShareAudioMode
  onAudioModeChange: (mode: ShareAudioMode) => void
  quality: ShareQuality
  onQualityChange: (quality: ShareQuality) => void
  onRefresh: () => Promise<void>
  onClose: () => void
  onStart: (sourceId: string, audioSourceIds: string[], audioMode: ShareAudioMode) => void
}

const isAuxiliarySource = (source: ShareSource) => !source.isScreen && /^(barracord(?: anfitrião)?$|nvidia (?:geforce|overlay)|lista de amigos$|steamwebhelper)/i.test(source.name.trim())

export default function SharePicker({ sources, audioMode, onAudioModeChange, quality, onQualityChange, onRefresh, onClose, onStart }: Props) {
  const [tab, setTab] = useState<'applications' | 'screens'>('applications')
  const [query, setQuery] = useState('')
  const [showAuxiliary, setShowAuxiliary] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [includeImageAudio, setIncludeImageAudio] = useState(true)
  const [extraAudioIds, setExtraAudioIds] = useState<string[]>([])
  const [audioQuery, setAudioQuery] = useState('')
  const [audioExpanded, setAudioExpanded] = useState(false)
  const [audioCustomized, setAudioCustomized] = useState(audioMode !== 'application')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState('')
  const dialogRef = useRef<HTMLElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    searchRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); return }
      if (event.key !== 'Tab') return
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? []).filter((node) => node.getClientRects().length)
      const first = controls[0], last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => { document.removeEventListener('keydown', onKeyDown, true); if (previousFocus?.isConnected) previousFocus.focus() }
  }, [])

  const selected = sources.find((source) => source.id === selectedId)
  const applicationSources = sources.filter((source) => !source.isScreen)
  const resolvedAudioIds = [...new Set([...(includeImageAudio && selected && !selected.isScreen ? [selected.id] : []), ...extraAudioIds])]
  const resolvedAudio = resolvedAudioIds.map((id) => applicationSources.find((source) => source.id === id))
  const hasMissingAudio = resolvedAudio.some((source) => !source)
  const validAudio = resolvedAudio.filter((source): source is ShareSource => Boolean(source))
  const audioCount = resolvedAudioIds.length
  const audioApplications = applicationSources.filter((source) => source.name.toLocaleLowerCase('pt-BR').includes(audioQuery.trim().toLocaleLowerCase('pt-BR')))
  const qualityLabel = `Até ${quality.resolution}p / ${quality.fps} fps`
  const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR')
  const visibleSources = sources.filter((source) => source.isScreen === (tab === 'screens'))
    .filter((source) => showAuxiliary || !isAuxiliarySource(source))
    .filter((source) => source.name.toLocaleLowerCase('pt-BR').includes(normalizedQuery))
  const auxiliaryCount = applicationSources.filter(isAuxiliarySource).length
  const audioLabel = audioMode === 'none' ? 'Sem áudio' : audioMode === 'system' ? 'Sistema inteiro' : hasMissingAudio ? 'Uma janela de áudio não está mais disponível' : validAudio.length ? validAudio.map((source) => source.name).join(' + ') : selected?.isScreen ? 'Escolha os aplicativos de áudio' : 'Mesmo aplicativo da imagem'
  const canStart = Boolean(selected && (audioMode !== 'application' || (audioCount > 0 && audioCount <= 8 && !hasMissingAudio))) && !refreshing
  const startHint = !selected ? 'Selecione uma janela ou tela para continuar.' : audioMode === 'application' && hasMissingAudio ? 'Uma janela foi fechada. Desmarque-a em Alterar ou atualize a lista.' : audioMode === 'application' && !audioCount ? 'Marque pelo menos um aplicativo de áudio em Alterar ou selecione Sem áudio.' : audioMode === 'application' && audioCount > 8 ? 'Escolha no máximo 8 aplicativos de áudio.' : refreshing ? 'Atualizando a lista de fontes…' : ''

  function selectSource(source: ShareSource) {
    setSelectedId(source.id)
    if (!audioCustomized) onAudioModeChange(source.isScreen ? 'none' : 'application')
  }

  function toggleAudioSource(source: ShareSource, checked: boolean) {
    setAudioCustomized(true)
    // Turning off the selected video's audio also disables the automatic link.
    if (!checked && source.id === selectedId) setIncludeImageAudio(false)
    setExtraAudioIds((current) => checked ? [...new Set([...current, source.id])] : current.filter((id) => id !== source.id))
  }

  async function refresh() {
    setRefreshing(true)
    setRefreshError('')
    try { await onRefresh() }
    catch { setRefreshError('Não foi possível atualizar. Confira se o aplicativo está aberto e tente novamente.') }
    finally { setRefreshing(false) }
  }

  return <div className="share-picker-overlay share-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="share-dialog-title" aria-describedby="share-dialog-description">
    <section className="share-picker share-dialog" ref={dialogRef}>
      <header><div><small>COMPARTILHAR NA BARRACA</small><h2 id="share-dialog-title">O que você quer compartilhar?</h2><p id="share-dialog-description">Escolha a imagem. O áudio acompanha o aplicativo, e você pode alterar.</p></div><button type="button" onClick={onClose} aria-label="Cancelar compartilhamento">×</button></header>

      <div className="share-source-toolbar">
        <nav aria-label="Tipo de fonte"><button type="button" aria-pressed={tab === 'applications'} onClick={() => setTab('applications')}>Aplicativos <span>{applicationSources.length}</span></button><button type="button" aria-pressed={tab === 'screens'} onClick={() => setTab('screens')}>Telas <span>{sources.length - applicationSources.length}</span></button></nav>
        <label className="share-source-search"><span className="sr-only">Buscar aplicativo ou tela</span><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar pelo nome…" type="search" /></label>
        <button className="share-refresh" type="button" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? 'Atualizando…' : '↻ Atualizar'}</button>
      </div>
      {tab === 'applications' && auxiliaryCount > 0 && <label className="share-show-other"><input type="checkbox" checked={showAuxiliary} onChange={(event) => setShowAuxiliary(event.target.checked)} />Mostrar outras janelas <span>({auxiliaryCount} auxiliares)</span></label>}
      <div className="share-source-results" aria-busy={refreshing}>
        {refreshError && <p className="share-source-error" role="alert">{refreshError}</p>}
        <div className="source-options-grid">
          {visibleSources.map((source) => <button type="button" className={`source-option ${selectedId === source.id ? 'selected' : ''}`} key={source.id} aria-pressed={selectedId === source.id} onClick={() => selectSource(source)} title={source.name}>
            <div className="source-option-image"><img src={source.thumbnail} alt="" />{selectedId === source.id && <span className="source-option-check" aria-hidden="true">✓</span>}</div>
            <div className="source-option-name">{source.appIcon ? <img src={source.appIcon} alt="" /> : <span className="source-option-icon" aria-hidden="true">{source.isScreen ? '▣' : source.name.slice(0, 1).toUpperCase()}</span>}<strong>{source.name}</strong></div>
          </button>)}
        </div>
        {!visibleSources.length && <div className="share-source-empty"><strong>{query ? 'Nenhuma fonte encontrada' : tab === 'screens' ? 'Nenhuma tela disponível' : 'Nenhum aplicativo disponível'}</strong><p>{query ? 'Tente outro nome ou limpe a busca.' : 'Abra o aplicativo e clique em Atualizar. Você também pode conferir as outras janelas.'}</p></div>}
      </div>

      <section className="share-audio-panel" aria-label="Áudio da transmissão">
        <div className="share-audio-summary"><span className="share-audio-symbol" aria-hidden="true">♪</span><div><strong title={audioLabel}>Áudio: {audioMode === 'application' && audioCount > 1 && !hasMissingAudio ? `${audioCount} aplicativos selecionados` : audioLabel}</strong><p>{audioMode === 'system' ? 'Inclui todos os sons, inclusive Discord e notificações.' : audioMode === 'none' ? 'A imagem será compartilhada sem áudio. Seu microfone continua separado.' : 'Os aplicativos marcados serão misturados. Deixe Discord e Barracord desmarcados para não transmitir a call.'}</p></div><button type="button" onClick={() => setAudioExpanded((value) => !value)} aria-expanded={audioExpanded} aria-controls="share-audio-choices">{audioExpanded ? 'Concluir' : 'Alterar'}</button></div>
        {audioExpanded && <div className="share-audio-choices" id="share-audio-choices"><label>Origem do áudio<select value={audioMode} onChange={(event) => { setAudioCustomized(true); onAudioModeChange(event.target.value as ShareAudioMode) }}><option value="application">Aplicativos escolhidos</option><option value="none">Sem áudio</option><option value="system">Sistema inteiro</option></select></label>
          {audioMode === 'application' && <div className="share-audio-apps"><label className="share-audio-same"><input type="checkbox" checked={includeImageAudio} onChange={(event) => { setAudioCustomized(true); setIncludeImageAudio(event.target.checked) }} />Incluir automaticamente o aplicativo da imagem</label><label className="share-audio-search">Buscar aplicativo de áudio<input type="search" value={audioQuery} onChange={(event) => setAudioQuery(event.target.value)} placeholder="Jogo, música…" /></label>
            <div className="share-audio-app-list" role="group" aria-label="Aplicativos de áudio">{audioApplications.map((source) => <label className="share-audio-app-option" key={source.id}><input type="checkbox" checked={resolvedAudioIds.includes(source.id)} disabled={!resolvedAudioIds.includes(source.id) && audioCount >= 8} onChange={(event) => toggleAudioSource(source, event.target.checked)} /><span title={source.name}>{source.name}</span></label>)}{!audioApplications.length && <p>Nenhum aplicativo encontrado.</p>}
              {extraAudioIds.filter((id) => !applicationSources.some((source) => source.id === id)).map((id) => <label className="share-audio-app-option unavailable" key={id}><input type="checkbox" checked onChange={() => setExtraAudioIds((current) => current.filter((item) => item !== id))} /><span>Janela fechada — desmarque para continuar</span></label>)}
            </div><p>Até 8 aplicativos. Janelas da mesma árvore de processos são capturadas uma vez; outras janelas desse aplicativo também podem entrar.</p></div>}
        </div>}
      </section>

      <div className="share-quality-options" role="group" aria-label="Qualidade da transmissão"><label>Resolução<select value={quality.resolution} onChange={(event) => onQualityChange({ ...quality, resolution: Number(event.target.value) as 720 | 1080 })}><option value="720">720p · HD</option><option value="1080">1080p · Full HD</option></select></label><label>FPS<select value={quality.fps} onChange={(event) => onQualityChange({ ...quality, fps: Number(event.target.value) as 30 | 60 })}><option value="30">30 fps</option><option value="60">60 fps</option></select></label><p>Limites para a próxima transmissão; dependem da janela e da conexão.</p></div>

      <footer className="share-dialog-footer">
        <div className="share-selection-summary" aria-live="polite"><span><b>Imagem</b> {selected?.name || 'Nenhuma selecionada'}</span><span><b>Áudio</b> {audioLabel}</span><span><b>Perfil</b> {qualityLabel}</span>{startHint && <p id="share-start-hint">{startHint}</p>}</div>
        <div className="share-dialog-actions"><button className="share-cancel" type="button" onClick={onClose}>Cancelar</button><button className="share-confirm" type="button" disabled={!canStart} aria-describedby={startHint ? 'share-start-hint' : undefined} onClick={() => { if (selected && canStart) onStart(selected.id, audioMode === 'application' ? resolvedAudioIds : [], audioMode) }}>Iniciar transmissão →</button></div>
      </footer>
    </section>
  </div>
}
