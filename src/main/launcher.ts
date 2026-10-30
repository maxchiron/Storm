import { spawn, execFile } from 'node:child_process'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { store } from './store'
import type { Game, RunningSession, SessionRecord } from '@shared/types'

const execFileAsync = promisify(execFile)

interface ActiveSession {
  gameId: string
  exePath: string
  startedAt: string
  pid: number | null
}

export type SessionListener = (running: RunningSession[]) => void
export type SessionEventListener = (payload: { gameId: string; minutes: number; startedAt: string; endedAt: string }) => void

/**
 * Launches a game's executable and keeps a running play session alive for as
 * long as the process lives, so Storm can show real playtime.
 */
export class Launcher {
  private active = new Map<string, ActiveSession>()
  private runningListeners = new Set<SessionListener>()
  private eventListeners = new Set<SessionEventListener>()

  addRunningListener(fn: SessionListener): void {
    this.runningListeners.add(fn)
  }

  addEventListener(fn: SessionEventListener): void {
    this.eventListeners.add(fn)
  }

  get runningSessions(): RunningSession[] {
    return [...this.active.values()].map((s) => ({
      gameId: s.gameId,
      pid: s.pid,
      exePath: s.exePath,
      startedAt: s.startedAt
    }))
  }

  isRunning(gameId: string): boolean {
    return this.active.has(gameId)
  }

  /**
   * Start the game. Returns an error message when the executable is missing.
   */
  async launch(game: Game): Promise<{ ok: boolean; error?: string }> {
    if (!game.exePath) return { ok: false, error: 'NO_EXE' }
    if (this.active.has(game.id)) return { ok: false, error: 'ALREADY_RUNNING' }

    try {
      const stat = await fsp.stat(game.exePath)
      if (!stat.isFile()) return { ok: false, error: 'NO_EXE' }
    } catch {
      return { ok: false, error: 'NO_EXE' }
    }

    const cwd = game.installPath && game.installPath.trim() ? game.installPath : path.dirname(game.exePath)
    const startedAt = new Date().toISOString()

    let child
    try {
      child = spawn(game.exePath, [], {
        cwd,
        detached: false,
        stdio: 'ignore',
        windowsHide: false
      })
    } catch (err) {
      return { ok: false, error: String(err) }
    }

    const session: ActiveSession = {
      gameId: game.id,
      exePath: game.exePath,
      startedAt,
      pid: child.pid ?? null
    }
    this.active.set(game.id, session)
    this.emitRunning()

    // The game counts as played the moment it is launched.
    this.touchPlayed(game.id)

    let settled = false
    const finalize = (interrupted = false): void => {
      if (settled) return
      settled = true
      this.finish(session, interrupted)
    }

    child.on('error', () => finalize(false))

    child.on('exit', () => {
      const elapsed = Date.now() - new Date(session.startedAt).getTime()
      if (process.platform === 'win32' && elapsed < 15_000) {
        // Many launchers spawn the real game and exit immediately. Give the
        // process tree a moment, then keep counting while the game is alive.
        void this.awaitProcessTree(session, finalize)
      } else {
        finalize(false)
      }
    })

    return { ok: true }
  }

  /** On Windows, poll tasklist until the game image disappears. */
  private async awaitProcessTree(session: ActiveSession, finalize: (interrupted: boolean) => void): Promise<void> {
    const exeName = path.basename(session.exePath).toLowerCase()
    const deadline = Date.now() + 6 * 60 * 60 * 1000
    // grace period: the stub may still be handing over
    await delay(4000)
    while (Date.now() < deadline) {
      const alive = await this.isImageRunning(exeName)
      if (!alive) break
      await delay(3000)
    }
    finalize(false)
  }

  private async isImageRunning(exeName: string): Promise<boolean> {
    if (process.platform !== 'win32') return false
    try {
      const { stdout } = await execFileAsync('tasklist', ['/FI', `IMAGENAME eq ${exeName}`, '/NH', '/FO', 'CSV'], {
        timeout: 5000
      })
      return stdout.toLowerCase().includes(exeName)
    } catch {
      return false
    }
  }

  /** Close the session and fold the time into the game's stats. */
  private finish(session: ActiveSession, interrupted: boolean): void {
    if (!this.active.has(session.gameId)) return
    this.active.delete(session.gameId)
    this.emitRunning()

    const endedAt = new Date().toISOString()
    const elapsedMs = Date.now() - new Date(session.startedAt).getTime()
    // Any real session counts as at least a minute, the way a game log should.
    const minutes = elapsedMs > 0 ? Math.max(1, Math.round(elapsedMs / 60_000)) : 0
    const record: SessionRecord = {
      id: randomUUID(),
      gameId: session.gameId,
      startedAt: session.startedAt,
      endedAt,
      minutes,
      interrupted
    }
    store.mutate((db) => {
      db.sessions.push(record)
      if (db.sessions.length > 2000) db.sessions.splice(0, db.sessions.length - 2000)
      const game = db.games.find((g) => g.id === session.gameId)
      if (game) {
        game.playtimeMinutes += minutes
        game.playCount += 1
        game.played = true
        game.lastPlayedAt = endedAt
        if (!game.firstPlayedAt) game.firstPlayedAt = session.startedAt
        game.updatedAt = endedAt
      }
    })
    void store.save()

    for (const fn of this.eventListeners) fn({ gameId: session.gameId, minutes, startedAt: session.startedAt, endedAt })
  }

  private touchPlayed(gameId: string): void {
    store.mutate((db) => {
      const game = db.games.find((g) => g.id === gameId)
      if (!game) return
      game.played = true
      if (!game.firstPlayedAt) game.firstPlayedAt = new Date().toISOString()
      game.updatedAt = new Date().toISOString()
    })
    void store.save()
  }

  /** Called on quit — record whatever was still running. */
  shutdown(): void {
    for (const session of [...this.active.values()]) {
      this.finish(session, true)
    }
  }

  private emitRunning(): void {
    const snapshot = this.runningSessions
    for (const fn of this.runningListeners) fn(snapshot)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const launcher = new Launcher()
