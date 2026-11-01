// Reads the zip "pakfile" embedded in a BSP (lump 40). Source packs entries uncompressed (method 0);
// compressed entries are skipped. Input is untrusted: all reads are bounds-checked.
export function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
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
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen)).toLowerCase().replace(/\\/g, '/');
    p += 46 + nameLen + extraLen + commentLen;
    if (method !== 0 || local + 30 > bytes.length || dv.getUint32(local, true) !== 0x04034b50) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    if (start + size <= bytes.length) out.set(name, bytes.subarray(start, start + size));
  }
  return out;
}
