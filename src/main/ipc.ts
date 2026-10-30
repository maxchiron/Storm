import { dialog, ipcMain, app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { store } from './store'
import { launcher } from './launcher'
import { watcher } from './watcher'
import { importImage, removeImage } from './media'
import { openFolder, revealFile, openFile } from './shell'
import { broadcast, getMainWindow } from './window'
import { hasTray, refreshTray } from './tray'
import type { AppSettings, Game, GameInput, LibrarySnapshot, RunningSession } from '@shared/types'

const IMAGE_FILTERS = [
  { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'avif'] }
]

function probeInstalled(game: Game): boolean {
  const anchor = game.installPath || (game.exePath ? path.dirname(game.exePath) : null)
  if (!anchor) return false
  try {
    fs.statSync(anchor)
    return true
  } catch {
    return false
  }
}

function applyInput(game: Game, input: GameInput): void {
  game.title = input.title.trim() || game.title
  if (input.cover !== undefined) game.cover = input.cover
  if (input.banner !== undefined) game.banner = input.banner
  if (input.exePath !== undefined) game.exePath = input.exePath?.trim() || null
  if (input.installPath !== undefined) game.installPath = input.installPath?.trim() || null
  if (input.savePath !== undefined) game.savePath = input.savePath?.trim() || null
  if (input.played !== undefined) game.played = input.played
  if (input.favorite !== undefined) game.favorite = input.favorite
  if (input.hidden !== undefined) game.hidden = input.hidden
  if (input.tags !== undefined) game.tags = input.tags
  if (input.note !== undefined) game.note = input.note
}

function snapshot(): LibrarySnapshot {
  return {
    games: store.games,
    settings: store.settings,
    running: launcher.runningSessions,
    dataDir: store.dataDir
  }
}

function pushGames(): void {
  broadcast('storm:games', store.games)
}

function pushSettings(): void {
  broadcast('storm:settings', store.settings)
}

function pushRunning(): void {
  broadcast('storm:running', launcher.runningSessions)
}

