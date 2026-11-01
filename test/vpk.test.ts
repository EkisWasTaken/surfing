import { describe, it, expect } from 'vitest';
import { readVpkDir, readVpkFile } from '../src/vpk';

// Builds a VPK directory file: tree of ext → dir → name, each entry pointing into the dir file (0x7fff) or archive 0.
function buildVpk(version: 1 | 2) {
  const enc = new TextEncoder();
  const parts: number[] = [];
  const s = (x: string) => parts.push(...enc.encode(x), 0);
  const entry = (archive: number, offset: number, length: number, preload: number[]) => {
    const b = new Uint8Array(18 + preload.length);
    const dv = new DataView(b.buffer);
    dv.setUint16(4, preload.length, true);
    dv.setUint16(6, archive, true);
    dv.setUint32(8, offset, true);
    dv.setUint32(12, length, true);
    dv.setUint16(16, 0xffff, true);
    b.set(preload, 18);
    parts.push(...b);
  };
  s('vmt'); s('materials/brick'); s('Wall'); entry(0x7fff, 3, 4, []); s(''); s('');
  s('vtf'); s('materials/brick'); s('wall'); entry(0, 10, 3, [7, 8]); s(''); s('');
  s('txt'); s(' '); s('readme'); entry(0x7fff, 0, 3, []); s(''); s('');
  s('');
  const tree = new Uint8Array(parts);
  const header = version === 2 ? 28 : 12;
  const data = enc.encode('abcVMT!');
  const out = new Uint8Array(header + tree.length + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x55aa1234, true);
  dv.setUint32(4, version, true);
  dv.setUint32(8, tree.length, true);
  out.set(tree, header);
  out.set(data, header + tree.length);
  return out;
}

describe.each([1, 2] as const)('VPK v%i', (version) => {
  const dir = buildVpk(version);
  const vpk = readVpkDir(dir);
  const archive0 = new TextEncoder().encode('0123456789XYZ');
  const read = (key: string) => {
    const e = vpk.entries.get(key)!;
    return new TextDecoder().decode(readVpkFile(e, dir, vpk.dataStart, (idx, off, len) => (idx === 0 ? archive0.subarray(off, off + len) : new Uint8Array())));
  };
  it('lists files by lower-cased path', () => {
    expect([...vpk.entries.keys()].sort()).toEqual(['materials/brick/wall.vmt', 'materials/brick/wall.vtf', 'readme.txt']);
  });
  it('reads data stored in the directory file', () => {
    expect(read('materials/brick/wall.vmt')).toBe('VMT!');
    expect(read('readme.txt')).toBe('abc');
  });
  it('reads preload bytes plus the archive part', () => {
    expect(Array.from(new TextEncoder().encode(read('materials/brick/wall.vtf')))).toEqual([7, 8, ...new TextEncoder().encode('XYZ')]);
  });
});

it('rejects non-VPK data', () => {
  expect(() => readVpkDir(new Uint8Array(40))).toThrow(/not a VPK/);
});
