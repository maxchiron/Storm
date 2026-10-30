import fs from 'node:fs'
import path from 'node:path'
import type { Game } from '@shared/types'

export type InstalledListener = (gameId: string, installed: boolean) => void

/**
 * Watches every game's install folder so the "Installed" badge reacts the moment
 * a folder disappears (or reappears) — not only at app start.
 *
 * Two independent mechanisms, because each one alone has blind spots:
 *   1. fs.watch on the PARENT directory — catches the folder being removed or
 *      moved. Cheap: one watcher per parent, not per game.
 *   2. A low-frequency stat poll — catches anything the watcher missed
 *      (network drives, deep paths, missed rename events).
 */
export class InstallWatcher {
  private listeners = new Set<InstalledListener>()
  /** gameId -> the path we probe to decide "installed" */
  private anchors = new Map<string, string>()
  /** parent dir -> watcher */
  private watchers = new Map<string, fs.FSWatcher>()
  /** parent dir -> debounce timer */
  private timers = new Map<string, NodeJS.Timeout>()
  private pollTimer: NodeJS.Timeout | null = null
  private intervalSeconds = 10
  private stopped = false

  addListener(fn: InstalledListener): void {
    this.listeners.add(fn)
  }

  removeListener(fn: InstalledListener): void {
    this.listeners.delete(fn)
  }

  setIntervalSeconds(seconds: number): void {
    const next = Math.max(2, Math.floor(seconds) || 10)
    if (next === this.intervalSeconds) return
    this.intervalSeconds = next
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    this.startPolling()
  }

  /** Reconcile the watch set with the current library. */
  setGames(games: Game[]): void {
    const next = new Map<string, string>()
    for (const g of games) {
      const anchor = anchorFor(g)
      if (anchor) next.set(g.id, anchor)
    }
    this.anchors = next
    this.rebuildWatchers()
  }

  /** The path used to decide whether the game is installed. */
  static anchorFor(game: Game): string | null {
    return anchorFor(game)
  }

  start(): void {
    this.stopped = false
    this.startPolling()
    this.rebuildWatchers()
  }

  stop(): void {
    this.stopped = true
    for (const w of this.watchers.values()) {
      try {
        w.close()
      } catch {
        /* ignore */
      }
    }
    this.watchers.clear()
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  private startPolling(): void {
    if (this.stopped || this.pollTimer) return
    this.pollTimer = setInterval(() => this.pollAll(), this.intervalSeconds * 1000)
    // don't let the poll keep the process alive on quit
    this.pollTimer.unref?.()
  }

  private rebuildWatchers(): void {
    const wantedParents = new Map<string, string[]>()
    for (const anchor of this.anchors.values()) {
      const parent = parentOf(anchor)
      if (!parent) continue
      const list = wantedParents.get(parent) ?? []
      list.push(anchor)
      wantedParents.set(parent, list)
    }

    // drop watchers for parents we no longer care about
    for (const [dir, watcher] of this.watchers) {
      if (!wantedParents.has(dir)) {
        try {
          watcher.close()
        } catch {
          /* ignore */
        }
        this.watchers.delete(dir)
      }
    }

    // add watchers for new parents
    for (const dir of wantedParents.keys()) {
      if (this.watchers.has(dir)) continue
      try {
        const watcher = fs.watch(dir, { persistent: false }, () => this.scheduleCheck(dir))
        watcher.on('error', () => {
          try {
            watcher.close()
          } catch {
            /* ignore */
          }
          this.watchers.delete(dir)
        })
        this.watchers.set(dir, watcher)
      } catch {
        // Directory is not watchable (missing, permission denied, network path).
        // The poll still covers it.
      }
    }
  }

  private scheduleCheck(dir: string): void {
    const existing = this.timers.get(dir)
    if (existing) clearTimeout(existing)
    this.timers.set(
      dir,
      setTimeout(() => {
        this.timers.delete(dir)
        this.checkAnchorsUnder(dir)
      }, 250)
    )
  }

  private checkAnchorsUnder(parent: string): void {
    for (const [gameId, anchor] of this.anchors) {
      if (parentOf(anchor) === parent) this.checkOne(gameId, anchor)
    }
  }

  private pollAll(): void {
    for (const [gameId, anchor] of this.anchors) {
      this.checkOne(gameId, anchor)
    }
  }

  private checkOne(gameId: string, anchor: string): void {
    let exists = false
    try {
      fs.statSync(anchor)
      exists = true
    } catch {
      exists = false
    }
    for (const fn of this.listeners) fn(gameId, exists)
  }

  /** Probe a single path right now (used by the manual "re-check" action). */
  checkNow(gameId: string): boolean {
    const anchor = this.anchors.get(gameId)
    if (!anchor) return false
    let exists = false
    try {
      fs.statSync(anchor)
      exists = true
    } catch {
      exists = false
    }
    for (const fn of this.listeners) fn(gameId, exists)
    return exists
  }

  /** Probe every watched path immediately (the "re-check installs" action). */
  checkAll(): void {
    this.pollAll()
  }
}

function anchorFor(game: Game): string | null {
  if (game.installPath) return game.installPath
  if (game.exePath) return path.dirname(game.exePath)
  return null
}

export const watcher = new InstallWatcher()

function parentOf(p: string): string | null {
  try {
    const parent = path.dirname(p)
    return parent && parent !== p ? parent : null
  } catch {
    return null
  }
}
