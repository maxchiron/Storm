import { shell } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { readVersionStrings, type VersionStrings } from './pe'
import { parseLnk, type ShortcutInfo } from './lnk'
import type { GameFileError, GameFileResult } from '@shared/types'

/**
 * Turns a dropped or picked .exe / .lnk into a ready-to-save game: a sensible
 * title, the executable, its arguments and the folder that holds the game.
 */

export const GAME_FILE_EXTENSIONS = ['.exe', '.lnk', '.bat', '.cmd']
const LAUNCHABLE = ['.exe', '.bat', '.cmd']

/**
 * Store launchers. A shortcut that starts a game through one of these points
 * at the launcher, so its folder says nothing about where the game lives.
 */
const STORE_LAUNCHERS = new Set([
  'steam.exe',
  'galaxyclient.exe',
  'epicgameslauncher.exe',
  'battle.net.exe',
  'battle.net launcher.exe',
  'upc.exe',
  'ubisoftconnect.exe',
  'eadesktop.exe',
  'origin.exe',
  'playnite.desktopapp.exe'
])

/** Folders that sit *inside* a game folder — the game itself is further up. */
const NESTED_DIRS = new Set([
  'bin',
  'bin32',
  'bin64',
  'binaries',
  'win32',
  'win64',
  'x64',
  'x86',
  'x86_64',
  'amd64',
  'game',
  'retail',
  '_retail_',
  'shipping',
  'release',
  'client',
  'windows',
  'windowsnoeditor',
  'wingdk'
])

/** Folders that hold many games, so their name is never a game's name. */
const LIBRARY_DIRS = new Set([
  'games',
  'game',
  'common',
  'steamapps',
  'steamlibrary',
  'steam',
  'program files',
  'program files (x86)',
  'epic games',
  'gog games',
  'gog galaxy',
  'xboxgames',
  'windowsapps',
  'desktop',
  'downloads',
  'publish',
  'content',
  'apps'
])

/** Version strings that name an engine or a tool rather than the game. */
const GENERIC_TITLE =
  /^(unity( player)?|unreal( engine)?|ue[45]?( game)?|godot( engine)?|game|launcher|bootstrap(packagedgame)?|setup|install(er)?|application|app|client|main|start|run|play|electron|nw\.?js|node\.?js|python|java.*|.*operating system.*)$/i

function fail(filePath: string, error: GameFileError): GameFileResult {
  return { ok: false, path: filePath, error }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p)
    return true
  } catch {
    return false
  }
}

function isRoot(p: string): boolean {
  return path.parse(p).root === p
}

/**
 * Under WSL a shortcut's "D:\Games\…" target lives at /mnt/d/Games/… — handy
 * when developing Storm on Linux. On Windows the path is used as is.
 */
function toLocalPath(p: string): string {
  if (process.platform === 'win32') return p
  const drive = /^([a-z]):[\\/](.*)$/i.exec(p)
  return drive ? `/mnt/${drive[1].toLowerCase()}/${drive[2].replace(/\\/g, '/')}` : p
}

async function resolveShortcut(filePath: string): Promise<ShortcutInfo | null> {
  if (process.platform === 'win32') {
    try {
      const link = shell.readShortcutLink(filePath)
      if (link.target) return { target: link.target, args: (link.args ?? '').trim(), cwd: link.cwd ?? '' }
    } catch {
      /* fall back to the built-in reader */
    }
  }
  const parsed = await parseLnk(filePath)
  return parsed ? { ...parsed, target: toLocalPath(parsed.target) } : null
}

/**
 * The folder that holds the whole game, not just the executable:
 * `…\Cyberpunk 2077\bin\x64\Cyberpunk2077.exe` → `…\Cyberpunk 2077`. Deleting
 * that folder is what "uninstalled" means, so it is the right thing to watch.
 */
export async function guessInstallRoot(exePath: string): Promise<string> {
  let dir = path.dirname(exePath)
  let climbedBinaries = false
  for (let i = 0; i < 4; i++) {
    const base = path.basename(dir).toLowerCase()
    const parent = path.dirname(dir)
    if (!NESTED_DIRS.has(base) || parent === dir || isRoot(parent)) break
    if (base === 'binaries') climbedBinaries = true
    dir = parent
  }
  // Unreal ships <Root>\<Project>\Binaries\Win64\…; <Root> also holds Engine\.
  if (climbedBinaries) {
    const parent = path.dirname(dir)
    if (!isRoot(parent) && (await exists(path.join(parent, 'Engine')))) dir = parent
  }
  return dir
}

