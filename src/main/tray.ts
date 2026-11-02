import { app, Menu, Tray } from 'electron'
import { store } from './store'
import { createIcon } from './icons'
import { translate } from '@shared/i18n'

let tray: Tray | null = null
let showHandler: (() => void) | null = null
let screenshotsHandler: (() => void) | null = null

/** Registered by the main entry point so the tray can raise the window. */
export function setShowHandler(fn: () => void): void {
  showHandler = fn
}

/** Registered by the main entry point to open the screenshot folder. */
export function setScreenshotsHandler(fn: () => void): void {
  screenshotsHandler = fn
}

export function hasTray(): boolean {
  return tray !== null
}

function buildMenu(): Electron.Menu {
  const lang = store.settings.language
  return Menu.buildFromTemplate([
    { label: translate(lang, 'tray.open'), click: () => showHandler?.() },
    { label: translate(lang, 'tray.screenshots'), click: () => screenshotsHandler?.() },
    { type: 'separator' },
    { label: translate(lang, 'tray.quit'), click: () => app.quit() }
  ])
}

export function createTray(): void {
  if (tray) return
  try {
    tray = new Tray(createIcon(store.settings.accent, 16))
  } catch (err) {
    // No notification area (some Linux desktops). Storm still works; the
    // window simply closes instead of hiding.
    console.error('[storm] tray unavailable', err)
    tray = null
    return
  }
  tray.setToolTip('Storm')
  tray.setContextMenu(buildMenu())
  tray.on('click', () => showHandler?.())
}

/** Called when the accent colour or language changes. */
export function refreshTray(): void {
  if (!tray) return
  tray.setImage(createIcon(store.settings.accent, 16))
  tray.setContextMenu(buildMenu())
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
