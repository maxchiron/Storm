import { useEffect } from 'react'
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from 'framer-motion'
import { useStorm } from './store/useStorm'
import type { AppSettings, Game, RunningSession } from '@shared/types'
import AmbientBackground from './components/AmbientBackground'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import PosterWall from './components/PosterWall'
import GameDetail from './components/GameDetail'
import GameForm from './components/GameForm'
import SettingsView from './components/SettingsView'
import ToastHost from './components/ToastHost'
import ConfirmDialog from './components/ConfirmDialog'

function accentChannels(hex: string): string {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const num = parseInt(full, 16)
  if (Number.isNaN(num)) return '56, 189, 248'
  return `${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}`
}

export default function App(): React.JSX.Element {
  const ready = useStorm((s) => s.ready)
  const settings = useStorm((s) => s.settings)
  const section = useStorm((s) => s.section)
  const init = useStorm((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  // Deep links for development and quick access:
  //   app://storm/index.html?game=<title>   open a game's detail page
  //   app://storm/index.html?form=1         open the add-game form
  //   app://storm/index.html?settings=1     open settings
  useEffect(() => {
    if (!ready) return
    const params = new URLSearchParams(window.location.search)
    if (!params.toString()) return
    if (params.has('settings')) {
      useStorm.getState().setSection('settings')
      return
    }
    if (params.has('form')) {
      useStorm.getState().openForm()
      return
    }
    const wanted = params.get('game')
    if (wanted) {
      const game = useStorm.getState().games.find((g) => g.title.toLowerCase() === wanted.toLowerCase())
      if (game) useStorm.getState().select(game.id)
    }
    const launch = params.get('launch')
    if (launch) {
      const game = useStorm.getState().games.find((g) => g.title.toLowerCase() === launch.toLowerCase())
      if (game) void useStorm.getState().launchGame(game.id)
    }
  }, [ready])

  // Keep the renderer in sync with the main process.
  useEffect(() => {
    const offGames = window.storm.on('storm:games', (payload) => {
      useStorm.getState().setGames(payload as Game[])
    })
    const offSettings = window.storm.on('storm:settings', (payload) => {
      useStorm.getState().setSettings(payload as AppSettings)
    })
    const offRunning = window.storm.on('storm:running', (payload) => {
      useStorm.getState().setRunning(payload as RunningSession[])
    })
    const offSession = window.storm.on('storm:session', (payload) => {
      const p = payload as { gameId: string; minutes: number }
      const state = useStorm.getState()
      const game = state.games.find((g) => g.id === p.gameId)
      const lang = state.settings.language
      const minutes = p.minutes >= 60 ? `${Math.round(p.minutes / 60)}h` : `${p.minutes}m`
      state.toast(`${game?.title ?? ''} · ${minutes}`, 'success')
    })
    return () => {
      offGames()
      offSettings()
      offRunning()
      offSession()
    }
  }, [])

  // Theme, accent and accessibility preferences.
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--accent', settings.accent)
    root.style.setProperty('--accent-rgb', accentChannels(settings.accent))
    root.dataset.theme = settings.theme
    root.dataset.poster = settings.posterSize
    root.dataset.motion = settings.reduceMotion ? 'reduced' : 'full'
    root.lang = settings.language === 'zh' ? 'zh-CN' : 'en'
  }, [settings])

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
      </div>
    )
  }

  return (
    <MotionConfig reducedMotion={settings.reduceMotion ? 'always' : 'user'}>
      <LayoutGroup>
        <div className="app">
          <AmbientBackground />
          <Sidebar />
          <main className="main">
            <TopBar />
            <div className="main-scroll">
              <AnimatePresence mode="wait" initial={false}>
                {section === 'settings' ? (
                  <motion.div
                    key="settings"
                    className="view"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <SettingsView />
                  </motion.div>
                ) : (
                  <motion.div
                    key="library"
                    className="view"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <PosterWall />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </main>
          <GameDetail />
          <GameForm />
          <ConfirmDialog />
          <ToastHost />
        </div>
      </LayoutGroup>
    </MotionConfig>
  )
}
