import { log } from './log'

/**
 * Keyboard and controller state read straight from Windows, so the screenshot
 * shortcuts work while a game has focus.
 *
 * Neither of Electron's own routes survives a game in front:
 *  - Chromium reads Xbox-style controllers through Windows.Gaming.Input,
 *    which only reports to the window that has focus. The renderer's Gamepad
 *    API sees nothing at all while the game is being played.
 *  - globalShortcut is RegisterHotKey. Games that take raw keyboard input
 *    with hotkeys disabled never let it through, and Windows reserves F12 —
 *    the default — for the debugger.
 * XInputGetState and GetAsyncKeyState answer whichever window has focus.
 *
 * Both are polled, which is cheap: a handful of calls every POLL_MS, and only
 * while Storm is listening for the shortcuts.
 */

const POLL_MS = 30
/** XInput's own advice: look for newly connected controllers every few seconds, not every frame. */
const PROBE_MS = 2000
const XUSER_MAX_COUNT = 4
const ERROR_SUCCESS = 0

const VK_SHIFT = 0x10
const VK_CONTROL = 0x11
const VK_MENU = 0x12
const VK_LWIN = 0x5b
const VK_RWIN = 0x5c

/** The triggers are analog; like the renderer, count them once they are more than half way down. */
const LEFT_TRIGGER = 0x10000
const RIGHT_TRIGGER = 0x20000

/** Gamepad API standard-mapping button → its bit in a pad mask (XInput's wButtons, plus the triggers). */
const PAD_BITS: Record<number, number> = {
  0: 0x1000, // A
  1: 0x2000, // B
  2: 0x4000, // X
  3: 0x8000, // Y
  4: 0x0100, // LB
  5: 0x0200, // RB
  6: LEFT_TRIGGER,
  7: RIGHT_TRIGGER,
  8: 0x0020, // View
  9: 0x0010, // Menu
  10: 0x0040, // L3
  11: 0x0080, // R3
  12: 0x0001, // D-pad up
  13: 0x0002, // D-pad down
  14: 0x0004, // D-pad left
  15: 0x0008 // D-pad right
  // 16, the Xbox button, belongs to Windows: XInput does not report it.
}

/** Accelerator key names (lower case) → virtual-key codes. */
const KEY_CODES: Record<string, number> = {
  space: 0x20,
  tab: 0x09,
  enter: 0x0d,
  return: 0x0d,
  backspace: 0x08,
  delete: 0x2e,
  insert: 0x2d,
  home: 0x24,
  end: 0x23,
  pageup: 0x21,
  pagedown: 0x22,
  left: 0x25,
  up: 0x26,
  right: 0x27,
  down: 0x28,
  printscreen: 0x2c,
  scrolllock: 0x91,
  capslock: 0x14,
  numlock: 0x90,
  esc: 0x1b,
  escape: 0x1b,
  '-': 0xbd,
  '=': 0xbb,
  plus: 0xbb,
  '[': 0xdb,
  ']': 0xdd,
  '\\': 0xdc,
  ';': 0xba,
  "'": 0xde,
  ',': 0xbc,
  '.': 0xbe,
  '/': 0xbf,
  '`': 0xc0,
  numadd: 0x6b,
  numsub: 0x6d,
  nummult: 0x6a,
  numdiv: 0x6f,
  numdec: 0x6e
}

export interface KeyChord {
  key: number
  ctrl: boolean
  alt: boolean
  shift: boolean
  win: boolean
}

function keyCode(name: string): number {
  const fn = /^f([1-9]|1\d|2[0-4])$/.exec(name)
  if (fn) return 0x6f + Number(fn[1])
  if (/^[a-z]$/.test(name)) return name.toUpperCase().charCodeAt(0)
  if (/^\d$/.test(name)) return 0x30 + Number(name)
  const num = /^num(\d)$/.exec(name)
  if (num) return 0x60 + Number(num[1])
  return KEY_CODES[name] ?? 0
}

/**
 * An Electron accelerator ("F12", "Ctrl+Shift+S") as virtual keys, or null
 * for one this module cannot follow (globalShortcut still handles those).
 */
export function parseAccelerator(accelerator: string): KeyChord | null {
  const chord: KeyChord = { key: 0, ctrl: false, alt: false, shift: false, win: false }
  for (const raw of accelerator.split(/\+(?!$)/)) {
    const part = raw.trim().toLowerCase()
    if (part === 'ctrl' || part === 'control' || part === 'cmdorctrl' || part === 'commandorcontrol') chord.ctrl = true
    else if (part === 'alt') chord.alt = true
    else if (part === 'shift') chord.shift = true
    else if (part === 'super' || part === 'meta') chord.win = true
    else if (chord.key) return null
    else {
      chord.key = keyCode(part)
      if (!chord.key) return null
    }
  }
  return chord.key ? chord : null
}

/** The buttons of a controller combo as a pad mask, or null if XInput cannot see all of them. */
export function padMask(combo: number[]): number | null {
  if (combo.length === 0) return null
  let mask = 0
  for (const button of combo) {
    const bit = PAD_BITS[button]
    if (!bit) return null
    mask |= bit
  }
  return mask
}

