import { motion } from 'framer-motion'
import { useMemo } from 'react'
import { useStorm, useT } from '../store/useStorm'
import type { Game } from '@shared/types'
import { coverSrc, formatPlaytime, hueFromString, initials } from '../utils/format'
import { wallItem } from '../motion'
import { FolderIcon, HeartIcon, PencilIcon, PlayIcon, TrashIcon } from './icons'

interface Props {
  game: Game
}

export default function GameCard({ game }: Props): React.JSX.Element {
  const t = useT()
  const select = useStorm((s) => s.select)
  const openForm = useStorm((s) => s.openForm)
  const askDelete = useStorm((s) => s.requestDelete)
  const launchGame = useStorm((s) => s.launchGame)
  const toggleFavorite = useStorm((s) => s.toggleFavorite)
  const openFolder = useStorm((s) => s.openFolder)
  const running = useStorm((s) => s.running)

  const isRunning = running.some((r) => r.gameId === game.id)
  const cover = coverSrc(game.cover)
  const hue = useMemo(() => hueFromString(game.title), [game.title])

  const open = (): void => select(game.id)

  return (
    // The wrapper owns the grid reflow animation; the card inside owns the
    // entrance and hover. Keeping them separate stops the two transforms
    // from fighting each other.
    <motion.div className="card-wrap" layout="position">
      <motion.article
        className={`card${game.installed ? '' : ' is-missing'}${isRunning ? ' is-running' : ''}`}
        variants={wallItem}
        whileHover={{ y: -8, scale: 1.025 }}
        whileTap={{ scale: 0.98 }}
        onClick={open}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            open()
          }
        }}
      >
      <motion.div className="card-poster" layoutId={`poster-${game.id}`}>
        {cover ? (
          <img className="card-img" src={cover} alt={game.title} loading="lazy" draggable={false} />
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

        <div className="card-shade" />

        <div className="card-top">
          <span className={`chip ${game.installed ? 'chip--ok' : 'chip--muted'}`}>
            <span className="chip-dot" />
            {game.installed ? t('state.installed') : t('state.notInstalled')}
          </span>
          <button
            type="button"
            className={`icon-btn card-fav${game.favorite ? ' is-on' : ''}`}
            title={game.favorite ? t('action.unfavorite') : t('action.favorite')}
            onClick={(e) => {
              e.stopPropagation()
              void toggleFavorite(game.id)
            }}
          >
            <HeartIcon size={15} />
          </button>
        </div>

        <div className="card-bottom">
          <h3 className="card-title" title={game.title}>
            {game.title}
          </h3>
          <div className="card-meta">
            {game.playtimeMinutes > 0 ? (
              <span>{formatPlaytime(game.playtimeMinutes, t)}</span>
            ) : (
              <span className="muted">{t('state.neverPlayed')}</span>
            )}
            {game.playCount > 0 && <span className="dot">•</span>}
            {game.playCount > 0 && <span>{game.playCount}</span>}
          </div>
        </div>

        <div className="card-overlay">
          <motion.button
            type="button"
            className="card-play"
            title={t('action.play')}
            onClick={(e) => {
              e.stopPropagation()
              void launchGame(game.id)
            }}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.94 }}
          >
            <PlayIcon size={20} />
          </motion.button>
          <div className="card-actions">
            <button
              type="button"
              className="icon-btn"
              title={t('action.edit')}
              onClick={(e) => {
                e.stopPropagation()
                openForm(game.id)
              }}
            >
              <PencilIcon size={15} />
            </button>
            <button
              type="button"
              className="icon-btn"
              title={t('action.openInstall')}
              onClick={(e) => {
                e.stopPropagation()
                void openFolder('install', game.id)
              }}
            >
              <FolderIcon size={15} />
            </button>
            <button
              type="button"
              className="icon-btn icon-btn--danger"
              title={t('action.delete')}
              onClick={(e) => {
                e.stopPropagation()
                void askDelete(game.id)
              }}
            >
              <TrashIcon size={15} />
            </button>
          </div>
        </div>

        {isRunning && (
          <div className="card-live">
            <span className="live-dot" />
            {t('state.playing')}
          </div>
        )}
        </motion.div>
      </motion.article>
    </motion.div>
  )
}
