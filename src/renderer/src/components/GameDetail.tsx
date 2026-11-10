import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStorm, useT, type Translate } from '../store/useStorm'
import type { Game, ScreenshotInfo } from '@shared/types'
import {
  bannerSrc,
  coverSrc,
  formatDate,
  formatDateTime,
  formatElapsed,
  formatPlaytime,
  hueFromString,
  truncatePath
} from '../utils/format'
import { acceleratorLabel } from '../utils/accelerator'
import { comboKeys } from '../utils/gamepad'
import { EASE, SPRING_SOFT } from '../motion'
import Poster from './Poster'
import ScreenshotViewer from './ScreenshotViewer'
import {
  CameraIcon,
  ChevronIcon,
  ClockIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  ExternalIcon,
  FolderIcon,
  HeartIcon,
  PencilIcon,
  PlayIcon,
  SparkIcon,
  TrashIcon
} from './icons'

const GALLERY_LIMIT = 8

function useElapsed(startedAt: string | undefined, t: Translate): string {
  const [value, setValue] = useState(() => (startedAt ? formatElapsed(startedAt, t) : ''))
  useEffect(() => {
    if (!startedAt) return
    setValue(formatElapsed(startedAt, t))
    // Minutes are all it shows, so a slow tick is plenty.
    const id = setInterval(() => setValue(formatElapsed(startedAt, t)), 10_000)
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
  /** omitted for values that are not paths (launch options) */
  onReveal?: (v: string) => void
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
          {onReveal && (
            <button type="button" className="icon-btn" title={t('action.reveal')} onClick={() => onReveal(value)}>
              <ExternalIcon size={14} />
            </button>
          )}
          <button type="button" className="icon-btn" title={t('action.copy')} onClick={() => onCopy(value)}>
            <CopyIcon size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

/** The game's screenshots, newest first, reloaded whenever a new one lands. */
function Screenshots({ game }: { game: Game }): React.JSX.Element {
  const t = useT()
  const language = useStorm((s) => s.settings.language)
  const hotkey = useStorm((s) => s.settings.screenshotHotkey)
  const combo = useStorm((s) => s.settings.screenshotPadCombo)
  const shotVersion = useStorm((s) => s.shotVersion)
  const openFolder = useStorm((s) => s.openFolder)
  const [shots, setShots] = useState<ScreenshotInfo[] | null>(null)
  /** The viewer, open on this shot; it keeps the list it opened with while new shots land. */
  const [viewing, setViewing] = useState<{ shots: ScreenshotInfo[]; index: number } | null>(null)

  useEffect(() => {
    let alive = true
    void window.storm.listScreenshots(game.id).then((list) => {
      if (alive) setShots(list)
    })
    return () => {
      alive = false
    }
  }, [game.id, shotVersion])

  const shortcut = [hotkey ? acceleratorLabel(hotkey) : null, combo.length ? comboKeys(combo).join(' + ') : null]
    .filter(Boolean)
    .join(' / ')

  if (shots === null) return <section className="panel panel--shots" />

  return (
    <section className="panel panel--shots">
      <div className="panel-head">
        <h3 className="panel-title">
          {t('detail.screenshots')}
          {shots.length > 0 && <span className="panel-count">{shots.length}</span>}
        </h3>
        {shots.length > 0 && (
          <button type="button" className="btn btn--soft" onClick={() => void openFolder('screenshots', game.id)}>
            <FolderIcon size={14} />
            {t('action.openScreenshots')}
          </button>
        )}
      </div>
      {shots.length === 0 ? (
        <p className="panel-hint panel-hint--flush">
          <CameraIcon size={14} />
          {shortcut ? t('detail.noScreenshots', { shortcut }) : t('detail.noScreenshotsOff')}
        </p>
      ) : (
        <div className="shot-grid">
          {shots.slice(0, GALLERY_LIMIT).map((shot, i) => {
            const more = i === GALLERY_LIMIT - 1 ? shots.length - GALLERY_LIMIT : 0
            return (
              <motion.button
                type="button"
                key={shot.id}
                className="shot"
                title={formatDateTime(shot.takenAt, language, t)}
                onClick={() => setViewing({ shots, index: i })}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03, duration: 0.3, ease: EASE }}
              >
                {shot.thumbUrl ? <img src={shot.thumbUrl} alt="" draggable={false} /> : <CameraIcon size={20} />}
                {more > 0 && <span className="shot-more">{t('detail.moreScreenshots', { count: more + 1 })}</span>}
              </motion.button>
            )
          })}
        </div>
      )}
      <AnimatePresence>
        {viewing && <ScreenshotViewer shots={viewing.shots} index={viewing.index} onClose={() => setViewing(null)} />}
      </AnimatePresence>
    </section>
  )
}

export default function GameDetail(): React.JSX.Element {
  const selectedId = useStorm((s) => s.selectedId)
  const game = useStorm((s) => (s.selectedId ? (s.games.find((g) => g.id === s.selectedId) ?? null) : null))
  const session = useStorm((s) => s.running.find((r) => r.gameId === s.selectedId))
  const select = useStorm((s) => s.select)
  const openForm = useStorm((s) => s.openForm)
  const requestDelete = useStorm((s) => s.requestDelete)
  const launchGame = useStorm((s) => s.launchGame)
  const toggleFavorite = useStorm((s) => s.toggleFavorite)
  const setHidden = useStorm((s) => s.setHidden)
  const togglePlayed = useStorm((s) => s.togglePlayed)
  const openFolder = useStorm((s) => s.openFolder)
  const revealPath = useStorm((s) => s.revealPath)
  const copyPath = useStorm((s) => s.copyPath)
  const language = useStorm((s) => s.settings.language)
  const t = useT()
  const elapsed = useElapsed(session?.startedAt, t)

  const cover = coverSrc(game?.cover)
  const banner = bannerSrc(game?.banner)
  const hue = useMemo(() => hueFromString(game?.title ?? ''), [game?.title])

  return (
    <AnimatePresence>
      {game && selectedId && (
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
            {banner || cover ? (
              <div className="detail-bg" style={{ backgroundImage: `url("${banner ?? cover}")` }} />
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
                  className={`icon-btn icon-btn--private${game.hidden ? ' is-on' : ''}`}
                  title={game.hidden ? t('action.unhide') : t('action.hide')}
                  onClick={() => void setHidden(game.id, !game.hidden)}
                >
                  {game.hidden ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                </button>
                <button type="button" className="icon-btn" title={t('action.edit')} onClick={() => openForm(game.id)}>
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
                <Poster title={game.title} cover={game.cover} />
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
                  {game.hidden && (
                    <span className="chip chip--hidden">
                      <EyeOffIcon size={12} />
                      {t('state.hidden')}
                    </span>
                  )}
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
                    className={`btn btn--play${session ? ' is-running' : ''}`}
                    onClick={() => void launchGame(game.id)}
                    disabled={!!session}
                    whileHover={session ? undefined : { y: -2, scale: 1.02 }}
                    whileTap={session ? undefined : { scale: 0.97 }}
                  >
                    {session ? <span className="live-dot" /> : <PlayIcon size={17} />}
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
                    disabled={!game.installPath && !game.exePath}
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
                    disabled={!game.savePath}
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
                    <span className="stat-tile-value stat-tile-value--sm">{formatDate(game.addedAt, language, t)}</span>
                    <span className="stat-tile-label">{t('detail.added')}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="detail-sections">
              <Screenshots game={game} />

              <section className="panel">
                <h3 className="panel-title">{t('detail.paths')}</h3>
                <div className="path-list">
                  <PathRow
                    label={t('form.exe')}
                    value={game.exePath}
                    onReveal={(v) => void revealPath(v)}
                    onCopy={(v) => void copyPath(v)}
                  />
                  {game.args && <PathRow label={t('form.args')} value={game.args} onCopy={(v) => void copyPath(v)} />}
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
                <p className="panel-hint">{game.installed ? t('detail.installed') : t('detail.missing')}</p>
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
                  <p className="panel-hint">{t('detail.noNote')}</p>
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
