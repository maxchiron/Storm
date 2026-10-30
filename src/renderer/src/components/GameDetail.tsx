import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStorm, useT } from '../store/useStorm'
import { bannerSrc, coverSrc, formatDate, formatDateTime, formatElapsed, formatPlaytime, hueFromString, initials, truncatePath } from '../utils/format'
import { EASE, SPRING_SOFT } from '../motion'
import {
  ChevronIcon,
  ClockIcon,
  CopyIcon,
  ExternalIcon,
  FolderIcon,
  HeartIcon,
  PencilIcon,
  PlayIcon,
  SparkIcon,
  TrashIcon
} from './icons'

function useElapsed(startedAt: string | undefined): string {
  const t = useT()
  const [value, setValue] = useState(() => (startedAt ? formatElapsed(startedAt, t) : ''))
  useEffect(() => {
    if (!startedAt) return
    setValue(formatElapsed(startedAt, t))
    const id = setInterval(() => setValue(formatElapsed(startedAt, t)), 1000)
    return () => clearInterval(id)
  }, [startedAt, t])
  return value
}

function PathRow({
  label,
  value,
  onReveal,
  onCopy
}: {
  label: string
  value: string | null
  onReveal: (v: string) => void
  onCopy: (v: string) => void
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="path-row">
      <div className="path-meta">
        <span className="path-label">{label}</span>
        <span className="path-value" title={value ?? ''}>
          {value ? truncatePath(value) : t('common.unknown')}
        </span>
      </div>
      {value && (
        <div className="path-actions">
          <button type="button" className="icon-btn" title={t('action.reveal')} onClick={() => onReveal(value)}>
            <ExternalIcon size={14} />
          </button>
          <button type="button" className="icon-btn" title={t('action.copy')} onClick={() => onCopy(value)}>
            <CopyIcon size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

export default function GameDetail(): React.JSX.Element {
  const selectedId = useStorm((s) => s.selectedId)
  const games = useStorm((s) => s.games)
  const running = useStorm((s) => s.running)
  const select = useStorm((s) => s.select)
  const openForm = useStorm((s) => s.openForm)
  const requestDelete = useStorm((s) => s.requestDelete)
  const launchGame = useStorm((s) => s.launchGame)
  const toggleFavorite = useStorm((s) => s.toggleFavorite)
  const togglePlayed = useStorm((s) => s.togglePlayed)
  const openFolder = useStorm((s) => s.openFolder)
  const revealPath = useStorm((s) => s.revealPath)
  const copyPath = useStorm((s) => s.copyPath)
  const language = useStorm((s) => s.settings.language)
  const t = useT()

  const game = useMemo(() => games.find((g) => g.id === selectedId) ?? null, [games, selectedId])
  const session = running.find((r) => r.gameId === selectedId)
  const elapsed = useElapsed(session?.startedAt)

  useEffect(() => {
    if (!selectedId) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') select(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, select])

  const cover = coverSrc(game?.cover)
  const banner = bannerSrc(game?.banner)
  const hue = useMemo(() => hueFromString(game?.title ?? ''), [game?.title])

  return (
    <AnimatePresence>
      {game && (
        <motion.div
          className="detail-overlay"
          key={game.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          <motion.div
            className="detail-backdrop"
            initial={{ scale: 1.06, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 1.04, opacity: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
          >
            {banner ? (
              <div className="detail-bg" style={{ backgroundImage: `url("${banner}")` }} />
            ) : cover ? (
              <div className="detail-bg" style={{ backgroundImage: `url("${cover}")` }} />
            ) : (
              <div
                className="detail-bg"
                style={{
                  background: `linear-gradient(140deg, hsl(${hue} 55% 26%), hsl(${(hue + 60) % 360} 50% 10%))`
                }}
              />
            )}
          </motion.div>
          <div className="detail-scrim" />

          <motion.div
            className="detail-scroll"
            initial={{ y: 26, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 18, opacity: 0 }}
            transition={SPRING_SOFT}
          >
            <header className="detail-bar">
              <button type="button" className="detail-back" onClick={() => select(null)}>
                <ChevronIcon size={15} className="detail-back-icon" />
                {t('detail.back')}
              </button>
              <div className="detail-bar-actions">
                <button
                  type="button"
                  className={`icon-btn${game.favorite ? ' is-on' : ''}`}
                  title={game.favorite ? t('action.unfavorite') : t('action.favorite')}
                  onClick={() => void toggleFavorite(game.id)}
                >
                  <HeartIcon size={16} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title={t('action.edit')}
                  onClick={() => openForm(game.id)}
                >
                  <PencilIcon size={16} />
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn--danger"
                  title={t('action.delete')}
                  onClick={() => void requestDelete(game.id)}
                >
                  <TrashIcon size={16} />
                </button>
              </div>
            </header>

            <div className="detail-body">
              <motion.div className="detail-poster" layoutId={`poster-${game.id}`}>
                {cover ? (
                  <img src={cover} alt={game.title} draggable={false} />
                ) : (
                  <div
                    className="card-fallback"
                    style={{
                      background: `linear-gradient(150deg, hsl(${hue} 62% 34%), hsl(${(hue + 48) % 360} 58% 18%))`
                    }}
                  >
                    <span className="card-fallback-text">{initials(game.title)}</span>
                  </div>
                )}
              </motion.div>

              <div className="detail-main">
                <div className="detail-badges">
                  <span className={`chip ${game.installed ? 'chip--ok' : 'chip--muted'}`}>
                    <span className="chip-dot" />
                    {game.installed ? t('state.installed') : t('state.notInstalled')}
                  </span>
                  <span className={`chip ${game.played ? 'chip--accent' : 'chip--muted'}`}>
                    {game.played ? t('state.played') : t('state.unplayed')}
                  </span>
                  {session && (
                    <span className="chip chip--live">
                      <span className="live-dot" />
                      {t('state.playing')} · {elapsed}
                    </span>
                  )}
                </div>

                <h1 className="detail-title">{game.title}</h1>

                <div className="detail-actions">
                  <motion.button
                    type="button"
                    className="btn btn--play"
                    onClick={() => void launchGame(game.id)}
                    whileHover={{ y: -2, scale: 1.02 }}
                    whileTap={{ scale: 0.97 }}
                  >
                    <PlayIcon size={17} />
                    {session ? t('state.playing') : t('action.play')}
                  </motion.button>
                  <motion.button
                    type="button"
                    className={`btn btn--ghost${game.played ? ' is-active' : ''}`}
                    onClick={() => void togglePlayed(game.id)}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.97 }}
                  >
                    <SparkIcon size={16} />
                    {game.played ? t('action.markUnplayed') : t('action.markPlayed')}
                  </motion.button>
                  <motion.button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => void openFolder('install', game.id)}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.97 }}
                  >
                    <FolderIcon size={16} />
                    {t('action.openInstall')}
                  </motion.button>
                  <motion.button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => void openFolder('save', game.id)}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.97 }}
                  >
                    <FolderIcon size={16} />
                    {t('action.openSave')}
                  </motion.button>
                </div>

                <div className="detail-stats">
                  <div className="stat-tile">
                    <span className="stat-tile-value">{formatPlaytime(game.playtimeMinutes, t)}</span>
                    <span className="stat-tile-label">{t('detail.playtime')}</span>
                  </div>
                  <div className="stat-tile">
                    <span className="stat-tile-value">{game.playCount}</span>
                    <span className="stat-tile-label">{t('detail.sessions')}</span>
                  </div>
                  <div className="stat-tile">
                    <span className="stat-tile-value stat-tile-value--sm">
                      {formatDate(game.lastPlayedAt, language, t)}
                    </span>
                    <span className="stat-tile-label">{t('detail.lastPlayed')}</span>
                  </div>
                  <div className="stat-tile">
                    <span className="stat-tile-value stat-tile-value--sm">
                      {formatDate(game.addedAt, language, t)}
                    </span>
                    <span className="stat-tile-label">{t('detail.added')}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="detail-sections">
              <section className="panel">
                <h3 className="panel-title">{t('detail.paths')}</h3>
                <div className="path-list">
                  <PathRow
                    label={t('form.exe')}
                    value={game.exePath}
                    onReveal={(v) => void revealPath(v)}
                    onCopy={(v) => void copyPath(v)}
                  />
                  <PathRow
                    label={t('form.installPath')}
                    value={game.installPath}
                    onReveal={(v) => void revealPath(v)}
                    onCopy={(v) => void copyPath(v)}
                  />
                  <PathRow
                    label={t('form.savePath')}
                    value={game.savePath}
                    onReveal={(v) => void revealPath(v)}
                    onCopy={(v) => void copyPath(v)}
                  />
                </div>
                <p className="panel-hint">
                  {game.installed ? t('detail.installed') : t('detail.missing')}
                </p>
              </section>

              {game.tags.length > 0 && (
                <section className="panel">
                  <h3 className="panel-title">{t('detail.tags')}</h3>
                  <div className="tag-row">
                    {game.tags.map((tag) => (
                      <span className="tag" key={tag}>
                        {tag}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              <section className="panel">
                <h3 className="panel-title">{t('form.note')}</h3>
                {game.note ? (
                  <p className="note-text">{game.note}</p>
                ) : (
                  <p className="panel-hint">{t('detail.noData')}</p>
                )}
                {game.firstPlayedAt && (
                  <p className="panel-hint">
                    <ClockIcon size={13} /> {t('detail.firstPlayed')}: {formatDateTime(game.firstPlayedAt, language, t)}
                  </p>
                )}
              </section>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
