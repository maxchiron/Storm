import type { MediaKind, MediaResult } from '@shared/types'

/**
 * Reading what the user dropped or pasted.
 *
 * A DataTransfer can only be read during the event that delivered it, so
 * `snapshotTransfer` copies everything useful out synchronously; the rest
 * of the work happens afterwards, asynchronously, on the snapshot.
 */

export interface TransferSnapshot {
  files: File[]
  /** local paths of the files, '' where there is none (e.g. a pasted bitmap) */
  paths: string[]
  uriList: string
  html: string
  text: string
}

const IMAGE_NAME = /\.(png|jpe?g|webp|gif|bmp|avif)$/i
const GAME_NAME = /\.(exe|lnk|bat|cmd)$/i

export function snapshotTransfer(dt: DataTransfer | null): TransferSnapshot {
  const empty: TransferSnapshot = { files: [], paths: [], uriList: '', html: '', text: '' }
  if (!dt) return empty
  const files: File[] = Array.from(dt.files ?? [])
  // A pasted bitmap shows up as an item, not always in `files`.
  if (files.length === 0) {
    for (const item of Array.from(dt.items ?? [])) {
      if (item.kind === 'file') {
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }
  }
  const read = (type: string): string => {
    try {
      return dt.getData(type) || ''
    } catch {
      return ''
    }
  }
  return {
    files,
    paths: files.map((f) => window.storm.pathForFile(f)),
    uriList: read('text/uri-list'),
    html: read('text/html'),
    text: read('text/plain')
  }
}

/**
 * Accept a drag over a drop zone. Returns false (and leaves the drag alone)
 * when the source offers no effect Storm can use.
 *
 * The drop effect must be one the source allows. Always asking for "copy"
 * made Chromium refuse — not-allowed cursor — drags that only offer "link",
 * such as a shortcut pulled out of the Start menu. "move" is never chosen:
 * Explorer may delete the original file after a drop it believes was a move.
 */
export function acceptDrag(e: { preventDefault(): void; dataTransfer: DataTransfer | null }): boolean {
  const dt = e.dataTransfer
  if (!dt) return false
  const allowed = (dt.effectAllowed || 'all').toLowerCase()
  const effect: DataTransfer['dropEffect'] | null =
    allowed === 'all' || allowed === 'uninitialized' || allowed.includes('copy')
      ? 'copy'
      : allowed.includes('link')
        ? 'link'
        : null
  if (!effect) return false
  e.preventDefault()
  dt.dropEffect = effect
  return true
}

/** Whether a drag carries files at all (names are hidden until the drop). */
export function dragHasFiles(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types ?? []).includes('Files')
}

/** Whether a drag carries a picture: an image file, or an image dragged out of a web page. */
export function dragLooksLikeImage(dt: DataTransfer | null): boolean {
  if (!dt) return false
  const items = Array.from(dt.items ?? [])
  if (items.some((i) => i.kind === 'file' && i.type.startsWith('image/'))) return true
  const types = Array.from(dt.types ?? [])
  return !types.includes('Files') && (types.includes('text/uri-list') || types.includes('text/html'))
}

export function isImageFile(file: File, path: string): boolean {
  return file.type.startsWith('image/') || IMAGE_NAME.test(path || file.name)
}

/** A local path from a file:// URL ("file:///C:/Games/x.exe" → "C:\Games\x.exe"). */
function pathFromFileUrl(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'file:') return null
    const pathname = decodeURIComponent(url.pathname)
    if (/^\/[a-z]:\//i.test(pathname)) return pathname.slice(1).replace(/\//g, '\\')
    // \\server\share paths arrive as file://server/share/…
    if (url.host) return `\\\\${url.host}${pathname.replace(/\//g, '\\')}`
    return pathname
  } catch {
    return null
  }
}

/**
 * The game files in a drop. Most sources hand over real files; some only a
 * file:// link to one, which is just as good.
 */
export function gamePaths(snap: TransferSnapshot): string[] {
  const fromFiles = snap.paths.filter((p) => !!p && GAME_NAME.test(p))
  if (fromFiles.length > 0) return fromFiles
  return snap.uriList
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map(pathFromFileUrl)
    .filter((p): p is string => !!p && GAME_NAME.test(p))
}

export function hasImage(snap: TransferSnapshot): boolean {
  return snap.files.some((f, i) => isImageFile(f, snap.paths[i])) || imageUrl(snap) !== null
}

/** The address of an image dragged or copied out of a web page. */
export function imageUrl(snap: TransferSnapshot): string | null {
  const fromList = snap.uriList
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'))
  const fromHtml = /<img[^>]+src\s*=\s*["']([^"']+)["']/i.exec(snap.html)?.[1]
  const fromText = snap.text.trim()
  // Prefer the <img src>: a dragged image's uri-list is sometimes the link around it.
  for (const candidate of [fromHtml, fromList, fromText]) {
    if (!candidate) continue
    const url = candidate.replace(/&amp;/g, '&')
    if (/^data:image\//i.test(url) || /^https?:\/\/\S+$/i.test(url)) return url
    // A file:// link counts only when it points at an image (not at a game's .exe).
    if (/^file:\/\//i.test(url) && IMAGE_NAME.test(url.split(/[?#]/)[0])) return url
  }
  return null
}

/**
 * Store the first usable picture in a snapshot. Returns null when there is
 * none at all, so the caller can fall back to other handling.
 */
export async function importImageFromSnapshot(kind: MediaKind, snap: TransferSnapshot): Promise<MediaResult | null> {
  for (let i = 0; i < snap.files.length; i++) {
    const file = snap.files[i]
    const path = snap.paths[i]
    if (!isImageFile(file, path)) continue
    if (path) return window.storm.importImageFile(kind, path)
    // No file behind it — a bitmap copied from a browser, or a virtual file.
    return window.storm.importImageData(kind, new Uint8Array(await file.arrayBuffer()))
  }
  const url = imageUrl(snap)
  return url ? window.storm.importImageUrl(kind, url) : null
}
