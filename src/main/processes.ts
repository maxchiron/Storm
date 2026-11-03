import fs from 'node:fs'
import { log } from './log'

/**
 * The running processes and their executables, for following a game that is
 * not — or no longer — Storm's own child process: one that goes through a
 * launcher, restarts through Steam, or was started by the shell.
 *
 * On Windows this asks the system directly (K32EnumProcesses, then
 * QueryFullProcessImageNameW with the "limited information" right, which a
 * normal process is granted even on games running as administrator). On
 * Linux, where Storm is developed and tested, /proc says the same.
 */

export interface RunningProcess {
  pid: number
  /** Full path of the executable. */
  file: string
}

export type ProcessLister = () => RunningProcess[]

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const MAX_PATH_CHARS = 32768

function windowsLister(): ProcessLister {
  const koffi = require('koffi') as typeof import('koffi')
  const kernel32 = koffi.load('kernel32.dll')
  const enumProcesses = kernel32.func(
    'int __stdcall K32EnumProcesses(void *lpidProcess, uint32_t cb, void *lpcbNeeded)'
  )
  const openProcess = kernel32.func(
    'void * __stdcall OpenProcess(uint32_t dwDesiredAccess, int bInheritHandle, uint32_t dwProcessId)'
  )
  const queryImageName = kernel32.func(
    'int __stdcall QueryFullProcessImageNameW(void *hProcess, uint32_t dwFlags, void *lpExeName, void *lpdwSize)'
  )
  const closeHandle = kernel32.func('int __stdcall CloseHandle(void *hObject)')

  let pids = new Uint32Array(4096)
  const needed = new Uint32Array(1)
  const name = Buffer.alloc(MAX_PATH_CHARS * 2)
  const size = new Uint32Array(1)

  return () => {
    // The list is complete only if it did not fill the buffer.
    for (;;) {
      if (!enumProcesses(pids, pids.byteLength, needed)) return []
      if (needed[0] < pids.byteLength) break
      pids = new Uint32Array(pids.length * 2)
    }
    const out: RunningProcess[] = []
    for (let i = 0; i < needed[0] / 4; i++) {
      const pid = pids[i]
      if (pid === 0) continue
      // Processes we may not even query (system ones, mostly) are not games.
      const handle = openProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid)
      if (!handle) continue
      try {
        size[0] = MAX_PATH_CHARS
        if (queryImageName(handle, 0, name, size)) out.push({ pid, file: name.toString('utf16le', 0, size[0] * 2) })
      } finally {
        closeHandle(handle)
      }
    }
    return out
  }
}

function procLister(): ProcessLister {
  return () => {
    const out: RunningProcess[] = []
    for (const entry of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue
      try {
        out.push({ pid: Number(entry), file: fs.readlinkSync(`/proc/${entry}/exe`) })
      } catch {
        /* gone, or not ours to look at */
      }
    }
    return out
  }
}

let lister: ProcessLister | null | undefined

/** The process lister for this system, or null where there is none (the caller falls back to tasklist). */
export function processLister(): ProcessLister | null {
  if (lister !== undefined) return lister
  lister = null
  try {
    if (process.platform === 'win32') lister = windowsLister()
    else if (process.platform === 'linux') lister = procLister()
  } catch (err) {
    log('launch', 'cannot list processes; games are followed by image name only', err)
  }
  return lister
}
