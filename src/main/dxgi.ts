import { ComScope, ffi, guid, hex, type Proto, type Ptr } from './com'
import type { HdrFrame } from './tonemap'

/**
 * Reading a screen the way it really is, HDR included — Windows only.
 *
 * Chromium's capture (behind desktopCapturer) asks DXGI Desktop Duplication
 * for 8-bit BGRA. On a screen with HDR on, Windows squeezes its scRGB desktop
 * into that by cutting off everything brighter than SDR white, which is why
 * HDR games come out blown out. IDXGIOutput5::DuplicateOutput1 can ask for
 * the half-float desktop instead, with the highlights intact; tonemap.ts then
 * brings them down properly.
 *
 * Talks to D3D11 and DXGI through koffi (com.ts). The vtable slots and
 * struct layouts come from the Windows SDK headers. This runs in
 * the capture process (capture-process.ts), so a mistake down here can only
 * ever take that process down — never Storm itself.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type ScreenGrab =
  /** HDR is off on this screen: an ordinary capture is already right. */
  { kind: 'sdr'; device: string } | { kind: 'hdr'; device: string; frame: HdrFrame; maxLuminance: number }

const hr = (code: number): number => code | 0
const DXGI_ERROR_NOT_FOUND = hr(0x887a0002)
const DXGI_ERROR_WAIT_TIMEOUT = hr(0x887a0027)
const DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020 = 12
const DXGI_FORMAT_R16G16B16A16_FLOAT = 10
const D3D_DRIVER_TYPE_UNKNOWN = 0
const D3D11_SDK_VERSION = 7
const D3D11_USAGE_STAGING = 3
const D3D11_CPU_ACCESS_READ = 0x20000
const D3D11_MAP_READ = 1
const QDC_ONLY_ACTIVE_PATHS = 2
const ERROR_INSUFFICIENT_BUFFER = 122
const DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME = 1
const DISPLAYCONFIG_DEVICE_INFO_GET_SDR_WHITE_LEVEL = 11
const DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4
/** sizeof(DISPLAYCONFIG_PATH_INFO), sizeof(DISPLAYCONFIG_MODE_INFO). */
const PATH_INFO_BYTES = 72
const MODE_INFO_BYTES = 64

/** Waiting for the first frame; then, briefly, for fresher ones. */
const FIRST_FRAME_MS = 500
const NEXT_FRAME_MS = 100
/** The first frame of a new duplication can be stale or empty, so take a few when they come quickly. */
const WANTED_FRAMES = 3

// vtable slots.
const FACTORY1_ENUM_ADAPTERS1 = 12
const ADAPTER_ENUM_OUTPUTS = 7
const OUTPUT5_DUPLICATE_OUTPUT1 = 26
const OUTPUT6_GET_DESC1 = 27
const DUPLICATION_ACQUIRE_NEXT_FRAME = 8
const DUPLICATION_RELEASE_FRAME = 14
const DEVICE_CREATE_TEXTURE2D = 5
const CONTEXT_MAP = 14
const CONTEXT_UNMAP = 15
const CONTEXT_COPY_RESOURCE = 47
const TEXTURE2D_GET_DESC = 10

const IID_IDXGIFactory1 = guid('770aae78-f26f-4dba-a829-253c83d1b387')
const IID_IDXGIOutput6 = guid('068346e8-aaec-4b84-add7-137f513f77a1')
const IID_ID3D11Texture2D = guid('6f15aaf2-d208-4e89-9ab4-489535d34f9c')

interface Native {
  createFactory: (riid: Buffer, out: BigUint64Array) => number
  createDevice: (...args: unknown[]) => number
  moveMemory: (destination: Uint16Array, source: Ptr, length: number) => void
  bufferSizes: (flags: number, paths: Uint32Array, modes: Uint32Array) => number
  queryConfig: (
    flags: number,
    numPaths: Uint32Array,
    paths: Buffer,
    numModes: Uint32Array,
    modes: Buffer,
    topology: null
  ) => number
  deviceInfo: (packet: Buffer) => number
  proto: Record<
    | 'enumerate'
    | 'getOutputDesc1'
    | 'duplicateOutput1'
    | 'acquireNextFrame'
    | 'releaseFrame'
    | 'getTextureDesc'
    | 'createTexture2D'
    | 'copyResource'
    | 'map'
    | 'unmap',
    Proto
  >
}

