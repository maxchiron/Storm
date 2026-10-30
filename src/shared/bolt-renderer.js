/**
 * Renders the Storm lightning-bolt icon at any size.
 *
 * Plain JavaScript so the exact same artwork can be used by the Electron main
 * process (runtime window and tray icons) and by the build script that
 * produces the Windows .ico file.
 */

/** The bolt outline, in a 0..1 unit square. */
const BOLT = [
  [0.62, 0.02],
  [0.16, 0.56],
  [0.43, 0.56],
  [0.36, 0.98],
  [0.84, 0.43],
  [0.55, 0.43]
]

const SAMPLES = 4

export function hexToRgb(hex) {
  const clean = String(hex).replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const num = parseInt(full, 16)
  if (Number.isNaN(num)) return { r: 56, g: 189, b: 248 }
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 }
}

function insidePolygon(x, y, polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Signed distance to a rounded rectangle, negative inside. */
function roundedRectDistance(x, y, cx, cy, halfW, halfH, radius) {
  const dx = Math.abs(x - cx) - (halfW - radius)
  const dy = Math.abs(y - cy) - (halfH - radius)
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
  return outside + Math.min(Math.max(dx, dy), 0) - radius
}

function mix(a, b, t) {
  return a + (b - a) * t
}

/**
 * Renders the icon and returns raw RGBA pixels.
 *
 * @param {number} size  edge length in pixels
 * @param {string} hex   accent colour for the badge
 * @returns {Buffer} RGBA data, `size * size * 4` bytes
 */
export function renderBolt(size, hex) {
  const { r, g, b } = hexToRgb(hex)
  // A darker sibling of the accent for the gradient.
  const dark = { r: Math.round(r * 0.42), g: Math.round(g * 0.42), b: Math.round(b * 0.5) }

  const data = Buffer.alloc(size * size * 4)
  const step = 1 / SAMPLES
  const badgeHalf = size * 0.46
  const badgeRadius = size * 0.27
  const boltScale = size * 0.62
  const boltOffsetX = (size - boltScale) / 2
  const boltOffsetY = (size - boltScale) / 2

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let badgeHits = 0
      let boltHits = 0

      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = px + (sx + 0.5) * step
          const y = py + (sy + 0.5) * step

          if (roundedRectDistance(x, y, size / 2, size / 2, badgeHalf, badgeHalf, badgeRadius) <= 0) {
            badgeHits++
          }

          const bx = (x - boltOffsetX) / boltScale
          const by = (y - boltOffsetY) / boltScale
          if (insidePolygon(bx, by, BOLT)) boltHits++
        }
      }

      const total = SAMPLES * SAMPLES
      const badgeAlpha = badgeHits / total
      const boltAlpha = boltHits / total
      const i = (py * size + px) * 4

      if (badgeAlpha <= 0) {
        data[i] = 0
        data[i + 1] = 0
        data[i + 2] = 0
        data[i + 3] = 0
        continue
      }

      // Vertical gradient across the badge.
      const t = py / size
      const br = mix(r, dark.r, t)
      const bg = mix(g, dark.g, t)
      const bb = mix(b, dark.b, t)

      // The bolt is white, composited over the badge.
      const finalAlpha = Math.max(badgeAlpha, boltAlpha)
      const mixT = badgeAlpha > 0 ? boltAlpha / badgeAlpha : 0

      data[i] = Math.round(mix(br, 255, mixT))
      data[i + 1] = Math.round(mix(bg, 255, mixT))
      data[i + 2] = Math.round(mix(bb, 255, mixT))
      data[i + 3] = Math.round(finalAlpha * 255)
    }
  }

  return data
}
