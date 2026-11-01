import { describe, it, expect } from 'vitest';
import { stockFilesFor } from '../src/stock';
import { readZip, writeZip } from '../src/pak';
import type { BspMap } from '../src/bsp';

const enc = (s: string) => new TextEncoder().encode(s);
const vtf = new Uint8Array([86, 84, 70, 0, 1, 2, 3]);

describe('writeZip', () => {
  it('round-trips through readZip', () => {
    const files = new Map([['materials/a.vmt', enc('x')], ['b/c.bin', new Uint8Array([1, 2, 3])]]);
    const back = readZip(writeZip(files));
    expect([...back.keys()].sort()).toEqual(['b/c.bin', 'materials/a.vmt']);
    expect(Array.from(back.get('b/c.bin')!)).toEqual([1, 2, 3]);
  });
});

describe('stockFilesFor', () => {
  const archive = new Map<string, Uint8Array>([
    ['materials/brick/wall.vmt', enc('"LightmappedGeneric" { "$basetexture" "brick/wall_color" }')],
    ['materials/brick/wall_color.vtf', vtf],
    ['materials/concrete/floor.vmt', enc('"LightmappedGeneric" { "$basetexture" "concrete/floor" }')],
    ['materials/concrete/floor.vtf', vtf],
  ]);
  const map = (pak: Map<string, Uint8Array>, textures: string[]) =>
    ({ pak, props: [], mesh: { groups: textures.map((texture) => ({ texture, start: 0, count: 3 })) } }) as unknown as BspMap;

  it('extracts the material chain and texture for textures the map does not pack', () => {
    const out = stockFilesFor(map(new Map(), ['BRICK/WALL']), (k) => archive.get(k));
    expect([...out.keys()].sort()).toEqual(['materials/brick/wall.vmt', 'materials/brick/wall_color.vtf']);
  });

  it('skips textures already packed in the map and ones the archive lacks', () => {
    const packed = new Map([['materials/concrete/floor.vmt', archive.get('materials/concrete/floor.vmt')!], ['materials/concrete/floor.vtf', vtf]]);
    const out = stockFilesFor(map(packed, ['concrete/floor', 'nope/missing']), (k) => archive.get(k));
    expect(out.size).toBe(0);
  });
});
