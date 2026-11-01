// Binary KeyValues3 (versions 4–5, as used by CS2 resources) → plain JS values.
// Layout follows ValveResourceFormat's BinaryKV3 reader (MIT); this is an independent implementation.
// Objects become plain objects, typed scalar arrays become JS arrays, binary blobs become Uint8Array.
export type KV3 = null | boolean | number | bigint | string | Uint8Array | KV3[] | { [key: string]: KV3 };

const T = {
  NULL: 1, BOOLEAN: 2, INT64: 3, UINT64: 4, DOUBLE: 5, STRING: 6, BINARY_BLOB: 7, ARRAY: 8, OBJECT: 9, ARRAY_TYPED: 10,
  INT32: 11, UINT32: 12, BOOLEAN_TRUE: 13, BOOLEAN_FALSE: 14, INT64_ZERO: 15, INT64_ONE: 16, DOUBLE_ZERO: 17, DOUBLE_ONE: 18,
  FLOAT: 19, INT16: 20, UINT16: 21, INT8: 22, UINT8: 23, ARRAY_TYPE_BYTE_LENGTH: 24, ARRAY_TYPE_AUXILIARY_BUFFER: 25, UINT32_ZERO: 26, UINT32_ONE: 27,
};
const TRAILER = 0xffeedd00;

// LZ4 block decode into dst starting at `at`; matches may reach back into earlier dst bytes (chained frames).
export function lz4Into(src: Uint8Array, dst: Uint8Array, at: number, limit = dst.length): number {
  let s = 0, d = at;
  const length = (n: number) => {
    if (n === 15) for (let b = 255; b === 255; ) n += b = src[s++];
    return n;
  };
  while (s < src.length) {
    const token = src[s++];
    const lit = length(token >> 4);
    if (d + lit > limit || s + lit > src.length) throw new Error('lz4: literal overrun');
    dst.set(src.subarray(s, s + lit), d);
    s += lit;
    d += lit;
    if (s >= src.length) break;
    const offset = src[s] | (src[s + 1] << 8);
    s += 2;
    const len = length(token & 15) + 4;
    if (!offset || offset > d || d + len > limit) throw new Error('lz4: bad match');
    for (let i = 0; i < len; i++, d++) dst[d] = dst[d - offset];
  }
  return d - at;
}

// A typed lane cursor over one region of a buffer.
class Lane {
  constructor(private dv: DataView, public pos: number, public end: number) {}
  private take(n: number) {
    const p = this.pos;
    if (p + n > this.end) throw new Error('kv3: lane overrun');
    this.pos += n;
    return p;
  }
  u8 = () => this.dv.getUint8(this.take(1));
  i8 = () => this.dv.getInt8(this.take(1));
  i16 = () => this.dv.getInt16(this.take(2), true);
  u16 = () => this.dv.getUint16(this.take(2), true);
  i32 = () => this.dv.getInt32(this.take(4), true);
  u32 = () => this.dv.getUint32(this.take(4), true);
  f32 = () => this.dv.getFloat32(this.take(4), true);
  f64 = () => this.dv.getFloat64(this.take(8), true);
  i64 = () => this.dv.getBigInt64(this.take(8), true);
  u64 = () => this.dv.getBigUint64(this.take(8), true);
}
type Lanes = { b1: Lane; b2: Lane; b4: Lane; b8: Lane };

function lanes(buf: Uint8Array, start: number, c1: number, c2: number, c4: number, c8: number): { lanes: Lanes; end: number } {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = start;
  const align = (n: number) => (o = Math.ceil(o / n) * n);
  const b1 = new Lane(dv, o, (o += c1));
  if (c2) align(2);
  const b2 = new Lane(dv, o, (o += c2 * 2));
  if (c4) align(4);
  const b4 = new Lane(dv, o, (o += c4 * 4));
  if (c8) align(8);
  const b8 = new Lane(dv, o, (o += c8 * 8));
  return { lanes: { b1, b2, b4, b8 }, end: o };
}

