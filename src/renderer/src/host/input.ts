import { useEffect, useRef } from 'react'
import { connectedPads } from '../utils/gamepad'

/**
 * Controller input for host mode.
 *
 * One loop reads every connected controller (and the keyboard, for whoever
 * has one at hand) and turns presses into actions. The action goes to one
 * place only: the topmost "layer" — the viewer over the details page over
 * the home screen — so a press is never handled twice.
 *
 *   D-pad / left stick   up · down · left · right (repeats while held)
 *   A B X Y              a · b · x · y
 *   LB RB LT RT          lb · rb · lt · rt
 *   Menu (≡) / View (⧉)  menu · view
 *
 * Input only counts while Storm has the focus. Chromium keeps reading some
 * controllers (PlayStation ones, through raw input) while a game is in front,
 * and a press meant for the game must never start another one behind it. A
 * button still held when the focus comes back (the A that quit the game)
 * counts only once it has been let go.
 */

export type HostAction =
  'up' | 'down' | 'left' | 'right' | 'a' | 'b' | 'x' | 'y' | 'lb' | 'rb' | 'lt' | 'rt' | 'menu' | 'view'

const ACTIONS: HostAction[] = [
  'up',
  'down',
  'left',
  'right',
  'a',
  'b',
  'x',
  'y',
  'lb',
  'rb',
  'lt',
  'rt',
  'menu',
  'view'
]

/** Standard-mapping button → action. */
const BUTTONS: [number, HostAction][] = [
  [0, 'a'],
  [1, 'b'],
  [2, 'x'],
  [3, 'y'],
  [4, 'lb'],
  [5, 'rb'],
  [6, 'lt'],
  [7, 'rt'],
  [8, 'view'],
  [9, 'menu'],
  [12, 'up'],
  [13, 'down'],
  [14, 'left'],
  [15, 'right']
]

const KEYS: Record<string, HostAction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'a',
  ' ': 'a',
  Escape: 'b',
  Backspace: 'b',
  x: 'x',
  X: 'x',
  y: 'y',
  Y: 'y',
  q: 'lb',
  Q: 'lb',
  e: 'rb',
  E: 'rb',
  PageUp: 'lb',
  PageDown: 'rb',
  '-': 'lt',
  '=': 'rt',
  '+': 'rt',
  m: 'menu',
  M: 'menu'
}

const REPEATS = new Set<HostAction>(['up', 'down', 'left', 'right'])
const FIRST_REPEAT_MS = 380
const REPEAT_MS = 110
/** Held longer than this, the repeat speeds up — long libraries scroll by quickly. */
const FAST_AFTER_MS = 1400
const FAST_REPEAT_MS = 55
/** How far a stick has to go to count as a direction, and how far back to let it go. */
const STICK_ON = 0.55
const STICK_OFF = 0.35

type Handler = (action: HostAction) => void

interface Layer {
  id: number
  priority: number
  handler: { current: Handler }
}

const layers: Layer[] = []
let layerSeq = 0
const inputListeners = new Set<(source: 'pad' | 'key') => void>()

/** The layer that gets the input: highest priority, then the most recent. */
function topLayer(): Layer | undefined {
  let top: Layer | undefined
  for (const layer of layers) {
    if (!top || layer.priority > top.priority || (layer.priority === top.priority && layer.id > top.id)) top = layer
  }
  return top
}

function dispatch(action: HostAction, source: 'pad' | 'key'): void {
  for (const fn of inputListeners) fn(source)
  topLayer()?.handler.current(action)
}

/**
 * Receive host-mode input while mounted (and enabled). Pages use priority 0,
 * things drawn over them (dialogs, the viewer) a higher one.
 */
export function useHostLayer(handler: Handler, options: { priority?: number; enabled?: boolean } = {}): void {
  const ref = useRef(handler)
  ref.current = handler
  const { priority = 0, enabled = true } = options
  useEffect(() => {
    if (!enabled) return
    const layer: Layer = { id: ++layerSeq, priority, handler: ref }
    layers.push(layer)
    return () => {
      const i = layers.indexOf(layer)
      if (i >= 0) layers.splice(i, 1)
    }
  }, [enabled, priority])
}

/** Be told of every press, whoever handles it (activity, the idle cursor, the controller hint). */
export function onHostInput(fn: (source: 'pad' | 'key') => void): () => void {
  inputListeners.add(fn)
  return () => inputListeners.delete(fn)
}

interface KeyState {
  down: boolean
  /** Held since before Storm had the focus: ignored until released. */
  blocked: boolean
  since: number
  next: number
}

