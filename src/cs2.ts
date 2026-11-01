// CS2 (Source 2) fallback for stock CS:GO textures: CS2 still ships many legacy materials, converted to its
// texture resources (materials/<name>_color_<src>_<hash>.vtex_c). We repackage those as classic VTF + VMT
// so the existing material/texture pipeline uses them unchanged.
import type { VpkEntry } from './vpk';

// Source 2 VTexFormat → VTF format id, for formats whose block data is identical (passed through as-is).
const PASSTHROUGH: Record<number, { vtf: number; block: number }> = { 1: { vtf: 13, block: 8 }, 2: { vtf: 15, block: 16 } }; // DXT1, DXT5
const COMPRESSED_MIP_SIZE = 4; // extra-data type: per-mip LZ4 sizes

export function vtexToVtf(bytes: Uint8Array): Uint8Array | null {
  try {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const blocksAt = 8 + dv.getUint32(8, true), count = dv.getUint32(12, true);
    let data = -1, dataEnd = 0;
    for (let i = 0; i < count; i++) {
      const o = blocksAt + i * 12;
      if (String.fromCharCode(...bytes.subarray(o, o + 4)) !== 'DATA') continue;
      data = o + 4 + dv.getUint32(o + 4, true);
      dataEnd = data + dv.getUint32(o + 8, true);
    }
    if (data < 0) return null;
    const width = dv.getUint16(data + 20, true), height = dv.getUint16(data + 22, true), depth = dv.getUint16(data + 24, true);
    const fmt = PASSTHROUGH[dv.getUint8(data + 26)], mips = Math.max(1, dv.getUint8(data + 27));
    if (!fmt || depth !== 1 || !width || !height) return null;
    const mipSize = (m: number) => Math.max(1, Math.ceil((width >> m) / 4)) * Math.max(1, Math.ceil((height >> m) / 4)) * fmt.block;
    let size = 0;
    for (let m = 0; m < mips; m++) size += mipSize(m);
    // Record = [isCompressed, sizes offset, count]: when set, sizes[level] (level 0 = largest) gives each mip's stored size.
    let lz4Sizes: number[] | null = null;
    const extrasAt = data + 32 + dv.getUint32(data + 32, true), extras = dv.getUint32(data + 36, true);
    for (let i = 0; i < extras; i++) {
      const o = extrasAt + i * 12;
      if (dv.getUint32(o, true) !== COMPRESSED_MIP_SIZE) continue;
      const p = o + 4 + dv.getUint32(o + 4, true);
      if (dv.getUint32(p, true) !== 1) continue;
      const at = p + 4 + dv.getUint32(p + 4, true);
      lz4Sizes = Array.from({ length: dv.getUint32(p + 8, true) }, (_, k) => dv.getUint32(at + k * 4, true));
    }
    let pixels: Uint8Array;
    if (lz4Sizes) {
      pixels = new Uint8Array(size);
      let s = dataEnd, d = 0;
      for (let m = mips - 1; m >= 0; m--) {
        const c = lz4Sizes[m];
        // A mip that didn't shrink is stored raw; only smaller ones are LZ4 blocks.
        pixels.set(c === mipSize(m) ? bytes.subarray(s, s + c) : lz4Block(bytes.subarray(s, s + c), mipSize(m)), d);
        s += c;
        d += mipSize(m);
      }
    } else {
      if (dataEnd + size > bytes.length) return null;
      pixels = bytes.subarray(dataEnd, dataEnd + size);
    }
    // VTF 7.2 header (80 bytes), no low-res thumbnail; pixel data is already smallest mip first, like VTF.
    const out = new Uint8Array(80 + size);
    const o = new DataView(out.buffer);
    out.set([86, 84, 70, 0]);
    o.setUint32(4, 7, true);
    o.setUint32(8, 2, true);
    o.setUint32(12, 80, true);
    o.setUint16(16, width, true);
    o.setUint16(18, height, true);
    o.setUint16(24, 1, true);
    o.setInt32(52, fmt.vtf, true);
    o.setUint8(56, mips);
    o.setInt32(57, -1, true);
    o.setUint16(63, 1, true);
    out.set(pixels, 80);
    return out;
  } catch {
    return null;
  }
}

// A file lookup (for stockFilesFor/resolveMaterial) answering materials/<name>.vmt and materials/cs2/<name>.vtf
// from CS2's archive. read(key) returns the archive file for a VPK key.
export function createCs2Lookup(entries: Map<string, VpkEntry>, read: (key: string) => Uint8Array) {
  const colorTexture = new Map<string, string>();
  for (const key of entries.keys()) {
    const m = key.match(/^materials\/(.+)_color_[a-z0-9]+_[0-9a-f]{8}\.vtex_c$/);
    if (m && !colorTexture.has(m[1])) colorTexture.set(m[1], key);
  }
  return (path: string): Uint8Array | undefined => {
    const vmt = path.match(/^materials\/(.+)\.vmt$/);
    if (vmt && colorTexture.has(vmt[1])) return new TextEncoder().encode(`"LightmappedGeneric"\n{\n\t"$basetexture" "cs2/${vmt[1]}"\n}\n`);
    const vtf = path.match(/^materials\/cs2\/(.+)\.vtf$/);
    const key = vtf && colorTexture.get(vtf[1]);
    return (key && vtexToVtf(read(key))) || undefined;
  };
}

// LZ4 block decompression (the format CS2 uses for compressed texture mips). Throws on malformed input.
export function lz4Block(src: Uint8Array, size: number): Uint8Array {
  const dst = new Uint8Array(size);
  let s = 0, d = 0;
  const length = (n: number) => {
    if (n === 15) for (let b = 255; b === 255; ) n += b = src[s++];
    return n;
  };
  while (s < src.length) {
    const token = src[s++];
    const lit = length(token >> 4);
    if (d + lit > size || s + lit > src.length) throw new Error('lz4: literal overrun');
    dst.set(src.subarray(s, s + lit), d);
    s += lit;
    d += lit;
    if (s >= src.length) break; // last sequence is literals only
    const offset = src[s] | (src[s + 1] << 8);
    s += 2;
    const len = length(token & 15) + 4;
    if (!offset || offset > d || d + len > size) throw new Error('lz4: bad match');
    for (let i = 0; i < len; i++, d++) dst[d] = dst[d - offset]; // byte-wise: matches may overlap themselves
  }
  if (d !== size) throw new Error('lz4: size mismatch');
  return dst;
}
