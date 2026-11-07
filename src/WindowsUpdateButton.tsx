import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import './WindowsUpdateButton.css'

export default function WindowsUpdateButton({ inCall }: { inCall: boolean }) {
  const [update, setUpdate] = useState<BarracordUpdateState>({ phase: 'disabled' })
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
  const downloading = phase === 'downloading'
  const installing = phase === 'installing'
  const ready = phase === 'ready' || phase === 'install-error'
  const label = downloading ? `Baixando Barracord ${version} · ${update.percent}%`
    : installing ? 'Instalando atualização…'
    : ready && inCall ? 'Atualização pronta. Saia da call para instalar.'
    : phase === 'install-error' ? 'Falha ao instalar. Clique para tentar de novo.'
    : ready ? `Reiniciar e instalar Barracord ${version}`
    : phase === 'download-error' ? 'Falha no download. Clique para tentar de novo.'
    : `Baixar e instalar Barracord ${version}`

  async function activate() {
    const desktop = window.chriscordDesktop
    if (!desktop || downloading || installing) return
    const restartNow = !callActive.current
    if (ready && !restartNow) return
    let next: BarracordUpdateState = update
    try {
      if (!ready) {
        next = await desktop.downloadUpdate()
        setUpdate(next)
      }
      if (restartNow && !callActive.current && (next.phase === 'ready' || next.phase === 'install-error')) {
        setUpdate(await desktop.installUpdate())
      }
    } catch {
      setUpdate({ phase: next.phase === 'ready' || ready ? 'install-error' : 'download-error', version })
    }
  }

  return <button type="button" className={`header-action windows-update ${phase}`}
    title={label} aria-label={label} aria-disabled={downloading || installing || (ready && inCall)}
    onClick={() => void activate()}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12m-5-5 5 5 5-5M5 20h14" />
    </svg>
    {downloading && <span aria-hidden="true">{update.percent}%</span>}
    {(phase === 'download-error' || phase === 'install-error') && <span aria-hidden="true">!</span>}
  </button>
}
