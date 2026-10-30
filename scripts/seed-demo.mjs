/**
 * Seeds the Storm library with demo games, generated poster art and real
 * install folders — handy for development and for checking the live
 * install-detection by deleting one of the folders.
 *
 *   node scripts/seed-demo.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'
import { randomBytes } from 'node:crypto'

const DATA_DIR = process.env.STORM_DATA_DIR || path.join(os.homedir(), '.config', 'storm')
const COVERS = path.join(DATA_DIR, 'covers')
const BANNERS = path.join(DATA_DIR, 'banners')
const GAMES_DIR = path.join(DATA_DIR, 'demo-games')

/* ------------------------------------------------------ png encoder */

const CRC_TABLE = (() => {
  const table = new Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function encodePng(width, height, rgba) {
  const stride = width * 4 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/* --------------------------------------------------------- artwork */

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0
  let g = 0
  let b = 0
  if (hp < 1) [r, g, b] = [c, x, 0]
  else if (hp < 2) [r, g, b] = [x, c, 0]
  else if (hp < 3) [r, g, b] = [0, c, x]
  else if (hp < 4) [r, g, b] = [0, x, c]
  else if (hp < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = l - c / 2
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

function hashOf(value) {
  let hash = 0
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) % 100000
  return hash
}

/** Generates a soft, poster-like gradient with a light source and a vignette. */
function artwork(width, height, seed) {
  const data = Buffer.alloc(width * height * 4)
  const baseHue = hashOf(seed) % 360
  const secondHue = (baseHue + 40 + (hashOf(seed) % 90)) % 360
  const lightX = 0.25 + ((hashOf(seed + 'x') % 100) / 100) * 0.5
  const lightY = 0.15 + ((hashOf(seed + 'y') % 60) / 100) * 0.45
  const radius = Math.max(width, height) * 0.75

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width
      const v = y / height

      // base diagonal gradient
      const t = (u * 0.45 + v * 0.75) % 1
      let [r, g, b] = hslToRgb(baseHue + t * 40, 0.55, 0.2 - t * 0.12)

      // secondary wash
      const [r2, g2, b2] = hslToRgb(secondHue, 0.6, 0.26)
      const wash = Math.max(0, 1 - Math.hypot(u - 0.85, v - 0.15) * 1.5)
      r += (r2 - r) * wash * 0.55
      g += (g2 - g) * wash * 0.55
      b += (b2 - b) * wash * 0.55

      // light source
      const d = Math.hypot((u - lightX) * width, (v - lightY) * height)
      const glow = Math.max(0, 1 - d / radius) ** 2.4
      r += glow * 120
      g += glow * 118
      b += glow * 110

      // diagonal light streaks
      const streak = Math.sin((u * 3.2 + v * 5.4) * Math.PI) * 0.5 + 0.5
      const streakAmount = streak ** 6 * 16
      r += streakAmount
      g += streakAmount
      b += streakAmount

      // vignette + bottom fade for the title overlay
      const edge = Math.hypot(u - 0.5, v - 0.5) * 1.5
      const vig = Math.max(0, 1 - edge) * 0.55 + 0.45
      const bottomFade = 1 - Math.max(0, v - 0.6) * 1.1
      const k = vig * bottomFade

      const i = (y * width + x) * 4
      data[i] = Math.max(0, Math.min(255, r * k))
      data[i + 1] = Math.max(0, Math.min(255, g * k))
      data[i + 2] = Math.max(0, Math.min(255, b * k))
      data[i + 3] = 255
    }
  }
  return encodePng(width, height, data)
}

/* ------------------------------------------------------------ data */

const GAMES = [
  {
    title: 'Cyberpunk 2077',
    hue: 'cyberpunk',
    installed: true,
    played: true,
    favorite: true,
    playCount: 14,
    playtimeMinutes: 862,
    tags: ['RPG', 'Open world', 'Night City'],
    note: '存档在 Documents\\Cyberpunk 2077\\Saved Games。2.1 版本，用的是 1440p 配置。',
    lastPlayedDaysAgo: 3,
    firstPlayedDaysAgo: 400
  },
  {
    title: 'Elden Ring',
    hue: 'elden',
    installed: true,
    played: true,
    favorite: false,
    playCount: 22,
    playtimeMinutes: 2140,
    tags: ['Souls-like', 'Open world'],
    note: 'DLC 也装了。存档 AppData\\Roaming\\Elden Ring。',
    lastPlayedDaysAgo: 21,
    firstPlayedDaysAgo: 300
  },
  {
    title: 'Baldur’s Gate 3',
    hue: 'baldur',
    installed: false,
    played: true,
    favorite: true,
    playCount: 31,
    playtimeMinutes: 3465,
    tags: ['RPG', 'Turn based', 'Co-op'],
    note: '通关了，随手删了。存档在 Steam 用户目录里，如果重装记得先备份。',
    lastPlayedDaysAgo: 120,
    firstPlayedDaysAgo: 600
  },
  {
    title: 'Stardew Valley',
    hue: 'stardew',
    installed: true,
    played: false,
    favorite: false,
    playCount: 0,
    playtimeMinutes: 0,
    tags: ['Farming', 'Cozy'],
    note: '还没开始。想在假期慢慢玩。',
    lastPlayedDaysAgo: null,
    firstPlayedDaysAgo: null
  },
  {
    title: 'Red Dead Redemption 2',
    hue: 'rdr',
    installed: false,
    played: true,
    favorite: true,
    playCount: 9,
    playtimeMinutes: 1180,
    tags: ['Open world', 'Story'],
    note: '硬盘满了已经删掉。剧情太好了，可惜。',
    lastPlayedDaysAgo: 200,
    firstPlayedDaysAgo: 500
  },
  {
    title: 'Hades',
    hue: 'hades',
    installed: true,
    played: true,
    favorite: false,
    playCount: 27,
    playtimeMinutes: 640,
    tags: ['Roguelike', 'Indie'],
    note: '无限模式还在刷。存档 %APPDATA%\\Hades。',
    lastPlayedDaysAgo: 8,
    firstPlayedDaysAgo: 250
  },
  {
    title: 'Hollow Knight',
    hue: 'hollow',
    installed: true,
    played: true,
    favorite: false,
    playCount: 6,
    playtimeMinutes: 320,
    tags: ['Metroidvania', 'Indie'],
    note: '',
    lastPlayedDaysAgo: 60,
    firstPlayedDaysAgo: 380
  },
  {
    title: 'Forza Horizon 5',
    hue: 'forza',
    installed: true,
    played: false,
    favorite: false,
    playCount: 0,
    playtimeMinutes: 0,
    tags: ['Racing', 'Xbox'],
    note: '手柄在抽屉里。',
    lastPlayedDaysAgo: null,
    firstPlayedDaysAgo: null
  },
  {
    title: 'Portal 2',
    hue: 'portal',
    installed: false,
    played: true,
    favorite: false,
    hidden: true,
    playCount: 4,
    playtimeMinutes: 415,
    tags: ['Puzzle', 'Co-op'],
    note: '双人和朋友一起打的，很经典。',
    lastPlayedDaysAgo: 340,
    firstPlayedDaysAgo: 700
  },
  {
    title: 'Disco Elysium',
    hue: 'disco',
    installed: true,
    played: true,
    favorite: true,
    playCount: 11,
    playtimeMinutes: 1490,
    tags: ['RPG', 'Detective', 'Text heavy'],
    note: '剧本太好了，值得二周目。',
    lastPlayedDaysAgo: 14,
    firstPlayedDaysAgo: 180
  },
  {
    title: 'Cities: Skylines II',
    hue: 'cities',
    installed: true,
    played: false,
    favorite: false,
    playCount: 0,
    playtimeMinutes: 0,
    tags: ['Builder', 'Simulation'],
    note: '',
    lastPlayedDaysAgo: null,
    firstPlayedDaysAgo: null
  },
  {
    title: 'Alan Wake 2',
    hue: 'alan',
    installed: false,
    played: true,
    favorite: false,
    playCount: 3,
    playtimeMinutes: 265,
    tags: ['Horror', 'Story'],
    note: '',
    lastPlayedDaysAgo: 90,
    firstPlayedDaysAgo: 420
  }
]

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString()
const uuid = () => {
  const buf = randomBytes(16)
  buf[6] = (buf[6] & 0x0f) | 0x40
  buf[8] = (buf[8] & 0x3f) | 0x80
  const hex = buf.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

fs.mkdirSync(COVERS, { recursive: true })
fs.mkdirSync(BANNERS, { recursive: true })
fs.mkdirSync(GAMES_DIR, { recursive: true })

const games = []

for (const [index, spec] of GAMES.entries()) {
  const coverName = `${spec.hue}.png`
  const bannerName = `${spec.hue}-banner.png`
  fs.writeFileSync(path.join(COVERS, coverName), artwork(600, 900, spec.hue + index))
  fs.writeFileSync(path.join(BANNERS, bannerName), artwork(1600, 900, spec.hue + index + 'banner'))

  let installPath = null
  let exePath = null
  let savePath = null

  if (spec.installed) {
    const dir = path.join(GAMES_DIR, spec.hue)
    fs.mkdirSync(dir, { recursive: true })
    fs.mkdirSync(path.join(dir, 'bin'), { recursive: true })
    const exe = path.join(dir, 'bin', `${spec.hue}.exe`)
    if (!fs.existsSync(exe)) fs.writeFileSync(exe, 'MZ')
    installPath = dir
    exePath = exe
    savePath = path.join(dir, 'saves')
    fs.mkdirSync(savePath, { recursive: true })
  }

  games.push({
    id: uuid(),
    title: spec.title,
    cover: coverName,
    banner: bannerName,
    exePath,
    installPath,
    savePath,
    installed: spec.installed,
    played: spec.played,
    favorite: spec.favorite,
    hidden: spec.hidden ?? false,
    playCount: spec.playCount,
    playtimeMinutes: spec.playtimeMinutes,
    firstPlayedAt: spec.firstPlayedDaysAgo === null ? null : daysAgo(spec.firstPlayedDaysAgo),
    lastPlayedAt: spec.lastPlayedDaysAgo === null ? null : daysAgo(spec.lastPlayedDaysAgo),
    tags: spec.tags,
    note: spec.note,
    addedAt: daysAgo(spec.firstPlayedDaysAgo ?? 30 + index),
    updatedAt: daysAgo(spec.lastPlayedDaysAgo ?? 1)
  })
}

const dbPath = path.join(DATA_DIR, 'library.json')
fs.writeFileSync(
  dbPath,
  JSON.stringify(
    {
      version: 1,
      games,
      settings: {
        language: 'zh',
        theme: 'storm',
        accent: '#38bdf8',
        posterSize: 'md',
        scanIntervalSeconds: 10,
        minimizeToTray: true,
        confirmBeforeDelete: true,
        reduceMotion: false
      },
      sessions: []
    },
    null,
    2
  )
)

console.log(`seeded ${games.length} games into ${DATA_DIR}`)
console.log(`install folders live in ${GAMES_DIR}`)
