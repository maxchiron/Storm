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
const CACHE = path.join(os.homedir(), '.cache', 'electron-builder')

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
  const found = findFile(path.join(CACHE, 'nsis-3.0.4.1'), (name, full) => name === 'makensis' && full.includes('/linux/'))
  if (!found) {
    throw new Error(
      'Could not find makensis.\n' +
        'It ships with electron-builder; run `npx electron-builder --win --dir` once,\n' +
        'or point MAKENSIS at the binary yourself.'
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
  const found = findFile(path.join(CACHE, '7zip@1.0.0'), (name) => name === '7za')
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
  const sourceAt = newestMtime(path.join(ROOT, 'out'))

  if (builtAt > 0 && builtAt >= sourceAt) {
    console.log('· the unpacked Windows app is up to date')
    return
  }

  console.log('· building the Windows app (electron-builder --dir)…')
  execFileSync('npx', ['electron-builder', '--win', '--x64', '--dir'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_MIRROR: process.env.ELECTRON_MIRROR ?? 'https://registry.npmmirror.com/-/binary/electron/'
    }
  })
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

  const makensis = locateMakensis()
  const pluginFiles = locatePlugins()
  const sevenZip = locate7za()
  const nsisTree = prepareNsisTree(nsisDirFor(makensis), pluginFiles)
  const payload = makePayload(sevenZip)

  const icon = path.join(BUILD, 'icon.ico')
  if (!fs.existsSync(icon)) {
    console.log('· generating the application icon…')
    execFileSync('node', [path.join(__dirname, 'gen-icon.mjs')], { cwd: ROOT, stdio: 'inherit' })
  }

  const outFile = path.join(RELEASE, `Storm-${pkg.version}-Setup.exe`)
  fs.rmSync(outFile, { force: true })

  // `-D` rather than `/D`: on Linux a leading slash reads as a path.
  const defines = [
    `-DAPP_NAME=${pkg.productName ?? 'Storm'}`,
    `-DAPP_VERSION=${pkg.version}`,
    '-DAPP_EXE=Storm.exe',
    '-DAPP_DESCRIPTION=Storm 本地游戏库',
    `-DAPP_PUBLISHER=${pkg.author ?? 'Storm'}`,
    `-DOUT_FILE=${outFile}`,
    `-DAPP_7Z=${payload}`,
    `-DAPP_ICON=${icon}`
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
