/**
 * PhantomBridge - Dynamic Proxy Relay + Control Center API
 *
 * Windows registers its cloudflared tunnel URL here.
 * PhantomBridge forwards all requests to that URL.
 * Mac/external clients always use PhantomBridge (permanent URL).
 *
 * Endpoints:
 *   POST /register       - Windows registers tunnel URL
 *   GET  /status         - Check current tunnel URL
 *   GET  /health         - Health check
 *   POST /api/command    - Forward command to Windows
 *   GET  /api/files      - Placeholder file listing
 *   POST /api/task/create- Create a new task
 *   GET  /api/clients    - List clients
 *   POST /api/clients    - Add/update client
 *   DELETE /api/clients/:id - Delete client
 *   *    /*              - Proxy to Windows tunnel
 */

const express = require('express')
const cors = require('cors')
const http = require('http')
const https = require('https')
const path = require('path')
const { URL } = require('url')

const app = express()
app.use(cors())
app.use(express.json({ limit: '5mb' }))

// Dashboard - serve static files
app.use('/dashboard', express.static(path.join(__dirname, 'public')))
app.get('/', (req, res) => res.redirect('/dashboard'))

// Secret token to protect registration
const REGISTER_TOKEN = process.env.REGISTER_TOKEN || 'phantom-secret-2025'

// In-memory tunnel URL
let tunnelUrl = null
let lastSeen = null

// In-memory clients store
let clients = [
  { id: '1', name: 'Ellos Marmitaria', status: 'active', type: 'Website', url: 'https://ellosmarmitaria.com.br', notes: 'Landing page + delivery system', createdAt: '2025-08-15T10:00:00Z' },
  { id: '2', name: 'Diamond Formaturas', status: 'active', type: 'Landing Page', url: '', notes: 'High conversion template', createdAt: '2025-09-20T10:00:00Z' },
  { id: '3', name: 'Tilika Content Studio', status: 'in-progress', type: 'Automation', url: '', notes: 'Mac-Windows content automation', createdAt: '2025-10-01T10:00:00Z' },
]
let clientIdCounter = 4

// In-memory command history
let commandHistory = []

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
// API: Command forwarding
// ============================================================

app.post('/api/command', async (req, res) => {
  const { command, type } = req.body
  if (!command) {
    return res.status(400).json({ error: 'Command is required' })
  }

  const entry = {
    id: Date.now().toString(),
    command,
    type: type || 'command',
    timestamp: new Date().toISOString(),
    status: 'sent',
    response: null
  }

  commandHistory.unshift(entry)
  if (commandHistory.length > 100) commandHistory = commandHistory.slice(0, 100)

  // Forward to Windows via /send-to-windows
  if (tunnelUrl) {
    try {
      const payload = JSON.stringify({
        message: command,
        from: 'phantom-terminal',
        type: type || 'command',
        timestamp: entry.timestamp
      })

      const target = new URL('/send-to-windows', tunnelUrl)
      const lib = target.protocol === 'https:' ? https : http

      await new Promise((resolve, reject) => {
        const proxyReq = lib.request({
          hostname: target.hostname,
          port: target.port || (target.protocol === 'https:' ? 443 : 80),
          path: target.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            'x-deploy-token': 'tilika-secret-2025'
          }
        }, (proxyRes) => {
          let body = ''
          proxyRes.on('data', c => body += c)
          proxyRes.on('end', () => {
            entry.status = 'delivered'
            try { entry.response = JSON.parse(body) } catch { entry.response = body }
            resolve()
          })
        })
        proxyReq.on('error', (err) => {
          entry.status = 'error'
          entry.response = err.message
          resolve()
        })
        proxyReq.write(payload)
        proxyReq.end()
      })
    } catch (err) {
      entry.status = 'error'
      entry.response = err.message
    }
  } else {
    entry.status = 'no-tunnel'
    entry.response = 'No tunnel registered'
  }

  res.json({ ok: true, entry })
})

app.get('/api/command/history', (req, res) => {
  res.json({ ok: true, history: commandHistory })
})

// ============================================================
// API: File browser (placeholder)
// ============================================================

app.get('/api/files', (req, res) => {
  const p = req.query.path || 'C:\\'
  // Placeholder - in a real implementation this would proxy to Windows
  res.json({
    ok: true,
    path: p,
    files: [
      { name: 'Users', type: 'folder', size: null, modified: '2025-01-15T10:00:00Z' },
      { name: 'Program Files', type: 'folder', size: null, modified: '2025-01-10T10:00:00Z' },
      { name: 'Windows', type: 'folder', size: null, modified: '2025-02-01T10:00:00Z' },
      { name: 'pagefile.sys', type: 'file', size: '4.8 GB', modified: '2025-03-10T10:00:00Z' },
    ],
    placeholder: true,
    note: 'Connect /api/files to Windows file listing endpoint for real data'
  })
})

// ============================================================
// API: Task create
// ============================================================

app.post('/api/task/create', (req, res) => {
  const { label, command, priority } = req.body
  if (!label) {
    return res.status(400).json({ error: 'Label is required' })
  }

  const task = {
    id: Date.now().toString(),
    label,
    cmd: command || '',
    priority: priority || 'normal',
    status: 'pending',
    result: null,
    createdAt: new Date().toISOString(),
    finishedAt: null
  }

  // If tunnel exists, forward task to Windows
  if (tunnelUrl) {
    const payload = JSON.stringify({
      message: JSON.stringify(task),
      from: 'phantom-dashboard',
      type: 'task',
      timestamp: task.createdAt
    })

    const target = new URL('/send-to-windows', tunnelUrl)
    const lib = target.protocol === 'https:' ? https : http

    const proxyReq = lib.request({
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: target.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'x-deploy-token': 'tilika-secret-2025'
      }
    }, () => {})
    proxyReq.on('error', () => {})
    proxyReq.write(payload)
    proxyReq.end()
  }

  res.json({ ok: true, task })
})

// ============================================================
// API: Clients (CRM)
// ============================================================

app.get('/api/clients', (req, res) => {
  res.json({ ok: true, clients })
})

app.post('/api/clients', (req, res) => {
  const { id, name, status, type, url, notes } = req.body
  if (!name) {
    return res.status(400).json({ error: 'Name is required' })
  }

  if (id) {
    // Update existing
    const idx = clients.findIndex(c => c.id === id)
    if (idx >= 0) {
      clients[idx] = { ...clients[idx], name, status: status || 'active', type: type || '', url: url || '', notes: notes || '' }
      return res.json({ ok: true, client: clients[idx], action: 'updated' })
    }
  }

  // Create new
  const client = {
    id: String(clientIdCounter++),
    name,
    status: status || 'active',
    type: type || '',
    url: url || '',
    notes: notes || '',
    createdAt: new Date().toISOString()
  }
  clients.push(client)
  res.json({ ok: true, client, action: 'created' })
})

app.delete('/api/clients/:id', (req, res) => {
  const idx = clients.findIndex(c => c.id === req.params.id)
  if (idx < 0) return res.status(404).json({ error: 'Client not found' })
  const removed = clients.splice(idx, 1)[0]
  res.json({ ok: true, removed })
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
  console.log(`[PhantomBridge] Dashboard: http://localhost:${PORT}/dashboard`)
})