export interface NativeInput {
  keyDown(vk: number): boolean
  /** The pad mask of the controller in this XInput slot, or null when the slot is empty. */
  pad(slot: number): number | null
}

let native: NativeInput | null | undefined

/**
 * The Win32 calls, bound on first use. koffi is required here rather than
 * imported so that a missing or broken native module costs the shortcuts
 * their reach into games, never Storm its start-up.
 */
function nativeInput(): NativeInput | null {
  if (native !== undefined) return native
  native = null
  if (process.platform !== 'win32') return native
  try {
    const koffi = require('koffi') as typeof import('koffi')
    const user32 = koffi.load('user32.dll')
    const getAsyncKeyState = user32.func('int16_t __stdcall GetAsyncKeyState(int vKey)')

    let getState: ((slot: number, state: Buffer) => number) | null = null
    for (const dll of ['xinput1_4.dll', 'xinput9_1_0.dll']) {
      try {
        getState = koffi.load(dll).func('uint32_t __stdcall XInputGetState(uint32_t dwUserIndex, _Out_ void *pState)')
        break
      } catch (err) {
        log('input', `${dll} unavailable`, err)
      }
    }
    if (!getState) log('input', 'no XInput: controllers are only seen while Storm has focus')

    // XINPUT_STATE: DWORD dwPacketNumber, then XINPUT_GAMEPAD — WORD wButtons,
    // BYTE bLeftTrigger, BYTE bRightTrigger, four SHORT thumb axes.
    const state = Buffer.alloc(16)
    native = {
      keyDown: (vk) => (getAsyncKeyState(vk) & 0x8000) !== 0,
      pad: (slot) => {
        if (!getState || getState(slot, state) !== ERROR_SUCCESS) return null
        return state.readUInt16LE(4) | (state[6] > 127 ? LEFT_TRIGGER : 0) | (state[7] > 127 ? RIGHT_TRIGGER : 0)
      }
    }
  } catch (err) {
    log('input', 'native input unavailable; shortcuts rely on globalShortcut and the window', err)
  }
  return native
}

function sameChord(a: KeyChord | null, b: KeyChord | null): boolean {
  if (!a || !b) return a === b
  return a.key === b.key && a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift && a.win === b.win
}

export type WatchSource = 'key' | 'pad'

/** Polls for one key chord and one controller combo, and reports each fresh press. */
export class ShortcutWatcher {
  private timer: NodeJS.Timeout | null = null
  private chord: KeyChord | null = null
  private mask: number | null = null
  // Whatever is already held when watching starts is not a fresh press.
  private keyHeld = true
  private padHeld = true
  private slots = new Set<number>()
  private probedAt = 0

  private constructor(
    private readonly input: NativeInput,
    private readonly fire: (source: WatchSource) => void
  ) {}

  /** A watcher, or null where Windows' input APIs are not available. */
  static create(fire: (source: WatchSource) => void): ShortcutWatcher | null {
    const input = nativeInput()
    return input ? new ShortcutWatcher(input, fire) : null
  }

  /** Watch for this chord and this pad mask; null turns either off. */
  watch(chord: KeyChord | null, mask: number | null): void {
    if (sameChord(chord, this.chord) && mask === this.mask) return
    this.chord = chord
    this.mask = mask
    this.keyHeld = true
    this.padHeld = true
    if (!chord && mask === null) {
      this.stop()
    } else if (!this.timer) {
      this.probedAt = 0
      this.timer = setInterval(() => this.tick(), POLL_MS)
      this.timer.unref()
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.chord = null
    this.mask = null
  }

  private tick(): void {
    try {
      if (this.chord) {
        const down = this.chordDown(this.chord)
        if (down && !this.keyHeld) this.fire('key')
        this.keyHeld = down
      }
      if (this.mask !== null) {
        const down = this.padDown(this.mask)
        if (down && !this.padHeld) this.fire('pad')
        this.padHeld = down
      }
    } catch (err) {
      log('input', 'polling failed and stopped', err)
      this.stop()
    }
  }

  /** The chord's key with exactly its modifiers, the way RegisterHotKey matches. */
  private chordDown(c: KeyChord): boolean {
    const down = (vk: number): boolean => this.input.keyDown(vk)
    if (!down(c.key)) return false
    return (
      down(VK_CONTROL) === c.ctrl &&
      down(VK_MENU) === c.alt &&
      down(VK_SHIFT) === c.shift &&
      (down(VK_LWIN) || down(VK_RWIN)) === c.win
    )
  }

  private padDown(mask: number): boolean {
    const now = Date.now()
    const probe = now - this.probedAt >= PROBE_MS
    if (probe) this.probedAt = now
    let held = false
    for (let slot = 0; slot < XUSER_MAX_COUNT; slot++) {
      if (!probe && !this.slots.has(slot)) continue
      const buttons = this.input.pad(slot)
      if (buttons === null) {
        if (this.slots.delete(slot)) log('input', `controller ${slot + 1} disconnected`)
        continue
      }
      if (!this.slots.has(slot)) {
        this.slots.add(slot)
        log('input', `controller ${slot + 1} connected`)
      }
      if ((buttons & mask) === mask) held = true
    }
    return held
  }
}
