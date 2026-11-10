import { useEffect } from 'react'
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from 'framer-motion'
import { useStorm } from './store/useStorm'
import type { AppSettings, Game, HotkeyState, RunningSession, ScreenshotError, SessionEvent } from '@shared/types'
import { applyTheme, onSystemModeChange, resolveMode } from './utils/theme'
import { comboHeld, connectedPads } from './utils/gamepad'
import { formatPlaytime } from './utils/format'
import { playShutter } from './utils/sound'
import AmbientBackground from './components/AmbientBackground'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import PosterWall from './components/PosterWall'
import GameDetail from './components/GameDetail'
import GameForm from './components/GameForm'
import SettingsView from './components/SettingsView'
import ToastHost from './components/ToastHost'
import ConfirmDialog from './components/ConfirmDialog'
import WindowControls from './components/WindowControls'
import DropLayer from './components/DropLayer'
import HostMode from './host/HostMode'

const VIEW_TRANSITION = { duration: 0.22, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }

/**
 * Watches connected controllers for the screenshot combo. Runs on a timer
 * rather than requestAnimationFrame, which stops while the window is hidden
 * — and hidden behind a game is exactly when the combo is used.
 *
 * On Windows this only covers controllers Chromium reads through raw input
 * (PlayStation ones, for instance): Xbox-style pads go through an API that
 * reports nothing while a game has focus, so the main process watches those
 * through XInput itself. A press both of them see still takes one picture.
 */
function usePadScreenshot(): void {
  const comboKey = useStorm((s) => s.settings.screenshotPadCombo.join(','))
  const onlyWhilePlaying = useStorm((s) => s.settings.screenshotOnlyWhilePlaying)
  const playing = useStorm((s) => s.running.length > 0)
  const recording = useStorm((s) => s.padRecording)

  useEffect(() => {
    if (!comboKey || recording || (onlyWhilePlaying && !playing)) return
    const combo = comboKey.split(',').map(Number)
    let held = false
    let lastShot = 0
    const timer = window.setInterval(() => {
      const active = connectedPads().some((pad) => comboHeld(pad, combo))
      // Fire on the press, not while held, and never twice in a second.
      if (active && !held && Date.now() - lastShot > 1000) {
        lastShot = Date.now()
        void window.storm.takeScreenshot()
      }
      held = active
    }, 50)
    return () => window.clearInterval(timer)
  }, [comboKey, onlyWhilePlaying, playing, recording])
}

