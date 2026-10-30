import { app, BrowserWindow, protocol } from 'electron'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { store } from './store'
import { registerIpc, startRuntimeBroadcasters } from './ipc'
import { readImage } from './media'
import { watcher } from './watcher'
import { launcher } from './launcher'
import { getMainWindow, setMainWindow, broadcast } from './window'
import { createTray, setShowHandler, showMainWindow } from './tray'
import { createIcon } from './icons'

// Two custom schemes:
//   app://   serves the built renderer (a real origin, so a strict CSP works
//            and ES modules load without file:// restrictions)
//   storm:// serves posters and wallpapers from the library folder
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  },
  {
    scheme: 'storm',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

const isDev = !app.isPackaged
let quitting = false

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon'
}

async function handleAppProtocol(request: Request): Promise<Response> {
  const root = path.join(__dirname, '../renderer')
  const url = new URL(request.url)
  const pathname = decodeURIComponent(url.pathname)
  const relative = pathname === '/' || pathname === '' ? 'index.html' : pathname.replace(/^\/+/, '')
  const filePath = path.join(root, relative)
  if (!path.resolve(filePath).startsWith(path.resolve(root))) {
    return new Response('Forbidden', { status: 403 })
  }
  try {
    const data = await fsp.readFile(filePath)
    const mime = MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
    return new Response(new Uint8Array(data), {
      headers: { 'Content-Type': mime, 'Cache-Control': 'no-cache' }
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

async function handleStormProtocol(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const segments = url.pathname.split('/').filter(Boolean)
  const kind = segments[0] === 'banners' ? 'banners' : 'covers'
  const name = decodeURIComponent(segments[1] ?? '')
  const image = await readImage(kind, name)
  if (!image) return new Response('Not found', { status: 404 })
  return new Response(new Uint8Array(image.data), {
    headers: { 'Content-Type': image.mime, 'Cache-Control': 'no-cache' }
  })
}

/** The renderer URL, with an optional deep-link query for development. */
function rendererUrl(): string {
  const view = process.env['STORM_VIEW']
  const arg = process.env['STORM_VIEW_ARG']
  if (!view) return 'app://storm/index.html'
  if (view === 'game') return `app://storm/index.html?game=${encodeURIComponent(arg ?? '')}`
  if (view === 'launch') return `app://storm/index.html?launch=${encodeURIComponent(arg ?? '')}`
  return `app://storm/index.html?${encodeURIComponent(view)}=1`
}

function showMain(): void {
  const win = getMainWindow()
  if (!win) {
    createWindow()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1060,
    minHeight: 640,
    show: false,
    backgroundColor: '#05060b',
    // Custom title bar: the window keeps its frame (and stays resizable and
    // snap-able) while the caption is hidden so we can draw our own.
    titleBarStyle: 'hidden',
    icon: createIcon(store.settings.accent, 32),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false
    }
  })

  setMainWindow(win)

  win.once('ready-to-show', () => win.show())
  win.on('closed', () => setMainWindow(null))
  win.on('maximize', () => broadcast('storm:window-state', 'maximized'))
  win.on('unmaximize', () => broadcast('storm:window-state', 'normal'))

  win.on('close', (event) => {
    if (!quitting && store.settings.minimizeToTray) {
      event.preventDefault()
      win.hide()
    }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadURL(rendererUrl())
  }

  // Development helper: capture the window to a PNG and exit.
  const screenshot = process.env['STORM_SCREENSHOT']
  if (screenshot) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const image = await win.webContents.capturePage()
          await fsp.writeFile(screenshot, image.toPNG())
          console.log(`[storm] screenshot written to ${screenshot}`)
        } catch (err) {
          console.error('[storm] screenshot failed', err)
        }
        app.quit()
      }, Number(process.env['STORM_SCREENSHOT_DELAY'] ?? 2500))
    })
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showMain())
}

app.setAppUserModelId('com.storm.gamelib')

app.whenReady().then(async () => {
  await store.init()

  protocol.handle('storm', handleStormProtocol)
  protocol.handle('app', handleAppProtocol)
  registerIpc()
  startRuntimeBroadcasters()

  watcher.setIntervalSeconds(store.settings.scanIntervalSeconds)
  watcher.setGames(store.games)
  watcher.start()

  setShowHandler(() => showMain())
  createWindow()
  createTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !store.settings.minimizeToTray) {
    app.quit()
  }
})

app.on('before-quit', () => {
  quitting = true
  launcher.shutdown()
  store.saveSync()
})
