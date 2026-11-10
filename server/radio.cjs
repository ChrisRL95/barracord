const express = require('express')

const mirror = 'https://de1.api.radio-browser.info'
const stationId = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i

function playableStation(item) {
  if (!stationId.test(item.stationuuid) || item.codec !== 'MP3' || item.hls || !item.lastcheckok) return null
  let url
  try { url = new URL(item.url_resolved) } catch { return null }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !/[a-z]/i.test(url.hostname) || !url.hostname.includes('.') || /\.(local|localhost|internal|test|home\.arpa)\.?$/i.test(url.hostname)) return null
  return { id: item.stationuuid, name: String(item.name || 'Rádio').slice(0, 120), url: url.href,
    details: [item.countrycode, String(item.tags || '').split(',').filter(Boolean).slice(0, 2).join(', ')].filter(Boolean).join(' · ').slice(0, 100) }
}

async function catalog(pathname, params) {
  const response = await fetch(mirror + pathname + '?' + new URLSearchParams(params), {
    signal: AbortSignal.timeout(5000),
    headers: { 'User-Agent': 'Barracord/1.0 (internet radio)', Accept: 'application/json' },
  })
  if (!response.ok) throw new Error('Catalog request failed')
  return (await response.json()).map(playableStation).filter(Boolean)
}

function createRadio({ getMember, currentChannel, hostCode }) {
  const router = express.Router()
  const shared = new Map()
  router.use((request, response, next) => {
    const id = request.query.installationId
    const member = getMember(id)
    if (!member) return response.sendStatus(401)
    response.locals.listener = { id, member }
    response.set('Cache-Control', 'no-store')
    next()
  })
  router.get('/stations', async (request, response) => {
    const filter = ['country', 'tag'].includes(request.query.filter) ? request.query.filter : 'name'
    const query = typeof request.query.q === 'string' ? request.query.q.trim().slice(0, 80) : ''
    try {
      const stations = await catalog('/json/stations/search', { [filter]: query, codec: 'MP3', is_https: 'true', hidebroken: 'true', order: 'clickcount', reverse: 'true', limit: '60' })
      return response.json({ stations: stations.slice(0, 30) })
    } catch {
      return response.status(502).json({ error: 'Catálogo de rádios indisponível. Tente novamente em instantes.' })
    }
  })
  router.get('/current', (request, response) => {
    const channel = currentChannel(response.locals.listener.id)
    return response.json({ selection: channel && channel === request.query.channel ? shared.get(channel) ?? null : null })
  })
  router.put('/current', async (request, response) => {
    const { id, member } = response.locals.listener
    const { channel, station } = request.body ?? {}
    if (typeof channel !== 'string' || channel !== currentChannel(id)) return response.status(409).json({ error: 'Entre neste canal de voz para compartilhar a rádio.' })
    if (station !== null && (typeof station !== 'string' || !stationId.test(station))) return response.sendStatus(400)
    const canChange = () => {
      const current = shared.get(channel)
      return !current || current.owner === id || request.body?.hostCode === hostCode
    }
    const conflict = () => response.status(409).json({ error: 'Quem colocou a rádio ou o anfitrião pode trocá-la ou encerrá-la.' })
    if (!canChange()) return conflict()
    if (station === null) { shared.delete(channel); return response.json({ selection: null }) }
    try {
      const [item] = await catalog('/json/stations/byuuid/' + station)
      if (!item) return response.status(404).json({ error: 'Essa estação não está disponível em MP3 por HTTPS.' })
      if (getMember(id) !== member || currentChannel(id) !== channel) return response.status(409).json({ error: 'Você saiu do canal de voz.' })
      if (!canChange()) return conflict()
      const selection = { station: item, owner: id, author: member.name }
      shared.set(channel, selection)
      return response.json({ selection })
    } catch {
      return response.status(502).json({ error: 'Não foi possível consultar essa estação agora.' })
    }
  })
  return { router, clearInactive(channels) {
    for (const [channel, selection] of shared) {
      if (!channels[channel]?.some((person) => person.identity === selection.owner)) shared.delete(channel)
    }
  } }
}

module.exports = { createRadio }