/** The actions held on any controller right now. */
function readPads(previous: Map<HostAction, KeyState>): Set<HostAction> {
  const out = new Set<HostAction>()
  for (const pad of connectedPads()) {
    for (const [index, action] of BUTTONS) {
      const button = pad.buttons[index]
      if (button && (button.pressed || button.value > 0.5)) out.add(action)
    }
    const x = pad.axes[0] ?? 0
    const y = pad.axes[1] ?? 0
    // One direction at a time — the bigger one — so a stick pushed at a
    // slant never moves two ways at once. A direction already held lets go
    // only once the stick is well back towards the middle.
    const horizontal = Math.abs(x) >= Math.abs(y)
    const value = horizontal ? x : y
    const action: HostAction = horizontal ? (x < 0 ? 'left' : 'right') : y < 0 ? 'up' : 'down'
    const threshold = previous.get(action)?.down ? STICK_OFF : STICK_ON
    if (Math.abs(value) > threshold) out.add(action)
  }
  return out
}

/** The input loop. Mount once, at the root of host mode. */
export function useHostInputLoop(): void {
  useEffect(() => {
    const state = new Map<HostAction, KeyState>()
    // Whatever is held when host mode starts is not a press.
    for (const action of ACTIONS) state.set(action, { down: true, blocked: true, since: 0, next: 0 })

    let frame = 0
    const tick = (): void => {
      frame = requestAnimationFrame(tick)
      const now = performance.now()
      if (!document.hasFocus()) {
        for (const s of state.values()) {
          s.down = true
          s.blocked = true
        }
        return
      }
      const pressed = readPads(state)
      for (const action of ACTIONS) {
        const s = state.get(action)!
        const down = pressed.has(action)
        if (!down) {
          s.down = false
          s.blocked = false
          continue
        }
        if (!s.down) {
          s.down = true
          s.since = now
          s.next = now + FIRST_REPEAT_MS
          dispatch(action, 'pad')
        } else if (!s.blocked && REPEATS.has(action) && now >= s.next) {
          s.next = now + (now - s.since > FAST_AFTER_MS ? FAST_REPEAT_MS : REPEAT_MS)
          dispatch(action, 'pad')
        }
      }
    }
    frame = requestAnimationFrame(tick)

    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return
      const action = KEYS[e.key]
      if (!action) return
      // Enter and Space would otherwise also click whatever button the mouse
      // last focused, and the page would act twice.
      e.preventDefault()
      if (e.repeat && !REPEATS.has(action)) return
      dispatch(action, 'key')
    }
    window.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKey)
    }
  }, [])
}

/** The right stick, for continuous things: scrolling, panning. x and y in -1 … 1, dead zone removed. */
export function rightStick(): { x: number; y: number } {
  return stick(2, 3)
}

export function leftStick(): { x: number; y: number } {
  return stick(0, 1)
}

function stick(ax: number, ay: number): { x: number; y: number } {
  if (!document.hasFocus()) return { x: 0, y: 0 }
  let x = 0
  let y = 0
  for (const pad of connectedPads()) {
    const px = pad.axes[ax] ?? 0
    const py = pad.axes[ay] ?? 0
    if (Math.abs(px) > Math.abs(x)) x = px
    if (Math.abs(py) > Math.abs(y)) y = py
  }
  const dead = (v: number): number => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82)
  return { x: dead(x), y: dead(y) }
}

/** How far the triggers are pulled, 0 … 1. */
export function triggers(): { left: number; right: number } {
  if (!document.hasFocus()) return { left: 0, right: 0 }
  let left = 0
  let right = 0
  for (const pad of connectedPads()) {
    left = Math.max(left, pad.buttons[6]?.value ?? 0)
    right = Math.max(right, pad.buttons[7]?.value ?? 0)
  }
  return { left, right }
}

/** Scroll an element with the right stick while mounted. */
export function useStickScroll(ref: React.RefObject<HTMLElement | null>, enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    let frame = 0
    const tick = (): void => {
      frame = requestAnimationFrame(tick)
      const el = ref.current
      const { y } = rightStick()
      if (el && y !== 0) el.scrollTop += y * 22
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [ref, enabled])
}

/** A short rumble on every controller that can. */
export function rumble(kind: 'launch' | 'bump'): void {
  const effect =
    kind === 'launch'
      ? { startDelay: 0, duration: 180, weakMagnitude: 0.6, strongMagnitude: 0.35 }
      : { startDelay: 0, duration: 40, weakMagnitude: 0.25, strongMagnitude: 0 }
  for (const pad of connectedPads()) {
    try {
      void pad.vibrationActuator?.playEffect('dual-rumble', effect).catch(() => undefined)
    } catch {
      /* not every controller rumbles */
    }
  }
}
