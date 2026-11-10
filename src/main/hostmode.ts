import { powerSaveBlocker, type BrowserWindow } from 'electron'
import { launcher } from './launcher'
import { log } from './log'
import { broadcast, getMainWindow } from './window'
import { foreground, hwndOf } from './foreground'

/**
 * Host mode: Storm fills the screen and is driven by a controller, like a
 * console's home screen. The renderer draws it; this side owns the window.
 *
 * Where the keyboard (and so the controller) goes is the one thing that has
 * to be right for a player on the sofa:
 *   - no game running → Storm, whatever popped up in front of it (Steam
 *     coming forward after a game closed, most often)
 *   - a game running  → the game, whenever the focus lands back on Storm or
 *     on the bare desktop (the game minimised itself, or was alt-tabbed)
 * Windows that are the system's own — Task Manager, the Game Bar, the Start
 * menu, the UAC prompt — are never fought over, nor is another app the player
 * brought up while a game runs, nor anything covering the whole screen: that
 * is a game Storm did not start (or lost track of) or a video, and taking the
 * controller away from it every second would make it unplayable.
 *
 * Controllers do not count as input for Windows' idle timer, so a player
 * browsing with one would see the screen go dark. While they do, a power
 * save blocker keeps it on; a few minutes after the last press it lets go.
 */

/** How often the focus is checked. */
const GUARD_MS = 1000
/** The least time between two attempts to move the focus — a switch takes a moment to land. */
const RETRY_MS = 1500
/** How long the screen stays awake after the last controller press. */
const AWAKE_MS = 5 * 60_000

/** System windows the player may be using on purpose; host mode leaves them in front. */
const LEAVE_ALONE = new Set([
  'taskmgr.exe',
  'gamebar.exe',
  'gamebarftserver.exe',
  'gamebarpresencewriter.exe',
  'xboxgamebarwidgets.exe',
  'shellexperiencehost.exe',
  'startmenuexperiencehost.exe',
  'searchhost.exe',
  'searchapp.exe',
  'searchui.exe',
  'lockapp.exe',
  'logonui.exe',
  'consent.exe',
  'credentialuibroker.exe',
  'screenclippinghost.exe',
  'snippingtool.exe',
  'sndvol.exe',
  'osk.exe',
  'magnify.exe',
  'narrator.exe',
  'explorer.exe',
  'applicationframehost.exe',
  'systemsettings.exe',
  'werfault.exe'
])

class HostMode {
  private active = false
  private win: BrowserWindow | null = null
  private guard: NodeJS.Timeout | null = null
  private soon: NodeJS.Timeout | null = null
  private lastMove = 0
  /** What the guard last did, so the log says it once rather than every second. */
  private lastNote = ''
  /** Whether the window was maximised before going full screen, to put it back that way. */
  private wasMaximized = false
  private blocker: number | null = null
  private awakeTimer: NodeJS.Timeout | null = null
  private followingGames = false

  get isActive(): boolean {
    return this.active
  }

  /**
   * Hook a newly created main window up. With `startActive` the window opens
   * in host mode — decided before the page loads, so the very first snapshot
   * the renderer reads already says so.
   */
  attach(win: BrowserWindow, startActive: boolean, maximized: boolean): void {
    this.win = win
    this.active = startActive
    this.wasMaximized = maximized
    win.on('blur', () => this.checkSoon(400))
    win.on('focus', () => this.checkSoon(200))
    // F11, or Windows taking the window out of full screen: host mode cannot
    // go on without it, so it ends cleanly rather than half-way.
    win.on('leave-full-screen', () => {
      if (this.active) this.set(false)
    })
    // Closed to the tray (Alt+F4): the player wants Storm gone, not pulled back.
    win.on('hide', () => {
      if (this.active) this.set(false)
    })
    win.on('closed', () => {
      this.active = false
      this.win = null
      this.stopGuard()
      this.releaseAwake()
    })
    if (this.followingGames) return
    this.followingGames = true
    launcher.addRunningListener((sessions) => {
      if (!this.active) return
      // A game that just ended hands the screen straight back to Storm.
      if (sessions.length === 0) this.lastMove = 0
      this.checkSoon(300)
    })
  }

  /** Called once the window first shows. */
  shown(): void {
    const win = this.win
    if (!this.active || !win || win.isDestroyed()) return
    win.setFullScreen(true)
    this.startGuard()
    log('host', 'started in host mode')
  }

