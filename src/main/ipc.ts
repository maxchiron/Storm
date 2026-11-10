import { app, clipboard, dialog, ipcMain, nativeTheme, shell } from 'electron'
import fsp from 'node:fs/promises'
import { store } from './store'
import { launcher } from './launcher'
import { anchorFor, pathExists, watcher } from './watcher'
import { importImage, importImageData, importImageUrl, mediaExists, removeImage } from './media'
import { inspectGameFile } from './gamefile'
import { screenshots } from './screenshot'
import { openFolder, revealFile } from './shell'
import { broadcast, getMainWindow } from './window'
import { hasTray, refreshTray } from './tray'
import { hostMode } from './hostmode'
import { cleanGameInput } from './normalize'
import { translate } from '@shared/i18n'
import { windowBackground } from '@shared/themes'
import { posterSearchUrl } from '@shared/links'
import type { FolderKind } from '@shared/api'
import type {
  AppSettings,
  Game,
  GameFileResult,
  LibrarySnapshot,
  MediaKind,
  MediaResult,
  ResolvedMode
} from '@shared/types'

const IMAGE_FILTERS = [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'avif'] }]

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length < 100
}

function isMediaKind(value: unknown): value is MediaKind {
  return value === 'covers' || value === 'banners'
}

function isPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length < 4096
}

/**
 * Host mode is read-only: guests at the TV can browse and play, but nothing
 * about the library changes. The host UI offers no way to edit; this makes
 * sure nothing else can either.
 */
function assertWritable(): void {
  if (hostMode.isActive) throw new Error('READ_ONLY')
}

async function probeInstalled(game: Game): Promise<boolean> {
  const anchor = anchorFor(game)
  return anchor ? pathExists(anchor) : false
}

export function resolvedMode(): ResolvedMode {
  const { appearance } = store.settings
  if (appearance === 'system') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  return appearance
}

/** Keep native chrome (dialogs, menus, the window background) in step with the theme. */
export function applyNativeTheme(): void {
  const { appearance, theme } = store.settings
  nativeTheme.themeSource = appearance
  const win = getMainWindow()
  if (win && !win.isDestroyed()) win.setBackgroundColor(windowBackground(theme, resolvedMode()))
}

function snapshot(): LibrarySnapshot {
  return {
    games: store.games,
    settings: store.settings,
    running: launcher.runningSessions,
    dataDir: store.dataDir,
    hotkey: screenshots.hotkeyState,
    host: hostMode.isActive,
    recoveredFrom: store.recoveredFrom
  }
}

function pushGames(): void {
  broadcast('storm:games', store.games)
}

function pushSettings(): void {
  broadcast('storm:settings', store.settings)
}

/** Apply a mutation to one game and persist it. */
async function updateGame(id: unknown, fn: (game: Game) => void): Promise<Game> {
  assertWritable()
  if (!isId(id)) throw new Error('NOT_FOUND')
  const game = store.getGame(id)
  if (!game) throw new Error('NOT_FOUND')
  store.mutate(() => {
    fn(game)
    game.updatedAt = new Date().toISOString()
  })
  await store.save()
  pushGames()
  return game
}

function dialogParent(): Electron.BaseWindow | undefined {
  const win = getMainWindow()
  return win && !win.isDestroyed() ? win : undefined
}

async function showOpen(options: Electron.OpenDialogOptions): Promise<string | null> {
  const parent = dialogParent()
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
}

