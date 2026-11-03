/**
 * Puts koffi's Windows native module where electron-builder picks it up:
 *
 *   build/koffi/win32_x64/koffi.node  →  resources/koffi/win32_x64/koffi.node
 *
 * which is one of the places koffi looks inside a packaged Electron app.
 *
 *   node scripts/fetch-koffi.mjs
 *
 * koffi ships each platform's binary as an optional package, so npm on Linux
 * only installs the Linux one. The Windows package is used from node_modules
 * when it is there (building on Windows); otherwise `npm pack` fetches it —
 * through npm's own registry and proxy settings — and the tarball is checked
 * against the integrity hash package-lock.json records for it.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE = '@koromix/koffi-win32-x64'
const OUT_DIR = path.join(ROOT, 'build', 'koffi', 'win32_x64')
const OUT = path.join(OUT_DIR, 'koffi.node')
const STAMP = path.join(OUT_DIR, 'integrity.txt')

function lockEntry() {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'))
  const entry = lock.packages?.[`node_modules/${PACKAGE}`]
  if (!entry?.version || !entry?.integrity) {
    throw new Error(`package-lock.json has no entry for ${PACKAGE}; run npm install first.`)
  }
  return entry
}

/** The contents of one file in a .tgz, by its path inside the archive. */
function extractFromTarball(tgz, wanted) {
  const tar = zlib.gunzipSync(tgz)
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((b) => b === 0)) break
    const field = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '')
    const prefix = field(345, 155)
    const name = prefix ? `${prefix}/${field(0, 100)}` : field(0, 100)
    const size = parseInt(field(124, 12).trim() || '0', 8)
    const body = offset + 512
    if (name === wanted) return tar.subarray(body, body + size)
    offset = body + Math.ceil(size / 512) * 512
  }
  throw new Error(`${wanted} is not in the ${PACKAGE} package`)
}

export function ensureKoffiWindows() {
  const entry = lockEntry()
  try {
    if (fs.readFileSync(STAMP, 'utf8').trim() === entry.integrity && fs.existsSync(OUT)) return OUT
  } catch {
    /* not fetched yet */
  }

  let binary
  const installed = path.join(ROOT, 'node_modules', PACKAGE)
  const installedVersion = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8')).version
    } catch {
      return null
    }
  })()
  if (installedVersion === entry.version) {
    binary = fs.readFileSync(path.join(installed, 'win32_x64', 'koffi.node'))
  } else {
    console.log(`· fetching ${PACKAGE}@${entry.version} (koffi for Windows)…`)
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'storm-koffi-'))
    try {
      // npm is a .cmd script on Windows, which Node only runs through a shell.
      const isWindows = process.platform === 'win32'
      const out = execFileSync(
        isWindows ? 'npm.cmd' : 'npm',
        ['pack', `${PACKAGE}@${entry.version}`, '--json', '--pack-destination', tmp],
        { cwd: tmp, encoding: 'utf8', shell: isWindows, stdio: ['ignore', 'pipe', 'inherit'] }
      )
      const [{ filename }] = JSON.parse(out)
      const tgz = fs.readFileSync(path.join(tmp, filename))
      const [algorithm, expected] = entry.integrity.split('-', 2)
      const actual = crypto.createHash(algorithm).update(tgz).digest('base64')
      if (actual !== expected) {
        throw new Error(`${PACKAGE}@${entry.version} does not match the integrity in package-lock.json`)
      }
      binary = extractFromTarball(tgz, 'package/win32_x64/koffi.node')
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(OUT, binary)
  fs.writeFileSync(STAMP, `${entry.integrity}\n`)
  console.log(`· koffi for Windows → ${path.relative(ROOT, OUT)}`)
  return OUT
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ensureKoffiWindows()
}
