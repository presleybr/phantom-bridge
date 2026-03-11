/**
 * PhantomOS Windows Agent v1.0.0
 *
 * Standalone agent for Windows clients. Zero external dependencies.
 * Starts local HTTP server, opens Cloudflare tunnel, registers with PhantomBridge.
 *
 * Usage:
 *   PhantomAgent.exe                      (uses config.json)
 *   PhantomAgent.exe --setup              (interactive first-time setup)
 *   PhantomAgent.exe --agentId=office-pc  (override agentId)
 */

const http = require('http')
const https = require('https')
const { exec, spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { URL } = require('url')

// ============================================================
// CONFIG
// ============================================================

// When running as pkg .exe, __dirname is a snapshot. Use cwd for config.
const CONFIG_DIR = process.pkg ? path.dirname(process.execPath) : __dirname
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json')

let config = {
  bridgeUrl: 'https://phantom-bridge.onrender.com',
  bridgeToken: 'phantom-secret-2025',
  agentId: '',
  agentName: '',
  agentToken: '',
  localPort: 4444,
  heartbeatInterval: 30000,
  tunnelEnabled: true
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) }
    }
  } catch (e) {
    log('WARN', 'Failed to load config: ' + e.message)
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
  } catch (e) {
    log('ERROR', 'Failed to save config: ' + e.message)
  }
}

function parseArgs() {
  const args = process.argv.slice(2)
  for (const arg of args) {
    if (arg === '--setup') { config._setup = true; continue }
    const m = arg.match(/^--(\w+)=(.+)$/)
    if (m) config[m[1]] = m[2]
  }
}

// Auto-configure via setup code from PhantomBridge
async function setupFromCode(code) {
  log('INFO', 'Activating setup code: ' + code)
  try {
    const res = await httpRequest(config.bridgeUrl + '/api/agent-setup/' + code, 'GET')
    if (res.status === 200 && res.data.ok) {
      const c = res.data.config
      config.bridgeUrl = c.bridgeUrl || config.bridgeUrl
      config.bridgeToken = c.bridgeToken || config.bridgeToken
      config.agentId = c.agentId || config.agentId
      config.agentName = c.agentName || config.agentName
      config.localPort = c.localPort || config.localPort
      config.heartbeatInterval = c.heartbeatInterval || config.heartbeatInterval
      config.tunnelEnabled = c.tunnelEnabled !== undefined ? c.tunnelEnabled : true
      saveConfig()
      log('OK', 'Setup code accepted! Agent ID: ' + config.agentId)
      return true
    } else {
      log('ERROR', 'Invalid setup code: ' + (res.data.error || 'unknown error'))
      return false
    }
  } catch (e) {
    log('ERROR', 'Cannot reach PhantomBridge: ' + e.message)
    return false
  }
}

// ============================================================
// LOGGING
// ============================================================

const LOG_PATH = path.join(CONFIG_DIR, 'agent.log')

function log(level, msg) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19)
  const colors = { INFO: '\x1b[36m', WARN: '\x1b[33m', ERROR: '\x1b[31m', OK: '\x1b[32m' }
  console.log((colors[level] || '') + '[' + ts + '] [' + level + ']\x1b[0m ' + msg)
  // Also write to log file
  try { fs.appendFileSync(LOG_PATH, '[' + ts + '] [' + level + '] ' + msg + '\n') } catch {}
}

// ============================================================
// HTTP HELPERS
// ============================================================

function httpRequest(url, method, body, headers, timeout) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const lib = parsed.protocol === 'https:' ? https : http
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(headers || {}) },
      timeout: timeout || 10000
    }
    if (body) {
      const data = typeof body === 'string' ? body : JSON.stringify(body)
      opts.headers['Content-Length'] = Buffer.byteLength(data)
    }
    const req = lib.request(opts, (res) => {
      let result = ''
      res.on('data', c => result += c)
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(result) }) }
        catch { resolve({ status: res.statusCode, data: { raw: result } }) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    if (body) {
      const data = typeof body === 'string' ? body : JSON.stringify(body)
      req.write(data)
    }
    req.end()
  })
}

