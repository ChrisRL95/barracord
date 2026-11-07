const oauthTokenEndpoint = 'https://api.tailscale.com/api/v2/oauth/token'
const apiBaseUrl = 'https://api.tailscale.com/api/v2'

function safeProvisioningError(response, operation) {
  if (response.status === 401 || response.status === 403) return `O Tailscale recusou a permissão para ${operation}. Confira a credencial do Anfitrião.`
  if (response.status === 429) return 'O Tailscale pediu para tentar novamente em instantes.'
  return `Não foi possível ${operation} agora.`
}

function createTailscaleProvisioner(environment = process.env) {
  const clientId = environment.TAILSCALE_OAUTH_CLIENT_ID?.trim() || ''
  const clientSecret = environment.TAILSCALE_OAUTH_CLIENT_SECRET?.trim() || ''
  const guestTag = environment.TAILSCALE_GUEST_TAG?.trim() || 'tag:barracord-guest'

  function status() {
    if (!clientId || !clientSecret) return { ready: false, guestTag, message: 'As credenciais privadas da Rede da Barraca ainda não foram configuradas.' }
    return { ready: true, guestTag, message: 'Rede da Barraca pronta para criar ativações únicas.' }
  }

  async function accessToken() {
    if (!clientId || !clientSecret) throw new Error(status().message)
    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'auth_keys devices:core',
      tags: guestTag,
    })
    const response = await fetch(oauthTokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    })
    if (!response.ok) throw new Error(safeProvisioningError(response, 'preparar a Rede da Barraca'))
    const body = await response.json()
    if (typeof body.access_token !== 'string' || !body.access_token) throw new Error('O Tailscale não respondeu com uma autorização temporária.')
    return body.access_token
  }

  async function apiRequest(path, options = {}) {
    const token = await accessToken()
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
    })
    if (!response.ok) throw new Error(safeProvisioningError(response, 'falar com a Rede da Barraca'))
    return response
  }

  async function createOneTimeGuestKey(label = '', expirySeconds = 86_400) {
    const response = await apiRequest('/tailnet/-/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilities: {
          devices: {
            create: {
              reusable: false,
              ephemeral: false,
              preauthorized: true,
              tags: [guestTag],
            },
          },
        },
        expirySeconds: Math.max(86_400, Math.min(7 * 24 * 60 * 60, Number(expirySeconds) || 86_400)),
        description: `Barracord guest${label ? ` — ${label.slice(0, 32)}` : ''}`,
      }),
    })
    const body = await response.json()
    if (typeof body.key !== 'string' || !body.key) throw new Error('A Rede da Barraca não criou uma chave de ativação válida.')
    return { key: body.key, id: typeof body.id === 'string' ? body.id : '', expiresAt: body.expires || null }
  }

  async function removeGuestDevice(deviceId) {
    if (typeof deviceId !== 'string' || !deviceId) throw new Error('Dispositivo da Rede da Barraca inválido.')
    await apiRequest(`/device/${encodeURIComponent(deviceId)}`, { method: 'DELETE' })
  }

  async function getGuestDevice(deviceId) {
    if (typeof deviceId !== 'string' || !deviceId) throw new Error('O computador não informou um dispositivo válido da Rede da Barraca.')
    const response = await apiRequest(`/device/${encodeURIComponent(deviceId)}`)
    const device = await response.json()
    const tags = Array.isArray(device?.tags) ? device.tags : []
    if (!tags.includes(guestTag)) throw new Error('Esse computador não pertence à Rede da Barraca.')
    if (typeof device?.id !== 'string' || !device.id) throw new Error('A Rede da Barraca não confirmou a identidade deste computador.')
    return { id: device.id, addresses: Array.isArray(device.addresses) ? device.addresses.filter((value) => typeof value === 'string') : [] }
  }

  async function revokeGuestKey(keyId) {
    if (typeof keyId !== 'string' || !keyId) throw new Error('Chave de ativação da Rede da Barraca inválida.')
    await apiRequest(`/tailnet/-/keys/${encodeURIComponent(keyId)}`, { method: 'DELETE' })
  }

  return { status, createOneTimeGuestKey, getGuestDevice, removeGuestDevice, revokeGuestKey }
}

module.exports = { createTailscaleProvisioner }
