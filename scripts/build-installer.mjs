/**
 * Builds the Storm Windows installer.
 *
 *   node scripts/build-installer.mjs
 *
 * Uses makensis directly. electron-builder's own NSIS target cannot be used on
 * Linux: it builds the uninstaller and then *runs* it under `wine` to
 * materialise it, which fails without wine. makensis generates a complete
 * installer — including a native uninstaller — on any host.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const RELEASE = path.join(ROOT, 'release')
const BUILD = path.join(ROOT, 'build')
const IS_WINDOWS = process.platform === 'win32'

/** electron-builder's download cache, where makensis and 7-Zip live. */
function cacheDir() {
  if (process.env.ELECTRON_BUILDER_CACHE) return process.env.ELECTRON_BUILDER_CACHE
  if (IS_WINDOWS) return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'electron-builder', 'Cache')
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'electron-builder')
  return path.join(os.homedir(), '.cache', 'electron-builder')
}
const CACHE = cacheDir()

/**
 * Environment for the child processes that download things. Node's fetch —
 * which electron-builder uses — ignores HTTP(S)_PROXY unless asked to, so
 * behind a proxy the downloads would simply time out.
 */
function downloadEnv() {
  const env = { ...process.env }
  const proxied = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'].some((k) => env[k])
  if (proxied && env.NODE_USE_ENV_PROXY === undefined) env.NODE_USE_ENV_PROXY = '1'
  return env
}

/**
 * makensis, its plugins and 7-Zip come from electron-builder's own toolset
 * downloads (checksum-verified). An NSIS target would fetch them; the --dir
 * build this script uses does not, so fetch them here when they are missing.
 */
function ensureToolsets() {
  const has = (dir) => fs.existsSync(path.join(CACHE, dir))
  if (has('nsis-3.0.4.1') && has('nsis-resources-3.4.1') && has('7zip@1.0.0')) return
  console.log('· downloading the NSIS and 7-Zip toolsets (once)…')
  const script = `
    const { getBinFromUrl } = require('app-builder-lib/out/binDownload')
    const { getPath7za } = require('app-builder-lib/out/toolsets/7zip')
    ;(async () => {
      await getPath7za()
      await getBinFromUrl('nsis-3.0.4.1', 'nsis-3.0.4.1.7z', '9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa')
      await getBinFromUrl('nsis-resources-3.4.1', 'nsis-resources-3.4.1.7z', '593a9a92ef958321293ac6a2ee61e64bf1bd543142a5bd6b3d310709cc924103')
    })().catch((err) => { console.error(err.message); process.exit(1) })
  `
  execFileSync(process.execPath, ['-e', script], { cwd: ROOT, stdio: 'inherit', env: downloadEnv() })
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

/** Recursively find a file under a directory, first match wins. */
function findFile(dir, matcher, limit = 8) {
  const walk = (current, depth) => {
    if (depth > limit) return null
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return null
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        const hit = walk(full, depth + 1)
        if (hit) return hit
      } else if (matcher(entry.name, full)) {
        return full
      }
    }
    return null
  }
  return walk(dir, 0)
}

function locateMakensis() {
  if (process.env.MAKENSIS && fs.existsSync(process.env.MAKENSIS)) return process.env.MAKENSIS
  const hostDir = { win32: null, darwin: 'mac', linux: 'linux' }[process.platform]
  const found = findFile(path.join(CACHE, 'nsis-3.0.4.1'), (name, full) =>
    IS_WINDOWS
      ? name.toLowerCase() === 'makensis.exe'
      : name === 'makensis' && path.basename(path.dirname(full)) === hostDir
  )
  if (!found) {
    throw new Error(
      'Could not find makensis.\n' +
        'It is part of electron-builder\'s NSIS toolset, which could not be downloaded;\n' +
        'check the network (or proxy) and retry, or point MAKENSIS at the binary yourself.'
    )
  }
  return found
}

/**
 * makensis finds its stubs, include files and language files through $NSISDIR.
 * The bundled Linux binary does not derive that from its own location (the
 * binaries live in a `linux/` subfolder, one level below the NSIS tree), so
 * it has to be set explicitly.
 */
function nsisDirFor(makensisPath) {
  const dir = path.dirname(makensisPath)
  const parent = path.dirname(dir)
  // `linux/makensis` -> the tree root that holds Stubs/, Include/ and Contrib/
  return fs.existsSync(path.join(parent, 'Stubs')) ? parent : dir
}