// ============================================================
// COMMAND EXECUTION
// ============================================================

function executeCommand(cmd, timeout) {
  return new Promise((resolve) => {
    const start = Date.now()
    exec(cmd, { timeout: timeout || 30000, maxBuffer: 10 * 1024 * 1024, shell: true }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        output: stdout || '',
        error: error ? error.message : null,
        stderr: stderr || '',
        exitCode: error ? error.code : 0,
        duration: Date.now() - start
      })
    })
  })
}

async function handleCommand(message, type) {
  const cmd = message.trim()
  log('INFO', 'Executing: ' + cmd.substring(0, 80))

  if (cmd === 'screenshot') return await takeScreenshot()
  if (cmd.startsWith('ps-')) return await handlePhotoshopCommand(cmd)

  const result = await executeCommand(cmd)
  log(result.ok ? 'OK' : 'WARN', 'Result: ' + (result.output || result.error || '').substring(0, 100))
  return result
}

async function takeScreenshot() {
  const screenshotPath = path.join(os.tmpdir(), 'phantom-screenshot-' + Date.now() + '.png')
  const psCmd = 'powershell "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen | ForEach { $b = $_.Bounds; $bmp = New-Object System.Drawing.Bitmap($b.Width,$b.Height); $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save(\'' + screenshotPath.replace(/\\/g, '\\\\') + '\'); $g.Dispose(); $bmp.Dispose() }"'
  await executeCommand(psCmd)
  if (fs.existsSync(screenshotPath)) {
    const base64 = fs.readFileSync(screenshotPath, 'base64')
    try { fs.unlinkSync(screenshotPath) } catch {}
    return { ok: true, type: 'screenshot', size: base64.length }
  }
  return { ok: false, error: 'Screenshot failed' }
}

async function handlePhotoshopCommand(cmd) {
  const cmds = {
    'ps-open-psd': 'Start-Process "C:\\Program Files\\Adobe\\Adobe Photoshop 2024\\Photoshop.exe"',
    'ps-export-png': 'echo "Export PNG - requires JSX script"',
    'ps-list-layers': 'echo "List layers - requires JSX script"'
  }
  const psCmd = cmds[cmd]
  if (!psCmd) return { ok: false, error: 'Unknown PS command: ' + cmd }
  return await executeCommand('powershell "' + psCmd + '"')
}

// ============================================================
// FILE LISTING
// ============================================================

function listFiles(dirPath) {
  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true })
    return {
      ok: true,
      path: dirPath,
      files: items.map(item => {
        let size = null, modified = null
        try {
          const stat = fs.statSync(path.join(dirPath, item.name))
          size = stat.size
          modified = stat.mtime.toISOString()
        } catch {}
        return { name: item.name, type: item.isDirectory() ? 'directory' : 'file', size, modified }
      })
    }
  } catch (e) {
    return { ok: false, error: e.message, path: dirPath }
  }
}

// ============================================================
// LOCAL HTTP SERVER (pure Node.js, no express)
// ============================================================

const messages = []

function parseBody(req) {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', () => {
      try { resolve(JSON.parse(body)) } catch { resolve({}) }
    })
  })
}

function parseQuery(url) {
  const idx = url.indexOf('?')
  if (idx < 0) return {}
  const params = {}
  url.substring(idx + 1).split('&').forEach(p => {
    const [k, v] = p.split('=')
    params[decodeURIComponent(k)] = decodeURIComponent(v || '')
  })
  return params
}

function json(res, data, status) {
  res.writeHead(status || 200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify(data))
}

