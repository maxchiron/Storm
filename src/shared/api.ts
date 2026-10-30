import type { AppSettings, Game, GameInput, LibrarySnapshot } from './types'

export interface StormApi {
  getSnapshot(): Promise<LibrarySnapshot>
  saveGame(input: GameInput & { id?: string }): Promise<Game>
  deleteGame(id: string): Promise<void>
  togglePlayed(id: string): Promise<Game>
  toggleFavorite(id: string): Promise<Game>
  setHidden(id: string, hidden: boolean): Promise<Game>
  setInstalled(id: string, installed: boolean): Promise<Game>
  pickImage(kind: 'covers' | 'banners'): Promise<string | null>
  pickExe(current?: string): Promise<string | null>
  pickDirectory(current?: string): Promise<string | null>
  launch(id: string): Promise<{ ok: boolean; error?: string }>
  openFolder(kind: 'install' | 'save' | 'data', id?: string): Promise<boolean>
  reveal(target: string): Promise<boolean>
  openFile(target: string): Promise<boolean>
  copyPath(target: string): Promise<boolean>
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  recheck(id?: string): Promise<boolean>
  exportLibrary(): Promise<string | null>
  importLibrary(): Promise<LibrarySnapshot | null>
  dataDir(): Promise<string>
  appVersion(): Promise<string>
  windowAction(action: 'minimize' | 'maximize' | 'close'): Promise<boolean>
  windowState(): Promise<'maximized' | 'normal'>
  on(channel: string, callback: (payload: unknown) => void): () => void
}

export const STORM_CHANNELS = [
  'storm:games',
  'storm:settings',
  'storm:running',
  'storm:session',
  'storm:installed',
  'storm:window-state'
] as const
