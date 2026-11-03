import {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  nativeImage,
  screen,
  shell,
  type Display,
  type NativeImage,
  type Rectangle
} from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { store } from './store'
import { launcher } from './launcher'
import { removeImage, writeImage } from './media'
import { log } from './log'
import { hdrCapture } from './hdrcapture'
import { padMask, parseAccelerator, ShortcutWatcher } from './wininput'
import { translate, type TranslationKey } from '@shared/i18n'
import type {
  HotkeyState,
  ScreenshotError,
  ScreenshotEvent,
  ScreenshotInfo,
  ScreenshotRecord,
  ScreenshotResult
} from '@shared/types'

/**
 * Screenshots: a global hotkey or a controller button combo captures the
 * screen the game is on and files the picture under the game that is running.
 *
 * Each shortcut is watched more than one way, because no single route
 * reaches into every game (see wininput.ts): globalShortcut and, on Windows,
 * polled key and XInput state in this process; the renderer's Gamepad API
 * for controllers XInput does not cover. They all end in shoot(), which
 * takes one picture per press however many of them saw it.
 *
 *   Pictures\Storm\<Game title>\<Game title> 2026-11-01 21-04-33.png
 *
 * Storm keeps a small preview of each one so the game's detail page can show
 * a gallery; the full-size files are the user's and are never deleted.
 *
 * A screen with HDR on is read in full through the capture process and its
 * highlights rolled off into the picture (hdrcapture.ts, tonemap.ts); the
 * ordinary capture would cut them off at SDR white. Or, if the settings say
 * so, it is kept as HDR in a JPEG XR file (jxr.ts). SDR screens, and any HDR
 * capture that fails, go through desktopCapturer as before.
 */

/** A captured screen: the picture, and the same screen as JPEG XR when it is kept as HDR. */
interface Grabbed {
  image: NativeImage
  jxr: Buffer | null
}

const RESERVED_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)$/i
const OVERLAY_WIDTH = 340
const OVERLAY_HEIGHT = 92
const OVERLAY_MS = 2600
/** Presses closer together than this are one press seen by two watchers. */
const COOLDOWN_MS = 800
/**
 * The longest a capture or a save may take. Past that the shot counts as
 * failed, so that one call that never returns cannot leave every later press
 * answered with "busy" until Storm restarts.
 */
const CAPTURE_TIMEOUT_MS = 10_000
const SAVE_TIMEOUT_MS = 15_000

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

