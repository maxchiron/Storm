export type Language = 'zh' | 'en'
export type PosterSize = 'sm' | 'md' | 'lg'
export type ThemeName = 'storm' | 'aurora' | 'nebula' | 'synthwave' | 'ember' | 'obsidian'
/** How the colour scheme is chosen: fixed, or following Windows. */
export type AppearanceMode = 'dark' | 'light' | 'system'
/** The scheme actually on screen once `system` has been resolved. */
export type ResolvedMode = 'dark' | 'light'
export type ScreenshotFormat = 'png' | 'jpg'
/** What a screenshot of a screen with HDR on is saved as: remapped to SDR (in screenshotFormat), or kept as HDR in JPEG XR. */
export type ScreenshotHdr = 'sdr' | 'jxr'
export type FilterKey = 'all' | 'installed' | 'notInstalled' | 'played' | 'unplayed' | 'favorite' | 'hidden'
export type SortKey = 'title' | 'addedAt' | 'lastPlayed' | 'playtime' | 'playCount'
export type MediaKind = 'covers' | 'banners'

export interface Game {
  id: string
  title: string
  /** file name inside the covers/ media folder */
  cover: string | null
  /** file name inside the banners/ media folder */
  banner: string | null
  exePath: string | null
  /** Extra command-line arguments passed to the executable. */
  args: string
  installPath: string | null
  savePath: string | null
  installed: boolean
  played: boolean
  favorite: boolean
  /** Kept off the wall — only shows up in the private shelf. */
  hidden: boolean
  playCount: number
  playtimeMinutes: number
  firstPlayedAt: string | null
  lastPlayedAt: string | null
  tags: string[]
  note: string
  addedAt: string
  updatedAt: string
}

/**
 * Fields the user can edit. Every field is optional on update; a new game
 * needs at least a title (it falls back to "Untitled").
 */
export interface GameInput {
  title?: string
  cover?: string | null
  banner?: string | null
  exePath?: string | null
  args?: string
  installPath?: string | null
  savePath?: string | null
  played?: boolean
  favorite?: boolean
  hidden?: boolean
  tags?: string[]
  note?: string
}

/** What Storm could work out about a dropped or picked .exe / .lnk. */
export interface GameDraft {
  title: string
  exePath: string
  args: string
  installPath: string
  /** The file the user actually handed over (the .lnk itself, for a shortcut). */
  source: string
}

export type GameFileError = 'UNSUPPORTED' | 'NOT_FOUND' | 'BROKEN_SHORTCUT'

export type GameFileResult = { ok: true; draft: GameDraft } | { ok: false; path: string; error: GameFileError }

export type MediaError = 'UNSUPPORTED' | 'TOO_LARGE' | 'DOWNLOAD_FAILED' | 'FAILED'

export type MediaResult = { ok: true; name: string } | { ok: false; error: MediaError }

export type LaunchError = 'NOT_FOUND' | 'NO_EXE' | 'ALREADY_RUNNING' | 'SPAWN_FAILED'

export interface AppSettings {
  language: Language
  theme: ThemeName
  appearance: AppearanceMode
  accent: string
  posterSize: PosterSize
  /** how often the install folders are polled, in seconds */
  scanIntervalSeconds: number
  minimizeToTray: boolean
  confirmBeforeDelete: boolean
  reduceMotion: boolean
  /** Electron accelerator for the screenshot hotkey; empty = off. */
  screenshotHotkey: string
  /** Standard-mapping gamepad buttons that must be held together; empty = off. */
  screenshotPadCombo: number[]
  /** Only listen for the screenshot shortcuts while a game started from Storm is running. */
  screenshotOnlyWhilePlaying: boolean
  /** Where screenshots go; empty = Pictures\Storm. */
  screenshotDir: string
  screenshotFormat: ScreenshotFormat
  screenshotHdr: ScreenshotHdr
  screenshotSound: boolean
  /** Flash a small "saved" card in the corner of the screen. */
  screenshotNotify: boolean
  /** Open straight into host mode — for a PC that lives under the TV. */
  startInHostMode: boolean
  /** Clicks and chimes as you move around host mode. */
  hostSounds: boolean
}

