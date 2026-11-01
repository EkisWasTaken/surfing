// CS2 (Source 2) texture resources (.vtex_c): decode their mips, and repackage legacy CS:GO materials CS2 still
// ships (materials/<name>_color_<src>_<hash>.vtex_c) as classic VTF + VMT for the existing pipeline.
import type { VpkEntry } from './vpk';
import { lz4Into } from './kv3';

// Source 2 VTexFormat → block format. DXT1/DXT5 match VTF's; BC7 is GPU-only (EXT_texture_compression_bptc).
const FORMATS: Record<number, { name: 'dxt1' | 'dxt5' | 'bc7'; vtf: number; block: number }> = {
  1: { name: 'dxt1', vtf: 13, block: 8 },
  2: { name: 'dxt5', vtf: 15, block: 16 },
  20: { name: 'bc7', vtf: 0, block: 16 },
};
const COMPRESSED_MIP_SIZE = 4; // extra-data type: per-mip LZ4 sizes

export type Vtex = { width: number; height: number; format: 'dxt1' | 'dxt5' | 'bc7'; mips: { width: number; height: number; data: Uint8Array }[] };

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
    const mipSize = (m: number) => Math.max(1, Math.ceil(dims(m)[0] / 4)) * Math.max(1, Math.ceil(dims(m)[1] / 4)) * fmt.block;
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
      out.unshift({ width: dims(m)[0], height: dims(m)[1], data: px });
      s += stored;
    }
    return { width, height, format: fmt.name, mips: out };
  } catch {
    return null;
  }
}

export function vtexToVtf(bytes: Uint8Array): Uint8Array | null {
  const t = readVtex(bytes);
  if (!t || t.format === 'bc7') return null; // classic VTF has no BC7
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