/** The display's bounds in physical pixels, which is how Windows names screens. */
function physicalBounds(display: Display): Rectangle {
  // Only Windows has dipToScreenRect, which also gets mixed-DPI layouts right.
  if (typeof screen.dipToScreenRect === 'function') return screen.dipToScreenRect(null, display.bounds)
  const scale = display.scaleFactor || 1
  const { x, y, width, height } = display.bounds
  return {
    x: Math.round(x * scale),
    y: Math.round(y * scale),
    width: Math.round(width * scale),
    height: Math.round(height * scale)
  }
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Rejects if the promise has not settled in time. The work itself carries on; only the waiting stops. */
function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000} s`)), ms)
  })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}

/** Write `<base>.<ext>` into dir, or `<base> (2).<ext>` and so on when the name is taken. */
async function writeUnique(dir: string, base: string, ext: string, data: Buffer): Promise<string> {
  await fsp.mkdir(dir, { recursive: true })
  // 'wx' fails instead of overwriting when two shots land in the same second.
  for (let n = 1; n < 100; n++) {
    const candidate = path.join(dir, n === 1 ? `${base}.${ext}` : `${base} (${n}).${ext}`)
    try {
      await fsp.writeFile(candidate, data, { flag: 'wx' })
      return candidate
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
  return ''
}

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

export type ShortcutKind = 'key' | 'pad'

export class ScreenshotService {
  private busy = false
  private lastShot = 0
  private registered: string | null = null
  private suspended: Record<ShortcutKind, boolean> = { key: false, pad: false }
  private watcher: ShortcutWatcher | null | undefined
  private state: HotkeyState = 'off'
  private stateListeners = new Set<(state: HotkeyState) => void>()
  private shotListeners = new Set<(event: ScreenshotEvent) => void>()
  private failListeners = new Set<(error: ScreenshotError) => void>()
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

  onFailure(fn: (error: ScreenshotError) => void): void {
    this.failListeners.add(fn)
  }

  /** The folder screenshots are saved under. */
  root(): string {
    return store.settings.screenshotDir || path.join(app.getPath('pictures'), 'Storm')
  }

  folderFor(gameId: string | null): string {
    const game = gameId ? store.getGame(gameId) : undefined
    return path.join(this.root(), game ? safeFileName(game.title) : 'Desktop')
  }

  /** Created on first use; null where there is no native input (anywhere but Windows). */
  private nativeWatcher(): ShortcutWatcher | null {
    if (this.watcher === undefined) {
      this.watcher = ShortcutWatcher.create((source) => void this.shoot(source))
      if (this.watcher) log('shot', 'watching keys and XInput controllers directly')
    }
    return this.watcher
  }

  /**
   * Start or stop listening for the shortcuts to match the settings and
   * whether a game is running. Call whenever either changes.
   */
  syncHotkey(): HotkeyState {
    const s = store.settings
    const listening = !s.screenshotOnlyWhilePlaying || launcher.hasRunning
    const wanted = s.screenshotHotkey && listening && !this.suspended.key ? s.screenshotHotkey : null
    const combo = listening && !this.suspended.pad ? s.screenshotPadCombo : []

    if (this.registered && this.registered !== wanted) {
      globalShortcut.unregister(this.registered)
      this.registered = null
    }
    if (wanted && this.registered !== wanted) {
      let ok = false
      try {
        ok = globalShortcut.register(wanted, () => void this.shoot('hotkey'))
      } catch {
        // An accelerator Electron cannot parse.
        ok = false
      }
      this.registered = ok ? wanted : null
    }

    const chord = wanted ? parseAccelerator(wanted) : null
    const mask = padMask(combo)
    const watcher = this.nativeWatcher()
    watcher?.watch(chord, mask)
    const watching = !!watcher && !!chord

    let next: HotkeyState
    if (!s.screenshotHotkey) next = 'off'
    else if (!wanted) next = 'idle'
    else next = this.registered === wanted || watching ? 'active' : 'unavailable'

    if (next !== this.state) {
      this.state = next
      log(
        'shot',
        `hotkey ${s.screenshotHotkey || '(none)'}: ${next}` +
          (wanted
            ? ` (globalShortcut ${this.registered === wanted ? 'registered' : 'refused'}, key polling ${watching ? 'on' : 'off'})`
            : '')
      )
      for (const fn of this.stateListeners) fn(next)
    }
    return next
  }

  /** Settings is recording a new hotkey or combo — let those presses through meanwhile. */
  suspend(suspended: boolean, kind: ShortcutKind): HotkeyState {
    this.suspended[kind] = suspended
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
    this.watcher?.stop()
    this.closeOverlay()
    hdrCapture.dispose()
  }

  /** Capture the screen under the pointer — where a running game almost always is. */
  private async grab(display: Display): Promise<Grabbed | null> {
    if (hdrCapture.usable) {
      // Whatever goes wrong on the HDR path, the ordinary capture is still there.
      const grabbed = await this.grabHdr(display).catch((err: unknown) => {
        log('shot', 'HDR capture failed, taking an ordinary one', err)
        return null
      })
      if (grabbed) return grabbed
    }
    const scale = display.scaleFactor || 1
    const thumbnailSize = {
      width: Math.round(display.size.width * scale),
      height: Math.round(display.size.height * scale)
    }
    try {
      const sources = await within(
        desktopCapturer.getSources({ types: ['screen'], thumbnailSize, fetchWindowIcons: false }),
        CAPTURE_TIMEOUT_MS,
        'desktopCapturer'
      )
      const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
      if (source && !source.thumbnail.isEmpty()) return { image: source.thumbnail, jxr: null }
      log('shot', `desktopCapturer returned no image (${sources.length} screen${sources.length === 1 ? '' : 's'})`)
      return null
    } catch (err) {
      log('shot', 'desktopCapturer failed', err)
      return null
    }
  }

  /** The screen through the capture process if it is in HDR; null for SDR screens and failures. */
  private async grabHdr(display: Display): Promise<Grabbed | null> {
    const keepHdr = store.settings.screenshotHdr === 'jxr'
    const reply = await hdrCapture.capture(physicalBounds(display), keepHdr)
    if (reply.kind === 'failed') log('shot', `HDR capture failed, taking an ordinary one: ${reply.reason}`)
    if (reply.kind !== 'image') return null
    log(
      'shot',
      `HDR screen ${reply.device}: SDR white ${Math.round(reply.sdrWhiteNits)} nits, ` +
        `brightest ${Math.round(reply.peakNits)} nits` +
        (reply.jxr
          ? `, kept as HDR (JPEG XR, ${(reply.jxr.byteLength / 1e6).toFixed(1)} MB)`
          : reply.toneMapped
            ? ', highlights rolled off'
            : '') +
        ` (${reply.ms} ms)`
    )
    if (keepHdr && !reply.jxr) log('shot', `could not keep it as HDR, saving it remapped to SDR: ${reply.jxrError}`)
    const pixels = Buffer.from(reply.pixels.buffer, reply.pixels.byteOffset, reply.pixels.byteLength)
    const image = nativeImage.createFromBitmap(pixels, { width: reply.width, height: reply.height })
    if (image.isEmpty()) return null
    const jxr = reply.jxr ? Buffer.from(reply.jxr.buffer, reply.jxr.byteOffset, reply.jxr.byteLength) : null
    return { image, jxr }
  }

  /**
   * Where every shortcut ends up, and the test button in Settings too. A
   * press that two watchers both saw takes a single picture.
   */
  async shoot(source: string): Promise<ScreenshotResult> {
    const now = Date.now()
    if (this.busy || now - this.lastShot < COOLDOWN_MS) return { ok: false, error: 'BUSY' }
    this.lastShot = now
    const result = await this.capture()
    if (!result.ok && result.error !== 'BUSY') log('shot', `${source}: ${result.error}`)
    return result
  }

  private async capture(): Promise<ScreenshotResult> {
    if (this.busy) return { ok: false, error: 'BUSY' }
    this.busy = true
    try {
      // The card of the previous shot must not end up in this one.
      if (this.overlay && !this.overlay.isDestroyed() && this.overlay.isVisible()) {
        this.overlay.hide()
        await delay(120)
      }

      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      const result = await this.captureOn(display)
      if (!result.ok) this.failed(result.error, display)
      return result
    } finally {
      this.busy = false
    }
  }

  /** Say so, in the game as well as in Storm — otherwise a failed shot looks like a press that did nothing. */
  private failed(error: ScreenshotError, display: Display): void {
    for (const fn of this.failListeners) fn(error)
    if (!store.settings.screenshotNotify) return
    const lang = store.settings.language
    const detail: TranslationKey = error === 'WRITE_FAILED' ? 'shot.writeFailed' : 'shot.captureFailed'
    void this.flash(display, {
      heading: translate(lang, 'shot.failed'),
      detail: translate(lang, detail),
      preview: null,
      error: true
    })
  }

  private async captureOn(display: Display): Promise<ScreenshotResult> {
    const grabbed = await this.grab(display)
    if (!grabbed) return { ok: false, error: 'CAPTURE_FAILED' }
    const { image, jxr } = grabbed

    const gameId = launcher.latestGameId
    const game = gameId ? store.getGame(gameId) : undefined
    const settings = store.settings
    const ext = jxr ? 'jxr' : settings.screenshotFormat === 'jpg' ? 'jpg' : 'png'
    const dir = this.folderFor(game?.id ?? null)
    const base = `${safeFileName(game?.title ?? 'Storm')} ${timestamp(new Date())}`

    let file = ''
    try {
      const data = jxr ?? (ext === 'jpg' ? image.toJPEG(92) : image.toPNG())
      file = await within(writeUnique(dir, base, ext, data), SAVE_TIMEOUT_MS, 'saving')
    } catch (err) {
      log('shot', `could not save to ${dir}`, err)
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
    if (settings.screenshotNotify) {
      const lang = settings.language
      void this.flash(display, {
        heading: translate(lang, jxr ? 'shot.savedHdr' : 'shot.saved'),
        detail: game?.title ?? translate(lang, 'shot.desktop'),
        preview,
        error: false
      })
    }
    return { ok: true, shot }
  }

  /**
   * A small card in the corner of the game's screen, the way Steam confirms a
   * screenshot. It never takes focus, so the game keeps its input.
   */
  private async flash(
    display: Display,
    card: { heading: string; detail: string; preview: Buffer | null; error: boolean }
  ): Promise<void> {
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
      const html = overlayHtml({
        heading: card.heading,
        detail: card.detail,
        accent: card.error ? ERROR_ACCENT : store.settings.accent,
        preview: card.preview ? `data:image/jpeg;base64,${card.preview.toString('base64')}` : null,
        error: card.error
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

const ERROR_ACCENT = '#f87171'

function overlayHtml(o: {
  heading: string
  detail: string
  accent: string
  preview: string | null
  error: boolean
}): string {
  const accent = /^#[0-9a-f]{6}$/i.test(o.accent) ? o.accent : '#38bdf8'
  const image = o.preview ? `<img src="${o.preview}" alt="">` : `<div class="ph">${o.error ? '!' : ''}</div>`
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:transparent;overflow:hidden;font-family:'Segoe UI Variable Text','Segoe UI','Microsoft YaHei UI',sans-serif}
  .card{position:absolute;inset:6px;display:flex;align-items:center;gap:12px;padding:10px 14px 10px 10px;border-radius:14px;
    background:rgba(12,14,22,.92);border:1px solid rgba(255,255,255,.12);box-shadow:0 10px 30px rgba(0,0,0,.45);
    animation:in .32s cubic-bezier(.16,1,.3,1) both, out .4s ease ${OVERLAY_MS - 450}ms forwards}
  .card::before{content:'';position:absolute;left:0;top:14px;bottom:14px;width:3px;border-radius:3px;background:${accent}}
  img,.ph{flex:none;width:96px;height:54px;border-radius:8px;object-fit:cover;background:#1e2230}
  .ph{display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800;color:${accent}}
  .t{min-width:0;display:flex;flex-direction:column;gap:2px}
  .h{font-size:13px;font-weight:700;color:#fff}
  .d{font-size:12px;color:rgba(255,255,255,.62);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .error .d{white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
  @keyframes in{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:none}}
  @keyframes out{to{opacity:0;transform:translateX(16px)}}
  </style></head><body><div class="card${o.error ? ' error' : ''}">${image}<div class="t"><span class="h">${escapeHtml(o.heading)}</span><span class="d">${escapeHtml(o.detail)}</span></div></div></body></html>`
}

export const screenshots = new ScreenshotService()