export interface SessionRecord {
  id: string
  gameId: string
  startedAt: string
  endedAt: string
  minutes: number
  interrupted: boolean
}

export interface ScreenshotRecord {
  id: string
  /** null when no game launched from Storm was running at the time */
  gameId: string | null
  /** absolute path of the full-size image */
  file: string
  /** file name of the small preview inside the thumbs/ media folder */
  thumb: string | null
  /**
   * A full-size SDR copy inside thumbs/, kept only for shots saved as JPEG XR
   * — no browser can show a .jxr, so the viewer shows this instead.
   */
  preview: string | null
  takenAt: string
}

/** A screenshot as the renderer sees it. */
export interface ScreenshotInfo {
  id: string
  gameId: string | null
  file: string
  thumbUrl: string | null
  /** The full-size picture, for the viewer. */
  url: string
  takenAt: string
}

export type ScreenshotError = 'BUSY' | 'CAPTURE_FAILED' | 'WRITE_FAILED'

export type ScreenshotResult = { ok: true; shot: ScreenshotInfo } | { ok: false; error: ScreenshotError }

/** Payload of the `storm:screenshot` event. */
export interface ScreenshotEvent {
  shot: ScreenshotInfo
  title: string | null
}

/**
 * Where the screenshot hotkey stands:
 *   off          no hotkey configured
 *   idle         configured, waiting for a game to start
 *   active       registered and listening
 *   unavailable  another program already owns that key combination
 */
export type HotkeyState = 'off' | 'idle' | 'active' | 'unavailable'

export interface RunningSession {
  gameId: string
  pid: number | null
  exePath: string
  startedAt: string
}

/** Payload of the `storm:session` event, sent when a play session ends. */
export interface SessionEvent {
  gameId: string
  minutes: number
  startedAt: string
  endedAt: string
}

export interface LibrarySnapshot {
  games: Game[]
  settings: AppSettings
  running: RunningSession[]
  dataDir: string
  hotkey: HotkeyState
  /** Whether the window is in host mode (fullscreen, controller-driven, read-only). */
  host: boolean
  /** Set when the library file was unreadable and Storm started from a backup copy. */
  recoveredFrom: string | null
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'zh',
  theme: 'storm',
  appearance: 'dark',
  accent: '#38bdf8',
  posterSize: 'md',
  scanIntervalSeconds: 10,
  minimizeToTray: true,
  confirmBeforeDelete: true,
  reduceMotion: false,
  screenshotHotkey: 'F12',
  // L3 + R3: clicking both sticks rarely opens anything in a game, so the
  // screenshot is not spoiled by a menu popping up.
  screenshotPadCombo: [10, 11],
  screenshotOnlyWhilePlaying: true,
  screenshotDir: '',
  screenshotFormat: 'png',
  // A PNG looks right everywhere; a .jxr needs an HDR-aware viewer.
  screenshotHdr: 'sdr',
  screenshotSound: true,
  screenshotNotify: true,
  startInHostMode: false,
  hostSounds: true
}

export const ACCENTS: { id: string; label: string; color: string }[] = [
  { id: 'storm', label: 'Storm', color: '#38bdf8' },
  { id: 'aurora', label: 'Aurora', color: '#34d399' },
  { id: 'violet', label: 'Nebula', color: '#a78bfa' },
  { id: 'neon', label: 'Neon', color: '#f472b6' },
  { id: 'ember', label: 'Ember', color: '#fb923c' },
  { id: 'rose', label: 'Rose', color: '#fb7185' },
  { id: 'gold', label: 'Gold', color: '#fbbf24' },
  { id: 'mono', label: 'Mono', color: '#e4e4e7' }
]

export const POSTER_SIZES: PosterSize[] = ['sm', 'md', 'lg']

/** Button names for the W3C "standard" gamepad mapping (Xbox layout). */
export const PAD_BUTTONS: Record<number, string> = {
  0: 'A',
  1: 'B',
  2: 'X',
  3: 'Y',
  4: 'LB',
  5: 'RB',
  6: 'LT',
  7: 'RT',
  8: 'View',
  9: 'Menu',
  10: 'L3',
  11: 'R3',
  12: '↑',
  13: '↓',
  14: '←',
  15: '→',
  16: 'Xbox'
}
