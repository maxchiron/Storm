import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, type Variants } from 'framer-motion'
import { useStorm, useT } from '../store/useStorm'
import type { ScreenshotInfo } from '@shared/types'
import { formatDate, formatElapsed, formatPlaytime, formatRelative } from '../utils/format'
import { EASE } from '../motion'
import Poster from '../components/Poster'
import { CameraIcon, HeartIcon, ImageIcon, PlayIcon } from '../components/icons'
import { useHostLayer, useStickScroll } from './input'
import { HostHints, type Hint } from './Hints'
import { bump, playGame, sound, useCollectionGames, useHost } from './state'

const swap: Variants = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 60 }),
  center: { opacity: 1, x: 0, transition: { duration: 0.35, ease: EASE } },
  exit: (dir: number) => ({ opacity: 0, x: dir * -60, transition: { duration: 0.2, ease: EASE } })
}

type Focus = { row: 'actions' | 'shots'; col: number }

function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(id)
  }, [ms])
  return now
}

/** A game's page in host mode: everything about it to look at, and Play. Nothing to edit. */
export default function HostDetail(): React.JSX.Element | null {
  const t = useT()
  const language = useStorm((s) => s.settings.language)
  const gameId = useHost((s) => s.gameId)
  const game = useStorm((s) => s.games.find((g) => g.id === gameId))
  const session = useStorm((s) => s.running.find((r) => r.gameId === gameId))
  const shotVersion = useStorm((s) => s.shotVersion)
  const list = useCollectionGames()
  const [shots, setShots] = useState<ScreenshotInfo[]>([])
  const [focus, setFocus] = useState<Focus>({ row: 'actions', col: 0 })
  const [dir, setDir] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  useNow(15_000)
  useStickScroll(scrollRef)

  useEffect(() => {
    if (!gameId) return
    let alive = true
    void window.storm.listScreenshots(gameId).then((found) => {
      if (alive) setShots(found)
    })
    return () => {
      alive = false
    }
  }, [gameId, shotVersion])

  // The game went away underneath (deleted or hidden in the meantime): back to the row.
  useEffect(() => {
    if (!game || game.hidden) useHost.getState().go('home')
  }, [game])

  // Keep whatever has the focus on screen.
  useEffect(() => {
    const el = scrollRef.current?.querySelector<HTMLElement>('.is-focus')
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [focus, gameId])

  const actions: ('play' | 'shots')[] = shots.length > 0 ? ['play', 'shots'] : ['play']
  const atActions = focus.row === 'actions' || shots.length === 0
  const col = atActions ? Math.min(focus.col, actions.length - 1) : Math.min(focus.col, shots.length - 1)

  const openShots = (index: number): void => {
    sound('open')
    useHost.getState().openViewer(shots, index)
  }

  const activate = (): void => {
    if (!game) return
    if (!atActions) return openShots(col)
    if (actions[col] === 'play') void playGame(game)
    else openShots(0)
  }

  const neighbour = (delta: number): void => {
    const i = list.findIndex((g) => g.id === gameId)
    const next = list[i + delta]
    if (i < 0 || !next) return bump()
    setDir(delta)
    setShots([])
    setFocus({ row: 'actions', col: 0 })
    useHost.getState().pick(next.id)
    sound('tab')
  }

  const back = (): void => {
    sound('back')
    useHost.getState().go('home')
  }

  useHostLayer((action) => {
    switch (action) {
      case 'b':
        return back()
      case 'lb':
      case 'rb':
        return neighbour(action === 'lb' ? -1 : 1)
      case 'a':
        return activate()
      case 'left':
      case 'right': {
        const next = col + (action === 'left' ? -1 : 1)
        const length = atActions ? actions.length : shots.length
        if (next < 0 || next >= length) return bump()
        setFocus({ row: atActions ? 'actions' : 'shots', col: next })
        sound('move')
        return
      }
      case 'down':
        if (!atActions || shots.length === 0) return bump()
        setFocus({ row: 'shots', col: 0 })
        sound('move')
        return
      case 'up':
        if (atActions) return bump()
        setFocus({ row: 'actions', col: 0 })
        sound('move')
        return
      default:
        return
    }
  })

  if (!game) return null

  const playable = game.installed && !!game.exePath
  const playLabel = session
    ? `${t('host.running')} · ${formatElapsed(session.startedAt, t)}`
    : playable
      ? t('action.play')
      : game.exePath
        ? t('state.notInstalled')
        : t('host.noExeShort')

  const hints: Hint[] = [
    {
      buttons: ['a'],
      label: atActions && actions[col] === 'play' ? t('action.play') : t('host.view'),
      onClick: activate
    },
    { buttons: ['lb', 'rb'], label: t('host.otherGame'), onClick: () => neighbour(1) },
    { buttons: ['rstick'], label: t('host.scroll') },
    { buttons: ['b'], label: t('host.back'), onClick: back }
  ]

  return (
    <motion.div
      className="hpage hdetail"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
      transition={{ duration: 0.3 }}
    >
      <div className="hdetail-scroll" ref={scrollRef}>
        <AnimatePresence mode="popLayout" custom={dir} initial={false}>
          <motion.div
            key={game.id}
            className="hdetail-body"
            custom={dir}
            variants={swap}
            initial="enter"
            animate="center"
            exit="exit"
          >
            <div className="hdetail-hero">
              <motion.div className="hdetail-poster on-art" layoutId={`hposter-${game.id}`}>
                <Poster title={game.title} cover={game.cover} />
              </motion.div>

              <div className="hdetail-main">
                <div className="hhero-chips">
                  {session ? (
                    <span className="chip chip--live">
                      <span className="live-dot" />
                      {t('host.running')}
                    </span>
                  ) : (
                    <span className={`chip ${game.installed ? 'chip--ok' : 'chip--muted'}`}>
                      <span className="chip-dot" />
                      {game.installed ? t('state.installed') : t('state.notInstalled')}
                    </span>
                  )}
                  <span className={`chip ${game.played ? 'chip--accent' : 'chip--muted'}`}>
                    {game.played ? t('state.played') : t('state.unplayed')}
                  </span>
                  {game.favorite && (
                    <span className="chip chip--accent">
                      <HeartIcon size={11} />
                      {t('nav.favorites')}
                    </span>
                  )}
                </div>

                <h1 className="hdetail-title">{game.title}</h1>

                <div className="hdetail-actions">
                  <motion.button
                    type="button"
                    tabIndex={-1}
                    className={`hbtn hbtn--play${atActions && col === 0 ? ' is-focus' : ''}${session ? ' is-running' : ''}${playable ? '' : ' is-off'}`}
                    animate={{ scale: atActions && col === 0 ? 1.05 : 1 }}
                    onClick={() => {
                      setFocus({ row: 'actions', col: 0 })
                      void playGame(game)
                    }}
                  >
                    {session ? <span className="live-dot" /> : <PlayIcon size={20} />}
                    {playLabel}
                  </motion.button>
                  {shots.length > 0 && (
                    <motion.button
                      type="button"
                      tabIndex={-1}
                      className={`hbtn${atActions && col === 1 ? ' is-focus' : ''}`}
                      animate={{ scale: atActions && col === 1 ? 1.05 : 1 }}
                      onClick={() => openShots(0)}
                    >
                      <ImageIcon size={19} />
                      {t('detail.screenshots')}
                      <b className="hbtn-count">{shots.length}</b>
                    </motion.button>
                  )}
                </div>

                <div className="hdetail-stats">
                  <div className="hstat">
                    <span className="hstat-value">{formatPlaytime(game.playtimeMinutes, t)}</span>
                    <span className="hstat-label">{t('detail.playtime')}</span>
                  </div>
                  <div className="hstat">
                    <span className="hstat-value">{game.playCount}</span>
                    <span className="hstat-label">{t('detail.sessions')}</span>
                  </div>
                  <div className="hstat">
                    <span className="hstat-value">{formatRelative(game.lastPlayedAt, language, t)}</span>
                    <span className="hstat-label">{t('detail.lastPlayed')}</span>
                  </div>
                  <div className="hstat">
                    <span className="hstat-value">{formatDate(game.addedAt, language, t)}</span>
                    <span className="hstat-label">{t('detail.added')}</span>
                  </div>
                </div>
              </div>
            </div>

            {shots.length > 0 && (
              <section className="hsection">
                <h3 className="hsection-title">
                  {t('detail.screenshots')}
                  <span className="hsection-count">{shots.length}</span>
                </h3>
                <div className="hshots">
                  {shots.map((shot, i) => {
                    const focused = !atActions && col === i
                    return (
                      <motion.button
                        key={shot.id}
                        type="button"
                        tabIndex={-1}
                        className={`hshot${focused ? ' is-focus' : ''}`}
                        animate={{ scale: focused ? 1.06 : 1 }}
                        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                        onClick={() => openShots(i)}
                      >
                        {shot.thumbUrl ? (
                          <img src={shot.thumbUrl} alt="" draggable={false} loading="lazy" />
                        ) : (
                          <CameraIcon size={22} />
                        )}
                      </motion.button>
                    )
                  })}
                </div>
              </section>
            )}

            {(game.tags.length > 0 || game.note) && (
              <section className="hsection hsection--notes">
                {game.tags.length > 0 && (
                  <div className="hdetail-tags">
                    {game.tags.map((tag) => (
                      <span key={tag} className="tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {game.note && <p className="hdetail-note">{game.note}</p>}
              </section>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
      <HostHints hints={hints} />
    </motion.div>
  )
}
