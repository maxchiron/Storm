import { contextBridge, ipcRenderer } from 'electron'
import { STORM_CHANNELS } from '@shared/api'
import type { StormApi } from '@shared/api'

const api: StormApi = {
  getSnapshot: () => ipcRenderer.invoke('storm:snapshot'),
  saveGame: (input) => ipcRenderer.invoke('storm:saveGame', input),
  deleteGame: (id) => ipcRenderer.invoke('storm:deleteGame', id),
  togglePlayed: (id) => ipcRenderer.invoke('storm:togglePlayed', id),
  toggleFavorite: (id) => ipcRenderer.invoke('storm:toggleFavorite', id),
  setHidden: (id, hidden) => ipcRenderer.invoke('storm:setHidden', id, hidden),
  setInstalled: (id, installed) => ipcRenderer.invoke('storm:setInstalled', id, installed),
  pickImage: (kind) => ipcRenderer.invoke('storm:pickImage', kind),
  pickExe: (current) => ipcRenderer.invoke('storm:pickExe', current),
  pickDirectory: (current) => ipcRenderer.invoke('storm:pickDirectory', current),
  launch: (id) => ipcRenderer.invoke('storm:launch', id),
  openFolder: (kind, id) => ipcRenderer.invoke('storm:openFolder', kind, id),
  reveal: (target) => ipcRenderer.invoke('storm:reveal', target),
  openFile: (target) => ipcRenderer.invoke('storm:openFile', target),
  copyPath: (target) => ipcRenderer.invoke('storm:copyPath', target),
  updateSettings: (patch) => ipcRenderer.invoke('storm:updateSettings', patch),
  recheck: (id) => ipcRenderer.invoke('storm:recheck', id),
  exportLibrary: () => ipcRenderer.invoke('storm:exportLibrary'),
  importLibrary: () => ipcRenderer.invoke('storm:importLibrary'),
  dataDir: () => ipcRenderer.invoke('storm:dataDir'),
  appVersion: () => ipcRenderer.invoke('storm:appVersion'),
  windowAction: (action) => ipcRenderer.invoke('storm:window', action),
  windowState: () => ipcRenderer.invoke('storm:window:state'),
  on: (channel, callback) => {
    if (!STORM_CHANNELS.includes(channel as (typeof STORM_CHANNELS)[number])) return () => {}
    const listener = (_e: unknown, payload: unknown): void => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('storm', api)
