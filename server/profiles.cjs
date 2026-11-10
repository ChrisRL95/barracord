const express = require('express')
const { randomUUID } = require('node:crypto')
const { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } = require('node:fs')
const path = require('node:path')

const address = (value) => value?.replace(/^::ffff:/i, '').toLowerCase()

async function verifyMemberDevice(request, member, getGuestDevice) {
  const remote = address(request.socket.remoteAddress)
  if (!remote || !member) return false
  if (member.invite === 'anfitriao') {
    return remote === '::1' || remote === '127.0.0.1' || remote === address(request.socket.localAddress)
  }
  if (!member.tailscaleDeviceId) return false
  try {
    const device = await getGuestDevice(member.tailscaleDeviceId)
    return device.addresses.some((value) => address(value) === remote)
  } catch { return false }
}

function imageBytes(value, limit) {
  if (value === '') return null
  if (typeof value !== 'string' || value.length > 4 * Math.ceil(limit / 3) || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('Imagem inválida ou muito grande.')
  const bytes = Buffer.from(value, 'base64')
  if (bytes.length > limit || bytes.length < 12 || bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) throw new Error('Imagem inválida ou muito grande.')
  return bytes
}

function createProfiles(directory, getMember, getGuestDevice) {
  const router = express.Router()
  const profiles = new Map()
  const validId = /^[a-z0-9-]{16,100}$/i
  const profilePath = (id) => path.join(directory, id + '.json')

  function read(id) {
    if (profiles.has(id)) return profiles.get(id)
    let profile = null
    try { profile = JSON.parse(readFileSync(profilePath(id), 'utf8')) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    profiles.set(id, profile)
    return profile
  }

  router.use((request, response, next) => {
    const id = request.query.installationId
    if (typeof id !== 'string' || !validId.test(id) || !getMember(id)) return response.status(401).json({ error: 'Entre na Barraca para abrir perfis.' })
    response.set('Cache-Control', 'private, no-store')
    next()
  })

  router.get('/:id', (request, response) => {
    const { id } = request.params
    if (!validId.test(id) || !getMember(id)) return response.sendStatus(404)
    response.json({ profile: read(id) })
  })

  router.get('/:id/:image', (request, response) => {
    const { id, image } = request.params
    if (image !== 'avatar' && image !== 'banner') return response.sendStatus(404)
    if (!validId.test(id) || !getMember(id)) return response.sendStatus(404)
    const profile = read(id)
    if (!profile?.[image]) return response.sendStatus(404)
    response.set('Cache-Control', request.query.v === profile.revision ? 'private, max-age=300' : 'private, no-store')
    response.set('X-Content-Type-Options', 'nosniff').type('jpeg').send(Buffer.from(profile[image], 'base64'))
  })

  router.put('/:id', express.json({ limit: '420kb' }), async (request, response) => {
    const { id } = request.params
    if (id !== request.query.installationId) return response.status(403).json({ error: 'Você só pode editar seu próprio perfil.' })
    const member = getMember(id)
    const verified = await verifyMemberDevice(request, member, getGuestDevice)
    if (!verified || getMember(id) !== member) return response.status(403).json({ error: 'Não consegui confirmar seu computador na Rede da Barraca. Conecte o Tailscale e tente de novo.' })
    const { bio, color, avatar, banner, nickColor = '', font = '', frame = '', effect = '', badge = '' } = request.body || {}
    if (typeof nickColor !== 'string' || (nickColor && !/^#[0-9a-f]{6}$/i.test(nickColor)) ||
        !['', 'rounded', 'retro', 'mono'].includes(font) || !['', 'neon', 'gold', 'holo'].includes(frame) ||
        !['', 'glow', 'shine'].includes(effect) || typeof badge !== 'string' || badge.length > 24 || /[\p{Cc}\p{Bidi_Control}]/u.test(badge)) {
      return response.status(400).json({ error: 'Confira as opções de estilo e o selo de até 24 caracteres.' })
    }
    if (typeof bio !== 'string' || bio.length > 180 || typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) {
      return response.status(400).json({ error: 'Confira a cor e a bio de até 180 caracteres.' })
    }
    try {
      imageBytes(avatar, 64 * 1024)
      imageBytes(banner, 240 * 1024)
    } catch (error) { return response.status(400).json({ error: error.message }) }
    const profile = { bio: bio.trim(), color, avatar, banner, nickColor, font, frame, effect, badge: badge.trim(), revision: randomUUID() }
    const temporary = profilePath(id) + '.' + profile.revision + '.tmp'
    mkdirSync(directory, { recursive: true })
    try {
      writeFileSync(temporary, JSON.stringify(profile), { flag: 'wx' })
      renameSync(temporary, profilePath(id))
    } finally {
      rmSync(temporary, { force: true })
    }
    profiles.set(id, profile)
    response.json({ profile })
  })

  router.use((error, _request, response, _next) => {
    if (error.status !== 413 && error.status !== 400) console.error('Falha ao acessar perfil:', error.code || error.name)
    const status = error.status === 413 || error.status === 400 ? error.status : 500
    response.status(status).json({ error: status === 413 ? 'As imagens do perfil ficaram muito grandes.' : 'Não foi possível processar o perfil.' })
  })
  return { router, appearance: (id) => {
    try {
      const profile = read(id)
      if (!profile) return {}
      const { nickColor, font, frame, badge, color, effect } = profile
      const bannerRevision = profile.banner ? profile.revision : undefined
      return { avatarRevision: profile.avatar ? profile.revision : undefined, appearance: { nickColor, font, frame, badge, color, effect, bannerRevision } }
    } catch { return {} }
  } }
}

module.exports = { createProfiles, verifyMemberDevice }
