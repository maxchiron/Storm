import type { ResolvedMode, ThemeName } from './types'

/**
 * Theme palettes.
 *
 * One table drives everything colour-related that depends on the theme: the
 * CSS variables the renderer sets, the preview tiles in Settings, and the
 * native window background the main process paints before the page loads
 * (so a light theme never flashes dark on start-up, or the other way round).
 *
 * Mode-wide tokens — text, surfaces, strokes — live in base.css under
 * `[data-mode]`; a theme only tints the backdrop and its ambient glow.
 */
export interface ThemePalette {
  /** Backdrop: [edge, middle, top glow]. */
  bg: [string, string, string]
  /** The two ambient glow colours (the third one is always the accent), as "r, g, b". */
  glow: [string, string]
}

export interface ThemeSpec {
  id: ThemeName
  /** The accent a theme brings with it when you pick it. */
  accent: string
  dark: ThemePalette
  light: ThemePalette
}

export const THEMES: ThemeSpec[] = [
  {
    id: 'storm',
    accent: '#38bdf8',
    dark: { bg: ['#05070d', '#0a0f1c', '#101a2e'], glow: ['139, 92, 246', '59, 130, 246'] },
    light: { bg: ['#edf2f9', '#e4ecf7', '#f8fbff'], glow: ['167, 139, 250', '96, 165, 250'] }
  },
  {
    id: 'aurora',
    accent: '#34d399',
    dark: { bg: ['#030f0e', '#061a18', '#0b2723'], glow: ['34, 211, 238', '167, 139, 250'] },
    light: { bg: ['#eaf6f2', '#dff1eb', '#f6fdfa'], glow: ['34, 211, 238', '196, 181, 253'] }
  },
  {
    id: 'nebula',
    accent: '#a78bfa',
    dark: { bg: ['#08051a', '#110a27', '#1c1039'], glow: ['236, 72, 153', '99, 102, 241'] },
    light: { bg: ['#f2eefc', '#e9e2fa', '#fbf9ff'], glow: ['244, 114, 182', '129, 140, 248'] }
  },
  {
    id: 'synthwave',
    accent: '#f472b6',
    dark: { bg: ['#0c0414', '#170826', '#260c3a'], glow: ['34, 211, 238', '251, 146, 60'] },
    light: { bg: ['#fbeff5', '#f7e3ee', '#fff8fb'], glow: ['103, 232, 249', '253, 186, 116'] }
  },
  {
    id: 'ember',
    accent: '#fb923c',
    dark: { bg: ['#0d0705', '#1a0e09', '#28160d'], glow: ['239, 68, 68', '250, 204, 21'] },
    light: { bg: ['#faf3ec', '#f5e8db', '#fffaf5'], glow: ['248, 113, 113', '253, 224, 71'] }
  },
  {
    id: 'obsidian',
    accent: '#e4e4e7',
    dark: { bg: ['#060607', '#0c0c0e', '#161619'], glow: ['161, 161, 170', '82, 82, 91'] },
    light: { bg: ['#f2f2f3', '#e8e8eb', '#fbfbfb'], glow: ['161, 161, 170', '212, 212, 216'] }
  }
]

export const THEME_IDS: ThemeName[] = THEMES.map((t) => t.id)

export function themeSpec(id: ThemeName): ThemeSpec {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

export function themePalette(id: ThemeName, mode: ResolvedMode): ThemePalette {
  const spec = themeSpec(id)
  return mode === 'light' ? spec.light : spec.dark
}

/** The colour behind the page — used for the native window background. */
export function windowBackground(id: ThemeName, mode: ResolvedMode): string {
  return themePalette(id, mode).bg[0]
}
