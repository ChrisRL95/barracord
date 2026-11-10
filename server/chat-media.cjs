const express = require('express')
const { randomUUID } = require('node:crypto')
const { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } = require('node:fs')
const path = require('node:path')

const idPattern = /^[a-f0-9-]{36}$/
const stickerFormats = {
  'image/png': (bytes) => bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  'image/jpeg': (bytes) => bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])),
  'image/webp': (bytes) => bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP',
  'image/gif': (bytes) => ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)),
}

function createChatMedia(directory, { getMember, hasChannel, addMessage }) {
  const router = express.Router()
  const file = (id, suffix) => path.join(directory, id + suffix)
  const stickerIds = () => existsSync(directory)
    ? readdirSync(directory).filter((name) => name.endsWith('.sticker.json') && idPattern.test(name.slice(0, -13))).map((name) => name.slice(0, -13))
    : []
  const sticker = (id) => idPattern.test(id) && existsSync(file(id, '.sticker.json'))
    ? JSON.parse(readFileSync(file(id, '.sticker.json'), 'utf8')) : null
  const save = (id, suffix, bytes) => {
    mkdirSync(directory, { recursive: true })
    writeFileSync(file(id, suffix), bytes, { flag: 'wx' })
  }
  const removeMessageMedia = (id, kind) => {
    if (!idPattern.test(id)) return
    try { rmSync(file(id, kind === 'image' ? '.image' : '.webm'), { force: true }) }
    catch (error) { console.error('Falha ao limpar mídia do chat:', error.code) }
  }
  router.use((request, response, next) => {
    const installationId = request.query.installationId
    const member = getMember(installationId)
    if (!member) return response.sendStatus(401)
    response.locals.member = member
    response.locals.installationId = installationId
    response.set('X-Content-Type-Options', 'nosniff')
    next()
  })
  router.get('/stickers', (_request, response) => {
    response.json({ stickers: stickerIds().map(sticker).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')) })
  })
  router.post('/stickers', express.raw({ type: Object.keys(stickerFormats), limit: '5mb' }), (request, response) => {
    const type = request.get('Content-Type')?.split(';')[0].toLowerCase()
    const name = typeof request.query.name === 'string' ? request.query.name.trim().slice(0, 40) : ''
    if (!name || !Buffer.isBuffer(request.body) || !Object.hasOwn(stickerFormats, type) || !stickerFormats[type](request.body)) {
      return response.status(400).json({ error: 'Escolha uma imagem PNG, JPEG, WebP ou GIF válida.' })
    }
    if (stickerIds().length >= 100) return response.status(409).json({ error: 'A biblioteca já tem 100 figurinhas.' })
    const id = randomUUID()
    const item = { id, name, type }
    save(id, '.sticker', request.body)
    try { save(id, '.sticker.json', JSON.stringify(item)) }
    catch (error) { rmSync(file(id, '.sticker'), { force: true }); throw error }
    return response.status(201).json({ sticker: item })
  })
  router.get('/stickers/:id', (request, response) => {
    const item = sticker(request.params.id)
    if (!item) return response.sendStatus(404)
    return response.type(item.type).sendFile(file(item.id, '.sticker'), { maxAge: '1d', immutable: true })
  })
  router.post('/stickers/:id/send', (request, response) => {
    const item = sticker(request.params.id)
    const { channel } = request.query
    if (!hasChannel(channel)) return response.status(400).json({ error: 'Canal de texto inválido.' })
    if (!item) return response.status(404).json({ error: 'Figurinha indisponível.' })
    const message = addMessage(channel, response.locals.member, response.locals.installationId, `[Figurinha: ${item.name}]`, {
      kind: 'sticker', id: item.id, name: item.name,
    }, request.query.replyTo)
    return response.status(201).json({ message })
  })
  router.post('/voice', express.raw({ type: 'audio/webm', limit: '1mb' }), (request, response) => {
    const { channel } = request.query
    if (!hasChannel(channel)) return response.status(400).json({ error: 'Canal de texto inválido.' })
    if (!Buffer.isBuffer(request.body) || request.body.length < 32 ||
        !request.body.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
      return response.status(400).json({ error: 'Gravação de voz inválida.' })
    }
    const id = randomUUID()
    save(id, '.webm', request.body)
    try {
      const duration = typeof request.query.duration === 'string' ? Number(request.query.duration) : 0
      const media = { kind: 'voice', id, ...(duration > 0 && duration <= 60 && { duration }) }
      const message = addMessage(channel, response.locals.member, response.locals.installationId, '[Mensagem de voz]', media, request.query.replyTo)
      return response.status(201).json({ message })
    } catch (error) { removeMessageMedia(id, 'voice'); throw error }
  })
  router.post('/images', express.raw({ type: Object.keys(stickerFormats), limit: '5mb' }), (request, response) => {
    const { channel, caption } = request.query
    const type = request.get('Content-Type')?.split(';')[0].toLowerCase()
    if (!hasChannel(channel)) return response.status(400).json({ error: 'Canal de texto inválido.' })
    if (!Buffer.isBuffer(request.body) || !Object.hasOwn(stickerFormats, type) || !stickerFormats[type](request.body)) {
      return response.status(400).json({ error: 'Formato de imagem inválido.' })
    }
    const id = randomUUID()
    const body = typeof caption === 'string' ? caption.trim().slice(0, 1000) : ''
    save(id, '.image', request.body)
    try {
      const message = addMessage(channel, response.locals.member, response.locals.installationId, body || '[Imagem]', { kind: 'image', id }, request.query.replyTo)
      return response.status(201).json({ message })
    } catch (error) { removeMessageMedia(id, 'image'); throw error }
  })
  router.get('/images/:id', (request, response) => {
    const { id } = request.params
    if (!idPattern.test(id) || !existsSync(file(id, '.image'))) return response.sendStatus(404)
    const bytes = readFileSync(file(id, '.image'))
    const type = Object.keys(stickerFormats).find((key) => stickerFormats[key](bytes))
    if (!type) return response.sendStatus(404)
    return response.type(type).send(bytes)
  })
  router.get('/voice/:id', (request, response) => {
    const { id } = request.params
    if (!idPattern.test(id) || !existsSync(file(id, '.webm'))) return response.sendStatus(404)
    return response.type('audio/webm').sendFile(file(id, '.webm'), { maxAge: '1d', immutable: true })
  })
  router.use((error, request, response, _next) => {
    if (error.status === 409) return response.status(409).json({ error: error.message })
    if (error.status === 413) {
      const limit = request.path === '/voice' ? '1 MB' : '5 MB'
      return response.status(413).json({ error: `O arquivo excede ${limit}.` })
    }
    console.error('Falha na mídia do chat:', error.code || error.name)
    return response.status(500).json({ error: 'A Barraca não conseguiu salvar ou ler o arquivo.' })
  })
  return { router, removeMessageMedia }
}

module.exports = { createChatMedia }