/**
 * Locates the 7-Zip extraction plugin for each architecture.
 * The installer is Unicode and 32-bit, so it needs the x86-unicode build;
 * the ANSI one is kept as a fallback.
 */
function locatePlugins() {
  const root = path.join(CACHE, 'nsis-resources-3.4.1')
  const plugins = {}
  for (const arch of ['x86-unicode', 'x86-ansi', 'x64-unicode']) {
    const found = findFile(root, (name, full) => name === 'nsis7z.dll' && full.includes(`${arch}${path.sep}`))
    if (found) plugins[arch] = found
  }
  if (!plugins['x86-unicode'] && !plugins['x86-ansi']) {
    throw new Error('Could not find the nsis7z plugin in the electron-builder cache.')
  }
  return plugins
}

/**
 * Assembles a small NSIS tree for makensis to compile against.
 *
 * The stock NSIS tree is shared with electron-builder, and this NSIS version
 * has no `!pluginpath`, so the plugin has to sit in the tree's own
 * Plugins/<arch> folder to be found — and to be embedded in the installer.
 * Symlinks keep the overlay tiny instead of copying the whole distribution.
 */
function prepareNsisTree(nsisDir, pluginFiles) {
  const overlay = path.join(BUILD, 'nsis')
  fs.rmSync(overlay, { recursive: true, force: true })
  fs.mkdirSync(path.join(overlay, 'Plugins'), { recursive: true })

  for (const dir of ['Include', 'Contrib', 'Stubs']) {
    const source = path.join(nsisDir, dir)
    if (!fs.existsSync(source)) continue
    const target = path.join(overlay, dir)
    try {
      fs.symlinkSync(source, target, 'dir')
    } catch {
      fs.cpSync(source, target, { recursive: true })
    }
  }

  // The plugin folders are copied rather than linked, because the 7-Zip plugin
  // has to be added to them — and a symlink would write into the shared
  // electron-builder cache.
  const plugins = path.join(overlay, 'Plugins')
  for (const arch of ['x86-ansi', 'x86-unicode', 'x64-ansi', 'x64-unicode']) {
    const source = path.join(nsisDir, 'Plugins', arch)
    if (!fs.existsSync(source)) continue
    fs.cpSync(source, path.join(plugins, arch), { recursive: true })
  }

  for (const [arch, file] of Object.entries(pluginFiles)) {
    const target = path.join(plugins, arch)
    if (!fs.existsSync(target)) continue
    fs.copyFileSync(file, path.join(target, 'nsis7z.dll'))
  }
  return overlay
}

function locate7za() {
  if (process.env.SEVEN_ZIP && fs.existsSync(process.env.SEVEN_ZIP)) return process.env.SEVEN_ZIP
  const found = findFile(path.join(CACHE, '7zip@1.0.0'), (name) => name === (IS_WINDOWS ? '7za.exe' : '7za'))
  if (!found) throw new Error('Could not find 7za in the electron-builder cache.')
  return found
}

/** The newest modification time under a directory, 0 when it does not exist. */
function newestMtime(dir) {
  let newest = 0
  const walk = (current) => {
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else {
        const mtime = fs.statSync(full).mtimeMs
        if (mtime > newest) newest = mtime
      }
    }
  }
  walk(dir)
  return newest
}

/**
 * Make sure the unpacked Windows app matches the current sources.
 * The installer must never ship a stale build, so the unpacked app is
 * rebuilt whenever `out/` is newer than it.
 */
function ensureAppBuilt() {
  const appDir = path.join(RELEASE, 'win-unpacked')
  const asar = path.join(appDir, 'resources', 'app.asar')
  const builtAt = fs.existsSync(asar) ? fs.statSync(asar).mtimeMs : 0
  // package.json counts too: a version bump alone must reach the app.
  const sourceAt = Math.max(newestMtime(path.join(ROOT, 'out')), fs.statSync(path.join(ROOT, 'package.json')).mtimeMs)

  if (builtAt > 0 && builtAt >= sourceAt) {
    console.log('· the unpacked Windows app is up to date')
    return
  }

  console.log('· building the Windows app (electron-builder --dir)…')
  // npx is a .cmd script on Windows, which Node only runs through a shell.
  execFileSync(IS_WINDOWS ? 'npx.cmd' : 'npx', ['electron-builder', '--win', '--x64', '--dir'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: IS_WINDOWS,
    env: {
      ...downloadEnv(),
      ELECTRON_MIRROR: process.env.ELECTRON_MIRROR ?? 'https://registry.npmmirror.com/-/binary/electron/'
    }
  })
}