let native: Native | undefined
let failure: unknown

function load(): Native {
  if (native) return native
  // Types are registered with koffi once and for all: a second attempt could only trip over them.
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

  koffi.struct('STORM_RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' })
  koffi.struct('STORM_DXGI_OUTPUT_DESC1', {
    DeviceName: koffi.array('char16_t', 32, 'String'),
    DesktopCoordinates: 'STORM_RECT',
    AttachedToDesktop: 'int32_t',
    Rotation: 'uint32_t',
    Monitor: 'void *',
    BitsPerColor: 'uint32_t',
    ColorSpace: 'uint32_t',
    RedPrimary: koffi.array('float', 2),
    GreenPrimary: koffi.array('float', 2),
    BluePrimary: koffi.array('float', 2),
    WhitePoint: koffi.array('float', 2),
    MinLuminance: 'float',
    MaxLuminance: 'float',
    MaxFullFrameLuminance: 'float'
  })
  koffi.struct('STORM_DXGI_OUTDUPL_FRAME_INFO', {
    LastPresentTime: 'int64_t',
    LastMouseUpdateTime: 'int64_t',
    AccumulatedFrames: 'uint32_t',
    RectsCoalesced: 'int32_t',
    ProtectedContentMaskedOut: 'int32_t',
    PointerX: 'int32_t',
    PointerY: 'int32_t',
    PointerVisible: 'int32_t',
    TotalMetadataBufferSize: 'uint32_t',
    PointerShapeBufferSize: 'uint32_t'
  })
  koffi.struct('STORM_D3D11_TEXTURE2D_DESC', {
    Width: 'uint32_t',
    Height: 'uint32_t',
    MipLevels: 'uint32_t',
    ArraySize: 'uint32_t',
    Format: 'uint32_t',
    SampleCount: 'uint32_t',
    SampleQuality: 'uint32_t',
    Usage: 'uint32_t',
    BindFlags: 'uint32_t',
    CPUAccessFlags: 'uint32_t',
    MiscFlags: 'uint32_t'
  })
  koffi.struct('STORM_D3D11_MAPPED_SUBRESOURCE', { pData: 'void *', RowPitch: 'uint32_t', DepthPitch: 'uint32_t' })

  const p = (definition: string): Proto => koffi.proto(definition)
  const proto: Native['proto'] = {
    enumerate: p('int32_t __stdcall StormEnumerate(void *self, uint32_t index, void *out)'),
    getOutputDesc1: p('int32_t __stdcall StormGetDesc1(void *self, _Out_ STORM_DXGI_OUTPUT_DESC1 *desc)'),
    duplicateOutput1: p(
      'int32_t __stdcall StormDuplicateOutput1(void *self, void *device, uint32_t flags, uint32_t count, void *formats, void *out)'
    ),
    acquireNextFrame: p(
      'int32_t __stdcall StormAcquireNextFrame(void *self, uint32_t timeout, _Out_ STORM_DXGI_OUTDUPL_FRAME_INFO *info, void *resource)'
    ),
    releaseFrame: p('int32_t __stdcall StormReleaseFrame(void *self)'),
    getTextureDesc: p('void __stdcall StormGetTextureDesc(void *self, _Out_ STORM_D3D11_TEXTURE2D_DESC *desc)'),
    createTexture2D: p(
      'int32_t __stdcall StormCreateTexture2D(void *self, const STORM_D3D11_TEXTURE2D_DESC *desc, void *initial, void *out)'
    ),
    copyResource: p('void __stdcall StormCopyResource(void *self, void *destination, void *source)'),
    map: p(
      'int32_t __stdcall StormMap(void *self, void *resource, uint32_t subresource, uint32_t type, uint32_t flags, _Out_ STORM_D3D11_MAPPED_SUBRESOURCE *mapped)'
    ),
    unmap: p('void __stdcall StormUnmap(void *self, void *resource, uint32_t subresource)')
  }

  const user32 = koffi.load('user32.dll')
  // DuplicateOutput1 refuses processes that are not per-monitor DPI aware.
  // Fails harmlessly when the awareness is already set (by the manifest).
  try {
    user32.func('int __stdcall SetProcessDpiAwarenessContext(intptr_t value)')(
      DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
    )
  } catch {
    /* older than Windows 10 1703 — DuplicateOutput1 is not there either */
  }

  const kernel32 = koffi.load('kernel32.dll')
  return {
    createFactory: koffi
      .load('dxgi.dll')
      .func('int32_t __stdcall CreateDXGIFactory1(void *riid, void *factory)') as Native['createFactory'],
    createDevice: koffi
      .load('d3d11.dll')
      .func(
        'int32_t __stdcall D3D11CreateDevice(void *adapter, int32_t driverType, void *software, uint32_t flags, void *featureLevels, uint32_t featureLevelCount, uint32_t sdkVersion, void *device, void *featureLevel, void *context)'
      ) as Native['createDevice'],
    moveMemory: kernel32.func(
      'void __stdcall RtlMoveMemory(void *destination, void *source, size_t length)'
    ) as Native['moveMemory'],
    bufferSizes: user32.func(
      'int32_t __stdcall GetDisplayConfigBufferSizes(uint32_t flags, void *numPaths, void *numModes)'
    ) as Native['bufferSizes'],
    queryConfig: user32.func(
      'int32_t __stdcall QueryDisplayConfig(uint32_t flags, void *numPaths, void *paths, void *numModes, void *modes, void *topology)'
    ) as Native['queryConfig'],
    deviceInfo: user32.func('int32_t __stdcall DisplayConfigGetDeviceInfo(void *packet)') as Native['deviceInfo'],
    proto
  }
}

