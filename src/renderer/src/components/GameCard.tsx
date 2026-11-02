import { motion } from 'framer-motion'
import { useStorm, useT } from '../store/useStorm'
import type { Game } from '@shared/types'
import { formatPlaytime } from '../utils/format'
import { wallItem } from '../motion'
import Poster from './Poster'
import { FolderIcon, HeartIcon, EyeIcon, EyeOffIcon, PencilIcon, PlayIcon, TrashIcon } from './icons'

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
  const setHidden = useStorm((s) => s.setHidden)
  const openFolder = useStorm((s) => s.openFolder)
  const isRunning = useStorm((s) => s.running.some((r) => r.gameId === game.id))

  const open = (): void => select(game.id)

  return (
    // The wrapper owns the grid reflow animation; the card inside owns the
    // entrance and hover. Keeping them separate stops the two transforms
    // from fighting each other.
    <motion.div className="card-wrap" layout="position">
      <motion.article
        className={`card${game.installed ? '' : ' is-missing'}${isRunning ? ' is-running' : ''}${game.hidden ? ' is-hidden' : ''}`}
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
        <motion.div className="card-poster on-art" layoutId={`poster-${game.id}`}>
          <Poster title={game.title} cover={game.cover} imgClassName="card-img" lazy />

          <div className="card-shade" />

          <div className="card-top">
            {isRunning ? (
              // A running game is installed by definition — the badge takes over
              // the chip slot so it never covers the corner buttons.
              <span className="chip chip--live">
                <span className="live-dot" />
                {t('state.playing')}
              </span>
            ) : (
              <span className={`chip ${game.installed ? 'chip--ok' : 'chip--muted'}`}>
                <span className="chip-dot" />
                {game.installed ? t('state.installed') : t('state.notInstalled')}
              </span>
            )}
            <div className="card-top-actions">
              <button
                type="button"
                className={`icon-btn card-hide${game.hidden ? ' is-on' : ''}`}
                title={game.hidden ? t('action.unhide') : t('action.hide')}
                onClick={(e) => {
                  e.stopPropagation()
                  void setHidden(game.id, !game.hidden)
                }}
              >
                {game.hidden ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
              </button>
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
              title={isRunning ? t('state.playing') : t('action.play')}
              disabled={isRunning}
              onClick={(e) => {
                e.stopPropagation()
                void launchGame(game.id)
              }}
              whileHover={isRunning ? undefined : { scale: 1.08 }}
              whileTap={isRunning ? undefined : { scale: 0.94 }}
            >
              {isRunning ? <span className="live-dot" /> : <PlayIcon size={20} />}
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
        </motion.div>
      </motion.article>
    </motion.div>
  )
}
