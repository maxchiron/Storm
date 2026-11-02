import {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  screen,
  shell,
  type Display,
  type NativeImage
} from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { store } from './store'
import { launcher } from './launcher'
import { removeImage, writeImage } from './media'
import { translate } from '@shared/i18n'
import type { HotkeyState, ScreenshotEvent, ScreenshotInfo, ScreenshotRecord, ScreenshotResult } from '@shared/types'

/**
 * Screenshots: a global hotkey (and, through the renderer, a controller
 * button combo) captures the screen the game is on and files the picture
 * under the game that is running.
 *
 *   Pictures\Storm\<Game title>\<Game title> 2026-11-01 21-04-33.png
 *
 * Storm keeps a small preview of each one so the game's detail page can show
 * a gallery; the full-size files are the user's and are never deleted.
 */

const RESERVED_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)$/i
const OVERLAY_WIDTH = 340
const OVERLAY_HEIGHT = 92
const OVERLAY_MS = 2600

/** A string that is safe to use as a Windows file or folder name. */
export function safeFileName(value: string, fallback = 'Game'): string {
  let name = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  if (name.length > 80) name = name.slice(0, 80).trim()
  if (!name) name = fallback
  if (RESERVED_NAMES.test(name)) name += '_'
  return name
}

function timestamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function fileState(file: string): Promise<'ok' | 'deleted' | 'unknown'> {
  try {
    await fsp.access(file)
    return 'ok'
  } catch {
    // Only call it deleted when its folder is still there: a screenshot on an
    // unplugged drive is not gone, merely out of reach.
    try {
      await fsp.access(path.dirname(file))
      return 'deleted'
    } catch {
      return 'unknown'
    }
  }
}

export function toInfo(record: ScreenshotRecord): ScreenshotInfo {
  return {
    id: record.id,
    gameId: record.gameId,
    file: record.file,
    thumbUrl: record.thumb ? `storm://asset/thumbs/${encodeURIComponent(record.thumb)}` : null,
    takenAt: record.takenAt
  }
}

export class ScreenshotService {
  private busy = false
  private registered: string | null = null
  private suspended = false
  private state: HotkeyState = 'off'
  private stateListeners = new Set<(state: HotkeyState) => void>()
  private shotListeners = new Set<(event: ScreenshotEvent) => void>()
  private overlay: BrowserWindow | null = null
  private overlayTimer: NodeJS.Timeout | null = null

  get hotkeyState(): HotkeyState {
    return this.state
  }

  onState(fn: (state: HotkeyState) => void): void {
    this.stateListeners.add(fn)
  }

  onShot(fn: (event: ScreenshotEvent) => void): void {
    this.shotListeners.add(fn)
  }

  /** The folder screenshots are saved under. */
  root(): string {
    return store.settings.screenshotDir || path.join(app.getPath('pictures'), 'Storm')
  }

  folderFor(gameId: string | null): string {
    const game = gameId ? store.getGame(gameId) : undefined
    return path.join(this.root(), game ? safeFileName(game.title) : 'Desktop')
  }

  /**
   * Register or release the global hotkey to match the settings and whether
   * a game is running. Call whenever either changes.
   */
  syncHotkey(): HotkeyState {
    const s = store.settings
    const listening = !s.screenshotOnlyWhilePlaying || launcher.hasRunning
    const wanted = s.screenshotHotkey && listening && !this.suspended ? s.screenshotHotkey : null

    if (this.registered && this.registered !== wanted) {
      globalShortcut.unregister(this.registered)
      this.registered = null
    }

    let next: HotkeyState
    if (!s.screenshotHotkey) next = 'off'
    else if (!wanted) next = 'idle'
    else if (this.registered === wanted) next = 'active'
    else {
      let ok = false
      try {
        ok = globalShortcut.register(wanted, () => void this.capture())
      } catch {
        // An accelerator Electron cannot parse.
        ok = false
      }
      this.registered = ok ? wanted : null
      next = ok ? 'active' : 'unavailable'
    }

    if (next !== this.state) {
      this.state = next
      for (const fn of this.stateListeners) fn(next)
    }
    return next
  }

  /** Settings is recording a new hotkey — let the keys through to the window meanwhile. */
  suspend(suspended: boolean): HotkeyState {
    this.suspended = suspended
    return this.syncHotkey()
  }

