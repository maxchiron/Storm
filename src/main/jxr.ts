import { check, ComScope, ffi, guid, type Proto, type Ptr } from './com'
import { placement, type HdrFrame } from './tonemap'

/**
 * Keeping an HDR screenshot as HDR: JPEG XR (.jxr), the format Xbox Game Bar
 * and NVIDIA save HDR screenshots in, which Windows Photos shows in HDR.
 *
 * It holds exactly what the screen was read as (dxgi.ts): scRGB half floats,
 * so nothing is tone mapped or clipped — highlights, and colours beyond sRGB,
 * are all there. Windows' own codec (WIC) does the encoding, at its default
 * quality: ImageQuality 0.9, lossy but with full-resolution colour, which
 * keeps a 4K shot to a few megabytes instead of 60.
 *
 * Windows only, and run in the capture process like the rest of the native
 * code (see capture-process.ts).
 */

const CLSCTX_INPROC_SERVER = 1
const COINIT_MULTITHREADED = 0
const WIC_BITMAP_ENCODER_NO_CACHE = 2
const STREAM_SEEK_END = 2
/** 1.0 as a half float. */
const OPAQUE = 0x3c00

const CLSID_WICImagingFactory = guid('cacaf262-9370-4615-a13b-9f5539da4c0a')
const IID_IWICImagingFactory = guid('ec5ec8a9-c395-4314-9c77-54d7a935ff70')
const GUID_ContainerFormatWmp = guid('57a37caa-367a-4540-916b-f183c5093a4b')
const GUID_WICPixelFormat64bppRGBAHalf = guid('6fddc324-4e03-4bfe-b185-3d77768dc93a')

// vtable slots.
const FACTORY_CREATE_ENCODER = 8
const ENCODER_INITIALIZE = 3
const ENCODER_CREATE_NEW_FRAME = 10
const ENCODER_COMMIT = 11
const FRAME_INITIALIZE = 3
const FRAME_SET_SIZE = 4
const FRAME_SET_PIXEL_FORMAT = 6
const FRAME_WRITE_PIXELS = 10
const FRAME_COMMIT = 12
const STREAM_SEEK = 5

interface Native {
  coInitialize: (reserved: null, flags: number) => number
  createInstance: (clsid: Buffer, outer: null, context: number, iid: Buffer, out: BigUint64Array) => number
  streamOnMemory: (memory: null, deleteOnRelease: number, out: BigUint64Array) => number
  memoryOfStream: (stream: Ptr, out: BigUint64Array) => number
  lock: (memory: Ptr) => Ptr | null
  unlock: (memory: Ptr) => number
  moveMemory: (destination: Buffer, source: Ptr, length: number) => void
  proto: Record<
    | 'createEncoder'
    | 'initializeEncoder'
    | 'createNewFrame'
    | 'initializeFrame'
    | 'setSize'
    | 'setPixelFormat'
    | 'writePixels'
    | 'commit'
    | 'seek',
    Proto
  >
}

let native: Native | undefined
let failure: unknown

function load(): Native {
  if (native) return native
  if (failure) throw failure
  try {
    native = bind()
  } catch (err) {
    failure = err
    throw err
  }
  return native
}

function bind(): Native {
  const { koffi } = ffi()
  const p = (definition: string): Proto => koffi.proto(definition)
  const ole32 = koffi.load('ole32.dll')
  const kernel32 = koffi.load('kernel32.dll')
  const result: Native = {
    coInitialize: ole32.func(
      'int32_t __stdcall CoInitializeEx(void *reserved, uint32_t flags)'
    ) as Native['coInitialize'],
    createInstance: ole32.func(
      'int32_t __stdcall CoCreateInstance(void *clsid, void *outer, uint32_t context, void *iid, void *out)'
    ) as Native['createInstance'],
    streamOnMemory: ole32.func(
      'int32_t __stdcall CreateStreamOnHGlobal(void *memory, int deleteOnRelease, void *out)'
    ) as Native['streamOnMemory'],
    memoryOfStream: ole32.func(
      'int32_t __stdcall GetHGlobalFromStream(void *stream, void *out)'
    ) as Native['memoryOfStream'],
    lock: kernel32.func('void * __stdcall GlobalLock(void *memory)') as Native['lock'],
    unlock: kernel32.func('int __stdcall GlobalUnlock(void *memory)') as Native['unlock'],
    moveMemory: kernel32.func(
      'void __stdcall RtlMoveMemory(void *destination, void *source, size_t length)'
    ) as Native['moveMemory'],
    proto: {
      createEncoder: p('int32_t __stdcall StormCreateEncoder(void *self, void *container, void *vendor, void *out)'),
      initializeEncoder: p('int32_t __stdcall StormEncoderInitialize(void *self, void *stream, uint32_t cache)'),
      createNewFrame: p('int32_t __stdcall StormCreateNewFrame(void *self, void *frame, void *options)'),
      initializeFrame: p('int32_t __stdcall StormFrameInitialize(void *self, void *options)'),
      setSize: p('int32_t __stdcall StormSetSize(void *self, uint32_t width, uint32_t height)'),
      setPixelFormat: p('int32_t __stdcall StormSetPixelFormat(void *self, void *format)'),
      writePixels: p(
        'int32_t __stdcall StormWritePixels(void *self, uint32_t lines, uint32_t stride, uint32_t size, void *pixels)'
      ),
      commit: p('int32_t __stdcall StormCommit(void *self)'),
      seek: p('int32_t __stdcall StormSeek(void *self, int64_t move, uint32_t origin, void *position)')
    }
  }
  // WIC is COM. Whatever this thread already has (S_FALSE, RPC_E_CHANGED_MODE) does as well.
  result.coInitialize(null, COINIT_MULTITHREADED)
  return result
}

