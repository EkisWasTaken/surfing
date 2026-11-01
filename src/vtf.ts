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
