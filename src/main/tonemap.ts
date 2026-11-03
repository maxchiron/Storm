/**
 * Turning what an HDR screen shows into an ordinary picture.
 *
 * With HDR on, Windows composes the desktop in scRGB: linear light, the sRGB
 * primaries, 1.0 = 80 nits, values above 1 for anything brighter and below 0
 * for colours outside sRGB. SDR content — the desktop, an SDR game — sits in
 * it scaled up to the "SDR content brightness" the user chose, so its white
 * is at sdrWhite / 80. HDR games write absolute brightness, often 1000 nits
 * and more.
 *
 * A PNG or JPEG has room for SDR white and nothing above it, so:
 *  - SDR content is divided back down by the SDR white level and comes out
 *    exactly as it went in.
 *  - Brighter highlights are rolled off with the BT.2390 EETF (the curve TVs
 *    and OBS use for the same job), applied to max(R, G, B) so hues stay put,
 *    from the frame's own peak down to SDR white. Below the knee nothing
 *    changes, so a scene's mid-tones keep their brightness.
 *  - Colours outside sRGB (negative channels) are clipped to its edge. That
 *    keeps them as vivid as sRGB allows; pulling them toward grey instead
 *    keeps their brightness but visibly washes them out.
 *
 * Pure arithmetic over typed arrays — no Electron, no native code — so it
 * runs anywhere, including the capture process and the tests.
 */

export interface HdrFrame {
  /** RGBA half floats, scRGB. */
  pixels: Uint16Array
  width: number
  height: number
  /** Distance from one row to the next, counted in half floats. */
  stride: number
  /** How the screen is turned (DXGI_MODE_ROTATION): 1 or 0 not at all, 2 = 90°, 3 = 180°, 4 = 270°. */
  rotation: number
  /** The brightness Windows gives SDR white on this screen. */
  sdrWhiteNits: number
}

export interface SdrImage {
  /** 8-bit sRGB, BGRA — what nativeImage.createFromBitmap takes. */
  pixels: Uint8Array
  width: number
  height: number
  /** The brightness the frame was mapped from: its 99.95th percentile, in nits. */
  peakNits: number
  /** Whether there was anything above SDR white to roll off. */
  toneMapped: boolean
  /** Not a single lit pixel — the first frames of a fresh capture can be like that. */
  blank: boolean
}

/** scRGB 1.0, in nits. */
const SCRGB_NITS = 80
/** The share of pixels allowed to clip, so a few specks of sun don't darken the whole picture. */
const CLIP_SHARE = 0.0005
/** A peak this close to SDR white is SDR content plus rounding. */
const SDR_TOLERANCE = 1.01
/** Largest finite half float, and the bucket count for half-float keys. */
const HALF_MAX_KEY = 0x7bff
const SRGB_STEPS = 65535

let halfTable: Float32Array | null = null

function halfToFloat(): Float32Array {
  if (halfTable) return halfTable
  const table = new Float32Array(65536)
  for (let h = 0; h < 65536; h++) {
    const exponent = (h >> 10) & 0x1f
    const fraction = h & 0x3ff
    let value: number
    if (exponent === 0) value = fraction * 2 ** -24
    else if (exponent === 31) value = fraction ? NaN : Infinity
    else value = (1 + fraction / 1024) * 2 ** (exponent - 15)
    table[h] = h & 0x8000 ? -value : value
  }
  return (halfTable = table)
}

let srgbTable: Uint8Array | null = null

/** Linear [0, 1] in SRGB_STEPS steps → 8-bit sRGB, with the piecewise curve Windows itself uses for SDR content. */
function srgbEncode(): Uint8Array {
  if (srgbTable) return srgbTable
  const table = new Uint8Array(SRGB_STEPS + 1)
  for (let i = 0; i <= SRGB_STEPS; i++) {
    const v = i / SRGB_STEPS
    const encoded = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
    table[i] = Math.round(encoded * 255)
  }
  return (srgbTable = table)
}

/**
 * A half float as a sortable bucket: its own bits when positive (they order
 * like the values do), 0 when negative or zero, the largest finite value for
 * infinity and NaN.
 */
function key(half: number): number {
  if (half & 0x8000) return 0
  return half > HALF_MAX_KEY ? HALF_MAX_KEY : half
}

// SMPTE ST 2084 (PQ), in nits.
const M1 = 2610 / 16384
const M2 = (2523 / 4096) * 128
const C1 = 3424 / 4096
const C2 = (2413 / 4096) * 32
const C3 = (2392 / 4096) * 32

function pqEncode(nits: number): number {
  const y = Math.pow(Math.max(nits, 0) / 10000, M1)
  return Math.pow((C1 + C2 * y) / (1 + C3 * y), M2)
}

function pqDecode(e: number): number {
  const p = Math.pow(Math.max(e, 0), 1 / M2)
  return 10000 * Math.pow(Math.max(p - C1, 0) / (C2 - C3 * p), 1 / M1)
}

