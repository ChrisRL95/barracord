import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import './UpdateButton.css'

// The main process checks for updates and downloads them on its own. The app
// shows progress in the header and, once the update is ready, a notice with a
// single click to restart into the new version (never during a call).
export default function UpdateButton({ inCall }: { inCall: boolean }) {
  const [update, setUpdate] = useState<BarracordUpdateState>({ phase: 'disabled' })
  const [dismissed, setDismissed] = useState<{ version: string; duringCall: boolean } | null>(null)
  const callActive = useRef(inCall)

  useLayoutEffect(() => { callActive.current = inCall }, [inCall])

  useEffect(() => {
    const desktop = window.chriscordDesktop
    if (!desktop?.updateState || !desktop.onUpdateState) return
    let active = true
    let receivedEvent = false
    const unsubscribe = desktop.onUpdateState((next) => {
      receivedEvent = true
      setUpdate(next)
    })
    void desktop.updateState().then((next) => {
      if (active && !receivedEvent) setUpdate(next)
    }).catch(() => {})
    return () => { active = false; unsubscribe() }
  }, [])

  if (!('version' in update)) return null
  const { phase, version } = update
  const downloading = phase === 'downloading' || phase === 'available'
  const installing = phase === 'installing'
  const ready = phase === 'ready' || phase === 'install-error'
  const percent = phase === 'downloading' ? update.percent : 0
  const label = downloading ? `Baixando Barracord ${version} · ${percent}%`
    : installing ? 'Instalando atualização…'
    : ready && inCall ? 'Atualização pronta. Saia da call para reiniciar.'
    : phase === 'install-error' ? 'Falha ao instalar. Clique para tentar de novo.'
    : ready ? `Reiniciar no Barracord ${version}`
    : 'Falha no download. Clique para tentar de novo.'

  // A notice dismissed during a call comes back once the call ends.
  const noticeHidden = dismissed?.version === version && (!dismissed.duringCall || inCall)
  const showNotice = (ready || installing) && !noticeHidden

  async function activate() {
    const desktop = window.chriscordDesktop
    if (!desktop || downloading || installing) return
    try {
      if (phase === 'download-error') { setUpdate(await desktop.downloadUpdate()); return }
      if (ready && !callActive.current) setUpdate(await desktop.installUpdate())
    } catch {
      setUpdate({ phase: ready ? 'install-error' : 'download-error', version })
    }
  }

  return <>
    <button type="button" className={`header-action app-update ${phase}`}
      title={label} aria-label={label} aria-disabled={downloading || installing || (ready && inCall)}
      onClick={() => void activate()}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3v12m-5-5 5 5 5-5M5 20h14" />
      </svg>
      {downloading && <span aria-hidden="true">{percent}%</span>}
      {(phase === 'download-error' || phase === 'install-error') && <span aria-hidden="true">!</span>}
    </button>
    {showNotice && <aside className={`app-update-notice ${phase}`} role="status" aria-live="polite">
      <i aria-hidden="true">↻</i>
      <div>
        <small>{phase === 'install-error' ? 'FALHA AO INSTALAR' : 'ATUALIZAÇÃO PRONTA'}</small>
        <strong>Barracord {version} já foi baixado.</strong>
        <span>{installing ? 'Reiniciando…' : inCall ? 'Dá para reiniciar assim que você sair da call.' : 'O app fecha e abre de novo em alguns segundos.'}</span>
      </div>
      <div className="app-update-actions">
        <button type="button" className="restart" onClick={() => void activate()} disabled={inCall || installing}>{phase === 'install-error' ? 'Tentar de novo' : 'Reiniciar agora'}</button>
        <button type="button" onClick={() => setDismissed({ version, duringCall: inCall })} disabled={installing}>Depois</button>
      </div>
    </aside>}
  </>
}
