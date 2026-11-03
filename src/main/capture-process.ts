import { grabScreen, type Rect } from './dxgi'
import { toneMap } from './tonemap'

/**
 * The capture process: an Electron utility process that takes screenshots of
 * HDR screens (see dxgi.ts and tonemap.ts) on behalf of the main process.
 *
 * It is a process of its own for two reasons. The capture calls into D3D11
 * through raw COM vtables, and a fault in native code there would take down
 * the whole process; here that only fails one screenshot, which then falls
 * back to the ordinary capture. And the pixel work — a 4K frame is 66 MB of
 * half floats — stays off the main process, where it would stall Storm.
 *
 * Each request names a screen by its physical-pixel rectangle; the answer is
 * the finished 8-bit picture, word that the screen is SDR (the ordinary
 * capture is right for those), or why it failed.
 */

export interface CaptureRequest {
  id: number
  rect: Rect
}

export type CaptureReply =
  | {
      id: number
      kind: 'image'
      /** 8-bit BGRA. */
      pixels: Uint8Array
      width: number
      height: number
      device: string
      sdrWhiteNits: number
      peakNits: number
      toneMapped: boolean
      ms: number
    }
  | { id: number; kind: 'sdr'; device: string }
  | { id: number; kind: 'failed'; reason: string }

function handle({ id, rect }: CaptureRequest): CaptureReply {
  const started = Date.now()
  try {
    const grab = grabScreen(rect)
    if (grab.kind === 'sdr') return { id, kind: 'sdr', device: grab.device }
    const image = toneMap(grab.frame)
    if (image.blank) return { id, kind: 'failed', reason: `${grab.device} gave an empty frame` }
    return {
      id,
      kind: 'image',
      pixels: image.pixels,
      width: image.width,
      height: image.height,
      device: grab.device,
      sdrWhiteNits: grab.frame.sdrWhiteNits,
      peakNits: image.peakNits,
      toneMapped: image.toneMapped,
      ms: Date.now() - started
    }
  } catch (err) {
    return { id, kind: 'failed', reason: err instanceof Error ? err.message : String(err) }
  }
}

process.parentPort.on('message', (event) => {
  process.parentPort.postMessage(handle(event.data as CaptureRequest))
})
