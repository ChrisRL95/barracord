const dotenv = require('dotenv')
const cors = require('cors')
const express = require('express')
const { AccessToken, RoomServiceClient } = require('livekit-server-sdk')
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const path = require('node:path')
const { createTailscaleProvisioner } = require('./tailscale-provisioning.cjs')
const { createSoundboard } = require('./soundboard.cjs')

dotenv.config({ path: process.env.BARRACORD_ENV_FILE || path.resolve(process.cwd(), '.env.server') })

const apiKey = process.env.LIVEKIT_API_KEY
const apiSecret = process.env.LIVEKIT_API_SECRET
const hostCode = process.env.APP_INVITE_CODE
const port = Number(process.env.TOKEN_SERVER_PORT || 3001)
const dataDirectory = process.env.BARRACORD_DATA_DIR || path.resolve(process.cwd(), 'data')
const invitesFile = process.env.BARRACORD_INVITES_FILE || path.join(dataDirectory, 'barracord-invites.json')
const membersFile = process.env.BARRACORD_MEMBERS_FILE || path.join(dataDirectory, 'barracord-members.json')
const messagesFile = process.env.BARRACORD_MESSAGES_FILE || path.join(dataDirectory, 'barracord-messages.json')
const channelsFile = process.env.BARRACORD_CHANNELS_FILE || path.join(dataDirectory, 'barracord-channels.json')
const defaultChannels = {
  text: [{ id: 'geral', name: 'geral', protected: true }, { id: 'clipes-e-memes', name: 'clipes-e-memes', protected: false }],
  voice: [{ id: 'geral', name: 'Geral', protected: true }, { id: 'jogatina', name: 'Jogatina', protected: false }, { id: 'filmes', name: 'Filmes', protected: false }, { id: 'afk', name: 'AFK', protected: false }],
}

if (!apiKey || !apiSecret || !hostCode) throw new Error('Defina LIVEKIT_API_KEY, LIVEKIT_API_SECRET e APP_INVITE_CODE.')

function loadInvites() {
  try { return JSON.parse(readFileSync(invitesFile, 'utf8')) }
  catch { return {} }
}

let invites = loadInvites()
function loadMembers() {
  try { return JSON.parse(readFileSync(membersFile, 'utf8')) }
  catch { return {} }
}

let members = loadMembers()
const memberHeartbeats = new Map()
function loadMessages() {
  try { return JSON.parse(readFileSync(messagesFile, 'utf8')) }
  catch { return {} }
}

let messages = loadMessages()
function loadChannels() {
  try {
    const saved = JSON.parse(readFileSync(channelsFile, 'utf8'))
    if (Array.isArray(saved.text) && Array.isArray(saved.voice)) return saved
  } catch {}
  return structuredClone(defaultChannels)
}

let channels = loadChannels()
function saveInvites() {
  mkdirSync(path.dirname(invitesFile), { recursive: true })
  writeFileSync(invitesFile, JSON.stringify(invites, null, 2), 'utf8')
}
function saveMembers() {
  mkdirSync(path.dirname(membersFile), { recursive: true })
  writeFileSync(membersFile, JSON.stringify(members, null, 2), 'utf8')
}
function saveMessages() {
  mkdirSync(path.dirname(messagesFile), { recursive: true })
  writeFileSync(messagesFile, JSON.stringify(messages, null, 2), 'utf8')
}
function saveChannels() {
  mkdirSync(path.dirname(channelsFile), { recursive: true })
  writeFileSync(channelsFile, JSON.stringify(channels, null, 2), 'utf8')
}
function normalizeInvite(value) { return typeof value === 'string' ? value.trim().toUpperCase() : '' }
function newInviteCode() {
  let code = ''
  do { code = `BARRACA-${crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}` } while (invites[code])
  return code
}
function inviteStatus(invite) {
  if (invite.revokedAt) return 'revogado'
  if (invite.usedAt) return 'usado'
  if (invite.expiresAt && new Date(invite.expiresAt) <= new Date()) return 'expirado'
  return 'ativo'
}
function adminInvites() {
  return Object.entries(invites).map(([code, invite]) => ({
    code,
    label: invite.label || '',
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt || null,
    usedAt: invite.usedAt || null,
    status: inviteStatus(invite),
    activationReady: Boolean(invite.networkKeyId),
  })).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
function inviteExpiry(value) {
  if (value === 'day') return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  if (value === 'week') return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  return null
}
function activationExpiry(value) { return value === 'week' ? 7 * 24 * 60 * 60 : 24 * 60 * 60 }
function activationCode(invite, networkKey) {
  const payload = Buffer.from(JSON.stringify({ version: 1, invite, networkKey }), 'utf8').toString('base64url')
  return `BARRACA1.${payload}`
}
function channelType(value) { return value === 'text' || value === 'voice' ? value : null }
function channelById(type, id) { return channels[type].find((channel) => channel.id === id) }
function channelIdFromName(name) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
function validateChannelName(name) {
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 32) return 'Use um nome entre 2 e 32 caracteres.'
  if (!channelIdFromName(name)) return 'Use pelo menos letras ou números no nome do canal.'
  return null
}

