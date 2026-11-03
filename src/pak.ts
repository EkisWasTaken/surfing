import { lzmaUnpackZipEntry } from './lzma';

const MAX_UNPACKED = 2 ** 31; // a small file can claim huge entries: stop unpacking past this, per zip

// LZMA entries unpack the first time they're read: a map packs thousands of files, and unpacking them all froze the page for 20s.
class Zip extends Map<string, Uint8Array> {
  private packed = new Map<string, number>(); // name -> unpacked size, while the stored value is still compressed
  private unpacked = 0;
  addPacked(name: string, data: Uint8Array, fullSize: number) {
    this.set(name, data);
    this.packed.set(name, fullSize);
  }
  set(name: string, data: Uint8Array) {
    this.packed?.delete(name);
    return super.set(name, data);
  }
  get(name: string) {
    const data = super.get(name), fullSize = this.packed.get(name);
    if (!data || fullSize === undefined) return data;
    this.packed.delete(name);
    try {
      if ((this.unpacked += fullSize) > MAX_UNPACKED) throw new Error('too much to unpack');
      const full = lzmaUnpackZipEntry(data, fullSize);
      super.set(name, full);
      return full;
    } catch {
      this.delete(name); // one broken file shouldn't lose the map
      return undefined;
    }
  }
  *entries(): Generator<[string, Uint8Array], undefined> {
    for (const name of [...this.keys()]) {
      const data = this.get(name);
      if (data) yield [name, data];
    }
  }
  *values(): Generator<Uint8Array, undefined> {
    for (const [, data] of this.entries()) yield data;
  }
  [Symbol.iterator]() {
    return this.entries();
  }
  forEach(fn: (value: Uint8Array, key: string, map: Map<string, Uint8Array>) => void) {
    for (const [name, data] of this.entries()) fn(data, name, this);
  }
}

// Reads the zip "pakfile" embedded in a BSP (lump 40). Source packs entries stored (method 0) or with LZMA (method 14);
// other methods and broken entries are skipped. Input is untrusted: all reads are bounds-checked.
export function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const out = new Zip();
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End-of-central-directory record sits in the last 64 KB (after an optional comment).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return out;
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder('latin1');
  for (let k = 0; k < count && p + 46 <= bytes.length; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true), fullSize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen)).toLowerCase().replace(/\\/g, '/');
    p += 46 + nameLen + extraLen + commentLen;
    if ((method !== 0 && method !== 14) || local + 30 > bytes.length || dv.getUint32(local, true) !== 0x04034b50) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    if (start + size > bytes.length) continue;
    const data = bytes.subarray(start, start + size);
    if (method === 0) out.set(name, data);
    else out.addPacked(name, data, fullSize);
  }
  return out;
}

// Writes a stored (uncompressed) zip, the format readZip and Source's pakfiles use.
export function writeZip(files: Map<string, Uint8Array>): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [], centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const n = enc.encode(name);
    const local = new Uint8Array(30 + n.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint32(18, data.length, true);
    l.setUint32(22, data.length, true);
    l.setUint16(26, n.length, true);
    local.set(n, 30);
    const central = new Uint8Array(46 + n.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, n.length, true);
    c.setUint32(42, offset, true);
    central.set(n, 46);
    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const cdSize = centrals.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.size, true);
  e.setUint16(10, files.size, true);
  e.setUint32(12, cdSize, true);
  e.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const part of [...locals, ...centrals, end]) out.set(part, p), (p += part.length);
  return out;
}