/**
 * The frame as the encoder takes it: rows packed tight, turned the way the
 * desktop is, alpha opaque (what the capture has there is no alpha at all),
 * and any NaN or infinity zeroed so no viewer trips over them.
 */
export function uprightHalf(frame: HdrFrame): { pixels: Uint16Array; width: number; height: number } {
  const out = placement(frame.rotation, frame.width, frame.height)
  const src = frame.pixels
  const pixels = new Uint16Array(out.width * out.height * 4)
  const step = out.step * 4
  for (let y = 0; y < frame.height; y++) {
    let i = y * frame.stride
    let o = out.start(y) * 4
    for (let x = 0; x < frame.width; x++, i += 4, o += step) {
      const r = src[i]
      const g = src[i + 1]
      const b = src[i + 2]
      pixels[o] = (r & 0x7c00) === 0x7c00 ? 0 : r
      pixels[o + 1] = (g & 0x7c00) === 0x7c00 ? 0 : g
      pixels[o + 2] = (b & 0x7c00) === 0x7c00 ? 0 : b
      pixels[o + 3] = OPAQUE
    }
  }
  return { pixels, width: out.width, height: out.height }
}

/** The frame as a JPEG XR file. */
export function encodeJxr(frame: HdrFrame): Buffer {
  if (process.platform !== 'win32') throw new Error('not Windows')
  const n = load()
  const { pixels, width, height } = uprightHalf(frame)
  const com = new ComScope()
  try {
    const factoryOut = new BigUint64Array(1)
    check(
      n.createInstance(CLSID_WICImagingFactory, null, CLSCTX_INPROC_SERVER, IID_IWICImagingFactory, factoryOut),
      'CoCreateInstance(WICImagingFactory)'
    )
    const factory = com.hold(factoryOut[0])
    // A stream over memory that grows as the encoder writes.
    const streamOut = new BigUint64Array(1)
    check(n.streamOnMemory(null, 1, streamOut), 'CreateStreamOnHGlobal')
    const stream = com.hold(streamOut[0])

    const encoder = com.create(
      factory,
      FACTORY_CREATE_ENCODER,
      n.proto.createEncoder,
      'CreateEncoder',
      GUID_ContainerFormatWmp,
      null
    )
    check(
      com.call(encoder, ENCODER_INITIALIZE, n.proto.initializeEncoder, stream, WIC_BITMAP_ENCODER_NO_CACHE),
      'IWICBitmapEncoder::Initialize'
    )
    const frameOut = new BigUint64Array(1)
    // No options: the codec's defaults.
    check(com.call(encoder, ENCODER_CREATE_NEW_FRAME, n.proto.createNewFrame, frameOut, null), 'CreateNewFrame')
    if (!frameOut[0]) throw new Error('CreateNewFrame returned nothing')
    const target = com.hold(frameOut[0])
    check(com.call(target, FRAME_INITIALIZE, n.proto.initializeFrame, null), 'IWICBitmapFrameEncode::Initialize')
    check(com.call(target, FRAME_SET_SIZE, n.proto.setSize, width, height), 'SetSize')
    // The encoder answers with the closest format it can do; anything but ours would need converting.
    const format = Buffer.from(GUID_WICPixelFormat64bppRGBAHalf)
    check(com.call(target, FRAME_SET_PIXEL_FORMAT, n.proto.setPixelFormat, format), 'SetPixelFormat')
    if (!format.equals(GUID_WICPixelFormat64bppRGBAHalf)) throw new Error('the JPEG XR encoder refused half floats')
    check(
      com.call(target, FRAME_WRITE_PIXELS, n.proto.writePixels, height, width * 8, pixels.byteLength, pixels),
      'WritePixels'
    )
    check(com.call(target, FRAME_COMMIT, n.proto.commit), 'IWICBitmapFrameEncode::Commit')
    check(com.call(encoder, ENCODER_COMMIT, n.proto.commit), 'IWICBitmapEncoder::Commit')

    // Read the file back out of the stream's memory.
    const end = new BigUint64Array(1)
    check(com.call(stream, STREAM_SEEK, n.proto.seek, 0n, STREAM_SEEK_END, end), 'IStream::Seek')
    const size = Number(end[0])
    if (!size) throw new Error('the JPEG XR encoder wrote nothing')
    const memoryOut = new BigUint64Array(1)
    check(n.memoryOfStream(stream, memoryOut), 'GetHGlobalFromStream')
    const memory = n.lock(memoryOut[0])
    if (!memory) throw new Error('GlobalLock failed')
    try {
      const file = Buffer.alloc(size)
      n.moveMemory(file, memory, size)
      return file
    } finally {
      n.unlock(memoryOut[0])
    }
  } finally {
    com.releaseAll()
  }
}
