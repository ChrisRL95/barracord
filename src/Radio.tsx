import { useEffect, useRef, useState } from 'react'
import './Radio.css'

type Station = { id: string; name: string; url: string; details: string }
type Selection = { station: Station; owner: string; author: string }

export default function Radio({ endpoint, installationId, channel, speaker, deafened, hostCode }: {
  endpoint: string; installationId: string; channel: string | null; speaker: string; deafened: boolean; hostCode?: string
}) {
  const base = endpoint.trim().replace(/\/token\/?$/, '/radio')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('name')
  const [stations, setStations] = useState<Station[]>([])
  const [searching, setSearching] = useState(false)
  const [changing, setChanging] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')
  const [shared, setShared] = useState<{ channel: string; selection: Selection | null } | null>(null)
  const [listening, setListening] = useState<{ station: Station; scope: string | null } | null>(null)
  const [volume, setVolume] = useState(() => Math.max(0, Math.min(100, Number(localStorage.getItem('barracord.radioVolume') ?? 20) || 0)))
  const audio = useRef<HTMLAudioElement>(null)
  const revision = useRef(0)
  const selection = shared?.channel === channel ? shared?.selection : null
  const canManage = Boolean(selection && (selection.owner === installationId || hostCode))
  const validPlayback = listening && (listening.scope === null || (listening.scope === channel && selection?.station.id === listening.station.id))
  if (listening && !validPlayback) setListening(null)

  useEffect(() => {
    if (!channel) return
    const controller = new AbortController()
    async function refresh() {
      const current = revision.current
      try {
        const params = new URLSearchParams({ installationId, channel: channel! })
        const response = await fetch(`${base}/current?${params}`, { signal: controller.signal })
        if (!response.ok) return
        const { selection } = await response.json()
        if (!controller.signal.aborted && revision.current === current) setShared({ channel: channel!, selection })
      } catch { /* retry on the next poll */ }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 3000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [base, installationId, channel])

  useEffect(() => {
    const player = audio.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null
    void player?.setSinkId?.(speaker).catch(() => undefined)
  }, [speaker])

  useEffect(() => {
    const player = audio.current
    if (player) player.muted = deafened
  }, [deafened])

  useEffect(() => {
    if (validPlayback || !audio.current?.hasAttribute('src')) return
    audio.current.pause()
    audio.current.removeAttribute('src')
    audio.current.load()
  }, [validPlayback])

  async function search() {
    setSearching(true)
    setError('')
    try {
      const response = await fetch(`${base}/stations?${new URLSearchParams({ installationId, filter, q: query })}`)
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || 'O catálogo de rádio está indisponível.')
      setStations(data.stations)
      setSearched(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao buscar estações.')
    } finally { setSearching(false) }
  }

  async function share(station: Station | null) {
    if (!channel || changing) return
    setChanging(true)
    setError('')
    try {
      const response = await fetch(`${base}/current?${new URLSearchParams({ installationId })}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, station: station?.id ?? null, hostCode }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || 'Não foi possível atualizar a rádio da call.')
      revision.current++
      setShared({ channel, selection: data.selection })
      if (station) setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao atualizar a rádio.')
    } finally { setChanging(false) }
  }

  function listen(station: Station, scope: string | null) {
    const player = audio.current
    if (!player) return
    setError('')
    player.volume = volume / 100
    player.src = station.url
    setListening({ station, scope })
    void player.play().catch((cause) => {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      setError('Não foi possível tocar essa rádio. Tente outra estação.')
      setListening(null)
    })
  }

  return <section className="radio-widget" aria-label="Rádio da Barraca">
    <audio ref={audio} onError={() => {
      if (!audio.current?.getAttribute('src')) return
      setError('A estação parou de responder. Tente ouvir novamente ou escolha outra.')
      setListening(null)
    }} />
    <button className="radio-toggle" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>♫ Rádio</button>
    {(selection || validPlayback || error) && <div className="radio-status">
      {selection && <div><strong>{selection.station.name}</strong><small>Na call · {selection.author}</small>
        {!(validPlayback && listening.scope === channel) && <button type="button" onClick={() => listen(selection.station, channel)}>Ouvir</button>}
        {canManage && <button type="button" disabled={changing} onClick={() => void share(null)}>Encerrar rádio</button>}
      </div>}
      {validPlayback && <div><small>Ouvindo {listening.station.name}</small><button type="button" onClick={() => setListening(null)}>Parar de ouvir</button>
        <label>Volume da rádio <output>{volume}%</output><input type="range" min={0} max={100} value={volume} onChange={(event) => {
          const next = Number(event.target.value)
          setVolume(next)
          localStorage.setItem('barracord.radioVolume', String(next))
          if (audio.current) audio.current.volume = next / 100
        }} /></label>
      </div>}
      {error && <p role="alert">{error}</p>}
    </div>}
    {open && <dialog open className="radio-library" aria-label="Catálogo de estações">
      <header><strong>Rádio da Barraca</strong><button type="button" onClick={() => setOpen(false)}>Fechar</button></header>
      <form onSubmit={(event) => { event.preventDefault(); void search() }}>
        <select aria-label="Buscar por" value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="name">Nome</option><option value="country">País</option><option value="tag">Gênero</option>
        </select>
        <input type="search" placeholder="Encontre uma estação…" aria-label="Buscar estação" maxLength={80} value={query} onChange={(event) => setQuery(event.target.value)} />
        <button type="submit" disabled={searching}>{searching ? 'Buscando…' : 'Buscar'}</button>
      </form>
      {searched && !stations.length && <p>Nenhuma estação disponível para essa busca.</p>}
      <ul>{stations.map((station) => <li key={station.id}>
        <div><strong>{station.name}</strong>{station.details && <small>{station.details}</small>}</div>
        <button type="button" onClick={() => { listen(station, null); setOpen(false) }}>Ouvir só eu</button>
        {channel && (!selection || canManage) && <button type="button" disabled={changing} onClick={() => void share(station)}>Colocar na call</button>}
      </li>)}</ul>
    </dialog>}
  </section>
}
