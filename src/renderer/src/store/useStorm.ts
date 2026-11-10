import { useCallback } from 'react'
import { create } from 'zustand'
import { DEFAULT_SETTINGS } from '@shared/types'
import type {
  AppSettings,
  FilterKey,
  Game,
  GameDraft,
  GameFileResult,
  HotkeyState,
  Language,
  MediaError,
  MediaResult,
  RunningSession,
  SortKey
} from '@shared/types'
import { fill, translate, type TranslationKey } from '@shared/i18n'

export interface Toast {
  id: string
  type: 'info' | 'success' | 'error'
  message: string
}

export type Section = 'library' | 'settings'

/** What a new-game form starts out with: a dropped game file, a dropped poster, or both. */
export interface FormSeed {
  draft?: GameDraft
  cover?: string
}

const MEDIA_ERRORS: Record<MediaError, TranslationKey> = {
  UNSUPPORTED: 'toast.imageUnsupported',
  TOO_LARGE: 'toast.imageTooLarge',
  DOWNLOAD_FAILED: 'toast.imageDownloadFailed',
  FAILED: 'toast.imageFailed'
}

/** Windows paths compare case-insensitively and with either slash. */
export function samePath(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  const norm = (p: string): string => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
  return norm(a) === norm(b)
}

interface StormState {
  ready: boolean
  games: Game[]
  settings: AppSettings
  running: RunningSession[]
  dataDir: string
  hotkey: HotkeyState
  section: Section
  selectedId: string | null
  filter: FilterKey
  sort: SortKey
  query: string
  formOpen: boolean
  editingId: string | null
  formSeed: FormSeed | null
  confirmId: string | null
  toasts: Toast[]
  /** Bumped whenever a screenshot lands, so open galleries reload. */
  shotVersion: number
  /** Settings is recording a controller combo; the live combo must not fire meanwhile. */
  padRecording: boolean
  /** Host mode: full screen, controller-driven and read-only. */
  hostMode: boolean

  init: () => Promise<void>
  setGames: (games: Game[]) => void
  setSettings: (settings: AppSettings) => void
  setRunning: (running: RunningSession[]) => void
  setHotkey: (state: HotkeyState) => void
  setSection: (section: Section) => void
  select: (id: string | null) => void
  setFilter: (filter: FilterKey) => void
  setSort: (sort: SortKey) => void
  setQuery: (query: string) => void
  openForm: (id?: string | null, seed?: FormSeed | null) => void
  closeForm: () => void
  askDelete: (id: string | null) => void
  requestDelete: (id: string) => Promise<void>
  deleteGame: (id: string) => Promise<void>
  toast: (message: string, type?: Toast['type']) => void
  dismissToast: (id: string) => void
  t: (key: TranslationKey, values?: Record<string, string | number>) => string
  mediaResult: (result: MediaResult | null) => string | null
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  launchGame: (id: string) => Promise<void>
  togglePlayed: (id: string) => Promise<void>
  toggleFavorite: (id: string) => Promise<void>
  setHidden: (id: string, hidden: boolean) => Promise<void>
  openFolder: (kind: 'install' | 'save' | 'data' | 'screenshots', id?: string) => Promise<void>
  revealPath: (target: string) => Promise<void>
  copyPath: (target: string) => Promise<void>
  addGameFiles: (paths: string[]) => Promise<void>
  bumpShots: () => void
  setPadRecording: (on: boolean) => void
  /** Ask the main process to enter or leave host mode. */
  setHostMode: (on: boolean) => Promise<void>
  /** The main process says host mode went on or off. */
  hostChanged: (on: boolean) => void
}

let toastSeq = 0

function fileError(results: GameFileResult[]): TranslationKey {
  const failure = results.find((r) => !r.ok)
  if (failure && !failure.ok) {
    if (failure.error === 'BROKEN_SHORTCUT') return 'toast.brokenShortcut'
    if (failure.error === 'NOT_FOUND') return 'toast.exeNotFound'
  }
  return 'toast.notGameFile'
}

