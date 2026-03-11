/**
 * PhantomOS Windows Agent
 *
 * Runs on the client's Windows PC. Starts a local HTTP server,
 * opens a Cloudflare tunnel, and registers with PhantomBridge.
 * Executes commands received from the dashboard.
 *
 * Usage:
 *   node index.js                     (uses config.json)
 *   node index.js --setup             (interactive first-time setup)
 *   node index.js --agentId=office-pc (override agentId)
 */

const express = require('express')
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

const CONFIG_PATH = path.join(__dirname, 'config.json')
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
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
      config = { ...config, ...JSON.parse(raw) }
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

// Parse CLI args
function parseArgs() {
  const args = process.argv.slice(2)
  for (const arg of args) {
    if (arg === '--setup') { config._setup = true; continue }
    const match = arg.match(/^--(\w+)=(.+)$/)
    if (match) config[match[1]] = match[2]
  }
}

// ============================================================
// LOGGING
// ============================================================

function log(level, msg) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19)
  const prefix = { INFO: '\x1b[36m', WARN: '\x1b[33m', ERROR: '\x1b[31m', OK: '\x1b[32m' }
  const reset = '\x1b[0m'
  console.log(`${prefix[level] || ''}[${ts}] [${level}]${reset} ${msg}`)
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

  // Special built-in commands
  if (cmd === 'screenshot') {
    return await takeScreenshot()
  }
  if (cmd.startsWith('ps-')) {
    return await handlePhotoshopCommand(cmd)
  }

  // Regular shell command
  const result = await executeCommand(cmd)
  log(result.ok ? 'OK' : 'WARN', 'Result: ' + (result.output || result.error || '').substring(0, 100))
  return result
}

async function takeScreenshot() {
  const screenshotPath = path.join(os.tmpdir(), 'phantom-screenshot-' + Date.now() + '.png')
  const psCmd = `powershell "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen | ForEach { $b = $_.Bounds; $bmp = New-Object System.Drawing.Bitmap($b.Width,$b.Height); $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save('${screenshotPath.replace(/\\/g, '\\\\')}'); $g.Dispose(); $bmp.Dispose() }"`
  const result = await executeCommand(psCmd)
  if (fs.existsSync(screenshotPath)) {
    const base64 = fs.readFileSync(screenshotPath, 'base64')
    fs.unlinkSync(screenshotPath)
    return { ok: true, type: 'screenshot', image: 'data:image/png;base64,' + base64.substring(0, 500) + '...', size: base64.length, path: screenshotPath }
  }
  return { ok: false, error: 'Screenshot failed', detail: result }
}

async function handlePhotoshopCommand(cmd) {
  const psCommands = {
    'ps-open-psd': 'Start-Process "C:\\Program Files\\Adobe\\Adobe Photoshop 2024\\Photoshop.exe"',
    'ps-export-png': 'echo "Export PNG - requires JSX script integration"',
    'ps-list-layers': 'echo "List layers - requires JSX script integration"',
    'ps-script': 'echo "Run script - requires JSX script integration"'
  }
  const psCmd = psCommands[cmd]
  if (!psCmd) return { ok: false, error: 'Unknown Photoshop command: ' + cmd }
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
        const fullPath = path.join(dirPath, item.name)
        let size = null
        let modified = null
        try {
          const stat = fs.statSync(fullPath)
          size = stat.size
          modified = stat.mtime.toISOString()
        } catch {}
        return {
          name: item.name,
          type: item.isDirectory() ? 'directory' : 'file',
          size,
          modified
        }
      })
    }
  } catch (e) {
    return { ok: false, error: e.message, path: dirPath }
  }
}

// ============================================================
// LOCAL HTTP SERVER (receives commands from PhantomBridge)
// ============================================================