/**
 * The BT.2390 EETF from [0, sourcePeak] to [0, targetPeak] nits: the
 * identity up to a knee, then a spline that lands the source peak exactly on
 * the target peak. Anything above the source peak lands there too.
 */
export function eetf(nits: number, sourcePeak: number, targetPeak: number): number {
  if (sourcePeak <= targetPeak) return Math.min(nits, targetPeak)
  const sourceMax = pqEncode(sourcePeak)
  const maxLum = pqEncode(targetPeak) / sourceMax
  const ks = Math.max(1.5 * maxLum - 0.5, 0)
  const e1 = Math.min(pqEncode(nits) / sourceMax, 1)
  if (e1 < ks) return nits
  const t = (e1 - ks) / (1 - ks)
  const t2 = t * t
  const t3 = t2 * t
  const e2 = (2 * t3 - 3 * t2 + 1) * ks + (t3 - 2 * t2 + t) * (1 - ks) + (-2 * t3 + 3 * t2) * maxLum
  return Math.min(pqDecode(e2 * sourceMax), targetPeak)
}

/** Where the first pixel of source row y goes, and how far each next one moves, for the screen's rotation. */
export function placement(
  rotation: number,
  width: number,
  height: number
): { width: number; height: number; start: (y: number) => number; step: number } {
  switch (rotation) {
    case 2: // 90°: the image is stored in the panel's own orientation, a quarter turn from the desktop's.
      return { width: height, height: width, start: (y: number) => height - 1 - y, step: height }
    case 3:
      return { width, height, start: (y: number) => (height - 1 - y) * width + width - 1, step: -1 }
    case 4:
      return { width: height, height: width, start: (y: number) => (width - 1) * height + y, step: -height }
    default:
      return { width, height, start: (y: number) => y * width, step: 1 }
  }
}

export function toneMap(frame: HdrFrame): SdrImage {
  const { pixels, width, height, stride } = frame
  const toFloat = halfToFloat()
  const encode = srgbEncode()
  const white = frame.sdrWhiteNits > 0 ? frame.sdrWhiteNits : SCRGB_NITS

  // How bright the frame is: a histogram of max(R, G, B).
  const histogram = new Uint32Array(HALF_MAX_KEY + 1)
  for (let y = 0; y < height; y++) {
    let i = y * stride
    const end = i + width * 4
    for (; i < end; i += 4) {
      const r = key(pixels[i])
      const g = key(pixels[i + 1])
      const b = key(pixels[i + 2])
      histogram[r > g ? (r > b ? r : b) : g > b ? g : b]++
    }
  }
  let peakKey = HALF_MAX_KEY
  for (let seen = 0, allowed = Math.floor(width * height * CLIP_SHARE); peakKey > 0; peakKey--) {
    seen += histogram[peakKey]
    if (seen > allowed) break
  }
  const peakNits = toFloat[peakKey] * SCRGB_NITS
  const toneMapped = peakNits > white * SDR_TOLERANCE

  // max(R, G, B) bucket → the factor that takes the pixel to [0, 1] relative to SDR white.
  const scale = new Float32Array(HALF_MAX_KEY + 1)
  for (let k = 1; k <= HALF_MAX_KEY; k++) {
    const nits = toFloat[k] * SCRGB_NITS
    scale[k] = toneMapped ? eetf(nits, peakNits, white) / white / toFloat[k] : SCRGB_NITS / white
  }

  const out = placement(frame.rotation, width, height)
  const bgra = new Uint8Array(out.width * out.height * 4)
  for (let y = 0; y < height; y++) {
    let i = y * stride
    let o = out.start(y) * 4
    const step = out.step * 4
    for (let x = 0; x < width; x++, i += 4, o += step) {
      const hr = pixels[i]
      const hg = pixels[i + 1]
      const hb = pixels[i + 2]
      const kr = key(hr)
      const kg = key(hg)
      const kb = key(hb)
      const s = scale[kr > kg ? (kr > kb ? kr : kb) : kg > kb ? kg : kb]
      const r = toFloat[hr] * s
      const g = toFloat[hg] * s
      const b = toFloat[hb] * s
      // Clipped to [0, 1]; NaN fails both comparisons and ends up black.
      bgra[o] = encode[b > 0 ? (b < 1 ? (b * SRGB_STEPS + 0.5) | 0 : SRGB_STEPS) : 0]
      bgra[o + 1] = encode[g > 0 ? (g < 1 ? (g * SRGB_STEPS + 0.5) | 0 : SRGB_STEPS) : 0]
      bgra[o + 2] = encode[r > 0 ? (r < 1 ? (r * SRGB_STEPS + 0.5) | 0 : SRGB_STEPS) : 0]
      bgra[o + 3] = 255
    }
  }

  return {
    pixels: bgra,
    width: out.width,
    height: out.height,
    peakNits,
    toneMapped,
    blank: histogram[0] === width * height
  }
}