export function parseKV3(bytes: Uint8Array): KV3 {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = dv.getUint32(0, true);
  const version = magic & 0xff;
  if (magic >>> 8 !== 0x4b5633 || version < 4 || version > 5) throw new Error(`kv3: unsupported magic ${magic.toString(16)}`);
  const method = dv.getUint32(20, true);
  if (method > 1) throw new Error('kv3: zstd-compressed data is not supported');
  let p = 24;
  const u16 = () => ((p += 2), dv.getUint16(p - 2, true));
  const i32 = () => ((p += 4), dv.getInt32(p - 4, true));
  u16(); // compression dictionary id
  u16(); // frame size
  const count1 = i32(), count4 = i32(), count8 = i32(), countTypes = i32();
  u16(); // objects (hint)
  u16(); // arrays (hint)
  const sizeTotal = i32();
  const csizeTotal = i32();
  const countBlocks = i32();
  const sizeBlobs = i32();
  const count2 = i32();
  i32(); // block-compressed sizes bytes
  const read = (size: number, csize: number) => {
    const out = new Uint8Array(size);
    if (method === 0) out.set(bytes.subarray(p, p + size)), (p += size);
    else {
      if (lz4Into(bytes.subarray(p, p + csize), out, 0) !== size) throw new Error('kv3: buffer size mismatch');
      p += csize;
    }
    return out;
  };
  const strings: string[] = [];
  const dec = new TextDecoder();
  // Reads `count` NUL-terminated strings from buf at `at`; returns the end offset.
  const readStrings = (buf: Uint8Array, at: number, count: number) => {
    for (let i = 0; i < count; i++) {
      let e = at;
      while (buf[e] !== 0) e++;
      strings.push(dec.decode(buf.subarray(at, e)));
      at = e + 1;
    }
    return at;
  };

  let buf2: Uint8Array, main: { lanes: Lanes; end: number }, aux: Lanes, objectLengths: Lane, typePos: number, typesEnd: number;
  if (version >= 5) {
    const size1 = i32(), csize1 = i32(), size2 = i32(), csize2 = i32();
    const b2c1 = i32(), b2c2 = i32(), b2c4 = i32(), b2c8 = i32();
    i32(); // nodes (hint)
    const objects2 = i32();
    i32(); // arrays (hint)
    i32(); // array elements (hint)
    // Buffer 1: auxiliary lanes; its 1-byte lane starts with the string table (count = first int of the 4-byte lane).
    const buf1 = read(size1, csize1);
    aux = lanes(buf1, 0, count1, count2, count4, count8).lanes;
    aux.b1.pos = readStrings(buf1, aux.b1.pos, aux.b4.i32());
    // Buffer 2: object member counts, main lanes, the type stream, then blob sizes.
    buf2 = read(size2, csize2);
    objectLengths = new Lane(new DataView(buf2.buffer), 0, objects2 * 4);
    main = lanes(buf2, objects2 * 4, b2c1, b2c2, b2c4, b2c8);
    typePos = main.end;
    typesEnd = typePos + countTypes;
  } else {
    // v4: one buffer — lanes, then strings, then types (countTypes counts strings + types); object lengths in the 4-byte lane.
    buf2 = read(sizeTotal, csizeTotal);
    main = lanes(buf2, 0, count1, count2, count4, count8);
    aux = main.lanes;
    objectLengths = main.lanes.b4;
    const stringsAt = Math.ceil(main.end / 8) * 8; // before v5, empty lanes are still padded to 8
    typePos = readStrings(buf2, stringsAt, main.lanes.b4.i32());
    typesEnd = stringsAt + countTypes;
  }
  const dv2 = new DataView(buf2.buffer);
  let tail = typesEnd;

  const blobs: Uint8Array[] = [];
  if (countBlocks > 0) {
    const lengths = Array.from({ length: countBlocks }, (_, i) => dv2.getInt32(tail + i * 4, true));
    tail += countBlocks * 4;
    if (dv2.getUint32(tail, true) !== TRAILER) throw new Error('kv3: bad blob trailer');
    tail += 4;
    if (lengths.reduce((a, b) => a + b, 0) !== sizeBlobs) throw new Error('kv3: blob sizes mismatch');
    // All blobs decode into one history buffer: LZ4 frames are chained, so later frames reference earlier output.
    const all = new Uint8Array(sizeBlobs);
    let at = 0;
    for (const len of lengths) {
      const start = at;
      if (method === 0) all.set(bytes.subarray(p, p + len), at), (p += len), (at += len);
      else
        while (at < start + len) {
          const frame = dv2.getUint16(tail, true);
          tail += 2;
          at += lz4Into(bytes.subarray(p, p + frame), all, at, start + len);
          p += frame;
        }
      blobs.push(all.subarray(start, start + len));
    }
  }

  let nextBlob = 0;
  const readType = (): number => {
    if (typePos >= typesEnd) throw new Error('kv3: type stream overrun');
    let t = buf2[typePos++];
    if (t & 0x80) typePos++; // flag byte (resource / soundevent / subclass…): not needed here
    if (t & 0x40) typePos++;
    return t & 0x3f;
  };
  const m = main.lanes;
  const value = (t: number, l: Lanes): KV3 => {
    switch (t) {
      case T.NULL: return null;
      case T.BOOLEAN_TRUE: return true;
      case T.BOOLEAN_FALSE: return false;
      case T.INT64_ZERO: case T.DOUBLE_ZERO: case T.UINT32_ZERO: return 0;
      case T.INT64_ONE: case T.DOUBLE_ONE: case T.UINT32_ONE: return 1;
      case T.BOOLEAN: return l.b1.u8() !== 0;
      case T.INT8: return l.b1.i8();
      case T.UINT8: return l.b1.u8();
      case T.INT16: return l.b2.i16();
      case T.UINT16: return l.b2.u16();
      case T.INT32: return l.b4.i32();
      case T.UINT32: return l.b4.u32();
      case T.FLOAT: return l.b4.f32();
      case T.INT64: return Number(l.b8.i64());
      case T.UINT64: return l.b8.u64();
      case T.DOUBLE: return l.b8.f64();
      case T.STRING: return strings[m.b4.i32()] ?? '';
      case T.BINARY_BLOB: return blobs[nextBlob++];
      case T.ARRAY: {
        const n = m.b4.i32();
        return Array.from({ length: n }, () => value(readType(), m));
      }
      case T.ARRAY_TYPED: case T.ARRAY_TYPE_BYTE_LENGTH: case T.ARRAY_TYPE_AUXILIARY_BUFFER: {
        const n = t === T.ARRAY_TYPED ? m.b4.i32() : m.b1.u8();
        const sub = readType();
        const lane = t === T.ARRAY_TYPE_AUXILIARY_BUFFER ? aux : m;
        return Array.from({ length: n }, () => value(sub, lane));
      }
      case T.OBJECT: {
        const n = objectLengths.i32();
        const o: { [k: string]: KV3 } = {};
        for (let i = 0; i < n; i++) {
          const name = strings[m.b4.i32()] ?? '';
          o[name] = value(readType(), m);
        }
        return o;
      }
      default:
        throw new Error(`kv3: unknown type ${t}`);
    }
  };
  return value(readType(), m);
}

// The KV3 payload of a Source 2 resource block (DATA, MDAT, ...), by block type.
export function resourceBlocks(bytes: Uint8Array): { type: string; data: Uint8Array }[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = 8 + dv.getUint32(8, true), n = dv.getUint32(12, true);
  return Array.from({ length: n }, (_, i) => {
    const o = at + i * 12;
    const start = o + 4 + dv.getUint32(o + 4, true);
    return { type: String.fromCharCode(...bytes.subarray(o, o + 4)), data: bytes.subarray(start, start + dv.getUint32(o + 8, true)) };
  });
}
