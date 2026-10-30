import { app, Menu, Tray } from 'electron'
import { store } from './store'
import { createIcon } from './icons'
import { translate } from '@shared/i18n'

let tray: Tray | null = null
let showHandler: (() => void) | null = null

/** Registered by the main entry point so the tray can raise the window. */
export function setShowHandler(fn: () => void): void {
  showHandler = fn
}

export function hasTray(): boolean {
  return tray !== null
}

export function showMainWindow(): void {
  showHandler?.()
}

function buildMenu(): Electron.Menu {
  const lang = store.settings.language
  return Menu.buildFromTemplate([
    {
      label: translate(lang, 'nav.library'),
      click: () => showMainWindow()
    },
    { type: 'separator' },
    {
      label: lang === 'zh' ? '退出 Storm' : 'Quit Storm',
      click: () => app.quit()
    }
  ])
}

export function createTray(): void {
  if (tray) return
  tray = new Tray(createIcon(store.settings.accent, 16))
  tray.setToolTip('Storm')
  tray.setContextMenu(buildMenu())
  tray.on('click', () => showMainWindow())
}

/** Called when the accent colour or language changes. */
export function refreshTray(): void {
  if (!tray) return
  tray.setImage(createIcon(store.settings.accent, 16))
  tray.setContextMenu(buildMenu())
}
