import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { store } from './store'

const MAGIC: { ext: string; test: (b: Buffer) => boolean }[] = [
  { ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'webp', test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
  { ext: 'gif', test: (b) => b.subarray(0, 4).toString('ascii') === 'GIF8' },
  { ext: 'bmp', test: (b) => b[0] === 0x42 && b[1] === 0x4d },
  { ext: 'avif', test: (b) => b.subarray(4, 12).toString('ascii').includes('ftypavif') }
]

export type MediaKind = 'covers' | 'banners'

function dirFor(kind: MediaKind): string {
  return kind === 'covers' ? store.coversDir : store.bannersDir
}

/** Detect the real image format from magic bytes — never trust the file extension. */
export async function detectImageExtension(filePath: string): Promise<string | null> {
  let handle: fsp.FileHandle | null = null
  try {
    handle = await fsp.open(filePath, 'r')
    const buf = Buffer.alloc(32)
    const { bytesRead } = await handle.read(buf, 0, 32, 0)
    if (bytesRead < 4) return null
    for (const m of MAGIC) {
      if (m.test(buf.subarray(0, bytesRead))) return m.ext
    }
    return null
  } catch {
    return null
  } finally {
    await handle?.close()
  }
}

/**
 * Copy an image into the Storm media folder and return the stored file name.
 * The original file is never modified or moved.
 */
export async function importImage(sourcePath: string, kind: MediaKind): Promise<string | null> {
  const ext = await detectImageExtension(sourcePath)
  if (!ext) return null
  const name = `${randomUUID()}.${ext}`
  const dest = path.join(dirFor(kind), name)
  await fsp.copyFile(sourcePath, dest)
  return name
}

export async function removeImage(name: string | null, kind: MediaKind): Promise<void> {
  if (!name) return
  try {
    await fsp.unlink(path.join(dirFor(kind), name))
  } catch {
    /* already gone */
  }
}

/**
 * Read a stored media file for the custom protocol handler.
 * Returns null for anything that escapes the media directory.
 */
export async function readImage(kind: MediaKind, fileName: string): Promise<{ data: Buffer; mime: string } | null> {
  if (!fileName || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) return null
  const dir = dirFor(kind)
  const full = path.join(dir, fileName)
  if (!path.resolve(full).startsWith(path.resolve(dir) + path.sep)) return null
  try {
    const data = await fsp.readFile(full)
    const ext = path.extname(fileName).slice(1).toLowerCase()
    const mime =
      ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : ext === 'avif' ? 'image/avif' : ext === 'bmp' ? 'image/bmp' : 'application/octet-stream'
    return { data, mime }
  } catch {
    return null
  }
}

export function coverUrl(fileName: string | null): string | null {
  return fileName ? `storm://asset/covers/${encodeURIComponent(fileName)}` : null
}

export function bannerUrl(fileName: string | null): string | null {
  return fileName ? `storm://asset/banners/${encodeURIComponent(fileName)}` : null
}
