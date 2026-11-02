import { net } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { store } from './store'
import type { MediaKind, MediaResult } from '@shared/types'

/** Where every stored image lives. `thumbs` holds screenshot previews. */
export type MediaFolder = MediaKind | 'thumbs'

/** Posters this large are almost certainly a mistake (or not an image at all). */
const MAX_IMAGE_BYTES = 40 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 20_000

const MAGIC: { ext: string; test: (b: Buffer) => boolean }[] = [
  { ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: 'webp',
    test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP'
  },
  { ext: 'gif', test: (b) => b.subarray(0, 4).toString('ascii') === 'GIF8' },
  { ext: 'bmp', test: (b) => b[0] === 0x42 && b[1] === 0x4d },
  { ext: 'avif', test: (b) => /^ftypavi[fs]$/.test(b.subarray(4, 12).toString('ascii')) }
]

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  bmp: 'image/bmp'
}

export function dirFor(kind: MediaFolder): string {
  if (kind === 'covers') return store.coversDir
  if (kind === 'banners') return store.bannersDir
  return store.thumbsDir
}

/** The real image format from magic bytes — the file extension is never trusted. */
export function sniffImage(head: Buffer): string | null {
  if (head.length < 12) return null
  for (const m of MAGIC) {
    if (m.test(head)) return m.ext
  }
  return null
}

async function readHead(filePath: string): Promise<Buffer | null> {
  let handle: fsp.FileHandle | null = null
  try {
    handle = await fsp.open(filePath, 'r')
    const buf = Buffer.alloc(32)
    const { bytesRead } = await handle.read(buf, 0, 32, 0)
    return buf.subarray(0, bytesRead)
  } catch {
    return null
  } finally {
    await handle?.close()
  }
}

/**
 * Copy an image file into Storm's media folder and return the stored name.
 * The original is never modified or moved.
 */
export async function importImage(sourcePath: string, kind: MediaKind): Promise<MediaResult> {
  try {
    const stat = await fsp.stat(sourcePath)
    if (!stat.isFile()) return { ok: false, error: 'UNSUPPORTED' }
    if (stat.size > MAX_IMAGE_BYTES) return { ok: false, error: 'TOO_LARGE' }
  } catch {
    return { ok: false, error: 'FAILED' }
  }
  const head = await readHead(sourcePath)
  const ext = head ? sniffImage(head) : null
  if (!ext) return { ok: false, error: 'UNSUPPORTED' }
  const name = `${randomUUID()}.${ext}`
  try {
    await fsp.copyFile(sourcePath, path.join(dirFor(kind), name))
    return { ok: true, name }
  } catch {
    return { ok: false, error: 'FAILED' }
  }
}

/** Store raw image bytes — a pasted bitmap or a file the renderer has no path for. */
export async function importImageData(data: Uint8Array, kind: MediaKind): Promise<MediaResult> {
  if (!(data instanceof Uint8Array) || data.byteLength === 0) return { ok: false, error: 'UNSUPPORTED' }
  if (data.byteLength > MAX_IMAGE_BYTES) return { ok: false, error: 'TOO_LARGE' }
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  const ext = sniffImage(buf.subarray(0, 32))
  if (!ext) return { ok: false, error: 'UNSUPPORTED' }
  const name = `${randomUUID()}.${ext}`
  try {
    await fsp.writeFile(path.join(dirFor(kind), name), buf)
    return { ok: true, name }
  } catch {
    return { ok: false, error: 'FAILED' }
  }
}

/**
 * Fetch an image dragged out of a web page. This is the only network request
 * Storm ever makes, and only because the user dropped a picture from the web.
 */
