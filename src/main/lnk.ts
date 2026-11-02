import fsp from 'node:fs/promises'
import path from 'node:path'

/**
 * A minimal reader for Windows shortcut (.lnk) files, following the
 * [MS-SHLLINK] binary format. On Windows Storm asks the shell first
 * (`shell.readShortcutLink`); this parser is the fallback when that fails and
 * the only option on other systems.
 */

export interface ShortcutInfo {
  target: string
  args: string
  cwd: string
}

const FLAG = {
  hasTargetIdList: 0x1,
  hasLinkInfo: 0x2,
  hasName: 0x4,
  hasRelativePath: 0x8,
  hasWorkingDir: 0x10,
  hasArguments: 0x20,
  hasIconLocation: 0x40,
  isUnicode: 0x80
}

const ENV_BLOCK_SIGNATURE = 0xa0000001
const MAX_LNK_BYTES = 1024 * 1024

function cString(buf: Buffer, start: number, unicode: boolean): string {
  if (start <= 0 || start >= buf.length) return ''
  if (unicode) {
    let end = start
    while (end + 1 < buf.length && buf.readUInt16LE(end) !== 0) end += 2
    return buf.toString('utf16le', start, end)
  }
  let end = start
  while (end < buf.length && buf[end] !== 0) end++
  return buf.toString('latin1', start, end)
}

export async function parseLnk(filePath: string): Promise<ShortcutInfo | null> {
  let buf: Buffer
  try {
    const stat = await fsp.stat(filePath)
    if (stat.size > MAX_LNK_BYTES) return null
    buf = await fsp.readFile(filePath)
  } catch {
    return null
  }
  try {
    return parse(buf, path.dirname(filePath))
  } catch {
    // Truncated or hostile file — a read past the end throws a RangeError.
    return null
  }
}

/** The long (Unicode) name stored in a file entry's 0xBEEF0004 extension block. */
function longNameOf(item: Buffer): string | null {
  const signature = Buffer.from([0x04, 0x00, 0xef, 0xbe])
  const at = item.indexOf(signature)
  if (at < 4) return null
  const block = at - 4
  const version = item.readUInt16LE(block + 2)
  const offset = version >= 9 ? 46 : version >= 8 ? 42 : version >= 7 ? 38 : version >= 3 ? 20 : -1
  if (offset < 0 || block + offset >= item.length) return null
  const name = cString(item, block + offset, true)
  return name || null
}

/**
 * Rebuild a filesystem path from the shell item ID list — the only place some
 * shortcuts (those written by Steam, for one) keep their target.
 */
function targetFromIdList(buf: Buffer, start: number, end: number): string {
  const parts: string[] = []
  let cursor = start
  while (cursor + 2 <= end) {
    const size = buf.readUInt16LE(cursor)
    if (size < 3 || cursor + size > end) break
    const item = buf.subarray(cursor, cursor + size)
    const type = item[2] & 0x70
    if (type === 0x20) {
      const drive = /^[A-Za-z]:/.exec(item.toString('latin1', 3, 6))
      if (drive) parts.push(drive[0])
    } else if (type === 0x30 && parts.length > 0) {
      const unicodeShort = (item[2] & 0x04) !== 0
      parts.push(longNameOf(item) ?? cString(item, 14, unicodeShort))
    }
    cursor += size
  }
  return parts.length > 1 ? parts.join('\\') : ''
}

function parse(buf: Buffer, linkDir: string): ShortcutInfo | null {
  if (buf.length < 0x4c || buf.readUInt32LE(0) !== 0x4c) return null
  const flags = buf.readUInt32LE(0x14)
  const unicode = (flags & FLAG.isUnicode) !== 0
  let cursor = 0x4c

  let idListTarget = ''
  if (flags & FLAG.hasTargetIdList) {
    const size = buf.readUInt16LE(cursor)
    idListTarget = targetFromIdList(buf, cursor + 2, cursor + 2 + size)
    cursor += 2 + size
  }

  let target = ''
  if (flags & FLAG.hasLinkInfo) {
    const info = cursor
    const infoSize = buf.readUInt32LE(info)
    const headerSize = buf.readUInt32LE(info + 4)
    const infoFlags = buf.readUInt32LE(info + 8)
    const localBase = buf.readUInt32LE(info + 16)
    const networkLink = buf.readUInt32LE(info + 20)
    const suffixOffset = buf.readUInt32LE(info + 24)
    const hasUnicodeOffsets = headerSize >= 0x24
    const suffix = hasUnicodeOffsets
      ? cString(buf, info + buf.readUInt32LE(info + 32), true)
      : cString(buf, info + suffixOffset, false)

    if (infoFlags & 0x1) {
      const base =
        hasUnicodeOffsets && buf.readUInt32LE(info + 28)
          ? cString(buf, info + buf.readUInt32LE(info + 28), true)
          : cString(buf, info + localBase, false)
      target = base + suffix
    } else if (infoFlags & 0x2 && networkLink) {
      const net = info + networkLink
      const netNameOffset = buf.readUInt32LE(net + 8)
      const netName =
        netNameOffset > 0x14 && buf.readUInt32LE(net + 20)
          ? cString(buf, net + buf.readUInt32LE(net + 20), true)
          : cString(buf, net + netNameOffset, false)
      target = netName && suffix ? `${netName}\\${suffix}` : netName
    }
    cursor = info + infoSize
  }

  const readString = (): string => {
    const chars = buf.readUInt16LE(cursor)
    cursor += 2
    const bytes = unicode ? chars * 2 : chars
    const value = buf.toString(unicode ? 'utf16le' : 'latin1', cursor, cursor + bytes)
    cursor += bytes
    return value
  }

  if (flags & FLAG.hasName) readString()
  const relative = flags & FLAG.hasRelativePath ? readString() : ''
  const cwd = flags & FLAG.hasWorkingDir ? readString() : ''
  const args = flags & FLAG.hasArguments ? readString() : ''
  if (flags & FLAG.hasIconLocation) readString()

  // Without LinkInfo the target lives in the item ID list, or failing that in
  // an environment block ("%ProgramFiles%\…") that only the shell can expand.
  if (!target) target = idListTarget
  if (!target) {
    while (cursor + 8 <= buf.length) {
      const size = buf.readUInt32LE(cursor)
      if (size < 8) break
      if (buf.readUInt32LE(cursor + 4) === ENV_BLOCK_SIGNATURE && size >= 0x314) {
        target = cString(buf, cursor + 8 + 260, true) || cString(buf, cursor + 8, false)
        break
      }
      cursor += size
    }
  }

  if (!target && relative) target = path.win32.resolve(linkDir, relative)
  if (!target) return null
  return { target, args: args.trim(), cwd }
}
