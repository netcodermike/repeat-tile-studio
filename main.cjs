const { app, BrowserWindow, clipboard, dialog, ipcMain, net, protocol, session } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const { pathToFileURL } = require('node:url')

const { productName } = require('./package.json')
const check = process.argv.includes('--verify')
const capture = process.argv.find(arg => arg.startsWith('--capture='))?.slice(10)
const entry = 'studio://workspace/index.html'
const bundled = new Set(['/index.html', '/style.css', '/app.js', '/project.js', '/tool.js', '/art.js'])
let window
protocol.registerSchemesAsPrivileged([{ scheme: 'studio', privileges: {
  standard: true, secure: true, supportFetchAPI: true,
} }])
if (check) app.commandLine.appendSwitch('force-device-scale-factor', '1')

async function start() {
  window = new BrowserWindow({
    width: 1280, height: 830, minWidth: 760, minHeight: 580, useContentSize: true,
    title: productName, backgroundColor: '#181723', autoHideMenuBar: true,
    show: !check, webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      offscreen: check,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.on('closed', () => { window = null })
  await window.loadURL(entry)
  if (!check) return
  if (!await window.webContents.executeJavaScript('window.desktopReady')) throw new Error('Editor did not load')
  if (capture) {
    // Offscreen composition can lag the renderer's requestAnimationFrame callbacks.
    await delay(280)
    const screenshot = await window.webContents.capturePage()
    await fs.writeFile(path.resolve(capture), screenshot.toPNG())
  }
  const result = await window.webContents.executeJavaScript('window.verifyDesktop()')
  console.log(`${productName}: ${result}`)
  app.exit(0)
}

ipcMain.handle('save-artwork', async (event, suggested, bytes) => {
  if (!window || event.senderFrame !== window.webContents.mainFrame ||
      typeof suggested !== 'string' || !/^[a-z0-9-]+\.(png|txt|svg|json|css)$/.test(suggested) ||
      !(bytes instanceof Uint8Array) || bytes.byteLength > 40 * 1024 * 1024) {
    throw new Error('Invalid export')
  }
  const extension = path.extname(suggested).slice(1)
  if (check) return bytes.length > 15
  const result = await dialog.showSaveDialog(window, {
    defaultPath: suggested, filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
  })
  if (result.canceled || !result.filePath) return false
  await fs.writeFile(result.filePath, bytes)
  return true
})

ipcMain.handle('copy-color', (event, color) => {
  if (!window || event.senderFrame !== window.webContents.mainFrame ||
      typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Invalid color')
  if (!check) clipboard.writeText(color)
})

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, done) => done(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  protocol.handle('studio', request => {
    const url = new URL(request.url)
    if (url.host !== 'workspace' || !bundled.has(url.pathname)) return new Response(null, { status: 404 })
    return net.fetch(pathToFileURL(path.join(__dirname, url.pathname.slice(1))).href)
  })
  return start()
}).catch(error => { console.error(error); app.exit(1) })
app.on('activate', () => {
  if (!window) start().catch(error => { console.error(error); app.exit(1) })
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
