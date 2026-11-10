import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStorm, useT } from '../store/useStorm'
import { bannerSrc, coverSrc, hueFromString } from '../utils/format'
import { connectedPads } from '../utils/gamepad'
import { EASE, SPRING_SNAPPY } from '../motion'
import { onHostInput, useHostInputLoop, useHostLayer } from './input'
import { bump, COLLECTIONS, cycleCollection, sound, useHost } from './state'
import { PadGlyph } from './Hints'
import Poster from '../components/Poster'
import ScreenshotViewer from '../components/ScreenshotViewer'
import ToastHost from '../components/ToastHost'
import HostHome from './HostHome'
import HostDetail from './HostDetail'
import HostAlbum from './HostAlbum'
import HostSettings from './HostSettings'
import { BoltIcon, GamepadIcon, HostIcon, PowerIcon } from '../components/icons'
import type { TranslationKey } from '@shared/i18n'

/** A value that follows another one, but only once it has stopped changing for a moment. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(value), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return settled
}

/**
 * The selected game's artwork, full screen behind everything. It crossfades
 * once the selection settles — scrolling quickly through the row does not
 * stack up a fade per game.
 */
function HostBackdrop(): React.JSX.Element {
  const page = useHost((s) => s.page)
  const gameId = useSettled(
    useHost((s) => s.gameId),
    160
  )
  const game = useStorm((s) => s.games.find((g) => g.id === gameId))
  const art = game ? (bannerSrc(game.banner) ?? coverSrc(game.cover)) : null
  const hue = hueFromString(game?.title ?? 'Storm')

  return (
    <div className={`hart hart--${page}`} aria-hidden="true">
      <AnimatePresence initial={false}>
        <motion.div
          key={art ?? `hue-${hue}`}
          className="hart-layer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        >
          {art ? (
            <div className="hart-img" style={{ backgroundImage: `url("${art}")` }} />
          ) : (
            <div className="hart-img hart-img--hue" style={{ '--hue': hue } as React.CSSProperties} />
          )}
        </motion.div>
      </AnimatePresence>
      <div className="hart-glow" />
      <div className="hart-scrim" />
    </div>
  )
}

function Clock(): React.JSX.Element {
  const language = useStorm((s) => s.settings.language)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 5000)
    return () => window.clearInterval(id)
  }, [])
  const time = new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(now)
  return <span className="htop-clock">{time}</span>
}

/** How many controllers Storm can see. Chromium only shows one after its first button press. */
export function usePadCount(): number {
  const [count, setCount] = useState(() => connectedPads().length)
  useEffect(() => {
    const update = (): void => setCount(connectedPads().length)
    const id = window.setInterval(update, 1000)
    window.addEventListener('gamepadconnected', update)
    window.addEventListener('gamepaddisconnected', update)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('gamepadconnected', update)
      window.removeEventListener('gamepaddisconnected', update)
    }
  }, [])
  return count
}

function PadStatus(): React.JSX.Element {
  const t = useT()
  const count = usePadCount()
  return (
    <span className={`htop-pad${count === 0 ? ' is-off' : ''}`} title={count === 0 ? t('host.pressButton') : undefined}>
      <GamepadIcon size={20} />
      {count === 0 ? <span className="htop-pad-text">{t('host.noController')}</span> : count > 1 && <b>{count}</b>}
    </span>
  )
}

const COLLECTION_LABELS: Record<string, TranslationKey> = {
  recent: 'host.collection.recent',
  favorites: 'host.collection.favorites',
  installed: 'host.collection.installed',
  az: 'host.collection.az'
}