function startLocalServer() {
  const server = http.createServer(async (req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-deploy-token, x-agent-token, x-bridge-token'
      })
      return res.end()
    }

    const urlPath = req.url.split('?')[0]
    const query = parseQuery(req.url)

    try {
      // GET /health
      if (req.method === 'GET' && urlPath === '/health') {
        return json(res, {
          ok: true,
          agent: config.agentId,
          name: config.agentName,
          platform: os.platform(),
          hostname: os.hostname(),
          uptime: os.uptime(),
          totalMem: Math.round(os.totalmem() / 1024 / 1024 / 1024 * 10) / 10 + ' GB',
          freeMem: Math.round(os.freemem() / 1024 / 1024 / 1024 * 10) / 10 + ' GB',
          cpus: os.cpus().length,
          version: '1.0.0'
        })
      }

      // POST /send-to-windows
      if (req.method === 'POST' && urlPath === '/send-to-windows') {
        const body = await parseBody(req)
        if (!body.message) return json(res, { error: 'message required' }, 400)
        log('INFO', 'Command from ' + (body.from || '?') + ': ' + body.message.substring(0, 80))
        const result = await handleCommand(body.message, body.type)
        return json(res, { ok: true, result })
      }

      // GET /api/files
      if (req.method === 'GET' && urlPath === '/api/files') {
        return json(res, listFiles(query.path || 'C:\\'))
      }

      // GET /api/system-info
      if (req.method === 'GET' && urlPath === '/api/system-info') {
        return json(res, {
          ok: true,
          hostname: os.hostname(),
          platform: os.platform(),
          arch: os.arch(),
          release: os.release(),
          uptime: os.uptime(),
          totalMem: os.totalmem(),
          freeMem: os.freemem(),
          cpuCount: os.cpus().length,
          cpuModel: os.cpus()[0] ? os.cpus()[0].model : 'unknown',
          user: os.userInfo().username
        })
      }

      // Messages endpoints
      if (req.method === 'GET' && (urlPath === '/messages-mac' || urlPath === '/messages')) {
        return json(res, { ok: true, messages })
      }
      if (req.method === 'POST' && urlPath === '/send-to-mac') {
        const body = await parseBody(req)
        if (body.message) {
          messages.push({ content: body.message, timestamp: new Date().toISOString(), from: 'windows' })
          if (messages.length > 100) messages.splice(0, messages.length - 100)
        }
        return json(res, { ok: true })
      }

      // 404
      json(res, { error: 'Not found', path: urlPath }, 404)
    } catch (e) {
      log('ERROR', 'Server error: ' + e.message)
      json(res, { error: e.message }, 500)
    }
  })

  server.listen(config.localPort, () => {
    log('OK', 'Local server running on port ' + config.localPort)
  })

  return server
}

// ============================================================
// CLOUDFLARE TUNNEL
// ============================================================

let tunnelProcess = null
let currentTunnelUrl = null

function findCloudflared() {
  // Check common locations
  const locations = [
    'cloudflared',
    'cloudflared.exe',
    path.join(CONFIG_DIR, 'cloudflared.exe'),
    path.join(os.homedir(), 'cloudflared.exe'),
    'C:\\cloudflared\\cloudflared.exe',
    path.join(process.env.LOCALAPPDATA || '', 'cloudflared', 'cloudflared.exe')
  ]
  return locations[0] // spawn will use PATH
}

