import { app } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { AppSettings, Game, ScreenshotRecord, SessionRecord } from '@shared/types'
import { normalizeGames, normalizeScreenshots, normalizeSessions, sanitizeSettings } from './normalize'

export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

export interface Db {
  version: number
  games: Game[]
  settings: AppSettings
  sessions: SessionRecord[]
  screenshots: ScreenshotRecord[]
  window: WindowBounds | null
}

const DB_VERSION = 2
const MAX_SESSIONS = 2000

function emptyDb(): Db {
  return {
    version: DB_VERSION,
    games: [],
    settings: { ...DEFAULT_SETTINGS },
    sessions: [],
    screenshots: [],
    window: null
  }
}

function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code
}

export class Store {
  private _dataDir: string | null = null
  private data: Db = emptyDb()
  private saveTimer: NodeJS.Timeout | null = null
  /** The write loop currently running, if any. */
  private writing: Promise<void> | null = null
  /** Something changed since the last write started. */
  private dirty = false
  /**
   * Nothing is written until the library has been read. Without this guard a
   * process that quits before `init()` finishes — a second instance, or a
   * start-up error — would flush its *empty* in-memory library over the
   * user's real one.
   */
  private loaded = false
  /** Set by the final synchronous flush on quit; later async writes are dropped. */
  private closed = false
  /** The backup made when the library file could not be parsed. */
  private _recoveredFrom: string | null = null

  /** Resolved lazily so the store can be constructed before app ready. */
  get dataDir(): string {
    if (!this._dataDir) this._dataDir = app.getPath('userData')
    return this._dataDir
  }

  get coversDir(): string {
    return path.join(this.dataDir, 'covers')
  }

  get bannersDir(): string {
    return path.join(this.dataDir, 'banners')
  }

  /** Small previews of screenshots; the full images live in the screenshot folder. */
  get thumbsDir(): string {
    return path.join(this.dataDir, 'thumbs')
  }

  private get dbFile(): string {
    return path.join(this.dataDir, 'library.json')
  }

  get isLoaded(): boolean {
    return this.loaded
  }

  get recoveredFrom(): string | null {
    return this._recoveredFrom
  }

  async init(): Promise<void> {
    await fsp.mkdir(this.coversDir, { recursive: true })
    await fsp.mkdir(this.bannersDir, { recursive: true })
    await fsp.mkdir(this.thumbsDir, { recursive: true })

    let raw: string
    try {
      raw = await fsp.readFile(this.dbFile, 'utf8')
    } catch (err) {
      if (errorCode(err) === 'ENOENT') {
        // First run — start with an empty library.
        this.loaded = true
        return
      }
      // The file exists but cannot be read (permissions, a locked file…).
      // Stay read-only rather than replace it with an empty library.
      console.error('[storm] cannot read the library; changes will not be saved', err)
      return
    }

    try {
      this.data = this.fromJson(JSON.parse(raw))
    } catch (err) {
      // A damaged file is moved aside, never overwritten, so it can be
      // recovered by hand. Storm then starts with an empty library.
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const backup = path.join(this.dataDir, `library.corrupt-${stamp}.json`)
      try {
        await fsp.rename(this.dbFile, backup)
        this._recoveredFrom = backup
        console.error(`[storm] library was unreadable; moved it to ${backup}`, err)
      } catch (renameErr) {
        console.error('[storm] library is unreadable and could not be backed up; staying read-only', renameErr)
        return
      }
    }
    this.loaded = true
  }

  private fromJson(parsed: unknown): Db {
    const obj = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Partial<Record<keyof Db, unknown>>
    const games = normalizeGames(obj.games)
    const ids = new Set(games.map((g) => g.id))
    return {
      version: DB_VERSION,
      games,
      settings: sanitizeSettings(obj.settings),
      sessions: normalizeSessions(obj.sessions, ids),
      screenshots: normalizeScreenshots(obj.screenshots),
      window: this.windowFromJson(obj.window)
    }
  }

  private windowFromJson(raw: unknown): WindowBounds | null {
    if (typeof raw !== 'object' || raw === null) return null
    const w = raw as Record<string, unknown>
    const num = (v: unknown): number | undefined =>
      typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined
    const width = num(w.width)
    const height = num(w.height)
    if (!width || !height) return null
    return { x: num(w.x), y: num(w.y), width, height, maximized: w.maximized === true }
  }