function HostTopBar(): React.JSX.Element {
  const t = useT()
  const page = useHost((s) => s.page)
  const collection = useHost((s) => s.collection)
  const titles: Partial<Record<string, TranslationKey>> = { album: 'host.album', settings: 'host.settings' }
  const title = titles[page]

  return (
    <header className="htop">
      <div className="htop-brand">
        <span className="htop-mark">
          <BoltIcon size={17} />
        </span>
        <span className="htop-word">STORM</span>
      </div>
      <div className="htop-center">
        <AnimatePresence mode="wait" initial={false}>
          {page === 'home' ? (
            <motion.nav
              key="tabs"
              className="htabs"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
            >
              <PadGlyph button="lb" />
              {COLLECTIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  tabIndex={-1}
                  className={`htab${c === collection ? ' is-active' : ''}`}
                  onClick={() => cycleCollection(COLLECTIONS.indexOf(c) - COLLECTIONS.indexOf(collection))}
                >
                  {c === collection && (
                    <motion.span className="htab-pill" layoutId="htab-pill" transition={SPRING_SNAPPY} />
                  )}
                  <span className="htab-label">{t(COLLECTION_LABELS[c])}</span>
                </button>
              ))}
              <PadGlyph button="rb" />
            </motion.nav>
          ) : title ? (
            <motion.span
              key={page}
              className="htop-title"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
            >
              {t(title)}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>
      <div className="htop-status">
        <PadStatus />
        <Clock />
      </div>
    </header>
  )
}

/**
 * "Starting…" while a game comes up. It steps aside as soon as the game takes
 * the screen (Storm loses the focus), if the launch fails, or after a while
 * — a game behind a slow launcher is still running, Storm just stops saying so.
 */
function HostLaunch(): React.JSX.Element {
  const t = useT()
  const launching = useHost((s) => s.launching)
  const game = useStorm((s) => (launching ? s.games.find((g) => g.id === launching) : undefined))
  const running = useStorm((s) => !!launching && s.running.some((r) => r.gameId === launching))
  const wasRunning = useRef(false)

  useEffect(() => {
    if (!launching) return
    wasRunning.current = false
    const done = (): void => useHost.getState().setLaunching(null)
    let away: number | null = null
    const onBlur = (): void => {
      away = window.setTimeout(done, 700)
    }
    const timer = window.setTimeout(done, 25_000)
    window.addEventListener('blur', onBlur)
    return () => {
      window.clearTimeout(timer)
      if (away) window.clearTimeout(away)
      window.removeEventListener('blur', onBlur)
    }
  }, [launching])

  // The session ended before the game ever showed (it crashed on start): nothing is starting any more.
  useEffect(() => {
    if (running) wasRunning.current = true
    else if (wasRunning.current) useHost.getState().setLaunching(null)
  }, [running])

  useHostLayer(
    (action) => {
      if (action === 'b') useHost.getState().setLaunching(null)
    },
    { priority: 30, enabled: !!launching }
  )

  return (
    <AnimatePresence>
      {game && (
        <motion.div
          key={game.id}
          className="hlaunch"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.4 } }}
          transition={{ duration: 0.3 }}
        >
          <motion.div
            className="hlaunch-poster on-art"
            initial={{ scale: 0.7, y: 40, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 180, damping: 20 }}
          >
            <span className="hlaunch-ring" />
            <span className="hlaunch-ring hlaunch-ring--2" />
            <Poster title={game.title} cover={game.cover} />
          </motion.div>
          <motion.div
            className="hlaunch-text"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.4, ease: EASE }}
          >
            <span className="hlaunch-title">{game.title}</span>
            <span className="hlaunch-status">{t('host.starting')}</span>
            <span className="hlaunch-bar" />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Leave host mode, or quit Storm altogether. */
