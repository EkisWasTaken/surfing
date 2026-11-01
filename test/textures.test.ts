import { describe, it, expect } from 'vitest';
import { readZip } from '../src/pak';
import { parseVtf } from '../src/vtf';
import { resolveMaterial } from '../src/materials';

// Minimal stored (method 0) zip writer.
function zip(files: Record<string, Uint8Array | string>): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let off = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === 'string' ? enc.encode(content) : content;
    const n = enc.encode(name);
    const local = new Uint8Array(30 + n.length);
    const dl = new DataView(local.buffer);
    dl.setUint32(0, 0x04034b50, true);
    dl.setUint32(18, data.length, true);
    dl.setUint32(22, data.length, true);
    dl.setUint16(26, n.length, true);
    local.set(n, 30);
    const c = new Uint8Array(46 + n.length);
    const dc = new DataView(c.buffer);
    dc.setUint32(0, 0x02014b50, true);
    dc.setUint32(20, data.length, true);
    dc.setUint32(24, data.length, true);
    dc.setUint16(28, n.length, true);
    dc.setUint32(42, off, true);
    c.set(n, 46);
    parts.push(local, data);
    central.push(c);
    off += local.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const de = new DataView(eocd.buffer);
  de.setUint32(0, 0x06054b50, true);
  de.setUint16(10, central.length, true);
  de.setUint32(12, cdSize, true);
  de.setUint32(16, off, true);
  const out = new Uint8Array(off + cdSize + 22);
  let p = 0;
  for (const part of [...parts, ...central, eocd]) out.set(part, p), (p += part.length);
  return out;
}

// VTF 7.2 header (80 bytes) + DXT1 low-res thumb (none) + mips smallest→largest.
function vtf(width: number, height: number, format: number, mipBytes: (w: number, h: number) => number, mips: number, flags = 0): Uint8Array {
  const sizes: [number, number][] = [];
  for (let i = 0; i < mips; i++) sizes.push([Math.max(1, width >> i), Math.max(1, height >> i)]);
  const body = sizes.reverse().map(([w, h], k) => new Uint8Array(mipBytes(w, h)).fill(k + 1));
  const total = 80 + body.reduce((s, b) => s + b.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set([86, 84, 70, 0]);
  dv.setUint32(4, 7, true);
  dv.setUint32(8, 2, true);
  dv.setUint32(12, 80, true);
  dv.setUint16(16, width, true);
  dv.setUint16(18, height, true);
  dv.setUint32(20, flags, true);
  dv.setUint16(24, 1, true);
  dv.setInt32(52, format, true);
  dv.setUint8(56, mips);
  dv.setInt32(57, -1, true); // no low-res image
  dv.setUint16(63, 1, true);
  let p = 80;
  for (const b of body) out.set(b, p), (p += b.length);
  return out;
}
const dxt1 = (w: number, h: number) => Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * 8;

describe('readZip', () => {
  it('reads stored entries by lower-cased path', () => {
    const files = readZip(zip({ 'materials/Foo/Bar.vmt': 'hello', 'x.bin': new Uint8Array([1, 2, 3]) }));
    expect(new TextDecoder().decode(files.get('materials/foo/bar.vmt'))).toBe('hello');
    expect(Array.from(files.get('x.bin')!)).toEqual([1, 2, 3]);
  });
  it('returns an empty map for junk', () => {
    expect(readZip(new Uint8Array(10)).size).toBe(0);
  });
});

describe('parseVtf', () => {
  it('reads DXT1 mips largest first', () => {
    const t = parseVtf(vtf(16, 8, 13, dxt1, 3))!;
    expect(t.format).toBe('dxt1');
    expect(t.mips.map((m) => [m.width, m.height, m.data.length])).toEqual([[16, 8, 64], [8, 4, 16], [4, 2, 8]]);
    expect(t.mips[0].data[0]).toBe(3); // largest mip is stored last
  });
  it('converts BGR888 to RGBA', () => {
    const bytes = vtf(1, 1, 3, (w, h) => w * h * 3, 1);
    bytes.set([10, 20, 30], 80); // B G R
    const t = parseVtf(bytes)!;
    expect(t.format).toBe('rgba');
    expect(Array.from(t.mips[0].data)).toEqual([30, 20, 10, 255]);
  });
  it('rejects cubemaps, unknown formats and junk', () => {
    expect(parseVtf(vtf(4, 4, 13, dxt1, 1, 0x4000))).toBeNull();
    expect(parseVtf(vtf(4, 4, 99, dxt1, 1))).toBeNull();
    expect(parseVtf(new Uint8Array(20))).toBeNull();
  });
});

describe('resolveMaterial', () => {
  const pak = readZip(
    zip({
      'materials/concrete/floor.vmt': '"LightmappedGeneric"\n{\n\t"$basetexture" "concrete/floor_tex"\n\t"$alphatest" "1"\n}',
      'materials/concrete/floor_tex.vtf': vtf(4, 4, 13, dxt1, 1),
      'materials/maps/surf_x/concrete/floor_1_2_3.vmt': '"patch"\n{\n\t"include" "materials/concrete/floor.vmt"\n\t"insert" { "$envmap" "maps/x/c" }\n}',
      'materials/glass/win.vmt': 'UnlitGeneric { $basetexture glass/win $translucent 1 }',
      'materials/glass/win.vtf': vtf(4, 4, 13, dxt1, 1),
    }),
  );
  it('finds the base texture and flags', () => {
    const m = resolveMaterial('CONCRETE/FLOOR', pak)!;
    expect(m.vtf!.length).toBeGreaterThan(80);
    expect(m.alphatest).toBe(true);
    expect(m.translucent).toBe(false);
  });
  it('follows cubemap patch materials to their include', () => {
    expect(resolveMaterial('maps/surf_x/concrete/floor_1_2_3', pak)?.alphatest).toBe(true);
  });
  it('handles unquoted keys and translucency', () => {
    expect(resolveMaterial('glass/win', pak)?.translucent).toBe(true);
  });
  it('ignores leading slashes in material paths', () => {
    expect(resolveMaterial('\\concrete/floor', pak)?.alphatest).toBe(true);
  });
  it('turns texture-less tinted materials into a solid color', () => {
    const tinted = readZip(zip({ 'materials/models/x/green.vmt': '"vertexlitgeneric"\n{\n\t%tooltexture "cs_havana/white"\n\t"$color2" "{0 90 0}"\n}' }));
    expect(resolveMaterial('models\\x\\green', tinted)).toEqual({ vtf: null, color: [0, 90 / 255, 0], alphatest: false, translucent: false });
  });
  it('returns null when the material is not packed', () => {
    expect(resolveMaterial('dev/dev_measuregeneric01', pak)).toBeNull();
  });
});