function startLocalServer() {
  const app = express()
  app.use(express.json({ limit: '10mb' }))

  // Health check
  app.get('/health', (req, res) => {
    res.json({
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
  })

  // Receive messages/commands from PhantomBridge
  app.post('/send-to-windows', async (req, res) => {
    const { message, type, from } = req.body
    if (!message) return res.status(400).json({ error: 'message required' })

    log('INFO', 'Command from ' + (from || 'unknown') + ': ' + (message || '').substring(0, 80))
    const result = await handleCommand(message, type)
    res.json({ ok: true, result })
  })

  // File listing
  app.get('/api/files', (req, res) => {
    const p = req.query.path || 'C:\\'
    res.json(listFiles(p))
  })

  // System info
  app.get('/api/system-info', (req, res) => {
    res.json({
      ok: true,
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      uptime: os.uptime(),
      totalMem: os.totalmem(),
      freeMem: os.freemem(),
      cpus: os.cpus(),
      networkInterfaces: os.networkInterfaces(),
      userInfo: os.userInfo(),
      tempDir: os.tmpdir()
    })
  })

  // Messages endpoint (for compatibility)
  const messages = []
  app.get('/messages-mac', (req, res) => {
    res.json({ ok: true, messages })
  })
  app.get('/messages', (req, res) => {
    res.json({ ok: true, messages })
  })
  app.post('/send-to-mac', (req, res) => {
    const { message } = req.body
    if (message) messages.push({ content: message, timestamp: new Date().toISOString(), from: 'windows' })
    if (messages.length > 100) messages.splice(0, messages.length - 100)
    res.json({ ok: true })
  })

  const server = app.listen(config.localPort, () => {
    log('OK', 'Local server running on port ' + config.localPort)
  })

  return server
}

// ============================================================
// CLOUDFLARE TUNNEL
// ============================================================

let tunnelProcess = null
let currentTunnelUrl = null

function startTunnel() {
  return new Promise((resolve, reject) => {
    if (!config.tunnelEnabled) {
      log('WARN', 'Tunnel disabled in config')
      return resolve(null)
    }

    log('INFO', 'Starting Cloudflare tunnel on port ' + config.localPort + '...')

    // Try to find cloudflared
    const cloudflared = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'

    tunnelProcess = spawn(cloudflared, [
      'tunnel', '--url', 'http://localhost:' + config.localPort,
      '--no-autoupdate'
    ], {
      stdio: ['ignore', 'pipe', 'pipe']
    })

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
      log('ERROR', 'Tunnel failed to start: ' + err.message)
      log('INFO', 'Make sure cloudflared is installed: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/')
      if (!resolved) { resolved = true; resolve(null) }
    })

    tunnelProcess.on('exit', (code) => {
      log('WARN', 'Tunnel process exited with code ' + code)
      currentTunnelUrl = null
      // Auto-restart after 10s
      setTimeout(() => {
        log('INFO', 'Restarting tunnel...')
        startTunnel().then(url => {
          if (url) registerWithBridge(url)
        })
      }, 10000)
    })

    // Timeout: if no URL found in 30s
    setTimeout(() => {
      if (!resolved) {
        resolved = true
        log('WARN', 'Tunnel URL not detected in 30s')
        resolve(null)
      }
    }, 30000)
  })
}

function stopTunnel() {
  if (tunnelProcess) {
    tunnelProcess.kill()
    tunnelProcess = null
    currentTunnelUrl = null
  }
}

// ============================================================
// BRIDGE REGISTRATION
// ============================================================

async function registerWithBridge(tunnelUrl) {
  if (!tunnelUrl) {
    log('WARN', 'No tunnel URL to register')
    return false
  }

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

  const headers = {}
  if (config.agentToken) {
    headers['x-agent-token'] = config.agentToken
  } else {
    headers['x-bridge-token'] = config.bridgeToken
  }

  try {
    const res = await httpRequest(config.bridgeUrl + '/register', 'POST', body, headers)
    if (res.status === 200 && res.data.ok) {
      log('OK', 'Registered with PhantomBridge as "' + config.agentId + '"')
      // Save agentToken for future reconnections
      if (res.data.agentToken && !config.agentToken) {
        config.agentToken = res.data.agentToken
        saveConfig()
        log('OK', 'Agent token saved to config')
      }
      return true
    } else {
      log('ERROR', 'Registration failed: ' + JSON.stringify(res.data))
      return false
    }
  } catch (e) {
    log('ERROR', 'Registration error: ' + e.message)
    return false
  }
}