function HostPower(): React.JSX.Element {
  const t = useT()
  const [focus, setFocus] = useState(0)
  const close = (): void => useHost.getState().setPowerOpen(false)
  const options = useMemo(
    () => [
      {
        key: 'exit',
        icon: <HostIcon size={22} />,
        label: t('host.exit'),
        run: () => void useStorm.getState().setHostMode(false)
      },
      {
        key: 'quit',
        icon: <PowerIcon size={22} />,
        label: t('host.quit'),
        run: () => void window.storm.windowAction('quit')
      }
    ],
    [t]
  )

  useHostLayer(
    (action) => {
      if (action === 'up' || action === 'left') {
        if (focus > 0) {
          setFocus(focus - 1)
          sound('move')
        } else bump()
      } else if (action === 'down' || action === 'right') {
        if (focus < options.length - 1) {
          setFocus(focus + 1)
          sound('move')
        } else bump()
      } else if (action === 'a') {
        sound('select')
        close()
        options[focus].run()
      } else if (action === 'b') {
        sound('back')
        close()
      }
    },
    { priority: 10 }
  )

  return (
    <motion.div
      className="hdialog-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <motion.div
        className="hdialog"
        role="dialog"
        initial={{ opacity: 0, y: 26, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 14, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
      >
        <h2 className="hdialog-title">{t('host.powerTitle')}</h2>
        <div className="hdialog-options">
          {options.map((o, i) => (
            <button
              key={o.key}
              type="button"
              tabIndex={-1}
              className={`hdialog-option${i === focus ? ' is-focus' : ''}`}
              onMouseEnter={() => setFocus(i)}
              onClick={() => {
                close()
                o.run()
              }}
            >
              <span className="hdialog-icon">{o.icon}</span>
              <span>{o.label}</span>
            </button>
          ))}
        </div>
        <div className="hdialog-foot">
          <span className="hhint">
            <PadGlyph button="a" />
            <span className="hhint-label">{t('host.select')}</span>
          </span>
          <button type="button" tabIndex={-1} className="hhint" onClick={close}>
            <PadGlyph button="b" />
            <span className="hhint-label">{t('action.cancel')}</span>
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

/** The pointer hides once the player is on the controller, and comes back when the mouse moves. */
function useIdleCursor(): boolean {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    let timer = window.setTimeout(() => setIdle(true), 2500)
    const onMove = (): void => {
      setIdle(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setIdle(true), 2500)
    }
    window.addEventListener('mousemove', onMove)
    const off = onHostInput(() => {
      window.clearTimeout(timer)
      setIdle(true)
    })
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('mousemove', onMove)
      off()
    }
  }, [])
  return idle
}

/**
 * Host mode: Storm as a console's home screen. Full screen, a row of posters,
 * a controller for everything — and read-only, so a living room full of
 * guests can browse and play without changing the library.
 */
export default function HostMode(): React.JSX.Element {
  const page = useHost((s) => s.page)
  const viewer = useHost((s) => s.viewer)
  const powerOpen = useHost((s) => s.powerOpen)
  const idle = useIdleCursor()

  useHostInputLoop()

  useEffect(() => {
    useHost.getState().reset()
    sound('open')
  }, [])

  // Controllers do not keep Windows awake; tell the main process someone is here.
  useEffect(() => {
    let last = 0
    return onHostInput(() => {
      const now = Date.now()
      if (now - last < 20_000) return
      last = now
      window.storm.hostActivity()
    })
  }, [])

  return (
    <motion.div
      className={`host${idle ? ' host--idle' : ''}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.45, ease: EASE }}
    >
      <HostBackdrop />
      <HostTopBar />
      <div className="hpages">
        <AnimatePresence initial={false}>
          {page === 'home' && <HostHome key="home" />}
          {page === 'detail' && <HostDetail key="detail" />}
          {page === 'album' && <HostAlbum key="album" />}
          {page === 'settings' && <HostSettings key="settings" />}
        </AnimatePresence>
      </div>
      <HostLaunch />
      <AnimatePresence>{powerOpen && <HostPower key="power" />}</AnimatePresence>
      <AnimatePresence>
        {viewer && (
          <ScreenshotViewer
            key="viewer"
            host
            shots={viewer.shots}
            index={viewer.index}
            onClose={() => useHost.getState().closeViewer()}
          />
        )}
      </AnimatePresence>
      <ToastHost />
    </motion.div>
  )
}