export default function App(): React.JSX.Element {
  const ready = useStorm((s) => s.ready)
  const theme = useStorm((s) => s.settings.theme)
  const appearance = useStorm((s) => s.settings.appearance)
  const accent = useStorm((s) => s.settings.accent)
  const posterSize = useStorm((s) => s.settings.posterSize)
  const reduceMotion = useStorm((s) => s.settings.reduceMotion)
  const language = useStorm((s) => s.settings.language)
  const section = useStorm((s) => s.section)
  const hostMode = useStorm((s) => s.hostMode)
  const init = useStorm((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  // Deep links for development and quick access:
  //   ?game=<title>     open a game's detail page
  //   ?launch=<title>   launch a game
  //   ?drop=<path>      behave as if that file was dropped on the window
  //   ?form=1           open the add-game form
  //   ?settings=1       open settings
  useEffect(() => {
    if (!ready) return
    const params = new URLSearchParams(window.location.search)
    if (!params.toString()) return
    const s = useStorm.getState()
    const byTitle = (title: string): Game | undefined =>
      s.games.find((g) => g.title.toLowerCase() === title.toLowerCase())
    if (params.has('settings')) s.setSection('settings')
    if (params.has('form')) s.openForm()
    const wanted = params.get('game')
    const game = wanted ? byTitle(wanted) : undefined
    if (game) s.select(game.id)
    const launch = params.get('launch')
    const toLaunch = launch ? byTitle(launch) : undefined
    if (toLaunch) void s.launchGame(toLaunch.id)
    const drop = params.get('drop')
    if (drop) void s.addGameFiles(drop.split('|'))
  }, [ready])

  // Keep the renderer in sync with the main process.
  useEffect(() => {
    const s = (): ReturnType<typeof useStorm.getState> => useStorm.getState()
    const offs = [
      window.storm.on('storm:games', (payload) => s().setGames(payload as Game[])),
      window.storm.on('storm:settings', (payload) => s().setSettings(payload as AppSettings)),
      window.storm.on('storm:running', (payload) => s().setRunning(payload as RunningSession[])),
      window.storm.on('storm:hotkey', (payload) => s().setHotkey(payload as HotkeyState)),
      window.storm.on('storm:host', (payload) => s().hostChanged(payload === true)),
      window.storm.on('storm:session', (payload) => {
        const { gameId, minutes } = payload as SessionEvent
        const state = s()
        const game = state.games.find((g) => g.id === gameId)
        if (!game) return
        state.toast(
          state.t('toast.sessionEnded', { title: game.title, time: formatPlaytime(minutes, state.t) }),
          'success'
        )
      }),
      window.storm.on('storm:screenshot', () => {
        const state = s()
        state.bumpShots()
        if (state.settings.screenshotSound) playShutter()
        state.toast(state.t('toast.shotSaved'), 'success')
      }),
      window.storm.on('storm:screenshot-failed', (payload) => {
        const state = s()
        const error = payload as ScreenshotError
        state.toast(state.t(error === 'WRITE_FAILED' ? 'toast.shotWriteFailed' : 'toast.shotCaptureFailed'), 'error')
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  // Theme, mode and accent — host mode included. "System" follows Windows while the app is open.
  useEffect(() => {
    const apply = (): void => applyTheme(theme, resolveMode(appearance), accent)
    apply()
    return appearance === 'system' ? onSystemModeChange(apply) : undefined
  }, [theme, appearance, accent])

  useEffect(() => {
    const root = document.documentElement
    root.dataset.poster = posterSize
    root.dataset.motion = reduceMotion ? 'reduced' : 'full'
    root.dataset.host = hostMode ? 'on' : 'off'
    root.lang = language === 'zh' ? 'zh-CN' : 'en'
  }, [posterSize, reduceMotion, language, hostMode])

  // Escape closes the topmost layer only: confirm dialog, then the form,
  // then the detail page. Menus and recorders that handle Escape themselves
  // mark the event as handled first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const s = useStorm.getState()
      // Host mode reads the keyboard through its own input layer.
      if (s.hostMode) return
      if (s.confirmId) s.askDelete(null)
      else if (s.formOpen) s.closeForm()
      else if (s.selectedId) s.select(null)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  usePadScreenshot()

  if (!ready) {
    return (
      <div className="boot">
        <motion.div
          className="boot-mark"
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 20 }}
        >
          <span className="boot-bolt" />
        </motion.div>
        <motion.div
          className="boot-word"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12, duration: 0.4 }}
        >
          STORM
        </motion.div>
        <WindowControls />
      </div>
    )
  }

  if (hostMode) {
    return (
      <MotionConfig reducedMotion={reduceMotion ? 'always' : 'user'}>
        <LayoutGroup>
          <HostMode />
        </LayoutGroup>
      </MotionConfig>
    )
  }

  return (
    <MotionConfig reducedMotion={reduceMotion ? 'always' : 'user'}>
      <LayoutGroup>
        <div className="app">
          <AmbientBackground />
          <Sidebar />
          <main className="main">
            <TopBar />
            <div className="main-scroll">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={section}
                  className="view"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={VIEW_TRANSITION}
                >
                  {section === 'settings' ? <SettingsView /> : <PosterWall />}
                </motion.div>
              </AnimatePresence>
            </div>
          </main>
          <GameDetail />
          <GameForm />
          <ConfirmDialog />
          <DropLayer />
          <ToastHost />
          <WindowControls />
        </div>
      </LayoutGroup>
    </MotionConfig>
  )
}