export function registerIpc(): void {
  ipcMain.handle('storm:snapshot', async (): Promise<LibrarySnapshot> => snapshot())

  ipcMain.handle('storm:saveGame', async (_e, payload: unknown): Promise<Game> => {
    assertWritable()
    const input = cleanGameInput(payload)
    const id = (payload as { id?: unknown } | null)?.id
    const now = new Date().toISOString()
    // Artwork replaced by this save; deleted only once the save is on disk.
    const replaced: { name: string; kind: MediaKind }[] = []
    let saved: Game

    if (id !== undefined && id !== null) {
      if (!isId(id)) throw new Error('NOT_FOUND')
      const game = store.getGame(id)
      if (!game) throw new Error('NOT_FOUND')
      if (input.cover !== undefined && game.cover && input.cover !== game.cover) {
        replaced.push({ name: game.cover, kind: 'covers' })
      }
      if (input.banner !== undefined && game.banner && input.banner !== game.banner) {
        replaced.push({ name: game.banner, kind: 'banners' })
      }
      const { title, ...rest } = input
      store.mutate(() => {
        Object.assign(game, rest)
        if (title) game.title = title
        game.updatedAt = now
      })
      game.installed = await probeInstalled(game)
      saved = game
    } else {
      const game: Game = {
        id: store.newGameId(),
        title: input.title || 'Untitled',
        cover: input.cover ?? null,
        banner: input.banner ?? null,
        exePath: input.exePath ?? null,
        args: input.args ?? '',
        installPath: input.installPath ?? null,
        savePath: input.savePath ?? null,
        installed: false,
        played: input.played ?? false,
        favorite: input.favorite ?? false,
        hidden: input.hidden ?? false,
        playCount: 0,
        playtimeMinutes: 0,
        firstPlayedAt: null,
        lastPlayedAt: null,
        tags: input.tags ?? [],
        note: input.note ?? '',
        addedAt: now,
        updatedAt: now
      }
      game.installed = await probeInstalled(game)
      store.mutate((db) => {
        db.games.unshift(game)
      })
      saved = game
    }

    await store.save()
    for (const r of replaced) void removeImage(r.name, r.kind)
    watcher.setGames(store.games)
    pushGames()
    return saved
  })

  ipcMain.handle('storm:deleteGame', async (_e, id: unknown): Promise<void> => {
    assertWritable()
    if (!isId(id)) return
    const game = store.getGame(id)
    if (!game) return
    store.mutate((db) => {
      db.games = db.games.filter((g) => g.id !== id)
      db.sessions = db.sessions.filter((s) => s.gameId !== id)
    })
    screenshots.forgetGame(id)
    await store.save()
    await removeImage(game.cover, 'covers')
    await removeImage(game.banner, 'banners')
    watcher.setGames(store.games)
    pushGames()
  })

  ipcMain.handle('storm:togglePlayed', (_e, id: unknown) => updateGame(id, (g) => (g.played = !g.played)))
  ipcMain.handle('storm:toggleFavorite', (_e, id: unknown) => updateGame(id, (g) => (g.favorite = !g.favorite)))
  ipcMain.handle('storm:setHidden', (_e, id: unknown, hidden: unknown) =>
    updateGame(id, (g) => (g.hidden = hidden === true))
  )

  /* ------------------------------------------------------------ media */

  ipcMain.handle('storm:pickImage', async (_e, kind: unknown): Promise<MediaResult | null> => {
    if (!isMediaKind(kind)) return null
    const lang = store.settings.language
    const file = await showOpen({
      title: translate(lang, kind === 'covers' ? 'dialog.pickCover' : 'dialog.pickWallpaper'),
      properties: ['openFile'],
      filters: IMAGE_FILTERS
    })
    return file ? importImage(file, kind) : null
  })

  ipcMain.handle('storm:importImageFile', async (_e, kind: unknown, filePath: unknown): Promise<MediaResult> => {
    if (!isMediaKind(kind) || !isPath(filePath)) return { ok: false, error: 'UNSUPPORTED' }
    return importImage(filePath, kind)
  })

  ipcMain.handle('storm:importImageData', async (_e, kind: unknown, data: unknown): Promise<MediaResult> => {
    if (!isMediaKind(kind) || !(data instanceof Uint8Array)) return { ok: false, error: 'UNSUPPORTED' }
    return importImageData(data, kind)
  })

  ipcMain.handle('storm:importImageUrl', async (_e, kind: unknown, url: unknown): Promise<MediaResult> => {
    if (!isMediaKind(kind) || typeof url !== 'string' || url.length > 8 * 1024 * 1024) {
      return { ok: false, error: 'UNSUPPORTED' }
    }
    return importImageUrl(url, kind)
  })

  ipcMain.handle('storm:discardImage', async (_e, kind: unknown, name: unknown): Promise<void> => {
    if (!isMediaKind(kind) || typeof name !== 'string') return
    // Only images no game uses — a cancelled form must never delete live artwork.
    const inUse = store.games.some((g) => (kind === 'covers' ? g.cover : g.banner) === name)
    if (!inUse && (await mediaExists(name, kind))) await removeImage(name, kind)
  })

  /* ------------------------------------------------------- game files */

  ipcMain.handle('storm:pickExe', async (_e, current: unknown): Promise<GameFileResult | null> => {
    const lang = store.settings.language
    const file = await showOpen({
      title: translate(lang, 'dialog.pickExe'),
      properties: ['openFile'],
      filters: [{ name: translate(lang, 'dialog.executables'), extensions: ['exe', 'lnk', 'bat', 'cmd'] }],
      defaultPath: isPath(current) ? current : undefined
    })
    return file ? inspectGameFile(file) : null
  })

  ipcMain.handle('storm:inspectGameFiles', async (_e, paths: unknown): Promise<GameFileResult[]> => {
    if (!Array.isArray(paths)) return []
    const files = paths.filter(isPath).slice(0, 50)
    return Promise.all(files.map((p) => inspectGameFile(p)))
  })

  ipcMain.handle('storm:pickDirectory', async (_e, current: unknown): Promise<string | null> => {
    return showOpen({
      title: translate(store.settings.language, 'dialog.pickFolder'),
      properties: ['openDirectory'],
      defaultPath: isPath(current) ? current : undefined
    })
  })

  /* ----------------------------------------------------------- launch */

  ipcMain.handle('storm:launch', async (_e, id: unknown) => {
    const game = isId(id) ? store.getGame(id) : undefined
    if (!game) return { ok: false, error: 'NOT_FOUND' }
    const result = await launcher.launch(game)
    if (result.ok) pushGames()
    return result
  })

  ipcMain.handle('storm:openFolder', async (_e, kind: FolderKind, id?: unknown): Promise<boolean> => {
    if (kind === 'data') return openFolder(store.dataDir)
    if (kind === 'screenshots') {
      const gameDir = isId(id) ? screenshots.folderFor(id) : null
      if (gameDir && (await pathExists(gameDir))) return openFolder(gameDir)
      const root = screenshots.root()
      await fsp.mkdir(root, { recursive: true }).catch(() => undefined)
      return openFolder(root)
    }
    const game = isId(id) ? store.getGame(id) : undefined
    if (!game) return false
    const target = kind === 'install' ? anchorFor(game) : game.savePath
    return target ? openFolder(target) : false
  })

  ipcMain.handle('storm:reveal', async (_e, target: unknown): Promise<boolean> =>
    isPath(target) ? revealFile(target) : false
  )

  ipcMain.handle('storm:copyPath', async (_e, target: unknown): Promise<boolean> => {
    if (!isPath(target)) return false
    clipboard.writeText(target)
    return true
  })

  /* --------------------------------------------------------- settings */

  ipcMain.handle('storm:updateSettings', async (_e, patch: unknown): Promise<AppSettings> => {
    const before = store.settings
    const settings = store.updateSettings(patch)
    watcher.setIntervalSeconds(settings.scanIntervalSeconds)
    if (before.appearance !== settings.appearance || before.theme !== settings.theme) applyNativeTheme()
    if (before.accent !== settings.accent || before.language !== settings.language) refreshTray()
    screenshots.syncHotkey()
    pushSettings()
    return settings
  })

  ipcMain.handle('storm:recheck', async (_e, id?: unknown): Promise<boolean> => {
    if (isId(id)) return watcher.checkNow(id)
    watcher.setGames(store.games)
    await watcher.checkAll()
    return true
  })

  ipcMain.handle('storm:exportLibrary', async (): Promise<string | null> => {
    const lang = store.settings.language
    const stamp = new Date().toISOString().slice(0, 10)
    const options: Electron.SaveDialogOptions = {
      title: translate(lang, 'settings.export'),
      defaultPath: `storm-library-${stamp}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const parent = dialogParent()
    const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    await fsp.writeFile(result.filePath, JSON.stringify(store.exportData(), null, 2), 'utf8')
    return result.filePath
  })

  ipcMain.handle('storm:importLibrary', async (): Promise<LibrarySnapshot | null> => {
    assertWritable()
    const lang = store.settings.language
    const file = await showOpen({
      title: translate(lang, 'settings.import'),
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (!file) return null

    let parsed: { games?: unknown; settings?: unknown; sessions?: unknown }
    try {
      parsed = JSON.parse(await fsp.readFile(file, 'utf8'))
    } catch {
      throw new Error('INVALID_FILE')
    }
    if (!parsed || !Array.isArray(parsed.games)) throw new Error('INVALID_FILE')

    // An import replaces the whole library — make sure that is what the user wants.
    if (store.games.length > 0) {
      const options: Electron.MessageBoxOptions = {
        type: 'warning',
        buttons: [translate(lang, 'import.replace'), translate(lang, 'action.cancel')],
        defaultId: 1,
        cancelId: 1,
        title: translate(lang, 'settings.import'),
        message: translate(lang, 'import.confirm'),
        detail: translate(lang, 'import.confirmDetail').replace('{count}', String(store.games.length))
      }
      const parent = dialogParent()
      const answer = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
      if (answer.response !== 0) return null
    }

    store.replace({ games: parsed.games, settings: parsed.settings, sessions: parsed.sessions })
    // Artwork is not part of an export; a library from another PC refers to
    // files that are not here. Show the placeholder instead of a broken image.
    for (const game of store.games) {
      if (!(await mediaExists(game.cover, 'covers'))) game.cover = null
      if (!(await mediaExists(game.banner, 'banners'))) game.banner = null
      game.installed = await probeInstalled(game)
    }
    await store.save()
    watcher.setGames(store.games)
    applyNativeTheme()
    refreshTray()
    screenshots.syncHotkey()
    pushGames()
    pushSettings()
    return snapshot()
  })

  /* ------------------------------------------------------ screenshots */

  ipcMain.handle('storm:takeScreenshot', () => screenshots.shoot('window'))
  ipcMain.handle('storm:listScreenshots', async (_e, gameId: unknown) => (isId(gameId) ? screenshots.list(gameId) : []))
  ipcMain.handle('storm:listAllScreenshots', () => screenshots.listAll())
  // Only SteamGridDB, and only built from the title: the renderer never gets
  // to open an arbitrary address in the browser.
  ipcMain.handle('storm:searchPoster', async (_e, title: unknown): Promise<boolean> => {
    const url = typeof title === 'string' && title.length <= 300 ? posterSearchUrl(title) : null
    if (!url) return false
    try {
      await shell.openExternal(url)
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle('storm:suspendHotkey', async (_e, suspended: unknown, kind: unknown) =>
    screenshots.suspend(suspended === true, kind === 'pad' ? 'pad' : 'key')
  )
  ipcMain.handle('storm:pickScreenshotDir', async (): Promise<string | null> => {
    return showOpen({
      title: translate(store.settings.language, 'dialog.pickFolder'),
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: screenshots.root()
    })
  })

  /* ----------------------------------------------------------- window */

  ipcMain.handle('storm:window', async (_e, action: unknown): Promise<boolean> => {
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
    else if (action === 'quit') app.quit()
    return true
  })

  ipcMain.handle('storm:host:set', async (_e, on: unknown): Promise<boolean> => hostMode.set(on === true))
  ipcMain.on('storm:host:activity', () => hostMode.activity())

  ipcMain.handle('storm:window:state', async (): Promise<'maximized' | 'normal'> => {
    return getMainWindow()?.isMaximized() ? 'maximized' : 'normal'
  })

  ipcMain.handle('storm:appVersion', async (): Promise<string> => app.getVersion())
}

export function startRuntimeBroadcasters(): void {
  launcher.addRunningListener((sessions) => {
    broadcast('storm:running', sessions)
    // "Only while playing": the hotkey comes and goes with the game.
    screenshots.syncHotkey()
  })
  launcher.addEventListener((payload) => {
    broadcast('storm:session', payload)
    pushGames()
  })
  screenshots.onState((state) => broadcast('storm:hotkey', state))
  screenshots.onShot((event) => broadcast('storm:screenshot', event))
  screenshots.onFailure((error) => broadcast('storm:screenshot-failed', error))
  watcher.addListener((gameId, installed) => {
    const game = store.getGame(gameId)
    if (!game || game.installed === installed) return
    store.mutate(() => {
      game.installed = installed
      game.updatedAt = new Date().toISOString()
    })
    void store.save()
    pushGames()
  })
  nativeTheme.on('updated', () => {
    if (store.settings.appearance === 'system') applyNativeTheme()
  })
}