/**
 * Writes the uninstaller's file list: one Delete per installed file, then
 * the folders deepest-first. RMDir without /r only removes a folder that is
 * empty, so nothing the user put there is ever touched.
 */
function writeUninstallList(nsisTree) {
  const appDir = path.join(RELEASE, 'win-unpacked')
  const files = []
  const dirs = []
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}\\${entry.name}` : entry.name
      if (entry.isDirectory()) {
        dirs.push(childRel)
        walk(path.join(dir, entry.name), childRel)
      } else {
        files.push(childRel)
      }
    }
  }
  walk(appDir, '')
  dirs.sort((a, b) => b.split('\\').length - a.split('\\').length)
  const lines = [
    '; Generated by scripts/build-installer.mjs — the files this build installs.',
    ...files.map((f) => `  Delete "$INSTDIR\\${f}"`),
    ...dirs.map((d) => `  RMDir "$INSTDIR\\${d}"`),
    ''
  ]
  const out = path.join(nsisTree, 'uninstall-files.nsh')
  // makensis reads include files in the system code page unless they carry a BOM.
  fs.writeFileSync(out, '\ufeff' + lines.join('\r\n'), 'utf8')
  return out
}

function makePayload(sevenZip) {
  const appDir = path.join(RELEASE, 'win-unpacked')
  const payload = path.join(RELEASE, 'app.7z')
  const marker = path.join(appDir, `Storm.${pkg.version}.version`)
  console.log('· packing the application payload…')
  fs.rmSync(payload, { force: true })
  // The marker's *name* embeds the version; the installer checks for its
  // presence after extraction to prove the files came from this build.
  fs.writeFileSync(marker, pkg.version, 'utf8')
  try {
    execFileSync(sevenZip, ['a', '-t7z', '-mx=9', '-bso0', payload, `${appDir}/*`], { cwd: ROOT })
  } finally {
    fs.rmSync(marker, { force: true })
  }
  return payload
}

function main() {
  fs.mkdirSync(RELEASE, { recursive: true })

  ensureAppBuilt()
  ensureToolsets()

  const makensis = locateMakensis()
  const pluginFiles = locatePlugins()
  const sevenZip = locate7za()
  const nsisTree = prepareNsisTree(nsisDirFor(makensis), pluginFiles)
  const uninstallList = writeUninstallList(nsisTree)
  const payload = makePayload(sevenZip)

  const icon = path.join(BUILD, 'icon.ico')
  if (!fs.existsSync(icon)) {
    console.log('· generating the application icon…')
    execFileSync(process.execPath, [path.join(__dirname, 'gen-icon.mjs')], { cwd: ROOT, stdio: 'inherit' })
  }

  const outFile = path.join(RELEASE, `Storm-${pkg.version}-Setup.exe`)
  fs.rmSync(outFile, { force: true })

  // `-D` rather than `/D`: on Linux a leading slash reads as a path.
  const defines = [
    `-DAPP_NAME=${pkg.productName ?? 'Storm'}`,
    `-DAPP_VERSION=${pkg.version}`,
    // The executable's version resource takes numbers only: "1.0.5-test" → "1.0.5".
    `-DAPP_VERSION_NUMERIC=${pkg.version.replace(/[-+].*$/, '')}`,
    '-DAPP_EXE=Storm.exe',
    '-DAPP_DESCRIPTION=Storm 本地游戏库',
    `-DAPP_PUBLISHER=${pkg.author ?? 'Storm'}`,
    `-DOUT_FILE=${outFile}`,
    `-DAPP_7Z=${payload}`,
    `-DAPP_ICON=${icon}`,
    `-DUNINSTALL_LIST=${uninstallList}`
  ]

  console.log('· compiling the installer with makensis…')
  const result = spawnSync(makensis, [...defines, path.join(__dirname, 'installer.nsi')], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, NSISDIR: nsisTree }
  })

  if (result.status !== 0) {
    throw new Error(`makensis exited with code ${result.status}`)
  }

  const size = (fs.statSync(outFile).size / (1024 * 1024)).toFixed(1)
  // The payload is embedded in the installer now — no need to keep it around.
  fs.rmSync(payload, { force: true })
  console.log(`\n✓ ${outFile}  (${size} MB)`)
}

try {
  main()
} catch (error) {
  console.error(`\n✗ ${error.message}`)
  process.exit(1)
}
