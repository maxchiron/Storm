import { app } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { AppSettings, Game, SessionRecord } from '@shared/types'

interface Db {
  version: number
  games: Game[]
  settings: AppSettings
  sessions: SessionRecord[]
}

const DB_VERSION = 1

export class Store {
  private _dataDir: string | null = null
  private data: Db = { version: DB_VERSION, games: [], settings: { ...DEFAULT_SETTINGS }, sessions: [] }
  private saveTimer: NodeJS.Timeout | null = null
  private saving: Promise<void> | null = null

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

  private get dbFile(): string {
    return path.join(this.dataDir, 'library.json')
  }

  async init(): Promise<void> {
    await fsp.mkdir(this.coversDir, { recursive: true })
    await fsp.mkdir(this.bannersDir, { recursive: true })
    try {
      const raw = await fsp.readFile(this.dbFile, 'utf8')
      const parsed = JSON.parse(raw) as Partial<Db>
      this.data = {
        version: parsed.version ?? DB_VERSION,
        games: Array.isArray(parsed.games) ? parsed.games : [],
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : []
      }
    } catch {
      // no library yet — start clean
    }
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

  getGame(id: string): Game | undefined {
    return this.data.games.find((g) => g.id === id)
  }

  /** Mutate the database and schedule a debounced atomic save. */
  mutate<T>(fn: (db: Db) => T): T {
    const result = fn(this.data)
    this.scheduleSave()
    return result
  }

  /** Replace the whole database (used by import). */
  replace(next: { games?: Game[]; settings?: Partial<AppSettings> }): void {
    if (next.games) this.data.games = next.games
    if (next.settings) this.data.settings = { ...DEFAULT_SETTINGS, ...next.settings }
    this.scheduleSave()
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    this.data.settings = { ...this.data.settings, ...patch }
    this.scheduleSave()
    return this.data.settings
  }

  newGameId(): string {
    return randomUUID()
  }

  scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      void this.save()
    }, 150)
  }

  /** Write the database atomically so a crash never truncates the library. */
  async save(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (this.saving) {
      await this.saving
      return
    }
    const payload = JSON.stringify(this.data, null, 2)
    // A unique temp name keeps a concurrent flush from clobbering this write.
    const tmp = `${this.dbFile}.${process.pid}.${Date.now()}.tmp`
    this.saving = (async () => {
      try {
        await fsp.writeFile(tmp, payload, 'utf8')
        await fsp.rename(tmp, this.dbFile)
      } catch (err) {
        console.error('[storm] failed to save library', err)
        await fsp.unlink(tmp).catch(() => undefined)
      } finally {
        this.saving = null
      }
    })()
    await this.saving
  }

  /** Blocking flush used on app quit. */
  saveSync(): void {
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
