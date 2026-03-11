/**
 * PhantomBridge - Dynamic Proxy Relay
 *
 * Windows registers its cloudflared tunnel URL here.
 * PhantomBridge forwards all requests to that URL.
 * Mac/external clients always use PhantomBridge (permanent URL).
 *
 * Endpoints:
 *   POST /register   - Windows registers tunnel URL
 *   GET  /status     - Check current tunnel URL
 *   *    /*          - Proxy to Windows tunnel
 */

const express = require('express')
const cors = require('cors')
const http = require('http')
const https = require('https')
const path = require('path')
const { URL } = require('url')

const app = express()
app.use(cors())
app.use(express.json())

// Dashboard - serve static files
app.use('/dashboard', express.static(path.join(__dirname, 'public')))
app.get('/', (req, res) => res.redirect('/dashboard'))

// Secret token to protect registration
const REGISTER_TOKEN = process.env.REGISTER_TOKEN || 'phantom-secret-2025'

// In-memory tunnel URL
let tunnelUrl = null
let lastSeen = null

// ============================================================
// STATUS
// ============================================================

app.get('/status', (req, res) => {
  res.json({
    ok: !!tunnelUrl,
    tunnel: tunnelUrl,
    lastSeen,
    message: tunnelUrl ? 'PhantomBridge active' : 'No tunnel registered'
  })
})

app.get('/health', (req, res) => {
  res.json({ ok: true, bridge: 'phantom', tunnel: tunnelUrl })
})

// ============================================================
// REGISTER TUNNEL URL (called by Windows on startup)
// ============================================================

app.post('/register', (req, res) => {
  const token = req.headers['x-bridge-token'] || req.body.token
  if (token !== REGISTER_TOKEN) {
    return res.status(401).json({ error: 'Invalid token' })
  }

  const { url } = req.body
  if (!url || !url.startsWith('https://')) {
    return res.status(400).json({ error: 'Invalid URL. Must be https://' })
  }

  tunnelUrl = url.replace(/\/$/, '') // remove trailing slash
  lastSeen = new Date().toISOString()

  console.log(`[PhantomBridge] Tunnel registered: ${tunnelUrl}`)
  res.json({ ok: true, url: tunnelUrl, message: 'Tunnel registered successfully' })
})

// ============================================================
// PROXY - forward all other requests to Windows tunnel
// ============================================================

app.use('/', (req, res) => {
  if (!tunnelUrl) {
    return res.status(503).json({
      error: 'No tunnel registered',
      hint: 'Windows server must POST /register with tunnel URL'
    })
  }

  const target = new URL(req.url, tunnelUrl)
  const isHttps = target.protocol === 'https:'
  const lib = isHttps ? https : http

  const options = {
    hostname: target.hostname,
    port: target.port || (isHttps ? 443 : 80),
    path: target.pathname + (target.search || ''),
    method: req.method,
    headers: {
      ...req.headers,
      host: target.hostname,
      'x-forwarded-for': req.ip,
      'x-phantom-bridge': 'true'
    }
  }

  // Remove content-length to avoid issues with re-forwarding
  delete options.headers['content-length']

  const proxy = lib.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers)
    proxyRes.pipe(res)
  })

  proxy.on('error', (err) => {
    console.error('[PhantomBridge] Proxy error:', err.message)
    if (!res.headersSent) {
      res.status(502).json({ error: 'Proxy error', detail: err.message })
    }
  })

  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    req.pipe(proxy)
  } else {
    proxy.end()
  }
})

// ============================================================
// START
// ============================================================

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`[PhantomBridge] Running on port ${PORT}`)
  console.log(`[PhantomBridge] Register URL: POST /register (x-bridge-token: ${REGISTER_TOKEN})`)
})
