import { describe, it, expect } from 'vitest';
import { vec, add } from '../src/math';
import { makeBox, makeRamp } from '../src/brush';
import { trace } from '../src/trace';
import { config } from '../src/config';

const { mins, maxs } = config.hullStand;
const floor = makeBox(vec(-100, -100, -16), vec(100, 100, 0));

describe('trace', () => {
  it('hits floor from above', () => {
    const t = trace(vec(0, 0, 50), vec(0, 0, -50), mins, maxs, [floor]);
    expect(t.fraction).toBeCloseTo(0.5, 2);
    expect(t.fraction).toBeLessThan(0.5);
    expect(t.normal).toEqual({ x: 0, y: 0, z: 1 });
    expect(t.endPos.z).toBeCloseTo(0, 1);
    expect(t.endPos.z).toBeGreaterThan(0);
  });

  it('misses when it stops short', () => {
    const t = trace(vec(0, 0, 50), vec(0, 0, 10), mins, maxs, [floor]);
    expect(t.fraction).toBe(1);
    expect(t.normal).toBeNull();
  });

  it('reports startSolid inside a brush', () => {
    const t = trace(vec(0, 0, -8), vec(0, 0, -8), mins, maxs, [floor]);
    expect(t.startSolid).toBe(true);
  });

  it('hits a 45° left ramp with its slope normal', () => {
    const ramp = makeRamp(vec(0, 0, 0), 512, 256, 256, 'left');
    const slope = ramp.planes.find((p) => p.normal.y > 0 && p.normal.z > 0)!;
    expect(slope.normal.y).toBeCloseTo(Math.SQRT1_2, 4);
    expect(slope.normal.z).toBeCloseTo(Math.SQRT1_2, 4);
    const t = trace(vec(256, 128, 400), vec(256, 128, 0), mins, maxs, [ramp]);
    expect(t.fraction).toBeLessThan(1);
    expect(t.normal!.y).toBeCloseTo(Math.SQRT1_2, 4);
    expect(t.normal!.z).toBeCloseTo(Math.SQRT1_2, 4);
  });

  it('does not tunnel through a 16u wall at 3500 u/s', () => {
    const wall = makeBox(vec(100, -500, 0), vec(116, 500, 200));
    let pos = vec(0, 0, 10);
    let hit = false;
    for (let i = 0; i < 10; i++) {
      const t = trace(pos, add(pos, vec(3500 / 64, 0, 0)), mins, maxs, [wall]);
      if (t.normal && t.normal.x === -1) hit = true;
      pos = t.endPos;
      expect(pos.x).toBeLessThanOrEqual(100 - 16);
    }
    expect(hit).toBe(true);
  });
});