  /** Enter or leave host mode. Returns whether it is on afterwards. */
  set(on: boolean): boolean {
    const win = this.win ?? getMainWindow()
    if (!win || win.isDestroyed()) return this.active
    if (on === this.active) return on
    this.active = on
    if (on) {
      this.wasMaximized = win.isMaximized()
      if (win.isMinimized()) win.restore()
      win.show()
      win.setFullScreen(true)
      win.focus()
      this.startGuard()
    } else {
      this.stopGuard()
      this.releaseAwake()
      if (win.isFullScreen()) {
        win.setFullScreen(false)
        if (this.wasMaximized) win.once('leave-full-screen', () => !win.isDestroyed() && win.maximize())
      }
    }
    log('host', on ? 'entered host mode' : 'left host mode')
    broadcast('storm:host', on)
    return on
  }

  /** A controller press in host mode: keep the screen on for a while longer. */
  activity(): void {
    if (!this.active) return
    if (this.blocker === null || !powerSaveBlocker.isStarted(this.blocker)) {
      this.blocker = powerSaveBlocker.start('prevent-display-sleep')
    }
    if (this.awakeTimer) clearTimeout(this.awakeTimer)
    this.awakeTimer = setTimeout(() => this.releaseAwake(), AWAKE_MS)
    this.awakeTimer.unref()
  }

  private releaseAwake(): void {
    if (this.awakeTimer) clearTimeout(this.awakeTimer)
    this.awakeTimer = null
    if (this.blocker !== null && powerSaveBlocker.isStarted(this.blocker)) powerSaveBlocker.stop(this.blocker)
    this.blocker = null
  }

  private startGuard(): void {
    if (this.guard) return
    this.lastMove = 0
    this.guard = setInterval(() => this.check(), GUARD_MS)
    this.guard.unref()
  }

  private stopGuard(): void {
    if (this.guard) clearInterval(this.guard)
    if (this.soon) clearTimeout(this.soon)
    this.guard = null
    this.soon = null
  }

  private checkSoon(ms: number): void {
    if (!this.active) return
    if (this.soon) clearTimeout(this.soon)
    this.soon = setTimeout(() => {
      this.soon = null
      this.check()
    }, ms)
  }

  private note(message: string): void {
    if (message === this.lastNote) return
    this.lastNote = message
    log('host', message)
  }

  private check(): void {
    const win = this.win
    if (!this.active || !win || win.isDestroyed() || !win.isVisible()) return
    try {
      const gameId = launcher.latestGameId
      if (gameId) this.keepGame(gameId)
      else this.keepStorm(win)
    } catch (err) {
      log('host', 'focus check failed', err)
    }
  }

  /** No game is running: the controller belongs to Storm. */
  private keepStorm(win: BrowserWindow): void {
    const native = foreground()
    if (native) {
      const fg = native.current()
      if (!fg || fg.pid === process.pid || fg.fullscreen) return
      if (!fg.shell) {
        const image = native.imageOf(fg.pid)
        // A process we may not even look at is the system's own.
        if (!image || LEAVE_ALONE.has(image)) return
        this.note(`bringing Storm back in front of ${image}`)
      } else {
        this.note('bringing Storm back in front of the desktop')
      }
    } else {
      // Elsewhere there is only Electron's own idea of focus. Developer tools
      // are part of Storm, not something to take the focus back from.
      if (win.isFocused() || win.webContents.isDevToolsOpened()) return
    }
    if (!this.mayMove()) return
    if (win.isMinimized()) win.restore()
    native?.activate(hwndOf(win.getNativeWindowHandle()))
    win.focus()
    win.webContents.focus()
  }

  /** A game is running: the controller belongs to the game, once it has a window. */
  private keepGame(gameId: string): void {
    const native = foreground()
    if (!native) return
    const fg = native.current()
    // Only take the focus from Storm or the bare desktop: anything else is
    // the game itself, or a window the player brought up on purpose.
    if (!fg || (fg.pid !== process.pid && !fg.shell)) return
    const target = native.windowOf(launcher.processIds(gameId))
    // Still starting, or a launcher with no window: Storm waits with it.
    if (!target || !this.mayMove()) return
    this.note('handing the focus to the game')
    native.activate(target)
  }

  private mayMove(): boolean {
    const now = Date.now()
    if (now - this.lastMove < RETRY_MS) return false
    this.lastMove = now
    return true
  }
}

export const hostMode = new HostMode()
