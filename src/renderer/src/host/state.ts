import { useMemo } from 'react'
import { create } from 'zustand'
import { useStorm } from '../store/useStorm'
import { playUi, type UiSound } from '../utils/sound'
import { rumble } from './input'
import type { Game, LaunchError, Language, ScreenshotInfo } from '@shared/types'
import type { TranslationKey } from '@shared/i18n'

/** Where host mode is: its home screen and the three places reached from it. */
export type HostPage = 'home' | 'detail' | 'album' | 'settings'

/** The rows of the home screen, switched with LB / RB. */
export type Collection = 'recent' | 'favorites' | 'installed' | 'az'
export const COLLECTIONS: Collection[] = ['recent', 'favorites', 'installed', 'az']

/** The round buttons under the games. */
export type SystemItem = 'album' | 'settings' | 'power'
export const SYSTEM_ITEMS: SystemItem[] = ['album', 'settings', 'power']

interface HostState {
  page: HostPage
  /** The game picked on the home row — and the one the detail page shows. */
  gameId: string | null
  collection: Collection
  /** Which home row has the focus: the games, or the round buttons under them. */
  homeRow: 'games' | 'system'
  systemIndex: number
  viewer: { shots: ScreenshotInfo[]; index: number } | null
  /** The game whose "starting" screen is up. */
  launching: string | null
  powerOpen: boolean

  reset: () => void
  go: (page: HostPage) => void
  pick: (gameId: string | null) => void
  setCollection: (collection: Collection) => void
  setHomeRow: (row: 'games' | 'system', systemIndex?: number) => void
  openViewer: (shots: ScreenshotInfo[], index: number) => void
  closeViewer: () => void
  setLaunching: (gameId: string | null) => void
  setPowerOpen: (open: boolean) => void
}

export const useHost = create<HostState>((set) => ({
  page: 'home',
  gameId: null,
  collection: 'recent',
  homeRow: 'games',
  systemIndex: 0,
  viewer: null,
  launching: null,
  powerOpen: false,

  reset: () => set({ page: 'home', homeRow: 'games', systemIndex: 0, viewer: null, launching: null, powerOpen: false }),
  go: (page) => set({ page }),
  pick: (gameId) => set({ gameId }),
  setCollection: (collection) => set({ collection }),
  setHomeRow: (homeRow, systemIndex) => set(systemIndex === undefined ? { homeRow } : { homeRow, systemIndex }),
  openViewer: (shots, index) => set({ viewer: { shots, index } }),
  closeViewer: () => set({ viewer: null }),
  setLaunching: (launching) => set({ launching }),
  setPowerOpen: (powerOpen) => set({ powerOpen })
}))

/** An interface sound, if the player wants them. */
export function sound(name: UiSound): void {
  if (useStorm.getState().settings.hostSounds) playUi(name)
}

/** Can't go that way: a dull knock, and the faintest rumble. */
export function bump(): void {
  sound('bump')
  rumble('bump')
}

const collators = new Map<Language, Intl.Collator>()

function byTitle(language: Language): (a: Game, b: Game) => number {
  let collator = collators.get(language)
  if (!collator) {
    collator = new Intl.Collator(language === 'zh' ? 'zh-CN' : 'en', { numeric: true, sensitivity: 'base' })
    collators.set(language, collator)
  }
  return (a, b) => collator.compare(a.title, b.title)
}

/**
 * The games of a collection, in the order the home row shows them. Hidden
 * games never appear in host mode: the private shelf stays private when the
 * whole room can see the screen.
 */
export function collectionGames(games: Game[], collection: Collection, language: Language): Game[] {
  const visible = games.filter((g) => !g.hidden)
  const title = byTitle(language)
  switch (collection) {
    case 'recent':
      // Like a console: what was played last comes first, and a game just
      // added counts as new until it has been played.
      return visible.sort(
        (a, b) => (b.lastPlayedAt ?? b.addedAt).localeCompare(a.lastPlayedAt ?? a.addedAt) || title(a, b)
      )
    case 'favorites':
      return visible.filter((g) => g.favorite).sort(title)
    case 'installed':
      return visible.filter((g) => g.installed).sort(title)
    case 'az':
      return visible.sort(title)
  }
}

export function useCollectionGames(): Game[] {
  const games = useStorm((s) => s.games)
  const language = useStorm((s) => s.settings.language)
  const collection = useHost((s) => s.collection)
  return useMemo(() => collectionGames(games, collection, language), [games, collection, language])
}

const LAUNCH_ERRORS: Record<LaunchError, TranslationKey> = {
  NO_EXE: 'host.noExe',
  NOT_FOUND: 'toast.launchFailed',
  ALREADY_RUNNING: 'toast.alreadyRunning',
  SPAWN_FAILED: 'toast.launchFailed'
}

/** Start a game from host mode: the "starting" screen, then the game takes over. */
export async function playGame(game: Game): Promise<void> {
  const storm = useStorm.getState()
  const { t, toast } = storm
  if (storm.running.some((r) => r.gameId === game.id)) {
    bump()
    toast(t('host.alreadyRunning', { title: game.title }), 'info')
    return
  }
  if (!game.exePath) {
    bump()
    toast(t('host.noExe'), 'error')
    return
  }
  if (!game.installed) {
    bump()
    toast(t('host.notInstalled'), 'error')
    return
  }
  sound('launch')
  rumble('launch')
  useHost.getState().setLaunching(game.id)
  const result = await window.storm.launch(game.id)
  if (!result.ok) {
    useHost.getState().setLaunching(null)
    toast(t(LAUNCH_ERRORS[result.error]), 'error')
  }
}

/** LB / RB switch between the rows of the home screen. */
export function cycleCollection(delta: number): void {
  const host = useHost.getState()
  const storm = useStorm.getState()
  const i = COLLECTIONS.indexOf(host.collection)
  const next = COLLECTIONS[(i + delta + COLLECTIONS.length) % COLLECTIONS.length]
  const list = collectionGames(storm.games, next, storm.settings.language)
  host.setCollection(next)
  // The same game stays picked if the new row has it; otherwise the row starts at its beginning.
  host.pick(list.some((g) => g.id === host.gameId) ? host.gameId : (list[0]?.id ?? null))
  sound('tab')
}

/** Screenshots that may be shown in host mode: none of hidden games. */
export function visibleShots(shots: ScreenshotInfo[], games: Game[]): ScreenshotInfo[] {
  const hidden = new Set(games.filter((g) => g.hidden).map((g) => g.id))
  return shots.filter((s) => !s.gameId || !hidden.has(s.gameId))
}
