import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useStorm, useT } from '../store/useStorm'
import type { FilterKey } from '@shared/types'
import type { TranslationKey } from '@shared/i18n'
import { countByFilter, totalPlaytime, visibleGames } from '../utils/selectors'
import { formatPlaytime } from '../utils/format'
import {
  BoltIcon,
  CheckIcon,
  ClockIcon,
  EyeOffIcon,
  FolderIcon,
  GridIcon,
  HeartIcon,
  PlayIcon,
  SettingsIcon,
  SparkIcon
} from './icons'

const NAV_ITEMS: { key: FilterKey; label: TranslationKey; icon: React.JSX.Element }[] = [
  { key: 'all', label: 'nav.all', icon: <GridIcon size={17} /> },
  { key: 'favorite', label: 'nav.favorites', icon: <HeartIcon size={17} /> },
  { key: 'installed', label: 'nav.installed', icon: <CheckIcon size={17} /> },
  { key: 'notInstalled', label: 'nav.notInstalled', icon: <SparkIcon size={17} /> },
  { key: 'played', label: 'nav.played', icon: <PlayIcon size={15} /> },
  { key: 'unplayed', label: 'nav.unplayed', icon: <ClockIcon size={17} /> }
]

export default function Sidebar(): React.JSX.Element {
  const games = useStorm((s) => s.games)
  const filter = useStorm((s) => s.filter)
  const setFilter = useStorm((s) => s.setFilter)
  const setSection = useStorm((s) => s.setSection)
  const section = useStorm((s) => s.section)
  const running = useStorm((s) => s.running)
  const t = useT()

  const counts = useMemo(() => countByFilter(games), [games])
  const playtime = useMemo(() => totalPlaytime(visibleGames(games)), [games])

  const pick = (key: FilterKey): void => {
    setSection('library')
    setFilter(key)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <motion.div
          className="brand-mark"
          initial={{ rotate: -12, opacity: 0 }}
          animate={{ rotate: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 16 }}
        >
          <BoltIcon size={20} />
        </motion.div>
        <div className="brand-text">
          <span className="brand-name">STORM</span>
          <span className="brand-sub">game library</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-label">{t('nav.sections')}</div>
        {NAV_ITEMS.map((item, index) => {
          const active = section === 'library' && filter === item.key
          return (
            <motion.button
              key={item.key}
              type="button"
              className={`nav-item${active ? ' is-active' : ''}`}
              onClick={() => pick(item.key)}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.04 * index, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              whileTap={{ scale: 0.98 }}
            >
              {active && (
                <motion.span
                  className="nav-pill"
                  layoutId="nav-pill"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                />
              )}
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-text">{t(item.label)}</span>
              <span className="nav-count">{counts[item.key]}</span>
            </motion.button>
          )
        })}
        {counts.hidden > 0 && (
          <div className="nav-private">
            <div className="nav-sep" />
            <motion.button
              type="button"
              className="nav-item nav-item--private"
              onClick={() => pick('hidden')}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              whileTap={{ scale: 0.98 }}
            >
              {section === 'library' && filter === 'hidden' && (
                <motion.span
                  className="nav-pill"
                  layoutId="nav-pill"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                />
              )}
              <span className="nav-icon">
                <EyeOffIcon size={17} />
              </span>
              <span className="nav-text">{t('nav.hidden')}</span>
              <span className="nav-count">{counts.hidden}</span>
            </motion.button>
          </div>
        )}
      </nav>

      <div className="sidebar-stats">
        <div className="stat-card">
          <span className="stat-value">{counts.all}</span>
          <span className="stat-label">{t('stats.games')}</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{counts.installed}</span>
          <span className="stat-label">{t('stats.installed')}</span>
        </div>
        <div className="stat-card stat-card--wide">
          <span className="stat-value stat-value--sm">{formatPlaytime(playtime, t)}</span>
          <span className="stat-label">{t('stats.playtime')}</span>
        </div>
        {running.length > 0 && (
          <div className="stat-live">
            <span className="live-dot" />
            {running.length} {t('state.playing')}
          </div>
        )}
      </div>

      <button
        type="button"
        className={`sidebar-settings${section === 'settings' ? ' is-active' : ''}`}
        onClick={() => setSection(section === 'settings' ? 'library' : 'settings')}
      >
        {section === 'settings' && <motion.span className="nav-pill" layoutId="nav-pill" />}
        <SettingsIcon size={17} />
        <span>{t('nav.settings')}</span>
      </button>
    </aside>
  )
}
