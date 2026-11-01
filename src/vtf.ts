// Valve Texture Format reader: first frame of a 2D texture, all mips largest-first.
// DXT data is passed through for the GPU; common uncompressed formats become RGBA8.
export type VtfFormat = 'dxt1' | 'dxt1a' | 'dxt3' | 'dxt5' | 'rgba';
export type Vtf = { width: number; height: number; format: VtfFormat; mips: { data: Uint8Array; width: number; height: number }[] };

const DXT: Record<number, [VtfFormat, number]> = { 13: ['dxt1', 8], 20: ['dxt1a', 8], 14: ['dxt3', 16], 15: ['dxt5', 16] };
// format id → [bytes per pixel, index of R, G, B, A in a pixel (-1 = opaque)]
const RAW: Record<number, [number, number, number, number, number]> = {
  0: [4, 0, 1, 2, 3], // RGBA8888
  1: [4, 3, 2, 1, 0], // ABGR8888
  2: [3, 0, 1, 2, -1], // RGB888
  3: [3, 2, 1, 0, -1], // BGR888
  11: [4, 1, 2, 3, 0], // ARGB8888
  12: [4, 2, 1, 0, 3], // BGRA8888
  16: [4, 2, 1, 0, -1], // BGRX8888
};
const ENVMAP = 0x4000;

export function parseVtf(bytes: Uint8Array): Vtf | null {
  if (bytes.length < 80 || bytes[0] !== 86 || bytes[1] !== 84 || bytes[2] !== 70 || bytes[3] !== 0) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minor = dv.getUint32(8, true), headerSize = dv.getUint32(12, true);
  const width = dv.getUint16(16, true), height = dv.getUint16(18, true), flags = dv.getUint32(20, true);
  const frames = Math.max(1, dv.getUint16(24, true));
  const format = dv.getInt32(52, true), mipCount = Math.max(1, dv.getUint8(56));
  const lowFormat = dv.getInt32(57, true), lowW = dv.getUint8(61), lowH = dv.getUint8(62);
  const depth = minor >= 2 ? Math.max(1, dv.getUint16(63, true)) : 1;
  if (flags & ENVMAP || depth !== 1 || !width || !height) return null;
  const dxt = DXT[format], raw = RAW[format];
  if (!dxt && !raw) return null;
  const sizeOf = (w: number, h: number) => (dxt ? Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * dxt[1] : w * h * raw[0]);

  let start: number;
  if (minor >= 3) {
    const n = dv.getUint32(68, true);
    const res = Array.from({ length: Math.min(n, 32) }, (_, i) => 80 + i * 8).find((o) => o + 8 <= bytes.length && bytes[o] === 0x30 && bytes[o + 1] === 0 && bytes[o + 2] === 0);
    if (res === undefined) return null;
    start = dv.getUint32(res + 4, true);
  } else {
    start = headerSize + (lowFormat === -1 || !lowW ? 0 : Math.ceil(lowW / 4) * Math.ceil(lowH / 4) * 8);
  }

  const mips: Vtf['mips'] = [];
  let p = start;
  for (let level = mipCount - 1; level >= 0; level--) {
    const w = Math.max(1, width >> level), h = Math.max(1, height >> level);
    const size = sizeOf(w, h);
    if (p + size > bytes.length) return null;
    const data = bytes.subarray(p, p + size);
    mips.unshift({ width: w, height: h, data: dxt ? data : toRgba(data, w * h, raw) });
    p += size * frames;
  }
  return { width, height, format: dxt ? dxt[0] : 'rgba', mips };
}

function toRgba(src: Uint8Array, pixels: number, [bpp, r, g, b, a]: [number, number, number, number, number]): Uint8Array {
  const out = new Uint8Array(pixels * 4);
  for (let i = 0; i < pixels; i++) {
    const s = i * bpp;
    out[i * 4] = src[s + r];
    out[i * 4 + 1] = src[s + g];
    out[i * 4 + 2] = src[s + b];
    out[i * 4 + 3] = a < 0 ? 255 : src[s + a];
  }
  return out;
}

// CPU decode of the largest DXT mip to RGBA8, for GPUs/browsers without S3TC support.
export function decodeDxt(v: Vtf): Uint8Array {
  const { width: w, height: h, data } = v.mips[0];
  const out = new Uint8Array(w * h * 4);
  const blockSize = v.format === 'dxt1' || v.format === 'dxt1a' ? 8 : 16;
  const bw = Math.max(1, Math.ceil(w / 4));
  const expand = (c: number) => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];
  for (let b = 0; b * blockSize < data.length; b++) {
    const o = b * blockSize, bx = (b % bw) * 4, by = Math.floor(b / bw) * 4;
    const alpha = new Uint8Array(16).fill(255);
    if (v.format === 'dxt3') for (let i = 0; i < 16; i++) alpha[i] = ((data[o + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17;
    if (v.format === 'dxt5') {
      const a0 = data[o], a1 = data[o + 1];
      const pal = a0 > a1 ? [a0, a1, ...[1, 2, 3, 4, 5, 6].map((k) => ((7 - k) * a0 + k * a1) / 7)] : [a0, a1, ...[1, 2, 3, 4].map((k) => ((5 - k) * a0 + k * a1) / 5), 0, 255];
      const bits = data[o + 2] | (data[o + 3] << 8) | (data[o + 4] << 16);
      const bits2 = data[o + 5] | (data[o + 6] << 8) | (data[o + 7] << 16);
      for (let i = 0; i < 16; i++) alpha[i] = Math.round(pal[i < 8 ? (bits >> (i * 3)) & 7 : (bits2 >> ((i - 8) * 3)) & 7]);
    }
    const c = o + blockSize - 8;
    const c0 = data[c] | (data[c + 1] << 8), c1 = data[c + 2] | (data[c + 3] << 8);
    const [p0, p1] = [expand(c0), expand(c1)];
    const fourColor = c0 > c1 || blockSize === 16; // DXT3/5 color blocks are always 4-color
    const pal = fourColor
      ? [p0, p1, p0.map((x, k) => (2 * x + p1[k]) / 3), p0.map((x, k) => (x + 2 * p1[k]) / 3)]
      : [p0, p1, p0.map((x, k) => (x + p1[k]) / 2), [0, 0, 0]];
    const idx = data[c + 4] | (data[c + 5] << 8) | (data[c + 6] << 16) | (data[c + 7] << 24);
    for (let i = 0; i < 16; i++) {
      const x = bx + (i & 3), y = by + (i >> 2);
      if (x >= w || y >= h) continue;
      const k = (idx >>> (i * 2)) & 3, px = (y * w + x) * 4;
      out[px] = Math.round(pal[k][0]);
      out[px + 1] = Math.round(pal[k][1]);
      out[px + 2] = Math.round(pal[k][2]);
      // 3-color DXT1 index 3 is transparent black (only meaningful for the alpha variant).
      out[px + 3] = !fourColor && k === 3 && v.format === 'dxt1a' ? 0 : alpha[i];
    }
  }
  return out;
}
