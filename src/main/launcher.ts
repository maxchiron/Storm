import { shell } from 'electron'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { store } from './store'
import { log } from './log'
import { shellStart } from './winshell'
import { processLister, type RunningProcess } from './processes'
import type { Game, LaunchError, RunningSession, SessionEvent, SessionRecord } from '@shared/types'

const execFileAsync = promisify(execFile)

/** A launched process that ends sooner than this was a launcher or a stub, not the game. */
const STUB_MS = 15_000
/** How often a game followed by its folder is looked for. */
const FOLLOW_POLL_MS = 3000
/** How long a launcher may take to bring the game up — Steam may have to start first. */
const STARTUP_GRACE_MS = 90_000
/** How long the game may be gone while it hands over: a launcher to the game, a restart. */
const HANDOVER_GRACE_MS = 20_000

/** Whether a file lies somewhere below a folder (case-insensitively on Windows). */
function isInside(file: string, dir: string): boolean {
  const rel = path.relative(dir, file)
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/** What the game folder is following, for the log: "tlou-i.exe, crs-handler.exe". */
function names(processes: RunningProcess[]): string {
  return [...new Set(processes.map((p) => path.basename(p.file)))].join(', ')
}

interface ActiveSession {
  gameId: string
  exePath: string
  startedAt: string
  pid: number | null
}

export type SessionListener = (running: RunningSession[]) => void
export type SessionEventListener = (payload: SessionEvent) => void
export type LaunchResult = { ok: true } | { ok: false; error: LaunchError }

/** What to actually start for a game. */
interface Command {
  file: string
  args: string[]
  cwd: string
  shell: boolean
}

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
  private async command(game: Game): Promise<Command | null> {
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
    let child: ChildProcess | null
    let exePath: string
    let folder: string | null = null
    let before = new Set<number>()
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

      // Whatever already runs from the game's folder was not started by this launch.
      folder = this.followFolder(game, exePath)
      const already = folder ? this.runningIn(folder, new Set()) : null
      before = new Set(already?.map((p) => p.pid))

      child = await this.spawnGame(game.title, cmd)
      if (!child) {
        // What CreateProcess refuses — a game set to run as administrator,
        // above all — the shell can still start, with a UAC prompt, the way
        // a double-click in Explorer does (see winshell.ts).
        if (process.platform !== 'win32' || cmd.shell) return { ok: false, error: 'SPAWN_FAILED' }
        const error = await shellStart(cmd.file, cmd.args, cmd.cwd)
        if (error) {
          log('launch', `${game.title}: the shell could not start it either`, error)
          return { ok: false, error: 'SPAWN_FAILED' }
        }
        log('launch', `${game.title}: started through the shell`)
      }
    } finally {
      this.pending.delete(game.id)
    }

    const session: ActiveSession = {
      gameId: game.id,
      exePath,
      startedAt: new Date().toISOString(),
      pid: child?.pid ?? null
    }
    this.active.set(game.id, session)
    this.emitRunning()

    // The game counts as played the moment it is launched.
    this.touchPlayed(game.id, session.startedAt)

    let settled = false
    const finalize = (interrupted = false, endedAt = Date.now()): void => {
      if (settled) return
      settled = true
      this.finish(session, interrupted, endedAt)
    }

    if (!child) {
      // Started by the shell: there is no process of ours to wait for, only the game's own.
      if (folder) void this.follow(game.title, session, folder, before, finalize)
      else void this.awaitProcessTree(session, finalize)
      return { ok: true }
    }

    child.on('error', () => finalize(false))
    child.on('exit', () => {
      const elapsed = Date.now() - new Date(session.startedAt).getTime()
      if (folder) {
        // A game that simply closed leaves nothing behind in its folder. A
        // launcher leaves the game it started — follow that instead.
        const others = this.runningIn(folder, before)
        if (elapsed >= STUB_MS && others?.length === 0) finalize(false)
        else void this.follow(game.title, session, folder, before, finalize)
      } else if (process.platform === 'win32' && elapsed < STUB_MS) {
        // No way to list processes: fall back to the launched image's name.
        void this.awaitProcessTree(session, finalize)
      } else {
        finalize(false)
      }
    })

    return { ok: true }
  }

  /**
   * The folder whose processes count as the game: the install folder when the
   * executable is inside it (a launcher and its game sit side by side there,
   * and Unreal games keep the real one a few folders down), otherwise the
   * executable's own. Never a whole drive, and the install folder only when
   * no other game of the library lives in it too.
   */
  private followFolder(game: Game, exePath: string): string | null {
    if (!processLister()) return null
    const exeDir = path.dirname(exePath)
    const isRoot = (dir: string): boolean => path.parse(dir).root === dir
    const install = game.installPath ? path.resolve(game.installPath) : ''
    if (install && !isRoot(install) && isInside(exePath, install)) {
      const shared = store.games.some((g) => g.id !== game.id && !!g.exePath && isInside(g.exePath, install))
      if (!shared) return install
    }
    return isRoot(exeDir) ? null : exeDir
  }

  /** Processes running from the folder, apart from those listed; null when they cannot be listed. */
  private runningIn(folder: string, except: Set<number>): RunningProcess[] | null {
    const list = processLister()
    if (!list) return null
    try {
      return list().filter((p) => !except.has(p.pid) && isInside(p.file, folder))
    } catch (err) {
      log('launch', 'listing processes failed', err)
      return null
    }
  }

  /**
   * Follow a game by its folder: it is being played for as long as anything
   * started from there runs — the launcher, the game it brings up, the game
   * restarted through Steam. Ends at the last moment any of it was seen.
   */
  private async follow(
    title: string,
    session: ActiveSession,
    folder: string,
    before: Set<number>,
    finalize: (interrupted: boolean, endedAt: number) => void
  ): Promise<void> {
    let lastSeen = Date.now()
    let following = ''
    while (this.active.get(session.gameId) === session) {
      await delay(FOLLOW_POLL_MS)
      const running = this.runningIn(folder, before) ?? []
      const now = Date.now()
      if (running.length > 0) {
        const current = names(running)
        if (current !== following) log('launch', `${title}: following ${current}`)
        following = current
        lastSeen = now
      } else if (now - lastSeen >= (following ? HANDOVER_GRACE_MS : STARTUP_GRACE_MS)) {
        break
      }
    }
    finalize(false, lastSeen)
  }

  /**
   * spawn() and wait for the outcome: a missing or blocked executable fails
   * *after* spawn() returns, through the 'error' event. Waiting means a failed
   * launch is reported as one — and never counted as a play session.
   */
  private async spawnGame(title: string, cmd: Command): Promise<ChildProcess | null> {
    let child: ChildProcess
    try {
      child = spawn(cmd.file, cmd.args, {
        cwd: cmd.cwd,
        detached: false,
        stdio: 'ignore',
        windowsHide: false,
        shell: cmd.shell
      })
    } catch (err) {
      log('launch', `${title}: could not start ${cmd.file}`, err)
      return null
    }
    const error = await new Promise<unknown>((resolve) => {
      child.once('spawn', () => resolve(null))
      child.once('error', (err) => resolve(err))
    })
    if (!error) return child
    log('launch', `${title}: could not start ${cmd.file}`, error)
    return null
  }

  /** Without a process list: poll tasklist until the launched image disappears. */
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
  private finish(session: ActiveSession, interrupted: boolean, endedAtMs = Date.now()): void {
    if (this.active.get(session.gameId) !== session) return
    this.active.delete(session.gameId)
    this.emitRunning()

    const endedAt = new Date(endedAtMs).toISOString()
    const elapsedMs = endedAtMs - new Date(session.startedAt).getTime()
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
