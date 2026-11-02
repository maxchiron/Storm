import { shell } from 'electron'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { store } from './store'
import type { Game, LaunchError, RunningSession, SessionEvent, SessionRecord } from '@shared/types'

const execFileAsync = promisify(execFile)

interface ActiveSession {
  gameId: string
  exePath: string
  startedAt: string
  pid: number | null
}

export type SessionListener = (running: RunningSession[]) => void
export type SessionEventListener = (payload: SessionEvent) => void
export type LaunchResult = { ok: true } | { ok: false; error: LaunchError }

/**
 * Split a Windows-style argument string: whitespace separates arguments,
 * double quotes group them, and \" is a literal quote.
 */
export function splitArgs(value: string): string[] {
  const out: string[] = []
  let current = ''
  let quoted = false
  let started = false
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch === '\\' && value[i + 1] === '"') {
      current += '"'
      started = true
      i++
    } else if (ch === '"') {
      quoted = !quoted
      started = true
    } else if (/\s/.test(ch) && !quoted) {
      if (started) out.push(current)
      current = ''
      started = false
    } else {
      current += ch
      started = true
    }
  }
  if (started) out.push(current)
  return out
}

/** Quote one argument for a cmd.exe command line. */
function cmdQuote(arg: string): string {
  return /[\s"&|<>^()]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg
}

/**
 * Launches a game's executable and keeps a play session alive for as long as
 * the process lives, so Storm can show real playtime.
 */
export class Launcher {
  private active = new Map<string, ActiveSession>()
  /** Games between "launch pressed" and "process started" — blocks a double launch. */
  private pending = new Set<string>()
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

  get hasRunning(): boolean {
    return this.active.size > 0
  }

  /** The game started most recently, if any is still running. */
  get latestGameId(): string | null {
    let latest: ActiveSession | null = null
    for (const s of this.active.values()) {
      if (!latest || s.startedAt > latest.startedAt) latest = s
    }
    return latest?.gameId ?? null
  }

  /** Work out what to actually spawn for a game's executable. */
  private async command(game: Game): Promise<{ file: string; args: string[]; cwd: string; shell: boolean } | null> {
    const exePath = game.exePath
    if (!exePath) return null
    const extra = splitArgs(game.args)
    const ext = path.extname(exePath).toLowerCase()

    if (ext === '.lnk') {
      // Libraries from before 1.0.4 could store a shortcut as the executable.
      if (process.platform !== 'win32') return null
      try {
        const link = shell.readShortcutLink(exePath)
        if (!link.target) return null
        return {
          file: link.target,
          args: [...splitArgs(link.args ?? ''), ...extra],
          cwd: link.cwd || path.dirname(link.target),
          shell: false
        }
      } catch {
        return null
      }
    }

    if (ext === '.bat' || ext === '.cmd') {
      // Batch files cannot be spawned directly (Node refuses since the
      // CVE-2024-27980 fix); they run through cmd.exe with explicit quoting.
      return {
        file: cmdQuote(exePath),
        args: extra.map(cmdQuote),
        cwd: path.dirname(exePath),
        shell: true
      }
    }

    // A game expects to start in its own folder, the way a double-click in
    // Explorer starts it — not in the (possibly higher) install root.
    return { file: exePath, args: extra, cwd: path.dirname(exePath), shell: false }
  }

  async launch(game: Game): Promise<LaunchResult> {
    if (!game.exePath) return { ok: false, error: 'NO_EXE' }
    if (this.active.has(game.id) || this.pending.has(game.id)) return { ok: false, error: 'ALREADY_RUNNING' }

    this.pending.add(game.id)
    let child: ChildProcess
    let exePath: string
    try {
      try {
        const stat = await fsp.stat(game.exePath)
        if (!stat.isFile()) return { ok: false, error: 'NO_EXE' }
      } catch {
        return { ok: false, error: 'NO_EXE' }
      }
      const cmd = await this.command(game)
      if (!cmd) return { ok: false, error: 'NO_EXE' }
      exePath = cmd.shell ? game.exePath : cmd.file

      try {
        child = spawn(cmd.file, cmd.args, {
          cwd: cmd.cwd,
          detached: false,
          stdio: 'ignore',
          windowsHide: false,
          shell: cmd.shell
        })
      } catch {
        return { ok: false, error: 'SPAWN_FAILED' }
      }

      // A missing or blocked executable fails *after* spawn() returns, through
      // the 'error' event. Wait for the outcome so a failed launch is reported
      // as one — and never counted as a play session.
      const started = await new Promise<boolean>((resolve) => {
        child.once('spawn', () => resolve(true))
        child.once('error', () => resolve(false))
      })
      if (!started) return { ok: false, error: 'SPAWN_FAILED' }
    } finally {
      this.pending.delete(game.id)
    }

    const session: ActiveSession = {
      gameId: game.id,
      exePath,
      startedAt: new Date().toISOString(),
      pid: child.pid ?? null
    }
    this.active.set(game.id, session)
    this.emitRunning()

    // The game counts as played the moment it is launched.
    this.touchPlayed(game.id, session.startedAt)

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
        // Many launchers start the real game and exit immediately. Give the
        // process a moment, then keep counting while the game is alive.
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
    while (Date.now() < deadline && this.active.get(session.gameId) === session) {
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
        timeout: 5000,
        windowsHide: true
      })
      return stdout.toLowerCase().includes(`"${exeName}"`)
    } catch {
      return false
    }
  }

  /** Close the session and fold the time into the game's stats. */
  private finish(session: ActiveSession, interrupted: boolean): void {
    if (this.active.get(session.gameId) !== session) return
    this.active.delete(session.gameId)
    this.emitRunning()

    const endedAt = new Date().toISOString()
    const elapsedMs = Date.now() - new Date(session.startedAt).getTime()
    // Any real session counts as at least a minute, the way a game log should.
    const minutes = elapsedMs > 0 ? Math.max(1, Math.round(elapsedMs / 60_000)) : 0

    const game = store.getGame(session.gameId)
    // The game may have been deleted while it was running — keep no orphans.
    if (game) {
      const record: SessionRecord = {
        id: randomUUID(),
        gameId: session.gameId,
        startedAt: session.startedAt,
        endedAt,
        minutes,
        interrupted
      }
      store.addSession(record)
      store.mutate(() => {
        game.playtimeMinutes += minutes
        game.playCount += 1
        game.played = true
        game.lastPlayedAt = endedAt
        if (!game.firstPlayedAt) game.firstPlayedAt = session.startedAt
        game.updatedAt = endedAt
      })
      void store.save()
    }

    const payload: SessionEvent = { gameId: session.gameId, minutes, startedAt: session.startedAt, endedAt }
    for (const fn of this.eventListeners) fn(payload)
  }

  private touchPlayed(gameId: string, at: string): void {
    store.mutate((db) => {
      const game = db.games.find((g) => g.id === gameId)
      if (!game) return
      game.played = true
      if (!game.firstPlayedAt) game.firstPlayedAt = at
      game.updatedAt = at
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
