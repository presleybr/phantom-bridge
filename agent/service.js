/**
 * PhantomOS Agent - Windows Service Installer/Uninstaller
 *
 * Usage:
 *   node service.js install     Install as Windows Service
 *   node service.js uninstall   Remove Windows Service
 *   node service.js status      Check service status
 */

const path = require('path')

const action = process.argv[2] || 'install'

try {
  const { Service } = require('node-windows')

  const svc = new Service({
    name: 'PhantomOS Agent',
    description: 'PhantomOS remote control agent - connects this PC to PhantomBridge',
    script: path.join(__dirname, 'index.js'),
    nodeOptions: [],
    workingDirectory: __dirname,
    allowServiceLogon: true
  })

  svc.on('install', () => {
    console.log('\x1b[32m[OK] Service installed successfully!\x1b[0m')
    console.log('Starting service...')
    svc.start()
  })

  svc.on('alreadyinstalled', () => {
    console.log('\x1b[33m[WARN] Service is already installed\x1b[0m')
  })

  svc.on('start', () => {
    console.log('\x1b[32m[OK] Service started!\x1b[0m')
    console.log('The agent will now run automatically when Windows starts.')
  })

  svc.on('uninstall', () => {
    console.log('\x1b[32m[OK] Service uninstalled\x1b[0m')
  })

  svc.on('alreadyuninstalled', () => {
    console.log('\x1b[33m[WARN] Service is not installed\x1b[0m')
  })

  svc.on('error', (err) => {
    console.log('\x1b[31m[ERROR] ' + err + '\x1b[0m')
  })

  if (action === 'install') {
    console.log('Installing PhantomOS Agent as Windows Service...')
    console.log('Script: ' + path.join(__dirname, 'index.js'))
    svc.install()
  } else if (action === 'uninstall') {
    console.log('Uninstalling PhantomOS Agent service...')
    svc.uninstall()
  } else if (action === 'status') {
    console.log('Service exists:', svc.exists)
  } else {
    console.log('Usage: node service.js [install|uninstall|status]')
  }
} catch (e) {
  if (e.code === 'MODULE_NOT_FOUND') {
    console.log('\x1b[31m[ERROR] node-windows not installed\x1b[0m')
    console.log('Run: npm install node-windows')
  } else {
    console.log('\x1b[31m[ERROR] ' + e.message + '\x1b[0m')
  }
}
