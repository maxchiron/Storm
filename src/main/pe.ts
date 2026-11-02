import fsp from 'node:fs/promises'

/**
 * Reads the version-information strings (ProductName, FileDescription…)
 * embedded in a Windows executable — the same text Explorer shows under
 * Properties › Details. Storm uses them to name a game that was dropped onto
 * the window.
 *
 * Only the few bytes that matter are read: the headers, the resource
 * directory and the version resource itself. A malformed file simply yields
 * null; nothing here throws.
 */

export interface VersionStrings {
  ProductName?: string
  FileDescription?: string
  CompanyName?: string
  OriginalFilename?: string
  InternalName?: string
}

const RT_VERSION = 16
const MAX_VERSION_RESOURCE = 64 * 1024

interface Section {
  rva: number
  virtualSize: number
  rawOffset: number
  rawSize: number
}

class Reader {
  constructor(
    private handle: fsp.FileHandle,
    private size: number
  ) {}

  async read(offset: number, length: number): Promise<Buffer | null> {
    if (offset < 0 || length <= 0 || offset + length > this.size) return null
    const buf = Buffer.alloc(length)
    const { bytesRead } = await this.handle.read(buf, 0, length, offset)
    return bytesRead === length ? buf : null
  }
}

export async function readVersionStrings(filePath: string): Promise<VersionStrings | null> {
  let handle: fsp.FileHandle | null = null
  try {
    handle = await fsp.open(filePath, 'r')
    const { size } = await handle.stat()
    return await parse(new Reader(handle, size))
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function parse(r: Reader): Promise<VersionStrings | null> {
  const dos = await r.read(0, 64)
  if (!dos || dos.readUInt16LE(0) !== 0x5a4d) return null // "MZ"
  const peOffset = dos.readUInt32LE(0x3c)

  const coff = await r.read(peOffset, 24)
  if (!coff || coff.readUInt32LE(0) !== 0x00004550) return null // "PE\0\0"
  const sectionCount = coff.readUInt16LE(6)
  const optionalSize = coff.readUInt16LE(20)
  const optionalOffset = peOffset + 24

  const optional = await r.read(optionalOffset, optionalSize)
  if (!optional || optionalSize < 2) return null
  const magic = optional.readUInt16LE(0)
  // The data directories start at a different place in PE32 and PE32+.
  const dirStart = magic === 0x20b ? 112 : magic === 0x10b ? 96 : -1
  if (dirStart < 0 || optionalSize < dirStart + 3 * 8) return null
  const resourceRva = optional.readUInt32LE(dirStart + 2 * 8)
  if (!resourceRva) return null

  const table = await r.read(optionalOffset + optionalSize, sectionCount * 40)
  if (!table) return null
  const sections: Section[] = []
  for (let i = 0; i < sectionCount; i++) {
    const at = i * 40
    sections.push({
      virtualSize: table.readUInt32LE(at + 8),
      rva: table.readUInt32LE(at + 12),
      rawSize: table.readUInt32LE(at + 16),
      rawOffset: table.readUInt32LE(at + 20)
    })
  }
  const toOffset = (rva: number): number => {
    for (const s of sections) {
      const span = Math.max(s.virtualSize, s.rawSize)
      if (rva >= s.rva && rva < s.rva + span) return s.rawOffset + (rva - s.rva)
    }
    return -1
  }

  const resourceBase = toOffset(resourceRva)
  if (resourceBase < 0) return null

  // Walk type → name → language, taking the first entry at the lower levels.
  const typeEntry = await findEntry(r, resourceBase, 0, RT_VERSION)
  if (typeEntry === null || !isDirectory(typeEntry)) return null
  const nameEntry = await findEntry(r, resourceBase, dirOffset(typeEntry), null)
  if (nameEntry === null || !isDirectory(nameEntry)) return null
  const langEntry = await findEntry(r, resourceBase, dirOffset(nameEntry), null)
  if (langEntry === null || isDirectory(langEntry)) return null

  const leaf = await r.read(resourceBase + langEntry, 16)
  if (!leaf) return null
  const dataRva = leaf.readUInt32LE(0)
  const dataSize = Math.min(leaf.readUInt32LE(4), MAX_VERSION_RESOURCE)
  const dataOffset = toOffset(dataRva)
  if (dataOffset < 0 || dataSize < 6) return null
  const data = await r.read(dataOffset, dataSize)
  if (!data) return null
  return parseVersionInfo(data)
}

const isDirectory = (entry: number): boolean => (entry & 0x80000000) !== 0
const dirOffset = (entry: number): number => entry & 0x7fffffff

/** Returns the raw OffsetToData of the matching entry (any entry when id is null). */
async function findEntry(r: Reader, base: number, offset: number, id: number | null): Promise<number | null> {
  const head = await r.read(base + offset, 16)
  if (!head) return null
  const total = head.readUInt16LE(12) + head.readUInt16LE(14)
  if (total === 0 || total > 4096) return null
  const entries = await r.read(base + offset + 16, total * 8)
  if (!entries) return null
  for (let i = 0; i < total; i++) {
    const name = entries.readUInt32LE(i * 8)
    const target = entries.readUInt32LE(i * 8 + 4)
    if (id === null) return target
    if ((name & 0x80000000) === 0 && name === id) return target
  }
  return null
}

const align4 = (n: number): number => (n + 3) & ~3

interface VersionNode {
  key: string
  /** text value, for String nodes */
  text: string
  children: VersionNode[]
}

/** Parse one VS_VERSIONINFO-style block (they are all shaped alike). */
function parseNode(buf: Buffer, start: number, end: number, depth: number): VersionNode | null {
  if (depth > 4 || start + 6 > end) return null
  const length = buf.readUInt16LE(start)
  const valueLength = buf.readUInt16LE(start + 2)
  const type = buf.readUInt16LE(start + 4)
  const nodeEnd = Math.min(start + length, end)
  if (length < 6 || nodeEnd <= start) return null

  let cursor = start + 6
  let key = ''
  while (cursor + 1 < nodeEnd) {
    const ch = buf.readUInt16LE(cursor)
    cursor += 2
    if (ch === 0) break
    key += String.fromCharCode(ch)
  }
  cursor = align4(cursor)

  // For text values the length is in characters, otherwise in bytes.
  const valueBytes = type === 1 ? valueLength * 2 : valueLength
  let text = ''
  if (type === 1 && valueBytes > 0 && cursor + valueBytes <= nodeEnd) {
    text = buf.toString('utf16le', cursor, cursor + valueBytes).replace(/\0+$/, '')
  }
  cursor = align4(cursor + valueBytes)

  const children: VersionNode[] = []
  while (cursor + 6 <= nodeEnd) {
    const childLength = buf.readUInt16LE(cursor)
    if (childLength === 0) break
    const child = parseNode(buf, cursor, nodeEnd, depth + 1)
    if (child) children.push(child)
    cursor = align4(cursor + childLength)
  }
  return { key, text, children }
}

function parseVersionInfo(buf: Buffer): VersionStrings | null {
  const root = parseNode(buf, 0, buf.length, 0)
  if (!root || root.key !== 'VS_VERSION_INFO') return null
  const tables = root.children.filter((c) => c.key === 'StringFileInfo').flatMap((c) => c.children)
  if (tables.length === 0) return null
  // Prefer the US-English table when there are several translations.
  const preferred = tables.find((t) => t.key.toLowerCase().startsWith('0409')) ?? tables[0]
  const out: VersionStrings = {}
  for (const table of [preferred, ...tables.filter((t) => t !== preferred)]) {
    for (const entry of table.children) {
      const value = entry.text.trim()
      if (!value) continue
      const key = entry.key as keyof VersionStrings
      if (
        (key === 'ProductName' ||
          key === 'FileDescription' ||
          key === 'CompanyName' ||
          key === 'OriginalFilename' ||
          key === 'InternalName') &&
        !out[key]
      ) {
        out[key] = value
      }
    }
  }
  return out
}
