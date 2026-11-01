// CS2 (Source 2) texture resources (.vtex_c): decode their mips, and repackage legacy CS:GO materials CS2 still
// ships (materials/<name>_color_<src>_<hash>.vtex_c) as classic VTF + VMT for the existing pipeline.
import type { VpkEntry } from './vpk';
import { lz4Into } from './kv3';

// Source 2 VTexFormat → storage. DXT1/DXT5 match VTF's; BC7 is GPU-only (EXT_texture_compression_bptc).
// BC4 (single channel) is decoded to R8 here; BGRA8888 and RGBA16161616F are plain pixels (`px` = bytes per pixel).
type Stored = 'dxt1' | 'dxt5' | 'bc7' | 'bc4' | 'bgra8' | 'rgba16f';
const FORMATS: Record<number, { name: Stored; vtf: number; block: number; px?: number }> = {
  1: { name: 'dxt1', vtf: 13, block: 8 },
  2: { name: 'dxt5', vtf: 15, block: 16 },
  10: { name: 'rgba16f', vtf: 0, block: 0, px: 8 },
  20: { name: 'bc7', vtf: 0, block: 16 },
  27: { name: 'bc4', vtf: 0, block: 8 },
  28: { name: 'bgra8', vtf: 0, block: 0, px: 4 },
};
const COMPRESSED_MIP_SIZE = 4; // extra-data type: per-mip LZ4 sizes

export type VtexFormat = 'dxt1' | 'dxt5' | 'bc7' | 'r8' | 'rgba8' | 'rgba16f';
export type Vtex = { width: number; height: number; format: VtexFormat; mips: { width: number; height: number; data: Uint8Array }[] };

// BC4: two endpoints, then 3-bit indices into an 8-step (or 6-step + 0/255) ramp per 4x4 block.
function decodeBc4(src: Uint8Array, w: number, h: number) {
  const out = new Uint8Array(w * h), ramp = new Uint8Array(8);
  let o = 0;
  for (let by = 0; by < h; by += 4)
    for (let bx = 0; bx < w; bx += 4, o += 8) {
      const a = src[o], b = src[o + 1];
      ramp[0] = a, ramp[1] = b;
      for (let k = 1; k < 7; k++) ramp[k + 1] = a > b ? ((7 - k) * a + k * b) / 7 : k < 5 ? ((5 - k) * a + k * b) / 5 : k === 5 ? 0 : 255;
      let bits = 0, nbits = 0, p = o + 2;
      for (let i = 0; i < 16; i++) {
        if (nbits < 3) (bits |= src[p++] << nbits), (nbits += 8);
        const x = bx + (i & 3), y = by + (i >> 2);
        if (x < w && y < h) out[y * w + x] = ramp[bits & 7];
        (bits >>= 3), (nbits -= 3);
      }
    }
  return out;
}
const blocks = (w: number, h: number) => Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4));

// Mips largest first. Null for formats/layouts we don't handle.
export function readVtex(bytes: Uint8Array): Vtex | null {
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
    const fmt = FORMATS[dv.getUint8(data + 26)], mips = Math.max(1, dv.getUint8(data + 27));
    if (!fmt || depth !== 1 || !width || !height) return null;
    const dims = (m: number) => [Math.max(1, width >> m), Math.max(1, height >> m)];
    const mipSize = (m: number) => (fmt.px ? dims(m)[0] * dims(m)[1] * fmt.px : blocks(dims(m)[0], dims(m)[1]) * fmt.block);
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
    // Stored smallest mip first.
    const out: Vtex['mips'] = [];
    let s = dataEnd;
    for (let m = mips - 1; m >= 0; m--) {
      const raw = mipSize(m), stored = lz4Sizes ? lz4Sizes[m] : raw;
      if (s + stored > bytes.length) return null;
      // A mip that didn't shrink is stored raw; only smaller ones are LZ4 blocks.
      const px = stored === raw ? bytes.subarray(s, s + raw) : lz4Block(bytes.subarray(s, s + stored), raw);
      const [w, h] = dims(m);
      let pixels = px;
      if (fmt.name === 'bc4') pixels = decodeBc4(px, w, h);
      else if (fmt.name === 'bgra8') {
        pixels = new Uint8Array(px);
        for (let k = 0; k < pixels.length; k += 4) (pixels[k] = px[k + 2]), (pixels[k + 2] = px[k]);
      }
      out.unshift({ width: w, height: h, data: pixels });
      s += stored;
    }
    const format: VtexFormat = fmt.name === 'bc4' ? 'r8' : fmt.name === 'bgra8' ? 'rgba8' : fmt.name;
    return { width, height, format, mips: out };
  } catch {
    return null;
  }
}

export function vtexToVtf(bytes: Uint8Array): Uint8Array | null {
  const t = readVtex(bytes);
  if (!t || (t.format !== 'dxt1' && t.format !== 'dxt5')) return null; // classic VTF: DXT only here
  const size = t.mips.reduce((a, m) => a + m.data.length, 0);
  // VTF 7.2 header (80 bytes), no low-res thumbnail; pixel data smallest mip first.
  const out = new Uint8Array(80 + size);
  const o = new DataView(out.buffer);
  out.set([86, 84, 70, 0]);
  o.setUint32(4, 7, true);
  o.setUint32(8, 2, true);
  o.setUint32(12, 80, true);
  o.setUint16(16, t.width, true);
  o.setUint16(18, t.height, true);
  o.setUint16(24, 1, true);
  o.setInt32(52, t.format === 'dxt1' ? 13 : 15, true);
  o.setUint8(56, t.mips.length);
  o.setInt32(57, -1, true);
  o.setUint16(63, 1, true);
  let p = 80;
  for (let m = t.mips.length - 1; m >= 0; m--) out.set(t.mips[m].data, p), (p += t.mips[m].data.length);
  return out;
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

// LZ4 block decompression to an exact size (CS2 texture mips). Throws on malformed input.
export function lz4Block(src: Uint8Array, size: number): Uint8Array {
  const dst = new Uint8Array(size);
  if (lz4Into(src, dst, 0) !== size) throw new Error('lz4: size mismatch');
  return dst;
}