  get games(): Game[] {
    return this.data.games
  }

  get settings(): AppSettings {
    return this.data.settings
  }

  get sessions(): SessionRecord[] {
    return this.data.sessions
  }

  get screenshots(): ScreenshotRecord[] {
    return this.data.screenshots
  }

  get windowBounds(): WindowBounds | null {
    return this.data.window
  }

  setWindowBounds(bounds: WindowBounds): void {
    this.data.window = bounds
    this.scheduleSave()
  }

  getGame(id: string): Game | undefined {
    return this.data.games.find((g) => g.id === id)
  }

  /** Mutate the database and schedule a debounced atomic save. */
  mutate<T>(fn: (db: Db) => T): T {
    const result = fn(this.data)
    this.scheduleSave()
    return result
  }

  addSession(record: SessionRecord): void {
    this.data.sessions.push(record)
    if (this.data.sessions.length > MAX_SESSIONS) {
      this.data.sessions.splice(0, this.data.sessions.length - MAX_SESSIONS)
    }
    this.scheduleSave()
  }

  /**
   * Replace the library with an imported one. Play sessions and screenshots
   * that belong to games which no longer exist are dropped.
   */
  replace(next: { games: unknown; settings?: unknown; sessions?: unknown }): void {
    const games = normalizeGames(next.games)
    const ids = new Set(games.map((g) => g.id))
    this.data.games = games
    if (next.settings !== undefined) this.data.settings = sanitizeSettings(next.settings)
    this.data.sessions = normalizeSessions(next.sessions ?? this.data.sessions, ids)
    this.data.screenshots = this.data.screenshots.filter((s) => s.gameId === null || ids.has(s.gameId))
    this.scheduleSave()
  }

  updateSettings(patch: unknown): AppSettings {
    this.data.settings = sanitizeSettings(patch, this.data.settings)
    this.scheduleSave()
    return this.data.settings
  }

  /** The data that goes into an export file. */
  exportData(): {
    version: number
    exportedAt: string
    games: Game[]
    settings: AppSettings
    sessions: SessionRecord[]
  } {
    return {
      version: DB_VERSION,
      exportedAt: new Date().toISOString(),
      games: this.data.games,
      settings: this.data.settings,
      sessions: this.data.sessions
    }
  }

  newGameId(): string {
    return randomUUID()
  }

  scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.save()
    }, 150)
  }

  /**
   * Write the database atomically (temp file + rename) so a crash never
   * truncates the library.
   *
   * Calls made while a write is in flight are not dropped: they mark the data
   * dirty and the running loop writes again once it finishes, so the promise
   * every caller gets settles only after its own changes are on disk.
   */
  save(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (!this.loaded || this.closed) return Promise.resolve()
    this.dirty = true
    if (!this.writing) {
      this.writing = this.writeLoop().finally(() => {
        this.writing = null
      })
    }
    return this.writing
  }

  private async writeLoop(): Promise<void> {
    while (this.dirty && !this.closed) {
      this.dirty = false
      const payload = JSON.stringify(this.data, null, 2)
      const tmp = `${this.dbFile}.${process.pid}.${Date.now()}.tmp`
      try {
        await fsp.writeFile(tmp, payload, 'utf8')
        if (this.closed) {
          // saveSync() already wrote the final state; don't rename an older copy over it.
          await fsp.unlink(tmp).catch(() => undefined)
          return
        }
        await fsp.rename(tmp, this.dbFile)
      } catch (err) {
        console.error('[storm] failed to save library', err)
        await fsp.unlink(tmp).catch(() => undefined)
      }
    }
  }

  /** Blocking final flush, used on app quit. No async write lands after it. */
  saveSync(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (!this.loaded || this.closed) return
    this.closed = true
    const payload = JSON.stringify(this.data, null, 2)
    const tmp = `${this.dbFile}.${process.pid}.sync.tmp`
    try {
      fs.writeFileSync(tmp, payload, 'utf8')
      fs.renameSync(tmp, this.dbFile)
    } catch (err) {
      console.error('[storm] failed to flush library', err)
      try {
        fs.unlinkSync(tmp)
      } catch {
        /* ignore */
      }
    }
  }
}

export const store = new Store()
