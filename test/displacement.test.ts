import { describe, it, expect } from 'vitest';
import { parseBsp, dispGrid, dispTriangles } from '../src/bsp';
import { makeBox, makeTriPrism } from '../src/brush';
import { newPlayer, step } from '../src/movement';
import { buildBsp } from './bspBuilder';
import { trace } from '../src/trace';
import { config } from '../src/config';
import { vec } from '../src/math';

const entities = '{ "classname" "worldspawn" }\n{ "classname" "info_player_terrorist" "origin" "0 0 400" "angles" "0 0 0" }\n';
const floor = { mins: [-4096, -4096, -2000], maxs: [4096, 4096, -1984], contents: 1 };
const square = [[-512, -512, 0], [512, -512, 0], [512, 512, 0], [-512, 512, 0]];
// A 5x5 grid over a 1024 square, with a 256 tall peak at its centre vertex.
const hill = (contents: number, start = square[0]) =>
  parseBsp(buildBsp({ entities, world: [floor], submodels: [], face: [{ verts: square, reflectivity: [1, 1, 1], name: 'GROUND', flags: 0, disp: { start, power: 2, contents, offset: (i) => [0, 0, i === 12 ? 256 : 0] } }] }), 'h');
const zero = vec(0, 0, 0);
const groundAt = (m: ReturnType<typeof hill>, x: number, y: number, mins = zero, maxs = zero) => trace(vec(x, y, 1000), vec(x, y, -1000), mins, maxs, m.brushes).endPos.z;

describe('displacements', () => {
  it('are solid in their real shape, not their flat base', () => {
    const m = hill(1);
    expect(groundAt(m, 0, 0)).toBeCloseTo(256, 0);
    expect(groundAt(m, 500, 500)).toBeCloseTo(0, 0);
    expect(groundAt(m, 128, 0)).toBeCloseTo(128, 0); // halfway down the slope
    expect(groundAt(m, 900, 900)).toBe(-1000); // nothing beyond the patch here, only the far lower floor's bounds
  });
  it('stop a player falling onto them, with the real hull', () => {
    const { mins, maxs } = config.hullStand;
    const z = groundAt(hill(1), 300, 300, mins, maxs);
    expect(z).toBeGreaterThan(-mins.z - 1);
    expect(z).toBeLessThan(-mins.z + 200);
  });
  it('see-through ones (smoke, waterfalls, glass) are drawn but not solid', () => {
    const m = hill(0x10000002);
    expect(groundAt(m, 0, 0)).toBe(-1000);
    expect(Math.max(...m.mesh.positions.filter((_, i) => i % 3 === 2))).toBeCloseTo(256, 0);
  });
  it('are drawn sculpted, with every triangle facing up and textures mapped from the flat base', () => {
    const { positions: p, uvs } = hill(1).mesh;
    expect(p.length / 9).toBe(32); // 4 x 4 squares x 2
    for (let i = 0; i < p.length; i += 9) {
      const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], wx = p[i + 6] - p[i], wy = p[i + 7] - p[i + 1];
      expect(ux * wy - uy * wx).toBeGreaterThan(0);
    }
    const peak = [...Array(p.length / 3).keys()].find((v) => p[v * 3 + 2] > 200)!;
    expect([p[peak * 3], p[peak * 3 + 1]]).toEqual([0, 0]);
    expect(uvs[peak * 2]).toBeCloseTo(0, 5); // the builder's texture axis runs along x, so the peak maps like the flat point under it
  });
  it('start the grid at the corner nearest the start position, whichever that is', () => {
    const offset = (i: number) => [0, 0, i === 0 ? 100 : 0];
    for (const start of square) {
      const { pos } = dispGrid(square, start, 3, offset);
      expect(pos[0]).toEqual([start[0], start[1], 100]);
    }
  });
  it('runs rows from the first corner to the second, as Source lays them out', () => {
    const { flat } = dispGrid(square, square[0], 3, () => [0, 0, 0]);
    expect(flat[1]).toEqual([-512, 0, 0]); // along the fourth corner's edge within a row
    expect(flat[3]).toEqual([0, -512, 0]); // the next row, along the second corner's edge
    expect(flat[8]).toEqual(square[2]);
  });
  it('alternates the diagonal across the grid', () => {
    const { flat } = dispGrid(square, square[0], 3, () => [0, 0, 0]);
    const tris = dispTriangles(3, flat, vec(0, 0, 1));
    expect(tris.length).toBe(8);
    const has = (a: number, b: number) => tris.some((t) => t.includes(a) && t.includes(b));
    expect(has(0, 4)).toBe(true);
    expect(has(1, 3)).toBe(false);
    expect(has(2, 4)).toBe(true);
  });
  it('skip a patch with an impossible size instead of failing the map', () => {
    const m = parseBsp(buildBsp({ entities, world: [floor], submodels: [], face: [{ verts: square, reflectivity: [1, 1, 1], name: 'G', flags: 0, disp: { start: square[0], power: 5, contents: 1, offset: () => [0, 0, 0] } }] }), 'b');
    expect(m.brushes.length).toBe(1); // just the floor
  });
});

describe('a solid triangle', () => {
  it('has its top where the triangle is and nothing for a degenerate one', () => {
    const b = makeTriPrism(vec(0, 0, 0), vec(100, 0, 0), vec(0, 100, 0))!;
    expect(trace(vec(10, 10, 50), vec(10, 10, -50), zero, zero, [b]).endPos.z).toBeCloseTo(0, 1);
    expect(trace(vec(90, 90, 50), vec(90, 90, -50), zero, zero, [b]).fraction).toBe(1); // past the long edge
    expect(makeTriPrism(vec(0, 0, 0), vec(1, 0, 0), vec(2, 0, 0))).toBeNull();
  });
});

describe('walking while fully inside something solid', () => {
  it("doesn't crash the game", () => {
    const solid = makeBox(vec(-512, -512, -512), vec(512, 512, 512));
    const p = { ...newPlayer(vec(0, 0, 0)), onGround: true };
    expect(() => step(p, { forward: 1, side: 0, jump: false, duck: false, yaw: 0, pitch: 0 }, [solid], 1 / 64)).not.toThrow();
  });
});

describe('func_rotating', () => {
  const box = { mins: [0, 0, 0], maxs: [64, 64, 16], contents: 1 };
  const withRotating = (flags: string) =>
    parseBsp(buildBsp({ entities: `${entities}{ "classname" "func_rotating" "model" "*1" "spawnflags" "${flags}" }\n`, world: [floor], submodels: [[box]] }), 'r');
  it('is solid unless flagged non-solid', () => {
    expect(trace(vec(32, 32, 100), vec(32, 32, -100), zero, zero, withRotating('0').brushes).endPos.z).toBeCloseTo(16, 0);
    expect(trace(vec(32, 32, 100), vec(32, 32, -100), zero, zero, withRotating('64').brushes).fraction).toBe(1);
  });
});
