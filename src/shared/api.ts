import type {
  AppSettings,
  Game,
  GameFileResult,
  GameInput,
  HotkeyState,
  LaunchError,
  LibrarySnapshot,
  MediaKind,
  MediaResult,
  ResolvedMode,
  ScreenshotInfo,
  ScreenshotResult,
  ThemeName
} from './types'

export type FolderKind = 'install' | 'save' | 'data' | 'screenshots'

/** Colours the preload hands over before React mounts, so the boot screen matches the theme. */
export interface BootAppearance {
  theme: ThemeName
  mode: ResolvedMode
  accent: string
}

export interface StormApi {
  /** Theme to paint the boot screen with; null in the unlikely case the main process sent none. */
  boot: BootAppearance | null

  getSnapshot(): Promise<LibrarySnapshot>
  /** Create (no id) or update (with id) a game. On update only the given fields change. */
  saveGame(input: GameInput & { id?: string }): Promise<Game>
  deleteGame(id: string): Promise<void>
  togglePlayed(id: string): Promise<Game>
  toggleFavorite(id: string): Promise<Game>
  setHidden(id: string, hidden: boolean): Promise<Game>

  /** Native picker. null when cancelled. */
  pickImage(kind: MediaKind): Promise<MediaResult | null>
  /** Copy an image file (dropped, or pasted from Explorer) into the library. */
  importImageFile(kind: MediaKind, filePath: string): Promise<MediaResult>
  /** Store raw image bytes (a pasted bitmap, or a file without a path). */
  importImageData(kind: MediaKind, data: Uint8Array): Promise<MediaResult>
  /** Download an image dragged out of a web page (http, https or data: URL). */
  importImageUrl(kind: MediaKind, url: string): Promise<MediaResult>
  /** Open SteamGridDB's poster search for this title in the default browser. */
  searchPoster(title: string): Promise<boolean>
  /** Forget an image that was imported for a form that was then cancelled. */
  discardImage(kind: MediaKind, name: string): Promise<void>

  /** Native picker for the game executable; the result is already inspected. */
  pickExe(current?: string): Promise<GameFileResult | null>
  /** Work out title, install folder and arguments from .exe / .lnk files. */
  inspectGameFiles(paths: string[]): Promise<GameFileResult[]>
  /** The local path of a dropped File ('' for data that has no file behind it). */
  pathForFile(file: File): string
  pickDirectory(current?: string): Promise<string | null>

  launch(id: string): Promise<{ ok: true } | { ok: false; error: LaunchError }>
  openFolder(kind: FolderKind, id?: string): Promise<boolean>
  reveal(target: string): Promise<boolean>
  copyPath(target: string): Promise<boolean>

  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  recheck(id?: string): Promise<boolean>
  exportLibrary(): Promise<string | null>
  importLibrary(): Promise<LibrarySnapshot | null>

  takeScreenshot(): Promise<ScreenshotResult>
  listScreenshots(gameId: string): Promise<ScreenshotInfo[]>
  openScreenshot(id: string): Promise<boolean>
  pickScreenshotDir(): Promise<string | null>
  /** Pause the hotkey (or the controller combo) while Settings records a new one. */
  suspendHotkey(suspended: boolean, kind?: 'key' | 'pad'): Promise<HotkeyState>

  appVersion(): Promise<string>
  windowAction(action: 'minimize' | 'maximize' | 'close'): Promise<boolean>
  windowState(): Promise<'maximized' | 'normal'>
  on(channel: StormChannel, callback: (payload: unknown) => void): () => void
}

export const STORM_CHANNELS = [
  'storm:games',
  'storm:settings',
  'storm:running',
  'storm:session',
  'storm:window-state',
  'storm:screenshot',
  'storm:screenshot-failed',
  'storm:hotkey'
] as const

export type StormChannel = (typeof STORM_CHANNELS)[number]
