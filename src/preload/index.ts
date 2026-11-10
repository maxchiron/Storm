import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { STORM_CHANNELS } from '@shared/api'
import type { BootAppearance, StormApi, StormChannel } from '@shared/api'

/** Theme passed in by the main process as `--storm-boot=<theme>:<mode>:<accent>`. */
function bootAppearance(): BootAppearance | null {
  const arg = process.argv.find((a) => a.startsWith('--storm-boot='))
  if (!arg) return null
  const [theme, mode, accent] = arg.slice('--storm-boot='.length).split(':')
  if (!theme || (mode !== 'dark' && mode !== 'light') || !/^#[0-9a-f]{6}$/i.test(accent ?? '')) return null
  return { theme: theme as BootAppearance['theme'], mode, accent }
}

const api: StormApi = {
  boot: bootAppearance(),

  getSnapshot: () => ipcRenderer.invoke('storm:snapshot'),
  saveGame: (input) => ipcRenderer.invoke('storm:saveGame', input),
  deleteGame: (id) => ipcRenderer.invoke('storm:deleteGame', id),
  togglePlayed: (id) => ipcRenderer.invoke('storm:togglePlayed', id),
  toggleFavorite: (id) => ipcRenderer.invoke('storm:toggleFavorite', id),
  setHidden: (id, hidden) => ipcRenderer.invoke('storm:setHidden', id, hidden),

  pickImage: (kind) => ipcRenderer.invoke('storm:pickImage', kind),
  importImageFile: (kind, filePath) => ipcRenderer.invoke('storm:importImageFile', kind, filePath),
  importImageData: (kind, data) => ipcRenderer.invoke('storm:importImageData', kind, data),
  importImageUrl: (kind, url) => ipcRenderer.invoke('storm:importImageUrl', kind, url),
  searchPoster: (title) => ipcRenderer.invoke('storm:searchPoster', title),
  discardImage: (kind, name) => ipcRenderer.invoke('storm:discardImage', kind, name),

  pickExe: (current) => ipcRenderer.invoke('storm:pickExe', current),
  inspectGameFiles: (paths) => ipcRenderer.invoke('storm:inspectGameFiles', paths),
  // Electron 32 removed File.path; this is its replacement.
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  pickDirectory: (current) => ipcRenderer.invoke('storm:pickDirectory', current),

  launch: (id) => ipcRenderer.invoke('storm:launch', id),
  openFolder: (kind, id) => ipcRenderer.invoke('storm:openFolder', kind, id),
  reveal: (target) => ipcRenderer.invoke('storm:reveal', target),
  copyPath: (target) => ipcRenderer.invoke('storm:copyPath', target),

  updateSettings: (patch) => ipcRenderer.invoke('storm:updateSettings', patch),
  recheck: (id) => ipcRenderer.invoke('storm:recheck', id),
  exportLibrary: () => ipcRenderer.invoke('storm:exportLibrary'),
  importLibrary: () => ipcRenderer.invoke('storm:importLibrary'),

  takeScreenshot: () => ipcRenderer.invoke('storm:takeScreenshot'),
  listScreenshots: (gameId) => ipcRenderer.invoke('storm:listScreenshots', gameId),
  listAllScreenshots: () => ipcRenderer.invoke('storm:listAllScreenshots'),
  pickScreenshotDir: () => ipcRenderer.invoke('storm:pickScreenshotDir'),
  suspendHotkey: (suspended, kind) => ipcRenderer.invoke('storm:suspendHotkey', suspended, kind),

  setHostMode: (on) => ipcRenderer.invoke('storm:host:set', on),
  hostActivity: () => ipcRenderer.send('storm:host:activity'),

  appVersion: () => ipcRenderer.invoke('storm:appVersion'),
  windowAction: (action) => ipcRenderer.invoke('storm:window', action),
  windowState: () => ipcRenderer.invoke('storm:window:state'),
  on: (channel, callback) => {
    if (!STORM_CHANNELS.includes(channel as StormChannel)) return () => {}
    const listener = (_e: unknown, payload: unknown): void => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('storm', api)
