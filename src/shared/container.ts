/**
 * The one binary container used for every world data file ("DBW1").
 * Layout: magic, uint32 header length, JSON header padded to 4 bytes, then the
 * typed-array payloads in header order, each 4-byte aligned. See docs/formats.md.
 */
export const MAGIC = 'DBW1';

export type ArrayType = 'f32' | 'i16' | 'u16' | 'u8' | 'u32' | 'i32';

export interface ArrayEntry {
  name: string;
  type: ArrayType;
  length: number;
  byteOffset: number;
}

export interface ContainerMeta {
  format: string;
  version: number;
  created: string;
  [key: string]: unknown;
}

export type ContainerHeader = ContainerMeta & { arrays: ArrayEntry[] };

export type TypedArray = Float32Array | Int16Array | Uint16Array | Uint8Array | Uint32Array | Int32Array;

const ctors = {
  f32: Float32Array,
  i16: Int16Array,
  u16: Uint16Array,
  u8: Uint8Array,
  u32: Uint32Array,
  i32: Int32Array,
} as const;

function typeOf(a: TypedArray): ArrayType {
  if (a instanceof Float32Array) return 'f32';
  if (a instanceof Int16Array) return 'i16';
  if (a instanceof Uint16Array) return 'u16';
  if (a instanceof Uint8Array) return 'u8';
  if (a instanceof Uint32Array) return 'u32';
  if (a instanceof Int32Array) return 'i32';
  throw new Error('unsupported typed array');
}

const align4 = (n: number): number => (n + 3) & ~3;

/** Serialises a header (without `arrays`) and named arrays into one buffer. */
export function writeContainer(meta: ContainerMeta, arrays: Record<string, TypedArray>): Uint8Array {
  const entries: ArrayEntry[] = [];
  let payloadBytes = 0;
  for (const [name, a] of Object.entries(arrays)) {
    entries.push({ name, type: typeOf(a), length: a.length, byteOffset: payloadBytes });
    payloadBytes = align4(payloadBytes + a.byteLength);
  }
  const header: ContainerHeader = { ...meta, arrays: entries };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const headerLen = align4(headerBytes.length);
  const total = 8 + headerLen + payloadBytes;
  const out = new Uint8Array(total);
  out.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(out.buffer).setUint32(4, headerLen, true);
  out.set(headerBytes, 8);
  for (let i = headerBytes.length; i < headerLen; i += 1) out[8 + i] = 0x20;
  const payloadStart = 8 + headerLen;
  for (const e of entries) {
    const a = arrays[e.name];
    out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), payloadStart + e.byteOffset);
  }
  return out;
}

export interface Container {
  header: ContainerHeader;
  arrays: Record<string, TypedArray>;
}

/** Parses a container; typed arrays are views over the given buffer (no copy). */
export function readContainer(bytes: Uint8Array): Container {
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== MAGIC) throw new Error('not a DBW1 container');
  const headerLen = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLen))) as ContainerHeader;
  const payloadStart = bytes.byteOffset + 8 + headerLen;
  if (payloadStart % 4 !== 0) throw new Error('container payload is not 4-byte aligned; copy the buffer first');
  const arrays: Record<string, TypedArray> = {};
  for (const e of header.arrays) {
    const Ctor = ctors[e.type];
    arrays[e.name] = new Ctor(bytes.buffer as ArrayBuffer, payloadStart + e.byteOffset, e.length);
  }
  return { header, arrays };
}