interface OutputDesc {
  DeviceName: string
  DesktopCoordinates: { left: number; top: number; right: number; bottom: number }
  AttachedToDesktop: number
  Rotation: number
  ColorSpace: number
  MaxLuminance: number
}

function overlap(a: OutputDesc['DesktopCoordinates'], b: Rect): number {
  const w = Math.min(a.right, b.x + b.width) - Math.max(a.left, b.x)
  const h = Math.min(a.bottom, b.y + b.height) - Math.max(a.top, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

const deviceName = (value: string): string => value.split('\0')[0].toUpperCase()

/** The "SDR content brightness" Windows gives this screen, in nits; null when it cannot say. */
function sdrWhiteNits(n: Native, device: string): number | null {
  const counts = [new Uint32Array(1), new Uint32Array(1)]
  let paths = Buffer.alloc(0)
  let modes = Buffer.alloc(0)
  for (let attempt = 0; ; attempt++) {
    if (n.bufferSizes(QDC_ONLY_ACTIVE_PATHS, counts[0], counts[1]) !== 0) return null
    paths = Buffer.alloc(counts[0][0] * PATH_INFO_BYTES)
    modes = Buffer.alloc(counts[1][0] * MODE_INFO_BYTES)
    const code = n.queryConfig(QDC_ONLY_ACTIVE_PATHS, counts[0], paths, counts[1], modes, null)
    if (code === 0) break
    // The displays changed between the two calls.
    if (code !== ERROR_INSUFFICIENT_BUFFER || attempt >= 3) return null
  }

  const packet = (type: number, size: number, low: number, high: number, id: number): Buffer => {
    const b = Buffer.alloc(size)
    b.writeUInt32LE(type, 0)
    b.writeUInt32LE(size, 4)
    b.writeUInt32LE(low, 8)
    b.writeInt32LE(high, 12)
    b.writeUInt32LE(id, 16)
    return b
  }

  for (let i = 0; i < counts[0][0]; i++) {
    const at = i * PATH_INFO_BYTES
    // DISPLAYCONFIG_PATH_INFO: sourceInfo { adapterId, id, … } at 0, targetInfo { adapterId, id, … } at 20.
    const source = packet(
      DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME,
      84,
      paths.readUInt32LE(at),
      paths.readInt32LE(at + 4),
      paths.readUInt32LE(at + 8)
    )
    if (n.deviceInfo(source) !== 0) continue
    if (deviceName(source.toString('utf16le', 20, 84)) !== device) continue
    const white = packet(
      DISPLAYCONFIG_DEVICE_INFO_GET_SDR_WHITE_LEVEL,
      24,
      paths.readUInt32LE(at + 20),
      paths.readInt32LE(at + 24),
      paths.readUInt32LE(at + 28)
    )
    if (n.deviceInfo(white) !== 0) return null
    // In thousandths of 80 nits.
    const nits = (white.readUInt32LE(20) / 1000) * 80
    return nits > 0 ? nits : null
  }
  return null
}

/**
 * The screen covering `rect` (physical pixels): its HDR picture, or word that
 * it is an SDR screen. Throws when the screen cannot be read this way.
 */
export function grabScreen(rect: Rect): ScreenGrab {
  if (process.platform !== 'win32') throw new Error('not Windows')
  const n = load()
  const com = new ComScope()
  try {
    const factoryOut = new BigUint64Array(1)
    const code = n.createFactory(IID_IDXGIFactory1, factoryOut)
    if (code < 0 || !factoryOut[0]) throw new Error(`CreateDXGIFactory1 failed (${hex(code)})`)
    const factory = com.hold(factoryOut[0])

    // The output under the rect, and the adapter it hangs off.
    let best: { adapter: Ptr; output: Ptr; desc: OutputDesc; area: number } | null = null
    for (let a = 0; ; a++) {
      const out = new BigUint64Array(1)
      const found = com.call(factory, FACTORY1_ENUM_ADAPTERS1, n.proto.enumerate, a, out) as number
      if (found === DXGI_ERROR_NOT_FOUND || !out[0]) break
      if (found < 0) throw new Error(`EnumAdapters1 failed (${hex(found)})`)
      const adapter = com.hold(out[0])
      for (let o = 0; ; o++) {
        const outputOut = new BigUint64Array(1)
        const listed = com.call(adapter, ADAPTER_ENUM_OUTPUTS, n.proto.enumerate, o, outputOut) as number
        if (listed < 0 || !outputOut[0]) break
        const output = com.hold(outputOut[0])
        const output6 = com.query(output, IID_IDXGIOutput6)
        if (!output6) continue
        const desc = {} as OutputDesc
        if ((com.call(output6, OUTPUT6_GET_DESC1, n.proto.getOutputDesc1, desc) as number) < 0) continue
        if (!desc.AttachedToDesktop) continue
        const area = overlap(desc.DesktopCoordinates, rect)
        if (area > (best?.area ?? 0)) best = { adapter, output: output6, desc, area }
      }
    }
    if (!best) throw new Error('no screen matches the display')

    const device = deviceName(best.desc.DeviceName)
    if (best.desc.ColorSpace !== DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020) return { kind: 'sdr', device }

    const white = sdrWhiteNits(n, device)
    if (!white) throw new Error(`no SDR white level for ${device}`)

    const deviceOut = new BigUint64Array(1)
    const contextOut = new BigUint64Array(1)
    const made = n.createDevice(
      best.adapter,
      D3D_DRIVER_TYPE_UNKNOWN,
      null,
      0,
      null,
      0,
      D3D11_SDK_VERSION,
      deviceOut,
      null,
      contextOut
    )
    if (made < 0 || !deviceOut[0] || !contextOut[0]) throw new Error(`D3D11CreateDevice failed (${hex(made)})`)
    const d3d = com.hold(deviceOut[0])
    const context = com.hold(contextOut[0])

    // Only half floats: whatever the screen holds is converted to them.
    const duplication = com.create(
      best.output,
      OUTPUT5_DUPLICATE_OUTPUT1,
      n.proto.duplicateOutput1,
      'DuplicateOutput1',
      d3d,
      0,
      1,
      new Uint32Array([DXGI_FORMAT_R16G16B16A16_FLOAT])
    )

    let staging: Ptr | null = null
    let desc: Record<string, number> | null = null
    let frames = 0
    const deadline = Date.now() + FIRST_FRAME_MS + WANTED_FRAMES * NEXT_FRAME_MS
    while (frames < WANTED_FRAMES && Date.now() < deadline) {
      const info: Record<string, number | bigint> = {}
      const resourceOut = new BigUint64Array(1)
      const got = com.call(
        duplication,
        DUPLICATION_ACQUIRE_NEXT_FRAME,
        n.proto.acquireNextFrame,
        frames ? NEXT_FRAME_MS : FIRST_FRAME_MS,
        info,
        resourceOut
      ) as number
      if (got === DXGI_ERROR_WAIT_TIMEOUT) {
        // Nothing on screen is moving: the frame already taken is current.
        if (frames) break
        continue
      }
      if (got < 0) {
        // Lost to a mode change or a game going fullscreen: what was copied before still stands.
        if (frames) break
        throw new Error(`AcquireNextFrame failed (${hex(got)})`)
      }
      const frame = new ComScope()
      try {
        if (resourceOut[0]) frame.hold(resourceOut[0])
        // A frame can be only the pointer moving; those carry no picture.
        if (!resourceOut[0] || (Number(info.AccumulatedFrames) === 0 && !info.LastPresentTime)) continue
        const texture = frame.query(resourceOut[0], IID_ID3D11Texture2D)
        if (!texture) throw new Error('the desktop image is not a texture')
        if (!staging) {
          const source: Record<string, number> = {}
          com.call(texture, TEXTURE2D_GET_DESC, n.proto.getTextureDesc, source)
          if (source.Format !== DXGI_FORMAT_R16G16B16A16_FLOAT) throw new Error(`desktop image format ${source.Format}`)
          desc = {
            ...source,
            MipLevels: 1,
            ArraySize: 1,
            SampleCount: 1,
            SampleQuality: 0,
            Usage: D3D11_USAGE_STAGING,
            BindFlags: 0,
            CPUAccessFlags: D3D11_CPU_ACCESS_READ,
            MiscFlags: 0
          }
          staging = com.create(d3d, DEVICE_CREATE_TEXTURE2D, n.proto.createTexture2D, 'CreateTexture2D', desc, null)
        }
        com.call(context, CONTEXT_COPY_RESOURCE, n.proto.copyResource, staging, texture)
        frames++
      } finally {
        frame.releaseAll()
        com.call(duplication, DUPLICATION_RELEASE_FRAME, n.proto.releaseFrame)
      }
    }
    if (!staging || !desc) throw new Error('no frame from the screen')

    const mapped: { pData?: Ptr | null; RowPitch?: number } = {}
    const opened = com.call(context, CONTEXT_MAP, n.proto.map, staging, 0, D3D11_MAP_READ, 0, mapped) as number
    if (opened < 0 || !mapped.pData || !mapped.RowPitch) throw new Error(`Map failed (${hex(opened)})`)
    const { Width: width, Height: height } = desc
    const rowPitch = mapped.RowPitch
    let pixels: Uint16Array
    try {
      pixels = new Uint16Array((rowPitch * height) / 2)
      // The last row ends at its last pixel, not at the pitch.
      n.moveMemory(pixels, mapped.pData, rowPitch * (height - 1) + width * 8)
    } finally {
      com.call(context, CONTEXT_UNMAP, n.proto.unmap, staging, 0)
    }

    return {
      kind: 'hdr',
      device,
      maxLuminance: best.desc.MaxLuminance,
      frame: {
        pixels,
        width,
        height,
        stride: rowPitch / 2,
        rotation: best.desc.Rotation,
        sdrWhiteNits: white
      }
    }
  } finally {
    com.releaseAll()
  }
}
