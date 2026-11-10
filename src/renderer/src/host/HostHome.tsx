import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStorm, useT } from '../store/useStorm'
import type { Game } from '@shared/types'
import { formatPlaytime, formatRelative } from '../utils/format'
import { EASE } from '../motion'
import Poster from '../components/Poster'
import { ClockIcon, GridIcon, HeartIcon, ImageIcon, PowerIcon, SettingsIcon } from '../components/icons'
import { useHostLayer } from './input'
import { HostHints, type Hint } from './Hints'
import {
  bump,
  cycleCollection,
  playGame,
  sound,
  SYSTEM_ITEMS,
  useCollectionGames,
  useHost,
  type SystemItem
} from './state'

const TILE_SPRING = { type: 'spring', stiffness: 380, damping: 30 } as const
const TRACK_SPRING = { type: 'spring', stiffness: 220, damping: 32, mass: 0.9 } as const

function useViewport(): { w: number; h: number } {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  useEffect(() => {
    const onResize = (): void => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

/**
 * The first tile in view. The selection moves freely inside the window and
 * the row scrolls only when it would reach an edge — keeping one tile of
 * room there, so you can see there is more.
 */
function useFirstVisible(index: number, visible: number, count: number): number {
  const first = useRef(0)
  let f = first.current
  const margin = visible >= 5 ? 1 : 0
  if (index < f + margin) f = index - margin
  if (index > f + visible - 1 - margin) f = index - visible + 1 + margin
  f = Math.max(0, Math.min(f, count - visible))
  first.current = f
  return f
}

function Tile({
  game,
  width,
  height,
  gap,
  order,
  selected,
  focused,
  running,
  onClick
}: {
  game: Game
  width: number
  height: number
  gap: number
  order: number
  selected: boolean
  focused: boolean
  running: boolean
  onClick: () => void
}): React.JSX.Element {
  const t = useT()
  const active = selected && focused
  return (
    <motion.div
      className={`htile${active ? ' is-active' : ''}${selected ? ' is-selected' : ''}${game.installed ? '' : ' is-missing'}`}
      style={{ width, height, marginRight: gap }}
      initial={{ opacity: 0, y: 40, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: active ? 1.09 : 1 }}
      transition={{
        scale: TILE_SPRING,
        opacity: { duration: 0.4, delay: Math.min(order, 9) * 0.045 },
        y: { type: 'spring', stiffness: 200, damping: 22, delay: Math.min(order, 9) * 0.045 }
      }}
      onClick={onClick}
    >
      <motion.div className="htile-art on-art" layoutId={`hposter-${game.id}`}>
        <Poster title={game.title} cover={game.cover} lazy />
      </motion.div>
      {active && <span key={game.id} className="htile-shine" />}
      {running && (
        <span className="htile-live">
          <span className="live-dot" />
          {t('host.running')}
        </span>
      )}
      {active && (
        <motion.span
          className="htile-ring"
          initial={{ opacity: 0, scale: 1.06 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.18, ease: EASE }}
        />
      )}
    </motion.div>
  )
}

/** The selected game's name and numbers, above the row. */
function Hero({ game, running }: { game: Game | undefined; running: boolean }): React.JSX.Element {
  const t = useT()
  const language = useStorm((s) => s.settings.language)
  return (
    <div className="hhero">
      <AnimatePresence initial={false}>
        {game && (
          <motion.div
            key={game.id}
            className="hhero-inner"
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12, transition: { duration: 0.14 } }}
            transition={{ duration: 0.3, ease: EASE }}
          >
            <div className="hhero-chips">
              {running ? (
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
              {game.favorite && (
                <span className="chip chip--accent">
                  <HeartIcon size={11} />
                  {t('nav.favorites')}
                </span>
              )}
              {game.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="chip">
                  {tag}
                </span>
              ))}
            </div>
            <h1 className="hhero-title">{game.title}</h1>
            <div className="hhero-meta">
              <span>
                <ClockIcon size={15} />
                {game.playtimeMinutes > 0 ? formatPlaytime(game.playtimeMinutes, t) : t('state.neverPlayed')}
              </span>
              {game.lastPlayedAt && (
                <span>
                  {t('detail.lastPlayed')} · {formatRelative(game.lastPlayedAt, language, t)}
                </span>
              )}
              {game.playCount > 0 && <span>{t('host.sessions', { count: game.playCount })}</span>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

const SYSTEM_ICONS: Record<SystemItem, React.JSX.Element> = {
  album: <ImageIcon size={26} />,
  settings: <SettingsIcon size={26} />,
  power: <PowerIcon size={26} />
}

function openSystem(item: SystemItem): void {
  sound('open')
  const host = useHost.getState()
  if (item === 'power') host.setPowerOpen(true)
  else host.go(item)
}

export default function HostHome(): React.JSX.Element {
  const t = useT()
  const games = useCollectionGames()
  const running = useStorm((s) => s.running)
  const gameId = useHost((s) => s.gameId)
  const collection = useHost((s) => s.collection)
  const row = useHost((s) => s.homeRow)
  const systemIndex = useHost((s) => s.systemIndex)
  const size = useViewport()
  const lastIndex = useRef(0)

  // A selection that is not in the row any more (another collection, a game
  // deleted in the meantime) moves to the nearest game that is.
  let index = games.findIndex((g) => g.id === gameId)
  if (index < 0) index = Math.min(lastIndex.current, games.length - 1)
  lastIndex.current = Math.max(0, index)
  const game = index >= 0 ? games[index] : undefined
  useEffect(() => {
    if (game && game.id !== gameId) useHost.getState().pick(game.id)
  }, [game, gameId])

  const onGames = row === 'games' && games.length > 0
  const isRunning = (id: string): boolean => running.some((r) => r.gameId === id)

  // The row's geometry follows the screen: posters a little under half its height.
  const tileH = Math.round(Math.min(560, Math.max(190, size.h * 0.41)))
  const tileW = Math.round((tileH * 2) / 3)
  const gap = Math.round(tileW * 0.12)
  const padX = Math.round(Math.max(48, size.w * 0.055))
  const visible = Math.max(1, Math.floor((size.w - padX * 2 + gap) / (tileW + gap)))
  const first = useFirstVisible(Math.max(0, index), visible, games.length)

  const move = (delta: number): void => {
    const next = index + delta
    if (next < 0 || next >= games.length) {
      bump()
      return
    }
    useHost.getState().pick(games[next].id)
    sound('move')
  }

  const details = (): void => {
    if (!game) return
    sound('open')
    useHost.getState().go('detail')
  }

  useHostLayer((action) => {
    const host = useHost.getState()
    if (action === 'lb' || action === 'rb') {
      cycleCollection(action === 'lb' ? -1 : 1)
      return
    }
    if (onGames && game) {
      switch (action) {
        case 'left':
          return move(-1)
        case 'right':
          return move(1)
        case 'down':
          host.setHomeRow('system')
          sound('move')
          return
        case 'a':
          void playGame(game)
          return
        case 'x':
        case 'menu':
          return details()
        case 'up':
        case 'b':
          return bump()
        default:
          return
      }
    }
    switch (action) {
      case 'left':
      case 'right': {
        const next = systemIndex + (action === 'left' ? -1 : 1)
        if (next < 0 || next >= SYSTEM_ITEMS.length) return bump()
        host.setHomeRow('system', next)
        sound('move')
        return
      }
      case 'up':
      case 'b':
        if (games.length === 0) return bump()
        host.setHomeRow('games')
        sound(action === 'b' ? 'back' : 'move')
        return
      case 'a':
        return openSystem(SYSTEM_ITEMS[systemIndex])
      default:
        return
    }
  })

  const hints: Hint[] = onGames
    ? [
        { buttons: ['a'], label: t('action.play'), onClick: () => game && void playGame(game) },
        { buttons: ['x'], label: t('host.details'), onClick: details },
        { buttons: ['lb', 'rb'], label: t('host.collection'), onClick: () => cycleCollection(1) }
      ]
    : [
        { buttons: ['a'], label: t('host.open'), onClick: () => openSystem(SYSTEM_ITEMS[systemIndex]) },
        ...(games.length > 0
          ? [
              {
                buttons: ['b'] as Hint['buttons'],
                label: t('host.back'),
                onClick: () => useHost.getState().setHomeRow('games')
              }
            ]
          : [])
      ]

  const emptyText: { title: string; hint: string } =
    collection === 'favorites'
      ? { title: t('host.emptyFavorites'), hint: t('host.emptySwitch') }
      : collection === 'installed'
        ? { title: t('host.emptyInstalled'), hint: t('host.emptySwitch') }
        : { title: t('host.empty'), hint: t('host.emptyHint') }

  return (
    <motion.div
      className="hpage hhome"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.02, transition: { duration: 0.22 } }}
      transition={{ duration: 0.35, ease: EASE }}
      style={{ '--hpad': `${padX}px` } as React.CSSProperties}
    >
      <Hero game={game} running={!!game && isRunning(game.id)} />

      <div className={`hrow${onGames ? ' is-focus' : ''}`} style={{ height: Math.round(tileH * 1.2) }}>
        {games.length === 0 ? (
          <motion.div
            key={`empty-${collection}`}
            className="hrow-empty"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
          >
            <GridIcon size={34} />
            <span className="hrow-empty-title">{emptyText.title}</span>
            <span className="hrow-empty-hint">{emptyText.hint}</span>
          </motion.div>
        ) : (
          <motion.div
            key={collection}
            className="hrow-track"
            initial={false}
            animate={{ x: -first * (tileW + gap) }}
            transition={TRACK_SPRING}
          >
            {games.map((g, i) => (
              <Tile
                key={g.id}
                game={g}
                width={tileW}
                height={tileH}
                gap={gap}
                order={i - first}
                selected={i === index}
                focused={onGames}
                running={isRunning(g.id)}
                onClick={() => {
                  const host = useHost.getState()
                  if (i === index && onGames) {
                    void playGame(g)
                    return
                  }
                  host.pick(g.id)
                  host.setHomeRow('games')
                  sound('move')
                }}
              />
            ))}
          </motion.div>
        )}
      </div>

      <div className="hsys">
        {SYSTEM_ITEMS.map((item, i) => {
          const active = !onGames && systemIndex === i
          return (
            <motion.button
              key={item}
              type="button"
              tabIndex={-1}
              className={`hsys-btn hsys-btn--${item}${active ? ' is-active' : ''}`}
              animate={{ scale: active ? 1.14 : 1 }}
              transition={TILE_SPRING}
              onClick={() => {
                useHost.getState().setHomeRow('system', i)
                openSystem(item)
              }}
            >
              {SYSTEM_ICONS[item]}
              <AnimatePresence>
                {active && (
                  <motion.span
                    className="hsys-label"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.18 }}
                  >
                    {t(item === 'album' ? 'host.album' : item === 'settings' ? 'host.settings' : 'host.power')}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          )
        })}
      </div>

      <HostHints hints={hints} />
    </motion.div>
  )
}