  /**
   * The hidden overlay is still a window; it has to go with the main window,
   * or Electron would never see "all windows closed" and Storm would linger.
   */
  closeOverlay(): void {
    if (this.overlayTimer) clearTimeout(this.overlayTimer)
    this.overlayTimer = null
    if (this.overlay && !this.overlay.isDestroyed()) this.overlay.destroy()
    this.overlay = null
  }

  dispose(): void {
    if (this.registered) globalShortcut.unregister(this.registered)
    this.registered = null
    this.closeOverlay()
  }

  /** Capture the screen under the pointer — where a running game almost always is. */
  private async grab(display: Display): Promise<NativeImage | null> {
    const scale = display.scaleFactor || 1
    const thumbnailSize = {
      width: Math.round(display.size.width * scale),
      height: Math.round(display.size.height * scale)
    }
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize, fetchWindowIcons: false })
      const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
      return source && !source.thumbnail.isEmpty() ? source.thumbnail : null
    } catch {
      return null
    }
  }

  async capture(): Promise<ScreenshotResult> {
    if (this.busy) return { ok: false, error: 'BUSY' }
    this.busy = true
    try {
      // The "saved" card of the previous shot must not end up in this one.
      if (this.overlay && !this.overlay.isDestroyed() && this.overlay.isVisible()) {
        this.overlay.hide()
        await delay(120)
      }

      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      const image = await this.grab(display)
      if (!image) return { ok: false, error: 'CAPTURE_FAILED' }

      const gameId = launcher.latestGameId
      const game = gameId ? store.getGame(gameId) : undefined
      const settings = store.settings
      const ext = settings.screenshotFormat === 'jpg' ? 'jpg' : 'png'
      const dir = this.folderFor(game?.id ?? null)
      const base = `${safeFileName(game?.title ?? 'Storm')} ${timestamp(new Date())}`

      let file = ''
      try {
        await fsp.mkdir(dir, { recursive: true })
        const data = ext === 'jpg' ? image.toJPEG(92) : image.toPNG()
        // 'wx' fails instead of overwriting when two shots land in the same second.
        for (let n = 1; n < 100 && !file; n++) {
          const candidate = path.join(dir, n === 1 ? `${base}.${ext}` : `${base} (${n}).${ext}`)
          try {
            await fsp.writeFile(candidate, data, { flag: 'wx' })
            file = candidate
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
          }
        }
      } catch (err) {
        console.error('[storm] could not save screenshot', err)
      }
      if (!file) return { ok: false, error: 'WRITE_FAILED' }

      let preview: Buffer | null = null
      let thumb: string | null = null
      try {
        preview = image.resize({ width: 480, quality: 'good' }).toJPEG(82)
        thumb = await writeImage(preview, 'jpg', 'thumbs')
      } catch {
        /* the gallery shows a placeholder instead */
      }

      const record: ScreenshotRecord = {
        id: randomUUID(),
        gameId: game?.id ?? null,
        file,
        thumb,
        takenAt: new Date().toISOString()
      }
      store.mutate((db) => {
        db.screenshots.push(record)
      })
      void store.save()

      const shot = toInfo(record)
      for (const fn of this.shotListeners) fn({ shot, title: game?.title ?? null })
      if (settings.screenshotNotify) void this.flash(display, game?.title ?? null, preview)
      return { ok: true, shot }
    } finally {
      this.busy = false
    }
  }

  /**
   * A small card in the corner of the game's screen, the way Steam confirms a
   * screenshot. It never takes focus, so the game keeps its input.
   */
  private async flash(display: Display, title: string | null, preview: Buffer | null): Promise<void> {
    try {
      if (!this.overlay || this.overlay.isDestroyed()) {
        this.overlay = new BrowserWindow({
          width: OVERLAY_WIDTH,
          height: OVERLAY_HEIGHT,
          show: false,
          frame: false,
          transparent: true,
          resizable: false,
          movable: false,
          minimizable: false,
          maximizable: false,
          focusable: false,
          skipTaskbar: true,
          hasShadow: false,
          alwaysOnTop: true,
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            javascript: false,
            spellcheck: false
          }
        })
        this.overlay.setAlwaysOnTop(true, 'screen-saver')
        this.overlay.setIgnoreMouseEvents(true)
      }
      const { workArea } = display
      this.overlay.setBounds({
        x: Math.round(workArea.x + workArea.width - OVERLAY_WIDTH - 20),
        y: Math.round(workArea.y + 20),
        width: OVERLAY_WIDTH,
        height: OVERLAY_HEIGHT
      })
      const lang = store.settings.language
      const html = overlayHtml({
        heading: translate(lang, 'shot.saved'),
        detail: title ?? translate(lang, 'shot.desktop'),
        accent: store.settings.accent,
        preview: preview ? `data:image/jpeg;base64,${preview.toString('base64')}` : null
      })
      await this.overlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      this.overlay.showInactive()
      if (this.overlayTimer) clearTimeout(this.overlayTimer)
      this.overlayTimer = setTimeout(() => {
        if (this.overlay && !this.overlay.isDestroyed()) this.overlay.hide()
      }, OVERLAY_MS)
    } catch {
      /* purely cosmetic */
    }
  }

  /** This game's screenshots, newest first. Records of deleted files are dropped. */
  async list(gameId: string): Promise<ScreenshotInfo[]> {
    const records = store.screenshots.filter((s) => s.gameId === gameId)
    const states = await Promise.all(records.map((r) => fileState(r.file)))
    const deleted = records.filter((_, i) => states[i] === 'deleted')
    if (deleted.length > 0) {
      const gone = new Set(deleted.map((r) => r.id))
      store.mutate((db) => {
        db.screenshots = db.screenshots.filter((s) => !gone.has(s.id))
      })
      void store.save()
      for (const r of deleted) void removeImage(r.thumb, 'thumbs')
    }
    return records
      .filter((_, i) => states[i] === 'ok')
      .sort((a, b) => b.takenAt.localeCompare(a.takenAt))
      .map(toInfo)
  }

  async open(id: string): Promise<boolean> {
    const record = store.screenshots.find((s) => s.id === id)
    if (!record) return false
    return (await shell.openPath(record.file)) === ''
  }

  /** Forget a deleted game's screenshots. The image files themselves stay. */
  forgetGame(gameId: string): void {
    const mine = store.screenshots.filter((s) => s.gameId === gameId)
    if (mine.length === 0) return
    store.mutate((db) => {
      db.screenshots = db.screenshots.filter((s) => s.gameId !== gameId)
    })
    for (const r of mine) void removeImage(r.thumb, 'thumbs')
  }
}

