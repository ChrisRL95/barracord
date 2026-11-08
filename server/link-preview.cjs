const { Resolver } = require('node:dns/promises')
const { BlockList, isIP } = require('node:net')
const http = require('node:http')
const https = require('node:https')

const resolver = new Resolver({ timeout: 1000, tries: 1 })
const privateNetworks = new BlockList()
for (const [ip, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
]) privateNetworks.addSubnet(ip, prefix)

function publicUrl(value) {
  if (typeof value !== 'string' || value.length > 1000) return null
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port ||
        isIP(url.hostname) || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(url.hostname)) return null
    url.hash = ''
    return url
  } catch { return null }
}

async function readHead(url, signal, redirects = 0) {
  const addresses = await resolver.resolve4(url.hostname)
  if (signal.aborted || !addresses.length || addresses.some((ip) => privateNetworks.check(ip))) return null
  // Connect only to the validated address. Keep the original hostname for TLS.
  const result = await new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http
    const request = client.get(url, {
      agent: false, family: 4, signal,
      lookup: (_host, _options, callback) => callback(null, addresses[0], 4),
      headers: { Accept: 'text/html', 'Accept-Encoding': 'identity', 'User-Agent': 'Barracord Link Preview' },
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        resolve({ location: response.headers.location })
        response.destroy()
        return
      }
      if (response.statusCode !== 200 || !/^text\/html\b/i.test(response.headers['content-type'] ?? '')) {
        resolve(null)
        response.destroy()
        return
      }
      let html = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        html += chunk.slice(0, Math.max(0, 96_000 - html.length))
        const end = html.search(/<\/head\s*>/i)
        if (end >= 0 || html.length >= 96_000) {
          resolve({ html: end >= 0 ? html.slice(0, end) : html })
          response.destroy()
        }
      })
      response.on('end', () => resolve({ html }))
      response.on('error', reject)
      response.on('aborted', () => reject(new Error('Preview response ended early')))
    })
    request.on('error', reject)
  })
  if (result?.location) {
    const next = publicUrl(new URL(result.location, url).href)
    return next && redirects < 3 ? readHead(next, signal, redirects + 1) : null
  }
  return result?.html ?? null
}

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
function clean(value, limit) {
  return (value ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (original, entity) => {
    if (!entity.startsWith('#')) return Object.hasOwn(entities, entity) ? entities[entity] : original
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1))
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
  }).replace(/\s+/g, ' ').trim().slice(0, limit)
}

function metadata(html, hostname) {
  const values = new Map()
  for (const [tag] of html.matchAll(/<meta\s+(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)) {
    const attrs = new Map(Array.from(tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g),
      ([, key, doubleQuoted, singleQuoted, plain]) => [key.toLowerCase(), doubleQuoted ?? singleQuoted ?? plain]))
    const key = (attrs.get('property') ?? attrs.get('name'))?.toLowerCase()
    if (key && attrs.has('content') && !values.has(key)) values.set(key, attrs.get('content'))
  }
  const title = clean(values.get('og:title') ?? values.get('twitter:title') ?? html.match(/<title\b[^>]*>([^<]*)<\/title\s*>/i)?.[1], 140)
  if (!title) return null
  const description = clean(values.get('og:description') ?? values.get('twitter:description') ?? values.get('description'), 240)
  return { title, description, hostname }
}

const cache = new Map()
const pending = new Map()
async function getLinkPreview(value) {
  const url = publicUrl(value)
  if (!url) return null
  const key = url.href
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.preview
  if (pending.has(key)) return pending.get(key)
  if (pending.size >= 6) return null

  const task = readHead(url, AbortSignal.timeout(4500))
    .then((html) => html ? metadata(html, url.hostname) : null)
    .catch(() => null)
    .then((preview) => {
      cache.delete(key)
      cache.set(key, { preview, expires: Date.now() + (preview ? 3_600_000 : 120_000) })
      if (cache.size > 256) cache.delete(cache.keys().next().value)
      return preview
    })
    .finally(() => pending.delete(key))
  pending.set(key, task)
  return task
}

module.exports = { getLinkPreview }
