/**
 * Calling COM objects through koffi, for the Windows-only native code in the
 * capture process (dxgi.ts, jxr.ts).
 *
 * A COM object is a pointer to a pointer to its vtable; a method is a slot in
 * that table, and is called with the object itself as the first argument.
 * Slot numbers count from IUnknown's QueryInterface, AddRef and Release, and
 * come from the Windows SDK headers.
 */

export type Koffi = typeof import('koffi')
export type Proto = ReturnType<Koffi['proto']>
export type Ptr = bigint

const QUERY_INTERFACE = 0
const RELEASE = 2

interface Shared {
  koffi: Koffi
  queryInterface: Proto
  release: Proto
}

let shared: Shared | undefined

/** koffi, loaded on first use — only the capture process ever needs it for this. */
export function ffi(): Shared {
  if (!shared) {
    const koffi = require('koffi') as Koffi
    shared = {
      koffi,
      queryInterface: koffi.proto('int32_t __stdcall StormQueryInterface(void *self, void *riid, void *out)'),
      release: koffi.proto('uint32_t __stdcall StormRelease(void *self)')
    }
  }
  return shared
}

/** A GUID in its in-memory layout. */
export function guid(text: string): Buffer {
  const hex = text.replace(/-/g, '')
  const out = Buffer.alloc(16)
  out.writeUInt32LE(parseInt(hex.slice(0, 8), 16), 0)
  out.writeUInt16LE(parseInt(hex.slice(8, 12), 16), 4)
  out.writeUInt16LE(parseInt(hex.slice(12, 16), 16), 6)
  Buffer.from(hex.slice(16), 'hex').copy(out, 8)
  return out
}

export function hex(code: number): string {
  return `0x${(code >>> 0).toString(16).padStart(8, '0')}`
}

/** Throws unless an HRESULT says success. */
export function check(code: unknown, what: string): void {
  if (typeof code !== 'number' || code < 0) throw new Error(`${what} failed (${hex(Number(code))})`)
}

/** The COM objects one piece of work acquires; released together, newest first. */
export class ComScope {
  private held: Ptr[] = []

  hold(object: Ptr): Ptr {
    this.held.push(object)
    return object
  }

  call(self: Ptr, slot: number, proto: Proto, ...args: unknown[]): unknown {
    const { koffi } = ffi()
    const vtable = koffi.decode(self, 'void *') as Ptr
    const fn = koffi.decode(vtable, slot * 8, 'void *') as Ptr
    return koffi.call(fn, proto, self, ...args)
  }

  /** A method that hands back a new object through its last argument. */
  create(self: Ptr, slot: number, proto: Proto, what: string, ...args: unknown[]): Ptr {
    const out = new BigUint64Array(1)
    const code = this.call(self, slot, proto, ...args, out)
    check(code, what)
    if (!out[0]) throw new Error(`${what} returned nothing`)
    return this.hold(out[0])
  }

  /** The object's interface `iid`, or null when it has none such. */
  query(self: Ptr, iid: Buffer): Ptr | null {
    const out = new BigUint64Array(1)
    const code = this.call(self, QUERY_INTERFACE, ffi().queryInterface, iid, out) as number
    if (code < 0 || !out[0]) return null
    return this.hold(out[0])
  }

  releaseAll(): void {
    const { release } = ffi()
    for (const object of this.held.reverse()) {
      try {
        this.call(object, RELEASE, release)
      } catch {
        /* nothing more to do */
      }
    }
    this.held = []
  }
}