export function registerIpc(): void {
  ipcMain.handle('storm:snapshot', async (): Promise<LibrarySnapshot> => snapshot())

  ipcMain.handle(
    'storm:saveGame',
    async (_e, payload: { id?: string } & GameInput): Promise<Game> => {
      let saved!: Game
      const now = new Date().toISOString()
      store.mutate((db) => {
        if (payload.id) {
          const game = db.games.find((g) => g.id === payload.id)
          if (!game) throw new Error('NOT_FOUND')
          const oldCover = game.cover
          const oldBanner = game.banner
          applyInput(game, payload)
          game.installed = probeInstalled(game)
          game.updatedAt = now
          saved = game
          // Drop the media files that were just replaced (after the mutate).
          if (payload.cover !== undefined && payload.cover !== oldCover) {
            void removeImage(oldCover, 'covers')
          }
          if (payload.banner !== undefined && payload.banner !== oldBanner) {
            void removeImage(oldBanner, 'banners')
          }
        } else {
          const game: Game = {
            id: store.newGameId(),
            title: payload.title?.trim() || 'Untitled',
            cover: payload.cover ?? null,
            banner: payload.banner ?? null,
            exePath: payload.exePath?.trim() || null,
            installPath: payload.installPath?.trim() || null,
            savePath: payload.savePath?.trim() || null,
            installed: false,
            played: payload.played ?? false,
            favorite: payload.favorite ?? false,
            hidden: payload.hidden ?? false,
            playCount: 0,
            playtimeMinutes: 0,
            firstPlayedAt: null,
            lastPlayedAt: null,
            tags: payload.tags ?? [],
            note: payload.note ?? '',
            addedAt: now,
            updatedAt: now
          }
          game.installed = probeInstalled(game)
          db.games.unshift(game)
          saved = game
        }
      })
      await store.save()
      watcher.setGames(store.games)
      pushGames()
      return saved
    }
  )

  ipcMain.handle('storm:deleteGame', async (_e, id: string): Promise<void> => {
    const game = store.getGame(id)
    if (game) {
      await removeImage(game.cover, 'covers')
      await removeImage(game.banner, 'banners')
    }
    store.mutate((db) => {
      db.games = db.games.filter((g) => g.id !== id)
      db.sessions = db.sessions.filter((s) => s.gameId !== id)
    })
    await store.save()
    watcher.setGames(store.games)
    pushGames()
  })

  ipcMain.handle('storm:togglePlayed', async (_e, id: string): Promise<Game> => {
    let out!: Game
    store.mutate((db) => {
      const game = db.games.find((g) => g.id === id)
      if (!game) throw new Error('NOT_FOUND')
      game.played = !game.played
      game.updatedAt = new Date().toISOString()
      out = game
    })
    await store.save()
    pushGames()
    return out
  })

  ipcMain.handle('storm:toggleFavorite', async (_e, id: string): Promise<Game> => {
    let out!: Game
    store.mutate((db) => {
      const game = db.games.find((g) => g.id === id)
      if (!game) throw new Error('NOT_FOUND')
      game.favorite = !game.favorite
      game.updatedAt = new Date().toISOString()
      out = game
    })
    await store.save()
    pushGames()
    return out
  })

  ipcMain.handle('storm:setHidden', async (_e, id: string, hidden: boolean): Promise<Game> => {
    let out!: Game
    store.mutate((db) => {
      const game = db.games.find((g) => g.id === id)
      if (!game) throw new Error('NOT_FOUND')
      game.hidden = hidden
      game.updatedAt = new Date().toISOString()
      out = game
    })
    await store.save()
    pushGames()
    return out
  })

  ipcMain.handle('storm:setInstalled', async (_e, id: string, installed: boolean): Promise<Game> => {
    let out!: Game
    store.mutate((db) => {
      const game = db.games.find((g) => g.id === id)
      if (!game) throw new Error('NOT_FOUND')
      game.installed = installed
      game.updatedAt = new Date().toISOString()
      out = game
    })
    await store.save()
    pushGames()
    return out
  })

  ipcMain.handle('storm:pickImage', async (_e, kind: 'covers' | 'banners'): Promise<string | null> => {
    const win = getMainWindow()
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: kind === 'covers' ? 'Select cover image' : 'Select wallpaper',
          properties: ['openFile'],
          filters: IMAGE_FILTERS
        })
      : await dialog.showOpenDialog({ properties: ['openFile'], filters: IMAGE_FILTERS })
    if (result.canceled || result.filePaths.length === 0) return null
    return importImage(result.filePaths[0], kind)
  })

  ipcMain.handle('storm:pickExe', async (_e, current?: string): Promise<string | null> => {
    const win = getMainWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Select game executable',
      properties: ['openFile'],
      filters: [{ name: 'Executables', extensions: ['exe', 'bat', 'cmd', 'lnk'] }],
      defaultPath: current || undefined
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('storm:pickDirectory', async (_e, current?: string): Promise<string | null> => {
    const win = getMainWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Select folder',
      properties: ['openDirectory'],
      defaultPath: current || undefined
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('storm:launch', async (_e, id: string): Promise<{ ok: boolean; error?: string }> => {
    const game = store.getGame(id)
    if (!game) return { ok: false, error: 'NOT_FOUND' }
    const result = await launcher.launch(game)
    if (result.ok) {
      pushGames()
      pushRunning()
    }
    return result
  })

  ipcMain.handle('storm:openFolder', async (_e, kind: 'install' | 'save' | 'data', id?: string): Promise<boolean> => {
    if (kind === 'data') return openFolder(store.dataDir)
    const game = id ? store.getGame(id) : undefined
    if (!game) return false
    const target = kind === 'install' ? game.installPath || (game.exePath ? path.dirname(game.exePath) : '') : game.savePath
    if (!target) return false
    return openFolder(target)
  })

  ipcMain.handle('storm:reveal', async (_e, target: string): Promise<boolean> => revealFile(target))

  ipcMain.handle('storm:openFile', async (_e, target: string): Promise<boolean> => openFile(target))

  ipcMain.handle('storm:copyPath', async (_e, target: string): Promise<boolean> => {
    const { clipboard } = await import('electron')
    clipboard.writeText(target)
    return true
  })

  ipcMain.handle('storm:updateSettings', async (_e, patch: Partial<AppSettings>): Promise<AppSettings> => {
    const settings = store.updateSettings(patch)
    watcher.setIntervalSeconds(settings.scanIntervalSeconds)
    refreshTray()
    pushSettings()
    return settings
  })

  ipcMain.handle('storm:recheck', async (_e, id?: string): Promise<boolean> => {
    if (id) return watcher.checkNow(id)
    watcher.setGames(store.games)
    watcher.checkAll()
    return true
  })

  ipcMain.handle('storm:exportLibrary', async (): Promise<string | null> => {
    const win = getMainWindow()
    const stamp = new Date().toISOString().slice(0, 10)
    const result = win
      ? await dialog.showSaveDialog(win, {
          title: 'Export library',
          defaultPath: `storm-library-${stamp}.json`,
          filters: [{ name: 'JSON', extensions: ['json'] }]
        })
      : await dialog.showSaveDialog({ defaultPath: `storm-library-${stamp}.json` })
    if (result.canceled || !result.filePath) return null
    await fsp.writeFile(result.filePath, JSON.stringify({ games: store.games, settings: store.settings }, null, 2), 'utf8')
    return result.filePath
  })

  ipcMain.handle('storm:importLibrary', async (): Promise<LibrarySnapshot | null> => {
    const win = getMainWindow()
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: 'Import library',
          properties: ['openFile'],
          filters: [{ name: 'JSON', extensions: ['json'] }]
        })
      : await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (result.canceled || result.filePaths.length === 0) return null
    try {
      const raw = await fsp.readFile(result.filePaths[0], 'utf8')
      const parsed = JSON.parse(raw) as { games?: Game[]; settings?: Partial<AppSettings> }
      if (!Array.isArray(parsed.games)) return null
      store.replace({ games: parsed.games, settings: parsed.settings })
      await store.save()
      watcher.setGames(store.games)
      pushGames()
      pushSettings()
      return snapshot()
    } catch {
      return null
    }
  })

  ipcMain.handle('storm:dataDir', async (): Promise<string> => store.dataDir)

  ipcMain.handle('storm:window', async (_e, action: 'minimize' | 'maximize' | 'close'): Promise<boolean> => {
    const win = getMainWindow()
    if (!win) return false
    if (action === 'minimize') {
      // Minimising goes to the tray when the user asked for that behaviour.
      if (store.settings.minimizeToTray && hasTray()) win.hide()
      else win.minimize()
    } else if (action === 'maximize') {
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
    } else if (action === 'close') win.close()
    return true
  })

  ipcMain.handle('storm:window:state', async (): Promise<'maximized' | 'normal'> => {
    const win = getMainWindow()
    return win?.isMaximized() ? 'maximized' : 'normal'
  })

  ipcMain.handle('storm:appVersion', async (): Promise<string> => app.getVersion())
}

export function startRuntimeBroadcasters(): void {
  launcher.addRunningListener((sessions: RunningSession[]) => broadcast('storm:running', sessions))
  launcher.addEventListener((payload) => {
    broadcast('storm:session', payload)
    pushGames()
  })
  watcher.addListener((gameId, installed) => {
    const game = store.getGame(gameId)
    if (!game || game.installed === installed) return
    store.mutate((db) => {
      const g = db.games.find((x) => x.id === gameId)
      if (g) {
        g.installed = installed
        g.updatedAt = new Date().toISOString()
      }
    })
    void store.save()
    pushGames()
  })
}
