import { utilityProcess, type UtilityProcess } from 'electron'
import path from 'node:path'
import { log } from './log'
import type { CaptureReply, CaptureRequest } from './capture-process'
import type { Rect } from './dxgi'

/**
 * The main-process end of the capture process (capture-process.ts): started
 * when a screenshot first needs it, let go after a while without any, and
 * given up on for the session if it keeps dying — screenshots then simply use
 * the ordinary capture, as they did before HDR was handled.
 */

const IDLE_MS = 120_000
/** Far more than a 4K frame takes; past this the process is presumed stuck. */
const REPLY_MS = 8_000
const MAX_FAILURES = 2

class CaptureProcess {
  private child: UtilityProcess | null = null
  private waiting = new Map<number, (reply: CaptureReply) => void>()
  private nextId = 1
  private idleTimer: NodeJS.Timeout | null = null
  private failures = 0

  /** Windows only, and only while it has not failed too often. */
  get usable(): boolean {
    return process.platform === 'win32' && this.failures < MAX_FAILURES
  }

  /** The screen covering rect (physical pixels). Never rejects: a failure is a reply too. */
  capture(rect: Rect): Promise<CaptureReply> {
    const id = this.nextId++
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    return new Promise<CaptureReply>((resolve) => {
      let child: UtilityProcess
      try {
        child = this.start()
      } catch (err) {
        this.failed('could not be started', err)
        resolve({ id, kind: 'failed', reason: 'the capture process could not be started' })
        return
      }
      const timer = setTimeout(() => {
        this.waiting.delete(id)
        this.failed(`did not answer within ${REPLY_MS / 1000} s`)
        this.stop()
        resolve({ id, kind: 'failed', reason: 'the capture process did not answer' })
      }, REPLY_MS)
      this.waiting.set(id, (reply) => {
        clearTimeout(timer)
        resolve(reply)
      })
      child.postMessage({ id, rect } satisfies CaptureRequest)
    }).finally(() => this.idleLater())
  }

  dispose(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    this.stop()
  }

  private start(): UtilityProcess {
    if (this.child) return this.child
    const child = utilityProcess.fork(path.join(__dirname, 'capture-process.js'), [], {
      serviceName: 'Storm screen capture'
    })
    child.on('message', (reply: CaptureReply) => {
      const done = this.waiting.get(reply.id)
      this.waiting.delete(reply.id)
      done?.(reply)
    })
    child.on('exit', (code) => {
      // Stopped on purpose: stop() has already let go of it.
      if (this.child !== child) return
      this.child = null
      this.failed(`exited unexpectedly (code ${code})`)
      for (const [id, done] of this.waiting)
        done({ id, kind: 'failed', reason: `the capture process exited (${code})` })
      this.waiting.clear()
    })
    this.child = child
    return child
  }

  private stop(): void {
    const child = this.child
    this.child = null
    child?.kill()
  }

  private idleLater(): void {
    if (this.waiting.size > 0 || !this.child) return
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.stop(), IDLE_MS)
  }

  private failed(what: string, detail?: unknown): void {
    this.failures++
    log(
      'shot',
      `capture process ${what}` + (this.usable ? '' : '; HDR screenshots are off until Storm restarts'),
      detail
    )
  }
}

export const hdrCapture = new CaptureProcess()
