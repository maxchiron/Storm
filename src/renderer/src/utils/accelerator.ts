/**
 * Turning a key press into an Electron accelerator ("Ctrl+Shift+S", "F12")
 * for the global screenshot hotkey, and back into something readable.
 */

const NAMED: Record<string, string> = {
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  PrintScreen: 'PrintScreen',
  ScrollLock: 'Scrolllock',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec'
}

/** Keys that are fine on their own: pressing them never types anything. */
const STANDALONE = /^(F([1-9]|1\d|2[0-4])|PrintScreen|Scrolllock)$/

function keyName(code: string): string | null {
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return letter[1]
  const digit = /^Digit(\d)$/.exec(code)
  if (digit) return digit[1]
  const numpad = /^Numpad(\d)$/.exec(code)
  if (numpad) return `num${numpad[1]}`
  return NAMED[code] ?? null
}

export type AcceleratorResult =
  | { kind: 'pending' }
  | { kind: 'cancel' }
  | { kind: 'clear' }
  | { kind: 'invalid' }
  | { kind: 'ok'; accelerator: string }

/** Interpret one key event while recording a hotkey. */
export function acceleratorFromEvent(e: KeyboardEvent): AcceleratorResult {
  if (e.code === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) return { kind: 'cancel' }
  if ((e.code === 'Backspace' || e.code === 'Delete') && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
    return { kind: 'clear' }
  }
  if (
    ['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight'].includes(
      e.code
    )
  ) {
    return { kind: 'pending' }
  }
  const key = keyName(e.code)
  if (!key) return { kind: 'invalid' }
  const mods: string[] = []
  if (e.ctrlKey) mods.push('Ctrl')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (e.metaKey) mods.push('Super')
  // A plain letter as a *global* hotkey would swallow it in every program.
  const hasRealModifier = e.ctrlKey || e.altKey || e.metaKey
  if (!hasRealModifier && !STANDALONE.test(key)) return { kind: 'invalid' }
  return { kind: 'ok', accelerator: [...mods, key].join('+') }
}

/** Split an accelerator into display keys: "Ctrl+Shift+S" → ["Ctrl", "Shift", "S"]. */
export function acceleratorKeys(accelerator: string): string[] {
  if (!accelerator) return []
  return accelerator
    .split(/\+(?!$)/)
    .filter(Boolean)
    .map((k) => (k === 'Super' ? 'Win' : k === 'Scrolllock' ? 'ScrLk' : k === 'PrintScreen' ? 'PrtSc' : k))
}

export function acceleratorLabel(accelerator: string): string {
  return acceleratorKeys(accelerator).join(' + ')
}