// ============================================================
// HEARTBEAT
// ============================================================

let heartbeatTimer = null

function startHeartbeat() {
  heartbeatTimer = setInterval(async () => {
    if (!currentTunnelUrl) return

    try {
      const res = await httpRequest(config.bridgeUrl + '/health', 'GET', null, null, 5000)
      if (res.status === 200) {
        // Re-register to update lastSeen
        await registerWithBridge(currentTunnelUrl)
      }
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

    config.bridgeUrl = (await ask('PhantomBridge URL [' + config.bridgeUrl + ']: ')).trim() || config.bridgeUrl
    config.bridgeToken = (await ask('Bridge Token [' + config.bridgeToken + ']: ')).trim() || config.bridgeToken

    const hostname = os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-')
    const defaultId = hostname || 'agent-' + Math.random().toString(36).substring(2, 6)
    config.agentId = (await ask('Agent ID [' + defaultId + ']: ')).trim() || defaultId
    config.agentName = (await ask('Agent Name [' + os.hostname() + ']: ')).trim() || os.hostname()

    const port = await ask('Local port [' + config.localPort + ']: ')
    if (port.trim()) config.localPort = parseInt(port.trim()) || 4444

    const tunnel = await ask('Enable Cloudflare tunnel? [Y/n]: ')
    config.tunnelEnabled = !tunnel.trim() || tunnel.trim().toLowerCase() === 'y'

    saveConfig()
    console.log('\n\x1b[32mConfig saved to ' + CONFIG_PATH + '\x1b[0m')
    console.log('\x1b[32mAgent ID: ' + config.agentId + '\x1b[0m\n')

    rl.close()
  })()
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('\n\x1b[36m╔══════════════════════════════════╗\x1b[0m')
  console.log('\x1b[36m║     PhantomOS Windows Agent      ║\x1b[0m')
  console.log('\x1b[36m║           v1.0.0                 ║\x1b[0m')
  console.log('\x1b[36m╚══════════════════════════════════╝\x1b[0m\n')

  loadConfig()
  parseArgs()

  // Interactive setup if needed
  if (config._setup || !config.agentId) {
    await runSetup()
    loadConfig()
  }

  if (!config.agentId) {
    config.agentId = os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'default'
    config.agentName = os.hostname()
    saveConfig()
  }

  log('INFO', 'Agent ID: ' + config.agentId)
  log('INFO', 'Agent Name: ' + config.agentName)
  log('INFO', 'Bridge: ' + config.bridgeUrl)
  log('INFO', 'Local port: ' + config.localPort)

  // Step 1: Start local server
  startLocalServer()

  // Step 2: Start Cloudflare tunnel
  const tunnelUrl = await startTunnel()

  // Step 3: Register with PhantomBridge
  if (tunnelUrl) {
    const registered = await registerWithBridge(tunnelUrl)
    if (registered) {
      log('OK', 'Agent is live and connected to PhantomBridge!')
      log('OK', 'Dashboard: ' + config.bridgeUrl + '/dashboard')
    } else {
      log('WARN', 'Registration failed. Will retry on heartbeat.')
    }
  } else {
    log('WARN', 'No tunnel URL. Agent is running locally only on port ' + config.localPort)
    log('INFO', 'Install cloudflared to enable remote access')
  }

  // Step 4: Start heartbeat
  startHeartbeat()

  // Graceful shutdown
  process.on('SIGINT', () => {
    log('INFO', 'Shutting down...')
    stopTunnel()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    log('INFO', 'Shutting down...')
    stopTunnel()
    process.exit(0)
  })
}

main().catch(err => {
  log('ERROR', 'Fatal: ' + err.message)
  process.exit(1)
})