const app = express()
const roomService = new RoomServiceClient('http://127.0.0.1:7880', apiKey, apiSecret)
const tailscaleProvisioner = createTailscaleProvisioner()
const trustedWebOrigins = new Set((process.env.WEB_ORIGIN || '').split(',').map((origin) => origin.trim()).filter(Boolean))

function isTrustedClientOrigin(origin) {
  // A build Electron é carregada de um arquivo local. Chromium pode enviar
  // `file://` ou a origem opaca `null` nesse caso; sites web continuam bloqueados.
  if (!origin || origin === 'null' || origin.startsWith('file://')) return true
  return trustedWebOrigins.has(origin)
}

app.use(cors({
  origin(origin, callback) {
    callback(null, isTrustedClientOrigin(origin))
  },
}))
app.use(express.json({ limit: '8kb' }))
app.use('/soundboard', createSoundboard(path.resolve(dataDirectory, 'soundboard'), (id) => (
  typeof id === 'string' && Object.hasOwn(members, id) ? getAuthorizedMember(id) : null
)))
app.get('/health', async (_request, response) => {
  try {
    await roomService.listParticipants(channels.voice[0]?.id || 'geral')
    return response.json({ ok: true, livekit: 'ready' })
  } catch {
    return response.status(503).json({ ok: false, error: 'O servidor de voz não respondeu.' })
  }
})

function rememberMemberHeartbeat(installationId, away = false) {
  memberHeartbeats.set(installationId, { lastSeen: Date.now(), away: Boolean(away) })
}

function activeMemberStatus(installationId, callsByInstallation) {
  const call = callsByInstallation.get(installationId)
  if (call) return { status: call.streaming ? 'streaming' : 'em-call', channelId: call.channelId }
  const heartbeat = memberHeartbeats.get(installationId)
  if (!heartbeat || Date.now() - heartbeat.lastSeen >= 45_000) return { status: 'offline', channelId: null }
  return { status: heartbeat.away ? 'away' : 'online', channelId: null }
}

app.post('/presence/heartbeat', (request, response) => {
  const installationId = request.body?.installationId
  if (!getAuthorizedMember(installationId)) return response.status(401).json({ error: 'Este computador ainda não está autorizado na Barraca.' })
  rememberMemberHeartbeat(installationId, request.body?.away)
  return response.json({ ok: true })
})

app.get('/presence', async (request, response) => {
  if (!getAuthorizedMember(request.query.installationId)) return response.status(401).json({ error: 'Este computador ainda não está autorizado na Barraca.' })
  try {
    const presence = await Promise.all(channels.voice.map(async (channel) => {
      const participants = await roomService.listParticipants(channel.id)
      return [channel.id, participants]
    }))
    const channelsPresence = Object.fromEntries(presence.map(([channelId, participants]) => [channelId, participants.map((participant) => ({ identity: participant.identity, name: participant.name || participant.identity }))]))
    const callsByInstallation = new Map()
    presence.forEach(([channelId, participants]) => participants.forEach((participant) => callsByInstallation.set(participant.identity, {
      channelId,
      streaming: participant.tracks?.some((track) => track.source === 3 || track.source === 'SCREEN_SHARE'),
    })))
    const memberList = Object.entries(members).map(([installationId, member]) => ({ installationId, name: member.name, ...activeMemberStatus(installationId, callsByInstallation) }))
    return response.json({ channels: channelsPresence, members: memberList })
  } catch {
    return response.status(503).json({ error: 'A Barraca ainda não está pronta.' })
  }
})

