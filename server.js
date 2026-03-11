/**
 * PhantomBridge - Dynamic Proxy Relay + PhantomOS API
 *
 * Windows registers its cloudflared tunnel URL here.
 * PhantomBridge forwards all requests to that URL.
 * Mac/external clients always use PhantomBridge (permanent URL).
 *
 * Endpoints:
 *   POST /register       - Windows registers tunnel URL
 *   GET  /status         - Check current tunnel URL
 *   GET  /health         - Health check (enhanced with Windows info)
 *   POST /api/command    - Forward command to Windows
 *   GET  /api/command/history - Command history
 *   GET  /api/files      - Placeholder file listing
 *   POST /api/task/create- Create a new task
 *   GET  /api/clients    - List clients
 *   POST /api/clients    - Add/update client
 *   DELETE /api/clients/:id - Delete client
 *   GET  /api/logs       - Server logs (last 200)
 *   POST /api/screenshot - Request screenshot from Windows
 *   GET  /api/stats      - Dashboard stats
 *   POST /api/restart-tunnel - Trigger tunnel restart
 *   POST /api/ping       - Ping with latency measurement
 *   POST /api/broadcast  - Send to all connected systems
 *   GET  /api/system-info - Aggregate system info
 *   POST /api/ai/execute - AI assistant command execution
 *   GET  /api/notifications - Recent notifications
 *   POST /api/notifications/read - Mark notifications read
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
app.use('/crm', express.static(path.join(__dirname, 'public', 'crm')))
app.get('/', (req, res) => res.redirect('/dashboard'))

// Secret token to protect registration
const REGISTER_TOKEN = process.env.REGISTER_TOKEN || 'phantom-secret-2025'

// In-memory tunnel URL
let tunnelUrl = null
let lastSeen = null

// In-memory clients store
let clients = [
  { id: '1', name: 'Elas Espeto e Marmitaria', status: 'active', type: 'Delivery + Website',
    url: 'https://elas-linktree.onrender.com', notes: 'Claudia Delivery system. API: https://claudia-delivery-api.onrender.com | Instagram: @elasespetoemarmitaria | Facebook: Ellos Marmitaria | WhatsApp: (67) 99645-0189 | Endereco: R. Tito Mello, Dourados-MS',
    createdAt: '2025-08-15T10:00:00Z',
    services: {
      frontend: 'https://elas-linktree.onrender.com',
      backend: 'https://claudia-delivery-api.onrender.com',
      instagram: 'https://www.instagram.com/elasespetoemarmitaria/',
      facebook: 'https://www.facebook.com/profile.php?id=61583765741772',
      github: 'https://github.com/nexus-automacoes/claudia-delivery',
      whatsapp: '5567996450189'
    }
  },
  { id: '2', name: 'Diamond Formaturas', status: 'active', type: 'Landing Page',
    url: '', notes: 'High conversion template. Design escuro + dourado. Instagram: @diamond.formaturas | Endereco: R. das Amoreiras 840, Dourados-MS',
    createdAt: '2025-09-20T10:00:00Z' },
  { id: '3', name: 'Tilika Content Studio', status: 'in-progress', type: 'Automation',
    url: '', notes: 'Mac-Windows content automation. PSD: Arte_Feed.psd | Repo: tilika-ps-server | Server: 192.168.48.133:4000',
    createdAt: '2025-10-01T10:00:00Z' },
]
let clientIdCounter = 4

// In-memory command history
let commandHistory = []

// In-memory server logs
const serverLogs = []
const MAX_LOGS = 200
const serverStartTime = Date.now()

// Message and task counters
let messagesCount = 0
let tasksCount = 0
let broadcastCount = 0

// In-memory notifications
let notifications = []
let notifIdCounter = 1

function addNotification(title, body, type) {
  const n = {
    id: String(notifIdCounter++),
    title,
    body: body || '',
    type: type || 'info',
    read: false,
    timestamp: new Date().toISOString()
  }
  notifications.unshift(n)
  if (notifications.length > 100) notifications = notifications.slice(0, 100)
  return n
}

// Override console.log/warn/error to capture logs
const origLog = console.log.bind(console)
const origWarn = console.warn.bind(console)
const origError = console.error.bind(console)

function captureLog(level, args) {
  const entry = {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 4),
    level,
    message: args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '),
    timestamp: new Date().toISOString()
  }
  serverLogs.push(entry)
  if (serverLogs.length > MAX_LOGS) serverLogs.shift()
}

console.log = function(...args) { captureLog('info', args); origLog(...args) }
console.warn = function(...args) { captureLog('warn', args); origWarn(...args) }
console.error = function(...args) { captureLog('error', args); origError(...args) }

// ============================================================
// HELPER: proxy request to Windows
// ============================================================

function proxyToWindows(urlPath, method, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!tunnelUrl) return reject(new Error('No tunnel registered'))
    const target = new URL(urlPath, tunnelUrl)
    const lib = target.protocol === 'https:' ? https : http
    const opts = {
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: target.pathname,
      method: method || 'GET',
      headers: { 'x-deploy-token': 'tilika-secret-2025' },
      timeout: timeoutMs || 8000
    }
    if (payload) {
      opts.headers['Content-Type'] = 'application/json'
      opts.headers['Content-Length'] = Buffer.byteLength(payload)
    }
    const req = lib.request(opts, (proxyRes) => {
      let body = ''
      proxyRes.on('data', c => body += c)
      proxyRes.on('end', () => {
        try { resolve(JSON.parse(body)) } catch { resolve({ raw: body }) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    if (payload) req.write(payload)
    req.end()
  })
}

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

app.get('/health', async (req, res) => {
  const result = { ok: true, bridge: 'phantom', tunnel: tunnelUrl, uptime: Math.floor((Date.now() - serverStartTime) / 1000) }

  if (tunnelUrl) {
    try {
      const windowsHealth = await proxyToWindows('/health', 'GET', null, 4000)
      result.windows = windowsHealth
      result.windowsOnline = true
    } catch (e) {
      result.windows = null
      result.windowsOnline = false
      result.windowsError = e.message
    }
  } else {
    result.windowsOnline = false
  }

  res.json(result)
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

  tunnelUrl = url.replace(/\/$/, '')
  lastSeen = new Date().toISOString()

  console.log('[PhantomBridge] Tunnel registered: ' + tunnelUrl)
  addNotification('Tunnel Connected', 'Windows registered: ' + tunnelUrl, 'success')
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

  messagesCount++

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

  if (tunnelUrl) {
    try {
      const payload = JSON.stringify({
        message: command,
        from: 'phantom-terminal',
        type: type || 'command',
        timestamp: entry.timestamp
      })
      const result = await proxyToWindows('/send-to-windows', 'POST', payload, 8000)
      entry.status = 'delivered'
      entry.response = result
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

  tasksCount++

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

  if (tunnelUrl) {
    const payload = JSON.stringify({
      message: JSON.stringify(task),
      from: 'phantom-dashboard',
      type: 'task',
      timestamp: task.createdAt
    })
    proxyToWindows('/send-to-windows', 'POST', payload).catch(() => {})
  }

  addNotification('Task Created', task.label, 'info')
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
    const idx = clients.findIndex(c => c.id === id)
    if (idx >= 0) {
      clients[idx] = { ...clients[idx], name, status: status || 'active', type: type || '', url: url || '', notes: notes || '' }
      return res.json({ ok: true, client: clients[idx], action: 'updated' })
    }
  }

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
// API: Server Logs
// ============================================================

app.get('/api/logs', (req, res) => {
  const level = req.query.level
  const limit = Math.min(parseInt(req.query.limit) || 200, 200)
  let logs = serverLogs.slice()
  if (level && ['info', 'warn', 'error'].includes(level)) {
    logs = logs.filter(l => l.level === level)
  }
  res.json({ ok: true, logs: logs.slice(-limit), total: logs.length })
})

// ============================================================
// API: Screenshot request
// ============================================================

app.post('/api/screenshot', async (req, res) => {
  if (!tunnelUrl) {
    return res.status(503).json({ error: 'No tunnel registered', hint: 'Windows must be connected' })
  }

  try {
    const payload = JSON.stringify({
      message: 'screenshot',
      from: 'phantom-dashboard',
      type: 'screenshot',
      timestamp: new Date().toISOString()
    })
    const result = await proxyToWindows('/send-to-windows', 'POST', payload, 10000)
    console.log('[PhantomBridge] Screenshot requested')
    res.json({ ok: true, message: 'Screenshot request sent', response: result })
  } catch (err) {
    res.status(502).json({ error: 'Failed to request screenshot', detail: err.message })
  }
})

// ============================================================
// API: Dashboard Stats
// ============================================================

app.get('/api/stats', (req, res) => {
  const uptimeSeconds = Math.floor((Date.now() - serverStartTime) / 1000)
  res.json({
    ok: true,
    uptime: uptimeSeconds,
    uptimeFormatted: formatUptime(uptimeSeconds),
    tunnelRegistered: !!tunnelUrl,
    messagesSent: messagesCount,
    tasksCreated: tasksCount,
    commandsSent: commandHistory.length,
    clientsCount: clients.length,
    // extended stats
    messagesCount,
    tasksCount,
    commandHistoryCount: commandHistory.length,
    broadcastCount,
    tunnelActive: !!tunnelUrl,
    tunnelUrl,
    lastSeen,
    logsCount: serverLogs.length,
    serverStartTime: new Date(serverStartTime).toISOString()
  })
})

function formatUptime(s) {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  let str = ''
  if (d) str += d + 'd '
  if (h) str += h + 'h '
  str += String(m).padStart(2, '0') + 'm ' + String(sec).padStart(2, '0') + 's'
  return str
}

// ============================================================
// API: Restart Tunnel
// ============================================================

app.post('/api/restart-tunnel', async (req, res) => {
  if (!tunnelUrl) {
    return res.status(503).json({ error: 'No tunnel registered' })
  }

  try {
    const payload = JSON.stringify({
      message: 'restart-tunnel',
      from: 'phantom-dashboard',
      type: 'system',
      timestamp: new Date().toISOString()
    })
    const result = await proxyToWindows('/send-to-windows', 'POST', payload, 10000)
    console.log('[PhantomBridge] Tunnel restart requested')
    addNotification('Tunnel Restart', 'Restart signal sent to Windows', 'warn')
    res.json({ ok: true, message: 'Tunnel restart request sent', response: result })
  } catch (err) {
    res.status(502).json({ error: 'Failed to send restart request', detail: err.message })
  }
})

// ============================================================
// API: Ping with latency
// ============================================================

app.post('/api/ping', async (req, res) => {
  const start = Date.now()
  const result = { ok: true, timestamp: new Date().toISOString(), bridgeAlive: true }

  if (tunnelUrl) {
    try {
      await proxyToWindows('/health', 'GET', null, 5000)
      result.windowsLatencyMs = Date.now() - start
      result.windowsAlive = true
    } catch (e) {
      result.windowsLatencyMs = null
      result.windowsAlive = false
      result.windowsError = e.message
    }
  } else {
    result.windowsAlive = false
    result.windowsLatencyMs = null
  }

  result.totalMs = Date.now() - start
  res.json(result)
})

// ============================================================
// API: Broadcast
// ============================================================

app.post('/api/broadcast', async (req, res) => {
  const { message, type } = req.body
  if (!message) {
    return res.status(400).json({ error: 'Message is required' })
  }

  broadcastCount++
  const results = []

  if (tunnelUrl) {
    try {
      const payload = JSON.stringify({
        message,
        from: 'phantom-broadcast',
        type: type || 'broadcast',
        timestamp: new Date().toISOString()
      })
      const r = await proxyToWindows('/send-to-windows', 'POST', payload, 5000)
      results.push({ target: 'windows', status: 'sent', response: r })
    } catch (err) {
      results.push({ target: 'windows', status: 'error', error: err.message })
    }
  } else {
    results.push({ target: 'windows', status: 'skipped', reason: 'no tunnel' })
  }

  console.log('[PhantomBridge] Broadcast sent: ' + message.substring(0, 50))
  res.json({ ok: true, broadcastId: broadcastCount, results })
})

// ============================================================
// API: System Info (aggregate)
// ============================================================

app.get('/api/system-info', async (req, res) => {
  const info = {
    ok: true,
    bridge: {
      version: '3.0.0',
      platform: process.platform,
      nodeVersion: process.version,
      uptime: Math.floor((Date.now() - serverStartTime) / 1000),
      memoryUsage: process.memoryUsage(),
      pid: process.pid
    },
    tunnel: {
      url: tunnelUrl,
      active: !!tunnelUrl,
      lastSeen
    },
    stats: {
      messagesCount,
      tasksCount,
      commandHistoryCount: commandHistory.length,
      clientsCount: clients.length,
      logsCount: serverLogs.length
    }
  }

  if (tunnelUrl) {
    try {
      info.windows = await proxyToWindows('/health', 'GET', null, 5000)
    } catch (e) {
      info.windows = null
      info.windowsError = e.message
    }
  }

  res.json(info)
})

// ============================================================
// API: Windows Remote Control Commands
// ============================================================

const windowsCommands = {
  system: [
    { cmd: 'shutdown /s /t 60', label: 'Shutdown (60s)', level: 'danger' },
    { cmd: 'shutdown /r /t 60', label: 'Restart (60s)', level: 'danger' },
    { cmd: 'shutdown /a', label: 'Cancel Shutdown', level: 'safe' },
    { cmd: 'rundll32.exe user32.dll,LockWorkStation', label: 'Lock Screen', level: 'moderate' },
    { cmd: 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0', label: 'Sleep', level: 'moderate' },
  ],
  processes: [
    { cmd: 'powershell "Get-Process | Sort-Object CPU -Descending | Select-Object -First 20 Name,CPU,WorkingSet | ConvertTo-Json"', label: 'Top 20 Processes', level: 'safe' },
    { cmd: 'tasklist /FO CSV', label: 'List All Processes', level: 'safe' },
    { cmd: 'taskkill /IM {process} /F', label: 'Kill Process', level: 'moderate', param: 'process' },
  ],
  files: [
    { cmd: 'dir {path}', label: 'List Directory', level: 'safe', param: 'path' },
    { cmd: 'type {path}', label: 'Read File', level: 'safe', param: 'path' },
    { cmd: 'powershell "Get-ChildItem -Path {path} -Recurse | Select Name,Length,LastWriteTime | ConvertTo-Json"', label: 'List Files (JSON)', level: 'safe', param: 'path' },
  ],
  network: [
    { cmd: 'ipconfig', label: 'IP Config', level: 'safe' },
    { cmd: 'netstat -an | findstr LISTENING', label: 'Listening Ports', level: 'safe' },
    { cmd: 'ping -n 4 google.com', label: 'Ping Google', level: 'safe' },
    { cmd: 'powershell "(Get-NetAdapter | Where Status -eq Up | Select Name,LinkSpeed,MacAddress | ConvertTo-Json)"', label: 'Network Adapters', level: 'safe' },
  ],
  sysinfo: [
    { cmd: 'powershell "Get-CimInstance Win32_Processor | Select Name,LoadPercentage,NumberOfCores | ConvertTo-Json"', label: 'CPU Info', level: 'safe' },
    { cmd: 'powershell "Get-CimInstance Win32_OperatingSystem | Select TotalVisibleMemorySize,FreePhysicalMemory,Caption | ConvertTo-Json"', label: 'Memory Info', level: 'safe' },
    { cmd: 'powershell "Get-CimInstance Win32_LogicalDisk | Select DeviceID,Size,FreeSpace | ConvertTo-Json"', label: 'Disk Info', level: 'safe' },
    { cmd: 'systeminfo', label: 'Full System Info', level: 'safe' },
    { cmd: 'powershell "[System.Environment]::OSVersion | ConvertTo-Json"', label: 'OS Version', level: 'safe' },
  ],
  display: [
    { cmd: 'powershell "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | ForEach { $_.Bounds } | ConvertTo-Json"', label: 'Screen Resolution', level: 'safe' },
  ],
  audio: [
    { cmd: 'powershell "(New-Object -ComObject WScript.Shell).SendKeys([char]173)"', label: 'Toggle Mute', level: 'safe' },
    { cmd: 'powershell "(New-Object -ComObject WScript.Shell).SendKeys([char]175)"', label: 'Volume Up', level: 'safe' },
    { cmd: 'powershell "(New-Object -ComObject WScript.Shell).SendKeys([char]174)"', label: 'Volume Down', level: 'safe' },
  ],
  apps: [
    { cmd: 'start chrome {url}', label: 'Open Chrome', level: 'safe', param: 'url' },
    { cmd: 'start explorer {path}', label: 'Open Explorer', level: 'safe', param: 'path' },
    { cmd: 'start notepad {path}', label: 'Open Notepad', level: 'safe', param: 'path' },
    { cmd: 'start ms-settings:', label: 'Windows Settings', level: 'safe' },
    { cmd: 'start "" "C:\\Program Files\\Adobe\\Adobe Photoshop 2024\\Photoshop.exe"', label: 'Open Photoshop', level: 'safe' },
  ],
  services: [
    { cmd: 'powershell "Get-Service | Where Status -eq Running | Select Name,DisplayName | ConvertTo-Json"', label: 'Running Services', level: 'safe' },
    { cmd: 'sc query {service}', label: 'Query Service', level: 'safe', param: 'service' },
  ],
  git: [
    { cmd: 'git -C {path} status', label: 'Git Status', level: 'safe', param: 'path' },
    { cmd: 'git -C {path} log --oneline -10', label: 'Git Log', level: 'safe', param: 'path' },
    { cmd: 'git -C {path} pull', label: 'Git Pull', level: 'moderate', param: 'path' },
  ],
  photoshop: [
    { cmd: 'ps-open-psd', label: 'Open PSD', level: 'safe' },
    { cmd: 'ps-export-png', label: 'Export PNG', level: 'safe' },
    { cmd: 'ps-list-layers', label: 'List Layers', level: 'safe' },
    { cmd: 'ps-script', label: 'Run JSX Script', level: 'moderate' },
  ],
  claudia: [
    { cmd: 'curl http://localhost:3333/api/health', label: 'Claudia API Health', level: 'safe' },
    { cmd: 'curl http://localhost:3333/api/orders', label: 'List Orders', level: 'safe' },
    { cmd: 'powershell "Get-Process -Name node | Select Id,ProcessName,CPU | ConvertTo-Json"', label: 'Node Processes', level: 'safe' },
    { cmd: 'cd D:/Sistemas/claudia-delivery && git status', label: 'Claudia Git Status', level: 'safe' },
  ]
}

app.get('/api/remote-commands', (req, res) => {
  res.json({ ok: true, commands: windowsCommands })
})

app.post('/api/remote-execute', async (req, res) => {
  const { cmd, params } = req.body
  if (!cmd) return res.status(400).json({ error: 'cmd is required' })

  let finalCmd = cmd
  if (params && typeof params === 'object') {
    for (const [key, val] of Object.entries(params)) {
      finalCmd = finalCmd.replace('{' + key + '}', val)
    }
  }

  messagesCount++
  const entry = {
    id: Date.now().toString(),
    command: finalCmd,
    source: 'remote-execute',
    timestamp: new Date().toISOString(),
    status: 'sent'
  }

  if (tunnelUrl) {
    try {
      const payload = JSON.stringify({
        message: finalCmd,
        from: 'phantom-remote',
        type: 'remote-command',
        timestamp: entry.timestamp
      })
      const result = await proxyToWindows('/send-to-windows', 'POST', payload, 15000)
      entry.status = 'delivered'
      entry.response = result
    } catch (err) {
      entry.status = 'error'
      entry.response = err.message
    }
  } else {
    entry.status = 'no-tunnel'
    entry.response = 'No tunnel registered'
  }

  commandHistory.unshift(entry)
  if (commandHistory.length > 100) commandHistory = commandHistory.slice(0, 100)
  res.json({ ok: true, entry })
})

// ============================================================
// API: Claudia Delivery Integration
// ============================================================

const claudiaApi = 'https://claudia-delivery-api.onrender.com'

app.get('/api/claudia/health', async (req, res) => {
  try {
    const r = await fetch(claudiaApi + '/api/health')
    const data = await r.json()
    res.json({ ok: true, claudia: data })
  } catch (e) {
    res.json({ ok: false, error: e.message })
  }
})

app.get('/api/claudia/orders', async (req, res) => {
  try {
    // Login first to get token
    const loginRes = await fetch(claudiaApi + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@claudia.com', password: 'claudia123' })
    })
    const loginData = await loginRes.json()
    const token = loginData.token

    const ordersRes = await fetch(claudiaApi + '/api/orders', {
      headers: { 'Authorization': 'Bearer ' + token }
    })
    const orders = await ordersRes.json()
    res.json({ ok: true, orders })
  } catch (e) {
    res.json({ ok: false, error: e.message })
  }
})

// ============================================================
// API: Windows Services Status
// ============================================================

app.get('/api/windows-services', (req, res) => {
  res.json({
    ok: true,
    services: [
      { name: 'Claudia Delivery API', port: 3333, url: 'http://localhost:3333', status: 'running' },
      { name: 'Claudia Frontend', port: 5173, url: 'http://localhost:5173', status: 'running' },
      { name: 'Browser Agent (Playwright)', port: 3999, url: 'http://localhost:3999', status: 'running' },
      { name: 'Messaging Server', port: 4000, url: 'http://localhost:4000', status: 'running' },
    ]
  })
})

// ============================================================
// API: AI Assistant Execute
// ============================================================

app.post('/api/ai/execute', async (req, res) => {
  const { command, action } = req.body
  if (!command && !action) {
    return res.status(400).json({ error: 'Command or action is required' })
  }

  const cmd = command || action
  messagesCount++

  const entry = {
    id: Date.now().toString(),
    command: cmd,
    source: 'ai-assistant',
    timestamp: new Date().toISOString(),
    status: 'processing'
  }

  // Handle built-in queries locally
  if (cmd === 'status' || cmd === 'check-status') {
    const stats = {
      tunnelActive: !!tunnelUrl,
      tunnelUrl,
      uptime: formatUptime(Math.floor((Date.now() - serverStartTime) / 1000)),
      messagesCount,
      tasksCount,
      clientsCount: clients.length
    }
    entry.status = 'completed'
    entry.response = stats
    return res.json({ ok: true, entry })
  }

  // Forward to Windows
  if (tunnelUrl) {
    try {
      const payload = JSON.stringify({
        message: cmd,
        from: 'phantom-ai',
        type: 'ai-command',
        timestamp: entry.timestamp
      })
      const result = await proxyToWindows('/send-to-windows', 'POST', payload, 10000)
      entry.status = 'delivered'
      entry.response = result
    } catch (err) {
      entry.status = 'error'
      entry.response = err.message
    }
  } else {
    entry.status = 'no-tunnel'
    entry.response = 'No tunnel registered. Windows must be connected.'
  }

  commandHistory.unshift(entry)
  if (commandHistory.length > 100) commandHistory = commandHistory.slice(0, 100)

  res.json({ ok: true, entry })
})

// ============================================================
// API: Notifications
// ============================================================

app.get('/api/notifications', (req, res) => {
  const unread = notifications.filter(n => !n.read).length
  res.json({ ok: true, notifications: notifications.slice(0, 50), unreadCount: unread })
})

app.post('/api/notifications/read', (req, res) => {
  const { id } = req.body
  if (id) {
    const n = notifications.find(n => n.id === id)
    if (n) n.read = true
  } else {
    notifications.forEach(n => { n.read = true })
  }
  res.json({ ok: true })
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
  console.log('[PhantomBridge] Running on port ' + PORT)
  console.log('[PhantomBridge] Register URL: POST /register (x-bridge-token: ' + REGISTER_TOKEN + ')')
  console.log('[PhantomBridge] Dashboard: http://localhost:' + PORT + '/dashboard')
  addNotification('System Started', 'PhantomOS v3.0 initialized', 'success')
})
