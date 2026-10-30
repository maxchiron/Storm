export type Language = 'zh' | 'en'
export type PosterSize = 'sm' | 'md' | 'lg'
export type ThemeName = 'storm' | 'midnight' | 'obsidian'
export type FilterKey =
  | 'all'
  | 'installed'
  | 'notInstalled'
  | 'played'
  | 'unplayed'
  | 'favorite'
  | 'hidden'
export type SortKey = 'title' | 'addedAt' | 'lastPlayed' | 'playtime' | 'playCount'
export type FolderKind = 'install' | 'save' | 'data'

export interface Game {
  id: string
  title: string
  /** file name inside the covers/ media folder */
  cover: string | null
  /** file name inside the banners/ media folder */
  banner: string | null
  exePath: string | null
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

export interface GameInput {
  title: string
  cover?: string | null
  banner?: string | null
  exePath?: string | null
  installPath?: string | null
  savePath?: string | null
  played?: boolean
  favorite?: boolean
  hidden?: boolean
  tags?: string[]
  note?: string
}

export interface AppSettings {
  language: Language
  theme: ThemeName
  accent: string
  posterSize: PosterSize
  /** how often the install folders are polled, in seconds */
  scanIntervalSeconds: number
  minimizeToTray: boolean
  confirmBeforeDelete: boolean
  reduceMotion: boolean
}

export interface SessionRecord {
  id: string
  gameId: string
  startedAt: string
  endedAt: string
  minutes: number
  interrupted: boolean
}

export interface RunningSession {
  gameId: string
  pid: number | null
  exePath: string
  startedAt: string
}

export interface LibrarySnapshot {
  games: Game[]
  settings: AppSettings
  running: RunningSession[]
  dataDir: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'zh',
  theme: 'storm',
  accent: '#38bdf8',
  posterSize: 'md',
  scanIntervalSeconds: 10,
  minimizeToTray: true,
  confirmBeforeDelete: true,
  reduceMotion: false
}

export const ACCENTS: { id: string; label: string; color: string }[] = [
  { id: 'storm', label: 'Storm', color: '#38bdf8' },
  { id: 'violet', label: 'Nebula', color: '#a78bfa' },
  { id: 'ember', label: 'Ember', color: '#fb923c' },
  { id: 'toxic', label: 'Toxic', color: '#4ade80' },
  { id: 'rose', label: 'Rose', color: '#fb7185' },
  { id: 'gold', label: 'Gold', color: '#fbbf24' }
]

export const POSTER_SIZES: PosterSize[] = ['sm', 'md', 'lg']