function overlayHtml(o: { heading: string; detail: string; accent: string; preview: string | null }): string {
  const accent = /^#[0-9a-f]{6}$/i.test(o.accent) ? o.accent : '#38bdf8'
  const image = o.preview ? `<img src="${o.preview}" alt="">` : '<div class="ph"></div>'
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:transparent;overflow:hidden;font-family:'Segoe UI Variable Text','Segoe UI','Microsoft YaHei UI',sans-serif}
  .card{position:absolute;inset:6px;display:flex;align-items:center;gap:12px;padding:10px 14px 10px 10px;border-radius:14px;
    background:rgba(12,14,22,.92);border:1px solid rgba(255,255,255,.12);box-shadow:0 10px 30px rgba(0,0,0,.45);
    animation:in .32s cubic-bezier(.16,1,.3,1) both, out .4s ease ${OVERLAY_MS - 450}ms forwards}
  .card::before{content:'';position:absolute;left:0;top:14px;bottom:14px;width:3px;border-radius:3px;background:${accent}}
  img,.ph{flex:none;width:96px;height:54px;border-radius:8px;object-fit:cover;background:#1e2230}
  .t{min-width:0;display:flex;flex-direction:column;gap:2px}
  .h{font-size:13px;font-weight:700;color:#fff}
  .d{font-size:12px;color:rgba(255,255,255,.62);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  @keyframes in{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:none}}
  @keyframes out{to{opacity:0;transform:translateX(16px)}}
  </style></head><body><div class="card">${image}<div class="t"><span class="h">${escapeHtml(o.heading)}</span><span class="d">${escapeHtml(o.detail)}</span></div></div></body></html>`
}

export const screenshots = new ScreenshotService()
