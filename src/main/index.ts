import { app, BrowserWindow, globalShortcut, protocol, screen, shell } from 'electron'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { store, type WindowBounds } from './store'
import { applyNativeTheme, registerIpc, resolvedMode, startRuntimeBroadcasters } from './ipc'
import { pruneOrphanMedia, readImage, type MediaFolder } from './media'
import { watcher } from './watcher'
import { launcher } from './launcher'
import { screenshots } from './screenshot'
import { hostMode } from './hostmode'
import { openFolder } from './shell'
import { getMainWindow, setMainWindow, broadcast } from './window'
import { createTray, destroyTray, hasTray, setScreenshotsHandler, setShowHandler } from './tray'
import { createIcon } from './icons'
import { windowBackground } from '@shared/themes'

// Two custom schemes:
//   app://   serves the built renderer (a real origin, so a strict CSP works
//            and ES modules load without file:// restrictions)
//   storm:// serves posters, wallpapers, screenshot previews and the
//            screenshots themselves (for the viewer)
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
const MIN_WIDTH = 1060
const MIN_HEIGHT = 640
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
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon'
}

async function handleAppProtocol(request: Request): Promise<Response> {
  const root = path.resolve(__dirname, '../renderer')
  const url = new URL(request.url)
  const pathname = decodeURIComponent(url.pathname)
  const relative = pathname === '/' || pathname === '' ? 'index.html' : pathname.replace(/^\/+/, '')
  const filePath = path.resolve(root, relative)
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
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

const STORM_FOLDERS: Record<string, MediaFolder> = { covers: 'covers', banners: 'banners', thumbs: 'thumbs' }

async function handleStormProtocol(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments[0] === 'shots' && segments.length === 2) {
    // A screenshot by its record id — never by path, so nothing else on disk can be asked for.
    const shot = await screenshots.image(decodeURIComponent(segments[1]))
    if (!shot) return new Response('Not found', { status: 404 })
    return new Response(new Uint8Array(shot.data), {
      headers: { 'Content-Type': shot.mime, 'Cache-Control': 'private, max-age=3600' }
    })
  }
  const kind = STORM_FOLDERS[segments[0] ?? '']
  if (!kind || segments.length !== 2) return new Response('Not found', { status: 404 })
  const image = await readImage(kind, decodeURIComponent(segments[1]))
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
  if (view === 'game' || view === 'launch' || view === 'drop') {
    return `app://storm/index.html?${view}=${encodeURIComponent(arg ?? '')}`
  }
  return `app://storm/index.html?${encodeURIComponent(view)}=1`
}

function isAppUrl(target: string): boolean {
  if (target.startsWith('app://storm/')) return true
  const dev = process.env['ELECTRON_RENDERER_URL']
  return isDev && !!dev && target.startsWith(dev)
}

