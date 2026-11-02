import { describe, it, expect } from 'vitest';
import { bspToMap, sharedFinish } from '../src/maps/imported';
import type { BspMap } from '../src/bsp';

const bsp = (endZone: unknown) => ({ brushes: [], spawn: { x: 0, y: 0, z: 0 }, spawnYaw: 0, killZ: 0, startZone: null, endZone, teleports: [], pushes: [], hurts: [], mesh: {} }) as unknown as BspMap;

describe('a finish everyone shares', () => {
  it('built-in maps always have one', () => expect(sharedFinish({})).toBe(true));
  it("a map's own finish counts", () => expect(sharedFinish(bspToMap(bsp([{}]), 'a.bsp'))).toBe(true));
  it('a map with no finish does not', () => expect(sharedFinish(bspToMap(bsp(null), 'a.bsp'))).toBe(false));
  it('a finish from the manifest counts, and becomes the end zone', () => {
    const m = bspToMap(bsp(null), 'a.bsp', [100, 200, 300]);
    expect(sharedFinish(m)).toBe(true);
    expect(m.endZone?.[0].mins).toEqual({ x: 36, y: 136, z: 284 });
  });
  it("the map's own finish wins over the manifest", () => {
    const own = [{ mins: { x: 1 } }];
    expect(bspToMap(bsp(own), 'a.bsp', [100, 200, 300]).endZone).toBe(own);
  });
});
