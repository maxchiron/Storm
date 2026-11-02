import { themePalette } from '@shared/themes'
import type { AppearanceMode, ResolvedMode, ThemeName } from '@shared/types'

type Rgb = [number, number, number]

export function parseHex(hex: string): Rgb | null {
  const clean = hex.replace('#', '')
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean
  if (!/^[0-9a-f]{6}$/i.test(full)) return null
  const num = parseInt(full, 16)
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255]
}

function toHex(rgb: Rgb): string {
  return `#${rgb
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
}

/** WCAG relative luminance, 0 (black) … 1 (white). */
function luminance([r, g, b]: Rgb): number {
  const lin = (c: number): number => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/** Move a colour towards `target` until it has `ratio` contrast against `against`. */
function untilContrast(color: Rgb, target: Rgb, against: Rgb, ratio: number): Rgb {
  let out = color
  for (let i = 0; i < 20 && contrast(out, against) < ratio; i++) out = mix(out, target, 0.08)
  return out
}

/** HSL saturation, 0 (grey) … 1. */
function saturation([r, g, b]: Rgb): number {
  const max = Math.max(r, g, b) / 255
  const min = Math.min(r, g, b) / 255
  const l = (max + min) / 2
  if (max === min) return 0
  return (max - min) / (1 - Math.abs(2 * l - 1))
}

const BLACK: Rgb = [0, 0, 0]
const WHITE: Rgb = [255, 255, 255]
const INK_DARK: Rgb = [6, 16, 28]

export interface AccentTokens {
  /** fills: buttons, toggles, the active pill */
  accent: string
  rgb: string
  /** text and icons drawn in the accent colour on the page background */
  ink: string
  /** text drawn on top of an accent fill */
  onAccent: string
}

/**
 * Any accent the user picks has to work on both a near-black and a
 * near-white page. A pale accent (the Mono swatch) turns dark in light mode;
 * accent-coloured text is nudged until it is readable.
 */
export function accentTokens(hex: string, mode: ResolvedMode, background: string): AccentTokens {
  const base = parseHex(hex) ?? [56, 189, 248]
  const bg = parseHex(background) ?? (mode === 'light' ? WHITE : BLACK)
  // A grey accent on a light page only reads as "a button" when it goes all
  // the way to ink — a mid grey looks disabled. Colourful accents keep their hue.
  const neutral = saturation(base) < 0.15
  const fill = mode === 'light' ? untilContrast(base, BLACK, bg, neutral ? 10 : 1.6) : untilContrast(base, WHITE, bg, 3)
  const ink = mode === 'light' ? untilContrast(base, BLACK, bg, 4.5) : untilContrast(base, WHITE, bg, 4.5)
  const onAccent = contrast(fill, INK_DARK) >= contrast(fill, WHITE) ? toHex(INK_DARK) : '#ffffff'
  return {
    accent: toHex(fill),
    rgb: fill.map((c) => Math.round(c)).join(', '),
    ink: toHex(ink),
    onAccent
  }
}

const darkQuery = (): MediaQueryList | null =>
  typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null

export function resolveMode(appearance: AppearanceMode): ResolvedMode {
  if (appearance !== 'system') return appearance
  return darkQuery()?.matches === false ? 'light' : 'dark'
}

/** Follow the OS colour scheme while `appearance` is "system". */
export function onSystemModeChange(fn: () => void): () => void {
  const query = darkQuery()
  if (!query) return () => {}
  query.addEventListener('change', fn)
  return () => query.removeEventListener('change', fn)
}

/** Paint the whole UI: mode tokens come from CSS, the theme tint and accent from here. */
export function applyTheme(theme: ThemeName, mode: ResolvedMode, accent: string): void {
  const root = document.documentElement
  const palette = themePalette(theme, mode)
  const tokens = accentTokens(accent, mode, palette.bg[1])
  root.dataset.theme = theme
  root.dataset.mode = mode
  const set = (name: string, value: string): void => root.style.setProperty(name, value)
  set('--bg-0', palette.bg[0])
  set('--bg-1', palette.bg[1])
  set('--bg-2', palette.bg[2])
  set('--glow-1', palette.glow[0])
  set('--glow-2', palette.glow[1])
  set('--accent', tokens.accent)
  set('--accent-rgb', tokens.rgb)
  set('--accent-ink', tokens.ink)
  set('--on-accent', tokens.onAccent)
}