function showMain(): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) {
    createWindow()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** Where the window was last time — as long as that spot is still on a screen. */
function initialBounds(): Partial<Electron.Rectangle> & { width: number; height: number } {
  const saved = store.windowBounds
  if (!saved) return { width: 1500, height: 940 }
  const width = Math.max(MIN_WIDTH, saved.width)
  const height = Math.max(MIN_HEIGHT, saved.height)
  if (saved.x === undefined || saved.y === undefined) return { width, height }
  const { x, y } = saved
  const onScreen = screen.getAllDisplays().some(({ workArea: a }) => {
    const overlapX = Math.min(x + width, a.x + a.width) - Math.max(x, a.x)
    const overlapY = Math.min(y + height, a.y + a.height) - Math.max(y, a.y)
    return overlapX >= 120 && overlapY >= 80
  })
  return onScreen ? { x, y, width, height } : { width, height }
}

function rememberBounds(win: BrowserWindow): void {
  // Full screen (host mode, the screenshot viewer) is not a size to come back to.
  if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
  const normal = win.getNormalBounds()
  const bounds: WindowBounds = { ...normal, maximized: win.isMaximized() }
  store.setWindowBounds(bounds)
}

function createWindow(): void {
  const settings = store.settings
  const mode = resolvedMode()
  const win = new BrowserWindow({
    ...initialBounds(),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    backgroundColor: windowBackground(settings.theme, mode),
    // Custom title bar: the window keeps its frame (and stays resizable and
    // snap-able) while the caption is hidden so we can draw our own.
    titleBarStyle: 'hidden',
    icon: createIcon(settings.accent, 32),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // Keeps timers — and so the controller screenshot combo — alive while a
      // game covers the window or Storm sits in the tray.
      backgroundThrottling: false,
      // The boot screen is painted before the library loads; this lets it use
      // the right colours from the first frame.
      additionalArguments: [`--storm-boot=${settings.theme}:${mode}:${settings.accent}`]
    }
  })

  setMainWindow(win)
  hostMode.attach(win, settings.startInHostMode, store.windowBounds?.maximized === true)

  win.once('ready-to-show', () => {
    if (hostMode.isActive) {
      win.show()
      hostMode.shown()
      return
    }
    // maximize() also shows the window, so it waits until there is something to show.
    if (store.windowBounds?.maximized) win.maximize()
    win.show()
  })
  win.on('closed', () => {
    setMainWindow(null)
    screenshots.closeOverlay()
  })
  win.on('maximize', () => broadcast('storm:window-state', 'maximized'))
  win.on('unmaximize', () => broadcast('storm:window-state', 'normal'))

  let boundsTimer: NodeJS.Timeout | null = null
  const queueBounds = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => rememberBounds(win), 600)
  }
  win.on('resize', queueBounds)
  win.on('move', queueBounds)

  win.on('close', (event) => {
    rememberBounds(win)
    if (!quitting && store.settings.minimizeToTray && hasTray()) {
      event.preventDefault()
      win.hide()
    }
  })

  // The window only ever shows Storm itself. Without these guards a file
  // dropped outside a drop zone would navigate the window to file://… and
  // replace the whole app with an image (or start downloading an .exe).
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault()
  })
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadURL(rendererUrl())
  }

  // Development helper: capture the window to a PNG and exit.
  const screenshot = process.env['STORM_SCREENSHOT']
  if (isDev && screenshot) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(
        async () => {
          try {
            const image = await win.webContents.capturePage()
            await fsp.writeFile(screenshot, image.toPNG())
            console.log(`[storm] screenshot written to ${screenshot}`)
          } catch (err) {
            console.error('[storm] screenshot failed', err)
          }
          quitting = true
          app.quit()
        },
        Number(process.env['STORM_SCREENSHOT_DELAY'] ?? 2500)
      )
    })
  }
}

async function openScreenshotFolder(): Promise<void> {
  const root = screenshots.root()
  await fsp.mkdir(root, { recursive: true }).catch(() => undefined)
  await openFolder(root)
}

function start(): void {
  app.on('second-instance', () => showMain())
  app.setAppUserModelId('com.storm.gamelib')

  app.whenReady().then(async () => {
    await store.init()

    protocol.handle('storm', handleStormProtocol)
    protocol.handle('app', handleAppProtocol)
    registerIpc()
    startRuntimeBroadcasters()
    applyNativeTheme()

    watcher.setIntervalSeconds(store.settings.scanIntervalSeconds)
    watcher.setGames(store.games)
    watcher.start()
    // Catch up with anything that changed while Storm was closed.
    void watcher.checkAll()

    setShowHandler(() => showMain())
    setScreenshotsHandler(() => void openScreenshotFolder())
    createWindow()
    createTray()
    screenshots.syncHotkey()

    // Tidy up artwork nothing refers to any more, once start-up has settled.
    setTimeout(() => void pruneOrphanMedia(), 30_000).unref()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    // With "minimize to tray" the window hides instead of closing, so getting
    // here means the user really closed it.
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    quitting = true
    const win = getMainWindow()
    if (win) rememberBounds(win)
    launcher.shutdown()
    store.saveSync()
  })

  app.on('will-quit', () => {
    screenshots.dispose()
    globalShortcut.unregisterAll()
    destroyTray()
  })
}

// A second copy of Storm hands over to the first one and leaves straight
// away, before it has read — let alone written — anything.
if (app.requestSingleInstanceLock()) {
  start()
} else {
  app.quit()
}