function getAuthorizedMember(installationId) {
  return typeof installationId === 'string' ? members[installationId] : null
}

function requireHostCode(request, response) {
  if (request.body?.hostCode !== hostCode) {
    response.status(401).json({ error: 'Chave do anfitrião inválida.' })
    return false
  }
  return true
}

function adminMembers() {
  return Object.entries(members).map(([installationId, member]) => ({
    installationId,
    name: member.name,
    authorizedAt: member.authorizedAt,
    networkLinked: Boolean(member.tailscaleDeviceId),
  })).sort((a, b) => b.authorizedAt.localeCompare(a.authorizedAt))
}

app.get('/channels', (request, response) => {
  if (!getAuthorizedMember(request.query.installationId)) return response.status(401).json({ error: 'Este computador ainda não está autorizado na Barraca.' })
  return response.json({ channels })
})

app.post('/admin/status', async (request, response) => {
  if (!requireHostCode(request, response)) return
  try {
    const rawPresence = await Promise.all(channels.voice.map(async (channel) => {
      const participants = await roomService.listParticipants(channel.id)
      return [channel.id, participants]
    }))
    const streams = new Set()
    for (const [, participants] of rawPresence) {
      for (const participant of participants) {
        if (participant.tracks?.some((track) => track.source === 3 || track.source === 'SCREEN_SHARE')) streams.add(participant.identity)
      }
    }
    const streamCount = streams.size
    const presence = rawPresence.map(([channelId, participants]) => [channelId, participants.map((participant) => ({ identity: participant.identity, name: participant.name || participant.identity }))])
    return response.json({ members: adminMembers(), presence: Object.fromEntries(presence), channels, invites: adminInvites(), metrics: { streamCount, estimatedUploadMbps: streamCount * 6 }, networkProvisioning: tailscaleProvisioner.status() })
  } catch {
    return response.status(503).json({ error: 'A Barraca ainda não está pronta.' })
  }
})

app.post('/admin/invites', async (request, response) => {
  if (!requireHostCode(request, response)) return
  const label = typeof request.body?.label === 'string' ? request.body.label.trim() : ''
  if (label.length > 32) return response.status(400).json({ error: 'A observação pode ter no máximo 32 caracteres.' })
  const provisioning = tailscaleProvisioner.status()
  if (!provisioning.ready) return response.status(503).json({ error: provisioning.message })
  const expiresIn = request.body?.expiresIn === 'week' ? 'week' : 'day'
  const invite = newInviteCode()
  try {
    const networkKey = await tailscaleProvisioner.createOneTimeGuestKey(label, activationExpiry(expiresIn))
    invites[invite] = {
      createdAt: new Date().toISOString(),
      label,
      expiresAt: inviteExpiry(expiresIn),
      usedAt: null,
      revokedAt: null,
      networkKeyId: networkKey.id,
      networkExpiresAt: networkKey.expiresAt,
    }
    saveInvites()
    return response.status(201).json({ invite, activationCode: activationCode(invite, networkKey.key), invites: adminInvites() })
  } catch (error) {
    return response.status(503).json({ error: error instanceof Error ? error.message : 'Não foi possível criar a ativação da Rede da Barraca.' })
  }
})

app.delete('/admin/invites/:code', async (request, response) => {
  if (!requireHostCode(request, response)) return
  const code = normalizeInvite(request.params.code)
  const invite = invites[code]
  if (!invite) return response.status(404).json({ error: 'Convite não encontrado.' })
  if (invite.usedAt) return response.status(409).json({ error: 'Um convite já usado não precisa ser revogado.' })
  if (invite.networkKeyId) {
    try { await tailscaleProvisioner.revokeGuestKey(invite.networkKeyId) }
    catch (error) { return response.status(503).json({ error: error instanceof Error ? error.message : 'Não foi possível revogar a ativação da Rede da Barraca.' }) }
  }
  invite.revokedAt = new Date().toISOString()
  saveInvites()
  return response.json({ ok: true, invites: adminInvites() })
})

