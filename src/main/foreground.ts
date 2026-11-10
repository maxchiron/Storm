import path from 'node:path'
import { log } from './log'

/**
 * Which window has the keyboard, and handing it to another one — for host
 * mode, which keeps the player either in Storm or in their game.
 *
 * Windows lets a process bring a window to the front only under conditions
 * (it is in the foreground itself, or it received the last input event);
 * otherwise SetForegroundWindow merely flashes the taskbar button. A
 * zero-length mouse input from SendInput counts as "the last input" without
 * moving or pressing anything — the workaround PowerToys uses as well.
 */

export interface ForegroundInfo {
  hwnd: number
  pid: number
  /** The desktop or the taskbar: nothing the player chose to look at. */
  shell: boolean
  /** It covers its whole screen — a game or a video, most likely. */
  fullscreen: boolean
}

export interface Foreground {
  /** The window that has the keyboard; null when there is none (the UAC desktop, a switch half done). */
  current(): ForegroundInfo | null
  /** The biggest visible top-level window of these processes, if they have one. */
  windowOf(pids: Set<number>): number | null
  /** The executable's file name in lower case ("taskmgr.exe"), or '' when it cannot be read. */
  imageOf(pid: number): string
  /** Bring a window to the front, restoring it first if it is minimised. */
  activate(hwnd: number): boolean
}

const SHELL_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd'])
const GW_OWNER = 4
const GWL_EXSTYLE = -20
const WS_EX_TOOLWINDOW = 0x80
const SW_RESTORE = 9
const MONITOR_DEFAULTTONEAREST = 2
/** sizeof(MONITORINFO): cbSize, rcMonitor, rcWork, dwFlags. */
const MONITORINFO_SIZE = 40
const DWMWA_CLOAKED = 14
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
/** sizeof(INPUT) on x64: a DWORD type, padding, and the 32-byte MOUSEINPUT. */
const INPUT_SIZE = 40
/** Smaller than this is a splash screen or a helper, not the game. */
const MIN_SIDE = 160