export async function importImageUrl(url: string, kind: MediaKind): Promise<MediaResult> {
  if (typeof url !== 'string') return { ok: false, error: 'UNSUPPORTED' }
  const trimmed = url.trim()

  const dataUrl = /^data:image\/[\w.+-]+;base64,(.*)$/is.exec(trimmed)
  if (dataUrl) return importImageData(Buffer.from(dataUrl[1], 'base64'), kind)

  if (/^file:/i.test(trimmed)) {
    try {
      return importImage(fileURLToPath(trimmed), kind)
    } catch {
      return { ok: false, error: 'UNSUPPORTED' }
    }
  }

  if (!/^https?:\/\//i.test(trimmed)) return { ok: false, error: 'UNSUPPORTED' }

  try {
    const response = await net.fetch(trimmed, {
      redirect: 'follow',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8' }
    })
    if (!response.ok || !response.body) return { ok: false, error: 'DOWNLOAD_FAILED' }
    const declared = Number(response.headers.get('content-length') ?? 0)
    if (declared > MAX_IMAGE_BYTES) return { ok: false, error: 'TOO_LARGE' }

    // Stream with a cap: a server that lies about (or omits) its length
    // cannot make Storm buffer an unbounded download.
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel()
        return { ok: false, error: 'TOO_LARGE' }
      }
      chunks.push(value)
    }
    return importImageData(Buffer.concat(chunks), kind)
  } catch {
    return { ok: false, error: 'DOWNLOAD_FAILED' }
  }
}

export async function removeImage(name: string | null, kind: MediaFolder): Promise<void> {
  if (!name || !isSafeName(name)) return
  try {
    await fsp.unlink(path.join(dirFor(kind), name))
  } catch {
    /* already gone */
  }
}

/** Write an already-encoded image (a screenshot preview) into a media folder. */
export async function writeImage(data: Buffer, ext: string, kind: MediaFolder): Promise<string> {
  const name = `${randomUUID()}.${ext}`
  await fsp.writeFile(path.join(dirFor(kind), name), data)
  return name
}

export async function mediaExists(name: string | null, kind: MediaFolder): Promise<boolean> {
  if (!name || !isSafeName(name)) return false
  try {
    await fsp.access(path.join(dirFor(kind), name))
    return true
  } catch {
    return false
  }
}

function isSafeName(fileName: string): boolean {
  return !!fileName && !/[\\/]/.test(fileName) && !fileName.includes('..')
}

/**
 * Read a stored media file for the custom protocol handler.
 * Returns null for anything that escapes the media directory.
 */
export async function readImage(kind: MediaFolder, fileName: string): Promise<{ data: Buffer; mime: string } | null> {
  if (!isSafeName(fileName)) return null
  const dir = dirFor(kind)
  const full = path.join(dir, fileName)
  if (!path.resolve(full).startsWith(path.resolve(dir) + path.sep)) return null
  try {
    const data = await fsp.readFile(full)
    const ext = path.extname(fileName).slice(1).toLowerCase()
    return { data, mime: MIME[ext] ?? 'application/octet-stream' }
  } catch {
    return null
  }
}

/**
 * Delete images nobody refers to any more: posters picked for a form that was
 * then cancelled, artwork of games removed by an import, previews of
 * screenshots whose record is gone. Files younger than an hour are left
 * alone in case a form is still open somewhere.
 */
export async function pruneOrphanMedia(): Promise<void> {
  // After a damaged library was set aside the in-memory one is empty: every
  // poster would look unused, and restoring the backup would bring the games
  // back without their artwork.
  if (!store.isLoaded || store.recoveredFrom) return
  const keep: Record<MediaFolder, Set<string>> = {
    covers: new Set(store.games.map((g) => g.cover).filter((n): n is string => !!n)),
    banners: new Set(store.games.map((g) => g.banner).filter((n): n is string => !!n)),
    thumbs: new Set(store.screenshots.map((s) => s.thumb).filter((n): n is string => !!n))
  }
  const cutoff = Date.now() - 60 * 60 * 1000
  for (const kind of ['covers', 'banners', 'thumbs'] as const) {
    let names: string[]
    try {
      names = await fsp.readdir(dirFor(kind))
    } catch {
      continue
    }
    for (const name of names) {
      if (keep[kind].has(name)) continue
      const full = path.join(dirFor(kind), name)
      try {
        const stat = await fsp.stat(full)
        if (stat.isFile() && stat.mtimeMs < cutoff) await fsp.unlink(full)
      } catch {
        /* ignore */
      }
    }
  }
}