app.post('/admin/channels', (request, response) => {
  if (!requireHostCode(request, response)) return
  const type = channelType(request.body?.type)
  const validationError = validateChannelName(request.body?.name)
  if (!type || validationError) return response.status(400).json({ error: validationError || 'Tipo de canal inválido.' })
  const id = channelIdFromName(request.body.name)
  if (channelById(type, id)) return response.status(409).json({ error: 'Já existe um canal com esse nome.' })
  const channel = { id, name: request.body.name.trim(), protected: false }
  channels[type].push(channel)
  saveChannels()
  return response.status(201).json({ channel, channels })
})

app.patch('/admin/channels/:id', (request, response) => {
  if (!requireHostCode(request, response)) return
  const type = channelType(request.body?.type)
  const validationError = validateChannelName(request.body?.name)
  if (!type || validationError) return response.status(400).json({ error: validationError || 'Tipo de canal inválido.' })
  const channel = channelById(type, request.params.id)
  if (!channel) return response.status(404).json({ error: 'Canal não encontrado.' })
  if (channel.protected) return response.status(403).json({ error: 'O canal Geral é protegido.' })
  channel.name = request.body.name.trim()
  saveChannels()
  return response.json({ channel, channels })
})

app.patch('/admin/channels/:id/order', (request, response) => {
  if (!requireHostCode(request, response)) return
  const type = channelType(request.body?.type)
  const direction = request.body?.direction
  if (!type || (direction !== 'up' && direction !== 'down')) return response.status(400).json({ error: 'Movimento de canal inválido.' })
  const index = channels[type].findIndex((channel) => channel.id === request.params.id)
  if (index < 0) return response.status(404).json({ error: 'Canal não encontrado.' })
  if (channels[type][index].protected) return response.status(403).json({ error: 'O canal Geral permanece no topo.' })
  const nextIndex = direction === 'up' ? index - 1 : index + 1
  if (nextIndex < 1 || nextIndex >= channels[type].length) return response.status(409).json({ error: 'O canal já está no limite desta lista.' })
  const [channel] = channels[type].splice(index, 1)
  channels[type].splice(nextIndex, 0, channel)
  saveChannels()
  return response.json({ channels })
})

app.delete('/admin/channels/:id', async (request, response) => {
  if (!requireHostCode(request, response)) return
  const type = channelType(request.body?.type)
  if (!type) return response.status(400).json({ error: 'Tipo de canal inválido.' })
  const channel = channelById(type, request.params.id)
  if (!channel) return response.status(404).json({ error: 'Canal não encontrado.' })
  if (channel.protected) return response.status(403).json({ error: 'O canal Geral é protegido.' })
  if (type === 'voice') {
    const participants = await roomService.listParticipants(channel.id)
    if (participants.length) return response.status(409).json({ error: 'Não é possível remover um canal de voz com pessoas na call.' })
  } else {
    delete messages[channel.id]
    saveMessages()
  }
  channels[type] = channels[type].filter((item) => item.id !== channel.id)
  saveChannels()
  return response.json({ ok: true, channels })
})

app.delete('/admin/members/:installationId', async (request, response) => {
  if (!requireHostCode(request, response)) return
  const { installationId } = request.params
  const member = members[installationId]
  if (!member) return response.status(404).json({ error: 'Membro não encontrado.' })
  if (member.tailscaleDeviceId) {
    try {
      await tailscaleProvisioner.removeGuestDevice(member.tailscaleDeviceId)
    } catch (error) {
      return response.status(502).json({ error: error instanceof Error ? `O acesso à Rede da Barraca não foi removido; o membro continua autorizado. ${error.message}` : 'Não foi possível remover o computador da Rede da Barraca.' })
    }
  }
  delete members[installationId]
  saveMembers()
  return response.json({ ok: true, networkRemoved: Boolean(member.tailscaleDeviceId) })
})

app.get('/messages', (request, response) => {
  const channel = typeof request.query.channel === 'string' ? request.query.channel : ''
  const member = getAuthorizedMember(request.query.installationId)
  if (!member) return response.status(401).json({ error: 'Este computador ainda não está autorizado na Barraca.' })
  if (!channelById('text', channel)) return response.status(400).json({ error: 'Canal de texto inválido.' })
  return response.json({ messages: (messages[channel] || []).slice(-100) })
})