function bind(): Foreground {
  const koffi = require('koffi') as typeof import('koffi')
  const user32 = koffi.load('user32.dll')
  const kernel32 = koffi.load('kernel32.dll')

  const getForegroundWindow = user32.func('intptr_t __stdcall GetForegroundWindow()')
  const getWindowThreadProcessId = user32.func(
    'uint32_t __stdcall GetWindowThreadProcessId(intptr_t hWnd, void *lpdwProcessId)'
  )
  koffi.proto('int __stdcall StormEnumWindowsProc(intptr_t hwnd, intptr_t lParam)')
  const enumWindows = user32.func('int __stdcall EnumWindows(StormEnumWindowsProc *lpEnumFunc, intptr_t lParam)')
  const isWindowVisible = user32.func('int __stdcall IsWindowVisible(intptr_t hWnd)')
  const isIconic = user32.func('int __stdcall IsIconic(intptr_t hWnd)')
  const getWindow = user32.func('intptr_t __stdcall GetWindow(intptr_t hWnd, uint32_t uCmd)')
  const getWindowLong = user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hWnd, int nIndex)')
  const getWindowRect = user32.func('int __stdcall GetWindowRect(intptr_t hWnd, void *lpRect)')
  const getClassName = user32.func('int __stdcall GetClassNameW(intptr_t hWnd, void *lpClassName, int nMaxCount)')
  const showWindow = user32.func('int __stdcall ShowWindow(intptr_t hWnd, int nCmdShow)')
  const setForegroundWindow = user32.func('int __stdcall SetForegroundWindow(intptr_t hWnd)')
  const bringWindowToTop = user32.func('int __stdcall BringWindowToTop(intptr_t hWnd)')
  const sendInput = user32.func('uint32_t __stdcall SendInput(uint32_t cInputs, void *pInputs, int cbSize)')
  const monitorFromWindow = user32.func('intptr_t __stdcall MonitorFromWindow(intptr_t hwnd, uint32_t dwFlags)')
  const getMonitorInfo = user32.func('int __stdcall GetMonitorInfoW(intptr_t hMonitor, void *lpmi)')

  const openProcess = kernel32.func(
    'void * __stdcall OpenProcess(uint32_t dwDesiredAccess, int bInheritHandle, uint32_t dwProcessId)'
  )
  const queryImageName = kernel32.func(
    'int __stdcall QueryFullProcessImageNameW(void *hProcess, uint32_t dwFlags, void *lpExeName, void *lpdwSize)'
  )
  const closeHandle = kernel32.func('int __stdcall CloseHandle(void *hObject)')

  // Cloaked windows (suspended store apps, other virtual desktops) are
  // "visible" yet nowhere on screen. Without DWM everything counts as shown.
  let isCloaked: (hwnd: number) => boolean = () => false
  try {
    const dwmGetWindowAttribute = koffi
      .load('dwmapi.dll')
      .func(
        'int32_t __stdcall DwmGetWindowAttribute(intptr_t hwnd, uint32_t dwAttribute, void *pvAttribute, uint32_t cbAttribute)'
      )
    const cloaked = new Uint32Array(1)
    isCloaked = (hwnd) => {
      cloaked[0] = 0
      return dwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, cloaked, 4) === 0 && cloaked[0] !== 0
    }
  } catch (err) {
    log('host', 'dwmapi unavailable', err)
  }

  const pidBuf = new Uint32Array(1)
  const rect = new Int32Array(4)
  const monitorInfo = new Int32Array(MONITORINFO_SIZE / 4)
  const classBuf = Buffer.alloc(512)
  const nameBuf = Buffer.alloc(32768 * 2)
  const nameSize = new Uint32Array(1)
  // Type 0 is INPUT_MOUSE; all zero is a mouse "move" by nothing at all.
  const noInput = Buffer.alloc(INPUT_SIZE)

  const pidOf = (hwnd: number): number => {
    pidBuf[0] = 0
    getWindowThreadProcessId(hwnd, pidBuf)
    return pidBuf[0]
  }

  const className = (hwnd: number): string => {
    const n = getClassName(hwnd, classBuf, 256)
    return n > 0 ? classBuf.toString('utf16le', 0, n * 2) : ''
  }

  /** Whether the window covers the whole of the screen it is on. */
  const coversScreen = (hwnd: number): boolean => {
    if (isIconic(hwnd) || !getWindowRect(hwnd, rect)) return false
    const monitor = Number(monitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST))
    monitorInfo.fill(0)
    monitorInfo[0] = MONITORINFO_SIZE
    if (!monitor || !getMonitorInfo(monitor, monitorInfo)) return false
    // rcMonitor follows cbSize: left, top, right, bottom.
    return (
      rect[0] <= monitorInfo[1] && rect[1] <= monitorInfo[2] && rect[2] >= monitorInfo[3] && rect[3] >= monitorInfo[4]
    )
  }

  return {
    current() {
      const hwnd = Number(getForegroundWindow())
      if (!hwnd) return null
      const shell = SHELL_CLASSES.has(className(hwnd))
      return { hwnd, pid: pidOf(hwnd), shell, fullscreen: !shell && coversScreen(hwnd) }
    },

    windowOf(pids) {
      if (pids.size === 0) return null
      // Only collected during the enumeration; looked at once it is over.
      const all: number[] = []
      enumWindows((hwnd: number) => {
        all.push(Number(hwnd))
        return 1
      }, 0)
      const candidates = all.filter((hwnd) => isWindowVisible(hwnd) && pids.has(pidOf(hwnd)))
      let best: number | null = null
      let bestArea = 0
      for (const hwnd of candidates) {
        if (Number(getWindow(hwnd, GW_OWNER)) !== 0) continue
        if (Number(getWindowLong(hwnd, GWL_EXSTYLE)) & WS_EX_TOOLWINDOW) continue
        if (isCloaked(hwnd)) continue
        let area: number
        if (isIconic(hwnd)) {
          // A minimised window has no real size, but it is still the game.
          area = 1
        } else {
          if (!getWindowRect(hwnd, rect)) continue
          const width = rect[2] - rect[0]
          const height = rect[3] - rect[1]
          if (width < MIN_SIDE || height < MIN_SIDE) continue
          area = width * height
        }
        if (area > bestArea) {
          best = hwnd
          bestArea = area
        }
      }
      return best
    },

    imageOf(pid) {
      const handle = openProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid)
      if (!handle) return ''
      try {
        nameSize[0] = 32768
        if (!queryImageName(handle, 0, nameBuf, nameSize)) return ''
        return path.win32.basename(nameBuf.toString('utf16le', 0, nameSize[0] * 2)).toLowerCase()
      } finally {
        closeHandle(handle)
      }
    },

    activate(hwnd) {
      if (isIconic(hwnd)) showWindow(hwnd, SW_RESTORE)
      if (setForegroundWindow(hwnd)) return true
      sendInput(1, noInput, INPUT_SIZE)
      const ok = setForegroundWindow(hwnd) !== 0
      bringWindowToTop(hwnd)
      return ok
    }
  }
}

let native: Foreground | null | undefined

/** The Win32 calls, bound on first use; null anywhere but Windows, or if they cannot be bound. */
export function foreground(): Foreground | null {
  if (native !== undefined) return native
  native = null
  if (process.platform !== 'win32') return native
  try {
    native = bind()
  } catch (err) {
    log('host', 'cannot follow the foreground window; host mode keeps Storm in front only', err)
  }
  return native
}

/** A BrowserWindow's HWND as a number. */
export function hwndOf(handle: Buffer): number {
  return handle.length >= 8 ? Number(handle.readBigUInt64LE(0)) : handle.readUInt32LE(0)
}