export const useStorm = create<StormState>((set, get) => ({
  ready: false,
  games: [],
  settings: { ...DEFAULT_SETTINGS },
  running: [],
  dataDir: '',
  hotkey: 'off',
  section: 'library',
  selectedId: null,
  filter: 'all',
  sort: 'title',
  query: '',
  formOpen: false,
  editingId: null,
  formSeed: null,
  confirmId: null,
  toasts: [],
  shotVersion: 0,
  padRecording: false,
  hostMode: false,

  init: async () => {
    const snapshot = await window.storm.getSnapshot()
    set({
      games: snapshot.games,
      settings: snapshot.settings,
      running: snapshot.running,
      dataDir: snapshot.dataDir,
      hotkey: snapshot.hotkey,
      hostMode: snapshot.host,
      ready: true
    })
    if (snapshot.recoveredFrom) get().toast(get().t('toast.recovered', { path: snapshot.recoveredFrom }), 'error')
  },

  setGames: (games) =>
    set((s) => ({
      games,
      // A game that disappeared (deleted elsewhere, or by an import) closes its views.
      selectedId: s.selectedId && games.some((g) => g.id === s.selectedId) ? s.selectedId : null,
      confirmId: s.confirmId && games.some((g) => g.id === s.confirmId) ? s.confirmId : null
    })),
  setSettings: (settings) => set({ settings }),
  setRunning: (running) => set({ running }),
  setHotkey: (hotkey) => set({ hotkey }),
  setSection: (section) => set({ section, selectedId: null }),
  select: (selectedId) => set({ selectedId }),
  setFilter: (filter) => set({ filter }),
  setSort: (sort) => set({ sort }),
  setQuery: (query) => set({ query }),
  openForm: (editingId = null, seed = null) => set({ formOpen: true, editingId, formSeed: editingId ? null : seed }),
  closeForm: () => set({ formOpen: false, editingId: null, formSeed: null }),
  askDelete: (confirmId) => set({ confirmId }),

  requestDelete: async (id) => {
    if (get().settings.confirmBeforeDelete) {
      get().askDelete(id)
      return
    }
    await get().deleteGame(id)
  },

  deleteGame: async (id) => {
    await window.storm.deleteGame(id)
    set((s) => ({
      selectedId: s.selectedId === id ? null : s.selectedId,
      confirmId: null
    }))
    get().toast(get().t('toast.deleted'), 'success')
  },

  toast: (message, type = 'info') => {
    const id = `t${++toastSeq}`
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, type, message }] }))
    // Errors stay up a little longer — they usually say what to do next.
    setTimeout(() => get().dismissToast(id), type === 'error' ? 6000 : 3600)
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  t: (key, values) => {
    const text = translate(get().settings.language, key)
    return values ? fill(text, values) : text
  },

  /** Toast the error of a failed image import; returns the stored name on success. */
  mediaResult: (result) => {
    if (!result) return null
    if (result.ok) return result.name
    get().toast(get().t(MEDIA_ERRORS[result.error]), 'error')
    return null
  },

  updateSettings: async (patch) => {
    const next = await window.storm.updateSettings(patch)
    set({ settings: next })
  },

  launchGame: async (id) => {
    const result = await window.storm.launch(id)
    const t = get().t
    if (result.ok) {
      get().toast(t('toast.launched'), 'info')
      return
    }
    const key: TranslationKey =
      result.error === 'NO_EXE'
        ? 'toast.noExe'
        : result.error === 'ALREADY_RUNNING'
          ? 'toast.alreadyRunning'
          : 'toast.launchFailed'
    get().toast(t(key), 'error')
  },

  togglePlayed: async (id) => {
    await window.storm.togglePlayed(id)
  },

  toggleFavorite: async (id) => {
    await window.storm.toggleFavorite(id)
  },

  setHidden: async (id, hidden) => {
    await window.storm.setHidden(id, hidden)
    get().toast(get().t(hidden ? 'toast.hidden' : 'toast.unhidden'), 'success')
  },

  openFolder: async (kind, id) => {
    const ok = await window.storm.openFolder(kind, id)
    if (!ok) get().toast(get().t('toast.pathMissing'), 'error')
  },

  revealPath: async (target) => {
    const ok = await window.storm.reveal(target)
    if (!ok) get().toast(get().t('toast.pathMissing'), 'error')
  },

  copyPath: async (target) => {
    await window.storm.copyPath(target)
    get().toast(get().t('toast.copied'), 'success')
  },

  /**
   * Game files dropped onto the window. One file opens the add form, filled
   * in; several are added straight away so a whole folder of shortcuts goes
   * in with one drag.
   */
  addGameFiles: async (paths) => {
    const { t, toast } = get()
    const results = await window.storm.inspectGameFiles(paths)
    const drafts = results.flatMap((r) => (r.ok ? [r.draft] : []))
    if (drafts.length === 0) {
      toast(t(fileError(results)), 'error')
      return
    }
    const known = (d: GameDraft): Game | undefined => get().games.find((g) => samePath(g.exePath, d.exePath))

    if (drafts.length === 1) {
      const draft = drafts[0]
      const existing = known(draft)
      if (existing) {
        toast(t('toast.gameExists', { title: existing.title }), 'info')
        if (existing.hidden) set({ filter: 'hidden', section: 'library' })
        set({ selectedId: existing.id })
        return
      }
      get().openForm(null, { draft })
      return
    }

    let added = 0
    const seen: GameDraft[] = []
    for (const draft of drafts) {
      if (known(draft) || seen.some((d) => samePath(d.exePath, draft.exePath))) continue
      seen.push(draft)
      try {
        await window.storm.saveGame({
          title: draft.title,
          exePath: draft.exePath,
          args: draft.args,
          installPath: draft.installPath || null
        })
        added++
      } catch {
        /* keep going with the rest */
      }
    }
    if (added === 0) {
      toast(t('toast.gameExists', { title: drafts[0].title }), 'info')
      return
    }
    toast(t('toast.gamesAdded', { count: added }), 'success')
  },

  bumpShots: () => set((s) => ({ shotVersion: s.shotVersion + 1 })),
  setPadRecording: (padRecording) => set({ padRecording }),

  setHostMode: async (on) => {
    get().hostChanged(await window.storm.setHostMode(on))
  },

  hostChanged: (on) => {
    if (on === get().hostMode) return
    // The PC views' overlays do not carry over: host mode starts on its home
    // screen, and leaving it comes back to the wall.
    set(on ? { hostMode: true, selectedId: null, confirmId: null } : { hostMode: false })
  }
}))

export type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string

/** Translate using the language currently selected in settings (stable between renders). */
export function useT(): Translate {
  const language = useStorm((s) => s.settings.language)
  return useCallback<Translate>(
    (key, values) => {
      const text = translate(language, key)
      return values ? fill(text, values) : text
    },
    [language]
  )
}

export function useLanguage(): Language {
  return useStorm((s) => s.settings.language)
}
