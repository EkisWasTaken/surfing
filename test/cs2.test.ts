import { describe, it, expect } from 'vitest';
import { vtexToVtf, createCs2Lookup } from '../src/cs2';
import { parseVtf } from '../src/vtf';
import { resolveMaterial } from '../src/materials';
import type { VpkEntry } from '../src/vpk';

// Minimal Source 2 texture resource: header, a RED2 block, a DATA block with the texture header, then pixels (smallest mip first).
// mipInfo: optional COMPRESSED_MIP_SIZE extra record [isCompressed, offset, count], as real CS2 textures carry.
function vtex(width: number, height: number, format: number, mips: number, mipInfo?: number[]) {
  const blockSize = format === 1 ? 8 : 16;
  const sizes = Array.from({ length: mips }, (_, i) => Math.max(1, Math.ceil((width >> i) / 4)) * Math.max(1, Math.ceil((height >> i) / 4)) * blockSize);
  const pixels = sizes.slice().reverse().map((s, k) => new Uint8Array(s).fill(k + 1)); // smallest first; fill = order
  const headerLen = 16 + 2 * 12, red2 = 8, data = mipInfo ? 40 + 12 + 12 : 40;
  const total = headerLen + red2 + data + sizes.reduce((a, b) => a + b, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, headerLen + red2 + data, true);
  dv.setUint16(4, 12, true);
  dv.setUint16(6, 1, true);
  dv.setUint32(8, 8, true); // blocks start at 8 + 8 = 16
  dv.setUint32(12, 2, true);
  const block = (i: number, type: string, off: number, size: number) => {
    const o = 16 + i * 12;
    out.set(new TextEncoder().encode(type), o);
    dv.setUint32(o + 4, off - (o + 4), true);
    dv.setUint32(o + 8, size, true);
  };
  const red2At = headerLen, dataAt = headerLen + red2;
  block(0, 'RED2', red2At, red2);
  block(1, 'DATA', dataAt, data);
  dv.setUint16(dataAt, 1, true);
  dv.setUint16(dataAt + 20, width, true);
  dv.setUint16(dataAt + 22, height, true);
  dv.setUint16(dataAt + 24, 1, true);
  dv.setUint8(dataAt + 26, format);
  dv.setUint8(dataAt + 27, mips);
  dv.setUint32(dataAt + 32, 8, true); // extra data right after the 40-byte header
  if (mipInfo) {
    dv.setUint32(dataAt + 36, 1, true);
    dv.setUint32(dataAt + 40, 4, true); // type COMPRESSED_MIP_SIZE
    dv.setUint32(dataAt + 44, 8, true); // its data 8 bytes after this field → dataAt + 52
    dv.setUint32(dataAt + 48, 12, true);
    mipInfo.forEach((v, i) => dv.setUint32(dataAt + 52 + i * 4, v, true));
  }
  let p = dataAt + data;
  for (const px of pixels) out.set(px, p), (p += px.length);
  return out;
}

describe('vtexToVtf', () => {
  it('turns a DXT1 CS2 texture into a classic VTF with the same mips', () => {
    const v = parseVtf(vtexToVtf(vtex(16, 8, 1, 3))!)!;
    expect(v.format).toBe('dxt1');
    expect(v.mips.map((m) => [m.width, m.height, m.data.length])).toEqual([[16, 8, 64], [8, 4, 16], [4, 2, 8]]);
    expect(v.mips[0].data[0]).toBe(3); // largest mip is stored last in both formats
  });
  it('converts real-world layout: mip-size record present but not compressed', () => {
    expect(parseVtf(vtexToVtf(vtex(16, 16, 1, 3, [0, 8, 3]))!)!.mips).toHaveLength(3);
  });
  it('handles DXT5 and skips formats it cannot pass through (BC7)', () => {
    expect(parseVtf(vtexToVtf(vtex(8, 8, 2, 2))!)!.format).toBe('dxt5');
    expect(vtexToVtf(vtex(8, 8, 20, 1))).toBeNull();
    expect(vtexToVtf(new Uint8Array(30))).toBeNull();
  });
});

