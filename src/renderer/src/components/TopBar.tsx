import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStorm, useT } from '../store/useStorm'
import type { SortKey } from '@shared/types'
import type { TranslationKey } from '@shared/i18n'
import {
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  CloseWindowIcon,
  MaximizeIcon,
  MinimizeIcon,
  PlusIcon,
  RestoreIcon,
  SearchIcon
} from './icons'

const SORT_OPTIONS: { key: SortKey; label: TranslationKey }[] = [
  { key: 'title', label: 'sort.title' },
  { key: 'addedAt', label: 'sort.addedAt' },
  { key: 'lastPlayed', label: 'sort.lastPlayed' },
  { key: 'playtime', label: 'sort.playtime' },
  { key: 'playCount', label: 'sort.playCount' }
]

export default function TopBar(): React.JSX.Element {
  const query = useStorm((s) => s.query)
  const setQuery = useStorm((s) => s.setQuery)
  const sort = useStorm((s) => s.sort)
  const setSort = useStorm((s) => s.setSort)
  const openForm = useStorm((s) => s.openForm)
  const section = useStorm((s) => s.section)
  const t = useT()

  const [menuOpen, setMenuOpen] = useState(false)
  const [windowState, setWindowState] = useState<'maximized' | 'normal'>('normal')
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.storm.windowState().then(setWindowState)
    return window.storm.on('storm:window-state', (payload) =>
      setWindowState(payload === 'maximized' ? 'maximized' : 'normal')
    )
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const currentSortLabel = t(SORT_OPTIONS.find((o) => o.key === sort)?.label ?? 'sort.title')

  return (
    <div className="topbar">
      <div className="titlebar">
        <div className="titlebar-left">
          <span className="titlebar-title">{section === 'settings' ? t('settings.title') : t('nav.library')}</span>
        </div>
        <div className="titlebar-right">
          <button
            type="button"
            className="win-btn"
            onClick={() => void window.storm.windowAction('minimize')}
            aria-label="Minimize"
          >
            <MinimizeIcon size={14} />
          </button>
          <button
            type="button"
            className="win-btn"
            onClick={() => void window.storm.windowAction('maximize')}
            aria-label="Maximize"
          >
            {windowState === 'maximized' ? <RestoreIcon size={14} /> : <MaximizeIcon size={14} />}
          </button>
          <button
            type="button"
            className="win-btn win-btn--close"
            onClick={() => void window.storm.windowAction('close')}
            aria-label="Close"
          >
            <CloseWindowIcon size={14} />
          </button>
        </div>
      </div>

      <div className="toolbar">
        <div className="search">
          <SearchIcon size={16} className="search-icon" />
          <input
            className="search-input"
            value={query}
            placeholder={t('action.search')}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
          />
          {query && (
            <motion.button
              type="button"
              className="search-clear"
              onClick={() => setQuery('')}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
            >
              <CloseIcon size={13} />
            </motion.button>
          )}
        </div>

        <div className="toolbar-right">
          <div className="menu-wrap" ref={menuRef}>
            <button
              type="button"
              className={`btn btn--ghost btn--sort${menuOpen ? ' is-open' : ''}`}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <span className="sort-label">{currentSortLabel}</span>
              <ChevronIcon size={14} className="sort-chevron" />
            </button>
            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  className="menu"
                  initial={{ opacity: 0, y: -6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                >
                  {SORT_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={`menu-item${option.key === sort ? ' is-active' : ''}`}
                      onClick={() => {
                        setSort(option.key)
                        setMenuOpen(false)
                      }}
                    >
                      <span>{t(option.label)}</span>
                      {option.key === sort && <CheckIcon size={14} />}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <motion.button
            type="button"
            className="btn btn--primary"
            onClick={() => openForm()}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.97 }}
          >
            <PlusIcon size={16} />
            <span>{t('action.addGame')}</span>
          </motion.button>
        </div>
      </div>
    </div>
  )
}
