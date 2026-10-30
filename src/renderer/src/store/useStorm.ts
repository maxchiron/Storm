import { create } from 'zustand'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { AppSettings, FilterKey, Game, Language, RunningSession, SortKey } from '@shared/types'
import { translate, type TranslationKey } from '@shared/i18n'

export interface Toast {
  id: string
  type: 'info' | 'success' | 'error'
  message: string
}

export type Section = 'library' | 'settings'

interface StormState {
  ready: boolean
  games: Game[]
  settings: AppSettings
  running: RunningSession[]
  dataDir: string
  section: Section
  selectedId: string | null
  filter: FilterKey
  sort: SortKey
  query: string
  formOpen: boolean
  editingId: string | null
  confirmId: string | null
  toasts: Toast[]

  init: () => Promise<void>
  setGames: (games: Game[]) => void
  setSettings: (settings: AppSettings) => void
  setRunning: (running: RunningSession[]) => void
  setSection: (section: Section) => void
  select: (id: string | null) => void
  setFilter: (filter: FilterKey) => void
  setSort: (sort: SortKey) => void
  setQuery: (query: string) => void
  openForm: (id?: string | null) => void
  closeForm: () => void
  askDelete: (id: string | null) => void
  requestDelete: (id: string) => Promise<void>
  toast: (message: string, type?: Toast['type']) => void
  dismissToast: (id: string) => void
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  launchGame: (id: string) => Promise<void>
  togglePlayed: (id: string) => Promise<void>
  toggleFavorite: (id: string) => Promise<void>
  openFolder: (kind: 'install' | 'save' | 'data', id?: string) => Promise<void>
  revealPath: (target: string) => Promise<void>
  copyPath: (target: string) => Promise<void>
}

let toastSeq = 0

export const useStorm = create<StormState>((set, get) => ({
  ready: false,
  games: [],
  settings: { ...DEFAULT_SETTINGS },
  running: [],
  dataDir: '',
  section: 'library',
  selectedId: null,
  filter: 'all',
  sort: 'title',
  query: '',
  formOpen: false,
  editingId: null,
  confirmId: null,
  toasts: [],

  init: async () => {
    const snapshot = await window.storm.getSnapshot()
    set({
      games: snapshot.games,
      settings: snapshot.settings,
      running: snapshot.running,
      dataDir: snapshot.dataDir,
      ready: true
    })
  },

  setGames: (games) => set({ games }),
  setSettings: (settings) => set({ settings }),
  setRunning: (running) => set({ running }),
  setSection: (section) => set({ section, selectedId: null }),
  select: (selectedId) => set({ selectedId }),
  setFilter: (filter) => set({ filter }),
  setSort: (sort) => set({ sort }),
  setQuery: (query) => set({ query }),
  openForm: (editingId = null) => set({ formOpen: true, editingId }),
  closeForm: () => set({ formOpen: false, editingId: null }),
  askDelete: (confirmId) => set({ confirmId }),

  requestDelete: async (id) => {
    if (!get().settings.confirmBeforeDelete) {
      await window.storm.deleteGame(id)
      get().toast(translate(get().settings.language, 'toast.deleted'), 'success')
      return
    }
    get().askDelete(id)
  },

  toast: (message, type = 'info') => {
    const id = `t${++toastSeq}`
    set((s) => ({ toasts: [...s.toasts, { id, type, message }] }))
    setTimeout(() => get().dismissToast(id), 3600)
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  updateSettings: async (patch) => {
    const next = await window.storm.updateSettings(patch)
    set({ settings: next })
  },

  launchGame: async (id) => {
    const result = await window.storm.launch(id)
    const lang = get().settings.language
    if (result.ok) {
      get().toast(translate(lang, 'toast.launched'), 'info')
    } else {
      const key = result.error === 'NO_EXE' ? 'toast.noExe' : 'toast.launchFailed'
      get().toast(translate(lang, key), 'error')
    }
  },

  togglePlayed: async (id) => {
    await window.storm.togglePlayed(id)
  },

  toggleFavorite: async (id) => {
    await window.storm.toggleFavorite(id)
  },

  openFolder: async (kind, id) => {
    const ok = await window.storm.openFolder(kind, id)
    if (!ok) get().toast(translate(get().settings.language, 'toast.pathMissing'), 'error')
  },

  revealPath: async (target) => {
    const ok = await window.storm.reveal(target)
    if (!ok) get().toast(translate(get().settings.language, 'toast.pathMissing'), 'error')
  },

  copyPath: async (target) => {
    await window.storm.copyPath(target)
    get().toast(translate(get().settings.language, 'toast.copied'), 'success')
  }
}))

/** Translate using the language currently selected in settings. */
export function useT(): (key: TranslationKey) => string {
  const language = useStorm((s) => s.settings.language)
  return (key) => translate(language, key)
}

export function useLanguage(): Language {
  return useStorm((s) => s.settings.language)
}
