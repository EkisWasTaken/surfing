// Valve VPK archive directory reader (v1 and v2), as used by CS:GO's pak01_dir.vpk + pak01_NNN.vpk.
export type VpkEntry = { archive: number; offset: number; length: number; preload: Uint8Array };

const IN_DIR_FILE = 0x7fff; // entry data lives in the directory file itself, after the tree

export function readVpkDir(bytes: Uint8Array): { entries: Map<string, VpkEntry>; dataStart: number } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || dv.getUint32(0, true) !== 0x55aa1234) throw new Error('not a VPK directory file');
  const version = dv.getUint32(4, true);
  const header = version === 2 ? 28 : 12;
  const treeEnd = header + dv.getUint32(8, true);
  const dec = new TextDecoder('latin1');
  let p = header;
  const str = () => {
    const e = bytes.indexOf(0, p);
    if (e < 0 || e >= treeEnd) throw new Error('VPK tree is truncated');
    const s = dec.decode(bytes.subarray(p, e));
    p = e + 1;
    return s;
  };
  const entries = new Map<string, VpkEntry>();
  for (let ext = str(); ext; ext = str())
    for (let dir = str(); dir; dir = str())
      for (let name = str(); name; name = str()) {
        const preloadLen = dv.getUint16(p + 4, true);
        entries.set(`${dir === ' ' ? '' : dir + '/'}${name}.${ext}`.toLowerCase(), {
          archive: dv.getUint16(p + 6, true),
          offset: dv.getUint32(p + 8, true),
          length: dv.getUint32(p + 12, true),
          preload: bytes.subarray(p + 18, p + 18 + preloadLen),
        });
        p += 18 + preloadLen;
      }
  return { entries, dataStart: treeEnd };
}

// File bytes = preload bytes from the tree + the rest from the dir file or a numbered archive.
export function readVpkFile(e: VpkEntry, dir: Uint8Array, dataStart: number, archive: (index: number, offset: number, length: number) => Uint8Array): Uint8Array {
  const rest = !e.length ? new Uint8Array() : e.archive === IN_DIR_FILE ? dir.subarray(dataStart + e.offset, dataStart + e.offset + e.length) : archive(e.archive, e.offset, e.length);
  if (!e.preload.length) return rest;
  const out = new Uint8Array(e.preload.length + rest.length);
  out.set(e.preload);
  out.set(rest, e.preload.length);
  return out;
}