function startTunnel() {
  return new Promise((resolve) => {
    if (!config.tunnelEnabled) {
      log('WARN', 'Tunnel disabled in config')
      return resolve(null)
    }

    log('INFO', 'Starting Cloudflare tunnel on port ' + config.localPort + '...')

    const cloudflared = findCloudflared()

    try {
      tunnelProcess = spawn(cloudflared, [
        'tunnel', '--url', 'http://localhost:' + config.localPort,
        '--no-autoupdate'
      ], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      log('ERROR', 'Cannot start cloudflared: ' + e.message)
      return resolve(null)
    }

    let resolved = false
    const urlRegex = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/

    function checkOutput(data) {
      const text = data.toString()
      const match = text.match(urlRegex)
      if (match && !resolved) {
        resolved = true
        currentTunnelUrl = match[0]
        log('OK', 'Tunnel URL: ' + currentTunnelUrl)
        resolve(currentTunnelUrl)
      }
    }

    tunnelProcess.stdout.on('data', checkOutput)
    tunnelProcess.stderr.on('data', checkOutput)

    tunnelProcess.on('error', (err) => {
      log('ERROR', 'Tunnel error: ' + err.message)
      if (!resolved) { resolved = true; resolve(null) }
    })

    tunnelProcess.on('exit', (code) => {
      log('WARN', 'Tunnel exited (code ' + code + '). Restarting in 10s...')
      currentTunnelUrl = null
      setTimeout(() => {
        startTunnel().then(url => { if (url) registerWithBridge(url) })
      }, 10000)
    })

    setTimeout(() => {
      if (!resolved) { resolved = true; log('WARN', 'Tunnel timeout (30s)'); resolve(null) }
    }, 30000)
  })
}

function stopTunnel() {
  if (tunnelProcess) { tunnelProcess.kill(); tunnelProcess = null; currentTunnelUrl = null }
}

// ============================================================
// BRIDGE REGISTRATION
// ============================================================

async function registerWithBridge(tunnelUrl) {
  if (!tunnelUrl) return false

  const body = {
    url: tunnelUrl,
    agentId: config.agentId,
    name: config.agentName,
    metadata: {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      cpus: os.cpus().length,
      totalMem: Math.round(os.totalmem() / 1024 / 1024 / 1024 * 10) / 10 + ' GB',
      user: os.userInfo().username,
      localPort: config.localPort,
      version: '1.0.0'
    }
  }

  const headers = config.agentToken
    ? { 'x-agent-token': config.agentToken }
    : { 'x-bridge-token': config.bridgeToken }

  try {
    const res = await httpRequest(config.bridgeUrl + '/register', 'POST', body, headers)
    if (res.status === 200 && res.data.ok) {
      log('OK', 'Registered as "' + config.agentId + '" on PhantomBridge')
      if (res.data.agentToken && !config.agentToken) {
        config.agentToken = res.data.agentToken
        saveConfig()
        log('OK', 'Agent token saved')
      }
      return true
    }
    log('ERROR', 'Registration failed: ' + JSON.stringify(res.data))
    return false
  } catch (e) {
    log('ERROR', 'Registration error: ' + e.message)
    return false
  }
}

// ============================================================
// HEARTBEAT
// ============================================================

function startHeartbeat() {
  setInterval(async () => {
    if (!currentTunnelUrl) return
    try {
      await registerWithBridge(currentTunnelUrl)
    } catch (e) {
      log('WARN', 'Heartbeat failed: ' + e.message)
    }
  }, config.heartbeatInterval)
}

// ============================================================
// INTERACTIVE SETUP
// ============================================================

function runSetup() {
  const readline = require('readline')
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const ask = (q) => new Promise(resolve => rl.question(q, resolve))

  return (async () => {
    console.log('\n\x1b[36m=== PhantomOS Agent Setup ===\x1b[0m\n')
    console.log('  \x1b[33m[1]\x1b[0m Tenho um codigo de setup (ex: PHX-A3B7)')
    console.log('  \x1b[33m[2]\x1b[0m Configurar manualmente')
    console.log('')

    const choice = (await ask('Escolha [1]: ')).trim() || '1'

    if (choice === '1') {
      const code = (await ask('\nDigite o codigo de setup: ')).trim().toUpperCase()
      if (!code) {
        console.log('\x1b[31mCodigo invalido.\x1b[0m')
        rl.close()
        return
      }
      rl.close()
      const ok = await setupFromCode(code)
      if (!ok) {
        console.log('\x1b[31mFalha na ativacao. Verifique o codigo e tente novamente.\x1b[0m')
        process.exit(1)
      }
    } else {
      config.bridgeUrl = (await ask('PhantomBridge URL [' + config.bridgeUrl + ']: ')).trim() || config.bridgeUrl
      config.bridgeToken = (await ask('Bridge Token [' + config.bridgeToken + ']: ')).trim() || config.bridgeToken

      const defaultId = os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'agent-' + Date.now().toString(36)
      config.agentId = (await ask('Agent ID [' + defaultId + ']: ')).trim() || defaultId
      config.agentName = (await ask('Agent Name [' + os.hostname() + ']: ')).trim() || os.hostname()

      const port = await ask('Local port [' + config.localPort + ']: ')
      if (port.trim()) config.localPort = parseInt(port.trim()) || 4444

      const tunnel = await ask('Enable Cloudflare tunnel? [Y/n]: ')
      config.tunnelEnabled = !tunnel.trim() || tunnel.trim().toLowerCase() === 'y'

      saveConfig()
      console.log('\n\x1b[32mConfig saved! Agent ID: ' + config.agentId + '\x1b[0m\n')
      rl.close()
    }
  })()
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('')
  console.log('\x1b[36m  ____  _                 _                    \x1b[0m')
  console.log('\x1b[36m |  _ \\| |__   __ _ _ __ | |_ ___  _ __ ___   \x1b[0m')
  console.log('\x1b[36m | |_) | \'_ \\ / _` | \'_ \\| __/ _ \\| \'_ ` _ \\  \x1b[0m')
  console.log('\x1b[36m |  __/| | | | (_| | | | | || (_) | | | | | | \x1b[0m')
  console.log('\x1b[36m |_|   |_| |_|\\__,_|_| |_|\\__\\___/|_| |_| |_| \x1b[0m')
  console.log('\x1b[36m                    Agent v1.0.0               \x1b[0m')
  console.log('')

  loadConfig()
  parseArgs()

  // Auto-setup via --code=XXX (no interactive prompts needed)
  if (config.code) {
    const ok = await setupFromCode(config.code)
    if (!ok) {
      log('ERROR', 'Setup code failed. Run with --setup for manual config.')
      process.exit(1)
    }
    delete config.code
    delete config._setup
  } else if (config._setup || !config.agentId) {
    await runSetup()
    loadConfig()
  }

  if (!config.agentId) {
    config.agentId = os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'default'
    config.agentName = os.hostname()
    saveConfig()
  }

  log('INFO', 'Agent ID:    ' + config.agentId)
  log('INFO', 'Agent Name:  ' + config.agentName)
  log('INFO', 'Bridge URL:  ' + config.bridgeUrl)
  log('INFO', 'Local port:  ' + config.localPort)
  log('INFO', 'Config path: ' + CONFIG_PATH)
  log('INFO', 'Log path:    ' + LOG_PATH)

  // Step 1: Start local server
  startLocalServer()

  // Step 2: Start Cloudflare tunnel
  const tunnelUrl = await startTunnel()

  // Step 3: Register with PhantomBridge
  if (tunnelUrl) {
    const ok = await registerWithBridge(tunnelUrl)
    if (ok) {
      log('OK', '================================')
      log('OK', '  Agent is LIVE and connected!')
      log('OK', '  Dashboard: ' + config.bridgeUrl + '/dashboard')
      log('OK', '================================')
    } else {
      log('WARN', 'Registration failed. Will retry via heartbeat.')
    }
  } else {
    log('WARN', 'No tunnel. Agent running locally on port ' + config.localPort)
    log('INFO', 'Install cloudflared for remote access:')
    log('INFO', 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/')
  }

  // Step 4: Heartbeat
  startHeartbeat()

  // Graceful shutdown
  const shutdown = () => { log('INFO', 'Shutting down...'); stopTunnel(); process.exit(0) }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch(err => { log('ERROR', 'Fatal: ' + err.message); process.exit(1) })
