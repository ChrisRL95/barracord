const express = require('express')
const { randomUUID } = require('node:crypto')
const { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } = require('node:fs')
const path = require('node:path')

const maxBytes = 44 + 32000 * 2 * 10
const validId = /^[a-f0-9-]{36}$/

function createSoundboard(directory, getMember) {
  const router = express.Router()
  const file = (id, ext) => path.join(directory, id + ext)
  const metadata = (id) => JSON.parse(readFileSync(file(id, '.json'), 'utf8'))
  const ids = () => existsSync(directory)
    ? readdirSync(directory).filter((name) => name.endsWith('.json') && validId.test(name.slice(0, -5))).map((name) => name.slice(0, -5))
    : []

  router.use((request, response, next) => {
    const member = getMember(request.query.installationId)
    if (!member) return response.status(401).json({ error: 'Entre na Barraca para usar o soundboard.' })
    response.locals.member = member
    response.set('Cache-Control', 'private, no-store')
    next()
  })

  router.get('/', (_request, response) => {
    const sounds = ids().map(metadata).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    response.json({ sounds })
  })

  router.post('/', express.raw({ type: 'audio/wav', limit: maxBytes }), (request, response) => {
    const audio = request.body
    const name = typeof request.query.name === 'string' ? request.query.name.trim() : ''
    const emoji = typeof request.query.emoji === 'string' ? request.query.emoji.trim() : ''
    const volume = typeof request.query.volume === 'string' && /^\d{1,3}$/.test(request.query.volume) ? Number(request.query.volume) : NaN
    if (!name || name.length > 40 || emoji.length > 24 || !Number.isInteger(volume) || volume < 0 || volume > 100) {
      return response.status(400).json({ error: 'Confira o nome, o emoji e o volume do som.' })
    }
    if (!Buffer.isBuffer(audio) || audio.length < 44 + 6400 || audio.length > maxBytes || audio.length % 2 ||
        audio.toString('ascii', 0, 4) !== 'RIFF' || audio.readUInt32LE(4) !== audio.length - 8 ||
        audio.toString('ascii', 8, 16) !== 'WAVEfmt ' || audio.readUInt32LE(16) !== 16 ||
        audio.readUInt16LE(20) !== 1 || audio.readUInt16LE(22) !== 1 || audio.readUInt32LE(24) !== 32000 ||
        audio.readUInt32LE(28) !== 64000 || audio.readUInt16LE(32) !== 2 || audio.readUInt16LE(34) !== 16 ||
        audio.toString('ascii', 36, 40) !== 'data' || audio.readUInt32LE(40) !== audio.length - 44) {
      return response.status(400).json({ error: 'Envie um trecho válido entre 0,1 e 10 segundos.' })
    }
    const library = ids()
    if (library.length >= 100 || library.map(metadata).filter((item) => item.owner === request.query.installationId).length >= 20) {
      return response.status(409).json({ error: 'Limite da biblioteca atingido. Remova um som seu para liberar espaço.' })
    }

    let peak = 0
    let energy = 0
    for (let offset = 44; offset < audio.length; offset += 2) {
      const sample = audio.readInt16LE(offset)
      peak = Math.max(peak, Math.abs(sample))
      energy += sample * sample
    }
    const rms = Math.sqrt(energy / ((audio.length - 44) / 2))
    const gain = (volume / 100) * Math.min(1, 24576 / Math.max(1, peak), 7209 / Math.max(1, rms))
    for (let offset = 44; offset < audio.length; offset += 2) audio.writeInt16LE(Math.round(audio.readInt16LE(offset) * gain), offset)

    const id = randomUUID()
    const sound = {
      id, name, emoji, volume, owner: request.query.installationId, author: response.locals.member.name,
      duration: (audio.length - 44) / 64000, createdAt: new Date().toISOString(),
    }
    mkdirSync(directory, { recursive: true })
    try {
      writeFileSync(file(id, '.wav'), audio, { flag: 'wx' })
      writeFileSync(file(id, '.tmp'), JSON.stringify(sound), { flag: 'wx' })
      renameSync(file(id, '.tmp'), file(id, '.json'))
    } catch (error) {
      rmSync(file(id, '.wav'), { force: true })
      rmSync(file(id, '.tmp'), { force: true })
      throw error
    }
    response.status(201).json({ sound })
  })

  router.get('/:id/audio', (request, response) => {
    const { id } = request.params
    if (!validId.test(id) || !existsSync(file(id, '.json'))) return response.sendStatus(404)
    response.set('X-Content-Type-Options', 'nosniff').type('audio/wav')
    response.sendFile(file(id, '.wav'), { cacheControl: false })
  })

  router.delete('/:id', (request, response) => {
    const { id } = request.params
    if (!validId.test(id) || !existsSync(file(id, '.json'))) return response.sendStatus(404)
    if (metadata(id).owner !== request.query.installationId) return response.sendStatus(403)
    rmSync(file(id, '.json'))
    rmSync(file(id, '.wav'), { force: true })
    response.sendStatus(204)
  })

  router.use((error, _request, response, _next) => {
    if (error.status !== 413) console.error('Falha no soundboard:', error.code || error.name)
    response.status(error.status === 413 ? 413 : 500).json({
      error: error.status === 413 ? 'O trecho excede o tamanho permitido.' : 'A Barraca não conseguiu acessar a biblioteca de sons.',
    })
  })
  return router
}

module.exports = { createSoundboard }
