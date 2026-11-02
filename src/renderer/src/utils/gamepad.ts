import { PAD_BUTTONS } from '@shared/types'

/**
 * Controllers through the Gamepad API. Storm keeps polling while it sits in
 * the tray behind a game: the main window runs with backgroundThrottling
 * off, which keeps both timers and the page's "visible" state alive.
 */

export function connectedPads(): Gamepad[] {
  const list = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []
  return Array.from(list).filter((p): p is Gamepad => !!p && p.connected)
}

/** Analog triggers count once they are more than half way down. */
function isDown(button: GamepadButton | undefined): boolean {
  return !!button && (button.pressed || button.value > 0.5)
}

export function pressedButtons(pad: Gamepad): number[] {
  const out: number[] = []
  // Only the standard-mapping buttons have names; extra vendor buttons are ignored.
  const count = Math.min(pad.buttons.length, 17)
  for (let i = 0; i < count; i++) if (isDown(pad.buttons[i])) out.push(i)
  return out
}

export function comboHeld(pad: Gamepad, combo: number[]): boolean {
  return combo.length > 0 && combo.every((b) => isDown(pad.buttons[b]))
}

export function buttonName(index: number): string {
  return PAD_BUTTONS[index] ?? `#${index}`
}

export function comboKeys(combo: number[]): string[] {
  return combo.map(buttonName)
}