describe('vtexToVtf with LZ4 mips (real CS2 layout)', () => {
  it('decodes an LZ4-packed largest mip and copies raw-sized small mips as-is', () => {
    // 8x8 DXT1, 2 mips. Layout: header(16) + 2 block entries(24) | RED2 @40 (8) | DATA @48 (72) | pixels @120.
    // DATA = texture header (40) + extra entry @88 + compressed-mip record @100 + sizes[2] @112.
    // mip1 (4x4 = 8 bytes) raw; mip0 (32 bytes of 0x07) as LZ4: 1 literal + a 31-byte self-overlapping match.
    const lz4 = [0x1f, 0x07, 1, 0, 12];
    const out = new Uint8Array(120 + 8 + lz4.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(8, 8, true); // block entries at 16
    dv.setUint32(12, 2, true);
    const block = (o: number, type: string, at: number, size: number) => {
      out.set(new TextEncoder().encode(type), o);
      dv.setUint32(o + 4, at - (o + 4), true);
      dv.setUint32(o + 8, size, true);
    };
    block(16, 'RED2', 40, 8);
    block(28, 'DATA', 48, 72);
    dv.setUint16(48 + 20, 8, true);
    dv.setUint16(48 + 22, 8, true);
    dv.setUint16(48 + 24, 1, true);
    dv.setUint8(48 + 26, 1); // DXT1
    dv.setUint8(48 + 27, 2);
    dv.setUint32(80, 88 - 80, true); // extras offset (relative to field @80)
    dv.setUint32(84, 1, true);
    dv.setUint32(88, 4, true); // COMPRESSED_MIP_SIZE
    dv.setUint32(92, 100 - 92, true);
    dv.setUint32(96, 12, true);
    dv.setUint32(100, 1, true); // compressed
    dv.setUint32(104, 112 - 104, true);
    dv.setUint32(108, 2, true);
    dv.setUint32(112, lz4.length, true); // sizes[0]: largest mip, compressed
    dv.setUint32(116, 8, true); // sizes[1]: raw
    out.set(new Uint8Array(8).fill(9), 120); // smallest mip first
    out.set(lz4, 128);
    const v = parseVtf(vtexToVtf(out)!)!;
    expect(Array.from(v.mips[1].data)).toEqual(new Array(8).fill(9));
    expect(Array.from(v.mips[0].data)).toEqual(new Array(32).fill(7));
  });
});

describe('createCs2Lookup', () => {
  const files = new Map<string, Uint8Array>([['materials/tile/tile_mall_floor00_color_tga_51298798.vtex_c', vtex(8, 8, 1, 1)]]);
  const entries = new Map<string, VpkEntry>([...files.keys()].map((k) => [k, { archive: 0, offset: 0, length: 0, preload: new Uint8Array() }]));
  const lookup = createCs2Lookup(entries, (key) => files.get(key)!);
  it('serves a material for a legacy texture name that CS2 still ships', () => {
    const m = resolveMaterial('TILE/TILE_MALL_FLOOR00', { get: lookup })!;
    expect(parseVtf(m.vtf!)?.format).toBe('dxt1');
  });
  it('returns nothing for names CS2 does not have', () => {
    expect(resolveMaterial('concrete/concretefloor001a', { get: lookup })).toBeNull();
  });
});

import { lz4Block } from '../src/cs2';

describe('lz4Block', () => {
  const dec = (bytes: number[], size: number) => new TextDecoder().decode(lz4Block(new Uint8Array(bytes), size));
  it('copies literals and back-references (including overlapping ones)', () => {
    // token 0x32: 3 literals "abc", then match length 2+4 = 6 at offset 3 → "abcabcabc"
    expect(dec([0x32, 97, 98, 99, 3, 0], 9)).toBe('abcabcabc');
  });
  it('reads extended literal lengths (15 + following bytes)', () => {
    const lits = Array.from({ length: 20 }, (_, i) => 65 + (i % 26));
    expect(dec([0xf0, 5, ...lits], 20)).toBe(String.fromCharCode(...lits));
  });
  it('rejects data that does not decode to the expected size', () => {
    expect(() => lz4Block(new Uint8Array([0x32, 97, 98, 99, 3, 0]), 12)).toThrow();
  });
});

import { meshToJson, meshFromJson } from '../src/cs2model';

describe('CS2 mesh JSON round trip', () => {
  it('keeps geometry and texture mips intact', () => {
    const mesh = {
      positions: new Float32Array([1, 2, 3, 4.5, 5, 6]),
      uvs: new Float32Array([0, 1, 0.25, 0.75]),
      indices: new Uint32Array([0, 1, 1]),
      groups: [{ start: 0, count: 3, material: 'm.vmat', texture: { width: 4, height: 4, format: 'bc7' as const, mips: [{ width: 4, height: 4, data: new Uint8Array(16).fill(7) }] } }],
    };
    const back = meshFromJson(JSON.parse(JSON.stringify(meshToJson(mesh))));
    expect(Array.from(back.positions)).toEqual([1, 2, 3, 4.5, 5, 6]);
    expect(Array.from(back.indices)).toEqual([0, 1, 1]);
    expect(Array.from(back.groups[0].texture!.mips[0].data)).toEqual(new Array(16).fill(7));
    expect(back.groups[0].texture!.format).toBe('bc7');
  });
});
