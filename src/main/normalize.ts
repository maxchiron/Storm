import { randomUUID } from 'node:crypto'
import { DEFAULT_SETTINGS, POSTER_SIZES } from '@shared/types'
import { THEME_IDS } from '@shared/themes'
import type { AppSettings, Game, GameInput, ScreenshotRecord, SessionRecord } from '@shared/types'

/**
 * Everything that crosses a trust boundary — the library file on disk, an
 * imported JSON file, or a payload from the renderer — goes through here, so
 * the rest of the main process can rely on well-formed records. A hand-edited
 * or half-written library must never crash the UI (`game.tags.map` on a
 * missing array) or smuggle a path into the media folder.
 */

type Loose = Record<string, unknown>

function isObject(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function optPath(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function count(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  return Number.isNaN(Date.parse(value)) ? null : value
}

/** Media files are always `<uuid-ish>.<ext>` names inside Storm's own folders. */
export function mediaName(value: unknown): string | null {
  return typeof value === 'string' && /^[\w-]+\.[a-z0-9]{2,5}$/i.test(value) ? value : null
}

/** Trim, drop empties and duplicates (case-insensitively), keep the first spelling. */
export function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of value) {
    if (typeof raw !== 'string') continue
    const tag = raw.trim().slice(0, 40)
    const key = tag.toLowerCase()
    if (!tag || seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  return out.slice(0, 32)
}

export function normalizeGame(raw: unknown): Game | null {
  if (!isObject(raw)) return null
  const now = new Date().toISOString()
  const id = str(raw.id).trim()
  return {
    id: id || randomUUID(),
    title: str(raw.title).trim() || 'Untitled',
    cover: mediaName(raw.cover),
    banner: mediaName(raw.banner),
    exePath: optPath(raw.exePath),
    args: str(raw.args).trim(),
    installPath: optPath(raw.installPath),
    savePath: optPath(raw.savePath),
    installed: bool(raw.installed),
    played: bool(raw.played),
    favorite: bool(raw.favorite),
    hidden: bool(raw.hidden),
    playCount: count(raw.playCount),
    playtimeMinutes: count(raw.playtimeMinutes),
    firstPlayedAt: isoDate(raw.firstPlayedAt),
    lastPlayedAt: isoDate(raw.lastPlayedAt),
    tags: cleanTags(raw.tags),
    note: str(raw.note),
    addedAt: isoDate(raw.addedAt) ?? now,
    updatedAt: isoDate(raw.updatedAt) ?? now
  }
}

/** Normalise a list of games, dropping junk and giving duplicate ids a fresh one. */
export function normalizeGames(raw: unknown): Game[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: Game[] = []
  for (const item of raw) {
    const game = normalizeGame(item)
    if (!game) continue
    if (seen.has(game.id)) game.id = randomUUID()
    seen.add(game.id)
    out.push(game)
  }
  return out
}

/** Keep only the editable fields of a renderer payload, each with the right type. */
export function cleanGameInput(raw: unknown): GameInput {
  if (!isObject(raw)) return {}
  const input: GameInput = {}
  if (typeof raw.title === 'string') input.title = raw.title.trim()
  if ('cover' in raw) input.cover = mediaName(raw.cover)
  if ('banner' in raw) input.banner = mediaName(raw.banner)
  if ('exePath' in raw) input.exePath = optPath(raw.exePath)
  if (typeof raw.args === 'string') input.args = raw.args.trim()
  if ('installPath' in raw) input.installPath = optPath(raw.installPath)
  if ('savePath' in raw) input.savePath = optPath(raw.savePath)
  if (typeof raw.played === 'boolean') input.played = raw.played
  if (typeof raw.favorite === 'boolean') input.favorite = raw.favorite
  if (typeof raw.hidden === 'boolean') input.hidden = raw.hidden
  if (Array.isArray(raw.tags)) input.tags = cleanTags(raw.tags)
  if (typeof raw.note === 'string') input.note = raw.note
  return input
}

const HEX = /^#[0-9a-f]{6}$/i

/** Themes that existed before 1.0.4, mapped onto their closest successor. */
const LEGACY_THEMES: Record<string, AppSettings['theme']> = {
  midnight: 'storm'
}

/**
 * Merge a settings patch into a base, keeping only valid values. Unknown keys
 * are dropped and a bad value leaves the current one in place.
 */
export function sanitizeSettings(patch: unknown, base: AppSettings = DEFAULT_SETTINGS): AppSettings {
  const next: AppSettings = { ...base, screenshotPadCombo: [...base.screenshotPadCombo] }
  if (!isObject(patch)) return next
  const p = patch

  if (p.language === 'zh' || p.language === 'en') next.language = p.language
  if (typeof p.theme === 'string') {
    const theme = LEGACY_THEMES[p.theme] ?? p.theme
    if ((THEME_IDS as string[]).includes(theme)) next.theme = theme as AppSettings['theme']
  }
  if (p.appearance === 'dark' || p.appearance === 'light' || p.appearance === 'system') next.appearance = p.appearance
  if (typeof p.accent === 'string' && HEX.test(p.accent)) next.accent = p.accent.toLowerCase()
  if ((POSTER_SIZES as unknown[]).includes(p.posterSize)) next.posterSize = p.posterSize as AppSettings['posterSize']
  if (typeof p.scanIntervalSeconds === 'number' && Number.isFinite(p.scanIntervalSeconds)) {
    next.scanIntervalSeconds = Math.min(600, Math.max(2, Math.round(p.scanIntervalSeconds)))
  }
  for (const key of [
    'minimizeToTray',
    'confirmBeforeDelete',
    'reduceMotion',
    'screenshotOnlyWhilePlaying',
    'screenshotSound',
    'screenshotNotify',
    'startInHostMode',
    'hostSounds'
  ] as const) {
    if (typeof p[key] === 'boolean') next[key] = p[key] as boolean
  }
  if (typeof p.screenshotHotkey === 'string' && p.screenshotHotkey.length <= 64) {
    next.screenshotHotkey = p.screenshotHotkey.trim()
  }
  if (Array.isArray(p.screenshotPadCombo)) {
    const buttons = p.screenshotPadCombo.filter((b): b is number => Number.isInteger(b) && b >= 0 && b <= 16)
    next.screenshotPadCombo = [...new Set(buttons)].slice(0, 4).sort((a, b) => a - b)
  }
  if (typeof p.screenshotDir === 'string') next.screenshotDir = p.screenshotDir.trim()
  if (p.screenshotFormat === 'png' || p.screenshotFormat === 'jpg') next.screenshotFormat = p.screenshotFormat
  if (p.screenshotHdr === 'sdr' || p.screenshotHdr === 'jxr') next.screenshotHdr = p.screenshotHdr
  return next
}

export function normalizeSessions(raw: unknown, gameIds?: Set<string>): SessionRecord[] {
  if (!Array.isArray(raw)) return []
  const out: SessionRecord[] = []
  for (const item of raw) {
    if (!isObject(item)) continue
    const gameId = str(item.gameId)
    const startedAt = isoDate(item.startedAt)
    const endedAt = isoDate(item.endedAt)
    if (!gameId || !startedAt || !endedAt) continue
    if (gameIds && !gameIds.has(gameId)) continue
    out.push({
      id: str(item.id) || randomUUID(),
      gameId,
      startedAt,
      endedAt,
      minutes: count(item.minutes),
      interrupted: bool(item.interrupted)
    })
  }
  return out
}

export function normalizeScreenshots(raw: unknown): ScreenshotRecord[] {
  if (!Array.isArray(raw)) return []
  const out: ScreenshotRecord[] = []
  for (const item of raw) {
    if (!isObject(item)) continue
    const file = optPath(item.file)
    const takenAt = isoDate(item.takenAt)
    if (!file || !takenAt) continue
    out.push({
      id: str(item.id) || randomUUID(),
      gameId: typeof item.gameId === 'string' && item.gameId ? item.gameId : null,
      file,
      thumb: mediaName(item.thumb),
      preview: mediaName(item.preview),
      takenAt
    })
  }
  return out
}