app.post('/messages', (request, response) => {
  const { channel, body, installationId } = request.body || {}
  const member = getAuthorizedMember(installationId)
  if (!member) return response.status(401).json({ error: 'Este computador ainda não está autorizado na Barraca.' })
  if (!channelById('text', channel)) return response.status(400).json({ error: 'Canal de texto inválido.' })
  if (typeof body !== 'string' || !body.trim() || body.trim().length > 1_000) return response.status(400).json({ error: 'A mensagem deve ter entre 1 e 1000 caracteres.' })
  const message = { id: crypto.randomUUID(), author: member.name, installationId, body: body.trim(), createdAt: new Date().toISOString() }
  messages[channel] = [...(messages[channel] || []), message].slice(-500)
  saveMessages()
  return response.status(201).json({ message })
})

function validateInstallation(installationId, participantName) {
  if (typeof installationId !== 'string' || !/^[a-z0-9-]{16,100}$/i.test(installationId)) return 'Não foi possível identificar esta instalação.'
  if (typeof participantName !== 'string' || participantName.trim().length < 2 || participantName.length > 32) return 'Informe um nome entre 2 e 32 caracteres.'
  return null
}

app.post('/register', (request, response) => {
  const { participantName, invite, installationId, networkDeviceId } = request.body || {}
  const validationError = validateInstallation(installationId, participantName)
  if (validationError) return response.status(400).json({ error: validationError })

  const register = async () => {
    let member = members[installationId]
    if (!member) {
      const inviteData = invites[normalizeInvite(invite)]
      if (!inviteData) return response.status(401).json({ error: 'Use um convite válido para autorizar este computador.' })
      const status = inviteStatus(inviteData)
      if (status !== 'ativo') return response.status(401).json({ error: status === 'revogado' ? 'Este convite foi revogado.' : status === 'expirado' ? 'Este convite expirou.' : 'Este convite já foi usado.' })
    }
    if (typeof networkDeviceId === 'string' && networkDeviceId) {
      try {
        const device = await tailscaleProvisioner.getGuestDevice(networkDeviceId)
        if (!member) member = { name: participantName.trim(), authorizedAt: new Date().toISOString(), invite: normalizeInvite(invite) }
        member.tailscaleDeviceId = device.id
      } catch (error) {
        return response.status(403).json({ error: error instanceof Error ? error.message : 'A Rede da Barraca não confirmou este computador.' })
      }
    } else if (!member) return response.status(403).json({ error: 'A Rede da Barraca não confirmou a identidade deste computador.' })

    if (!member) return response.status(500).json({ error: 'Não foi possível preparar este computador.' })
    if (!members[installationId]) {
      members[installationId] = member
      invites[normalizeInvite(invite)].usedAt = new Date().toISOString()
      saveInvites()
    } else if (member.name !== participantName.trim()) member.name = participantName.trim()
    saveMembers()
    return response.json({ ok: true, member: { name: member.name, authorizedAt: member.authorizedAt } })
  }
  void register()
})

app.post('/host/bootstrap', (request, response) => {
  if (!requireHostCode(request, response)) return
  const { participantName, installationId } = request.body || {}
  const validationError = validateInstallation(installationId, participantName)
  if (validationError) return response.status(400).json({ error: validationError })
  const member = members[installationId] || { name: participantName.trim(), authorizedAt: new Date().toISOString(), invite: 'anfitriao' }
  member.name = participantName.trim()
  members[installationId] = member
  saveMembers()
  return response.json({ ok: true, member: { name: member.name, authorizedAt: member.authorizedAt } })
})

app.post('/token', async (request, response) => {
  const { roomName, participantName, installationId } = request.body || {}
  const validationError = validateInstallation(installationId, participantName)
  if (validationError) return response.status(400).json({ error: validationError })
  if (typeof roomName !== 'string' || !channelById('voice', roomName)) return response.status(400).json({ error: 'Canal de voz inválido.' })

  let member = members[installationId]
  if (!member) return response.status(401).json({ error: 'Este computador ainda não está autorizado na Barraca.' })
  if (member.name !== participantName.trim()) {
    member.name = participantName.trim()
    saveMembers()
  }

  rememberMemberHeartbeat(installationId)
  const token = new AccessToken(apiKey, apiSecret, { identity: installationId, name: participantName.trim(), ttl: '8h' })
  token.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true, canPublishData: true })
  return response.json({ token: await token.toJwt() })
})

function startHostServer() {
  return app.listen(port, '0.0.0.0', () => console.log(`Servidor de convites na porta ${port}`))
}

if (require.main === module) startHostServer()

module.exports = { startHostServer }
