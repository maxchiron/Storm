import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { Game } from '@shared/types'

export type InstalledListener = (gameId: string, installed: boolean) => void

/** The path that decides whether a game is installed. */
export function anchorFor(game: Pick<Game, 'installPath' | 'exePath'>): string | null {
  if (game.installPath) return game.installPath
  if (game.exePath) return path.dirname(game.exePath)
  return null
}

/**
 * Whether a path exists. Only "it is not there" counts as missing; a
 * permission error still means something is on disk.
 *
 * This is asynchronous on purpose: a stat on an offline network drive can
 * block for many seconds, and a synchronous one would freeze the whole main
 * process — every IPC call, the tray, the window — while it waits.
 */
export async function pathExists(target: string): Promise<boolean> {
  try {
    await fsp.stat(target)
    return true
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return code === 'EACCES' || code === 'EPERM' || code === 'EBUSY'
  }
}

/**
 * Watches every game's install folder so the "Installed" badge reacts the
 * moment a folder disappears (or reappears) — not only at app start.
 *
 * Two independent mechanisms, because each one alone has blind spots:
 *   1. fs.watch on the PARENT directory — catches the folder being removed or
 *      moved. Cheap: one watcher per parent, not per game.
 *   2. A low-frequency poll — catches anything the watcher missed (network
 *      drives, deep paths, missed rename events).
 */
export class InstallWatcher {
  private listeners = new Set<InstalledListener>()
  /** gameId -> the path we probe to decide "installed" */
  private anchors = new Map<string, string>()
  /** parent dir -> watcher */
  private watchers = new Map<string, fs.FSWatcher>()
  /** parent dir -> debounce timer */
  private timers = new Map<string, NodeJS.Timeout>()
  /** games whose probe has not come back yet — a hung drive must not pile up probes */
  private inFlight = new Set<string>()
  private pollTimer: NodeJS.Timeout | null = null
  private intervalSeconds = 10
  private stopped = false

  addListener(fn: InstalledListener): void {
    this.listeners.add(fn)
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
    if (this.stopped) return
    const wantedParents = new Set<string>()
    for (const anchor of this.anchors.values()) {
      const parent = parentOf(anchor)
      if (parent) wantedParents.add(parent)
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

    // add watchers for new parents (and retry ones that failed before)
    for (const dir of wantedParents) {
      if (this.watchers.has(dir)) continue
      try {
        const watcher = fs.watch(dir, { persistent: false }, () => this.scheduleCheck(dir))
        watcher.on('error', () => {
          try {
            watcher.close()
          } catch {
            /* ignore */
          }
          if (this.watchers.get(dir) === watcher) this.watchers.delete(dir)
          // The folder itself may be gone; let its games know right away.
          this.scheduleCheck(dir)
        })
        this.watchers.set(dir, watcher)
      } catch {
        // Not watchable right now (missing, permission denied, network path).
        // The poll covers it and the next poll retries the watcher.
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
        for (const [gameId, anchor] of this.anchors) {
          if (parentOf(anchor) === dir) void this.checkOne(gameId, anchor)
        }
      }, 250)
    )
  }

  private pollAll(): void {
    for (const [gameId, anchor] of this.anchors) void this.checkOne(gameId, anchor)
    // A parent folder that was missing earlier may be back by now.
    this.rebuildWatchers()
  }

  private async checkOne(gameId: string, anchor: string): Promise<boolean | null> {
    if (this.inFlight.has(gameId)) return null
    this.inFlight.add(gameId)
    try {
      const exists = await pathExists(anchor)
      // The library may have changed while the probe was out.
      if (this.anchors.get(gameId) !== anchor) return null
      for (const fn of this.listeners) fn(gameId, exists)
      return exists
    } finally {
      this.inFlight.delete(gameId)
    }
  }

  /** Probe a single game right now (the manual "re-check" action). */
  async checkNow(gameId: string): Promise<boolean> {
    const anchor = this.anchors.get(gameId)
    if (!anchor) return false
    return (await this.checkOne(gameId, anchor)) ?? false
  }

  /** Probe every game immediately and wait for the answers. */
  async checkAll(): Promise<void> {
    await Promise.all([...this.anchors].map(([gameId, anchor]) => this.checkOne(gameId, anchor)))
  }
}

export const watcher = new InstallWatcher()

function parentOf(p: string): string | null {
  const parent = path.dirname(p)
  return parent && parent !== p ? parent : null
}