/** Strip trademark signs, shortcut suffixes and stray whitespace. */
export function cleanTitle(value: string): string {
  return value
    .replace(/[™®©]|\((?:tm|r|c)\)/gi, ' ')
    .replace(/\s+-\s+(shortcut|快捷方式|捷径)$/i, '')
    .replace(/\.(exe|lnk)$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Make a file or folder name readable: "hollow_knight" → "Hollow Knight",
 * "HogwartsLegacy" → "Hogwarts Legacy", "Stray-Win64-Shipping" → "Stray".
 */
export function prettifyName(value: string, isExecutable: boolean): string {
  let name = value.replace(/\.(exe|bat|cmd|lnk)$/i, '')
  if (isExecutable) {
    for (let i = 0; i < 3; i++) {
      name = name.replace(/[-_ .]?(win64|win32|x64|x86|shipping|dx1[12]|vk|vulkan|launcher)$/i, '')
    }
  }
  name = name.replace(/[_.]+/g, ' ').trim()
  if (!/\s/.test(name)) {
    name = name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([a-zA-Z]{3,})(\d+)$/, '$1 $2')
  }
  if (name === name.toLowerCase()) name = name.replace(/\b\p{L}/gu, (c) => c.toUpperCase())
  return cleanTitle(name)
}

function acceptable(title: string | undefined): title is string {
  if (!title) return false
  return title.length >= 2 && title.length <= 80 && !GENERIC_TITLE.test(title)
}

export function pickTitle(input: {
  shortcutName: string | null
  version: VersionStrings | null
  installPath: string
  exePath: string
}): string {
  const candidates: (string | undefined)[] = [
    input.shortcutName ? cleanTitle(input.shortcutName) : undefined,
    input.version?.ProductName ? cleanTitle(input.version.ProductName) : undefined
  ]
  if (input.installPath && !isRoot(input.installPath)) {
    const folder = path.basename(input.installPath)
    if (!LIBRARY_DIRS.has(folder.toLowerCase()) && !NESTED_DIRS.has(folder.toLowerCase())) {
      candidates.push(prettifyName(folder, false))
    }
  }
  candidates.push(input.version?.FileDescription ? cleanTitle(input.version.FileDescription) : undefined)
  for (const candidate of candidates) {
    if (acceptable(candidate)) return candidate
  }
  return prettifyName(path.basename(input.exePath), true) || 'Untitled'
}

export async function inspectGameFile(filePath: string): Promise<GameFileResult> {
  if (typeof filePath !== 'string' || !filePath) return fail(String(filePath), 'NOT_FOUND')
  const ext = path.extname(filePath).toLowerCase()
  if (!GAME_FILE_EXTENSIONS.includes(ext)) return fail(filePath, 'UNSUPPORTED')

  let exePath = filePath
  let args = ''
  let shortcutName: string | null = null
  if (ext === '.lnk') {
    const link = await resolveShortcut(filePath)
    if (!link) return fail(filePath, 'BROKEN_SHORTCUT')
    // A shortcut to a folder, a document or a store app is not something Storm can launch.
    if (!LAUNCHABLE.includes(path.extname(link.target).toLowerCase())) return fail(filePath, 'UNSUPPORTED')
    exePath = link.target
    args = link.args
    shortcutName = path.basename(filePath, ext)
  }

  try {
    const stat = await fsp.stat(exePath)
    if (!stat.isFile()) return fail(filePath, ext === '.lnk' ? 'BROKEN_SHORTCUT' : 'NOT_FOUND')
  } catch {
    return fail(filePath, ext === '.lnk' ? 'BROKEN_SHORTCUT' : 'NOT_FOUND')
  }

  const viaLauncher = STORE_LAUNCHERS.has(path.basename(exePath).toLowerCase())
  const installPath = viaLauncher ? '' : await guessInstallRoot(exePath)
  const version =
    !viaLauncher && path.extname(exePath).toLowerCase() === '.exe' ? await readVersionStrings(exePath) : null
  const title = pickTitle({ shortcutName, version, installPath, exePath })

  return { ok: true, draft: { title, exePath, args, installPath, source: filePath } }
}
