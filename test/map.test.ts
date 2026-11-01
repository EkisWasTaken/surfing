import { describe, it, expect } from 'vitest';
import { brushes, spawn } from '../src/map';
import { trace } from '../src/trace';
import { step, newPlayer } from '../src/movement';
import { config } from '../src/config';

describe('map', () => {
  it('spawn is not inside geometry', () => {
    const { mins, maxs } = config.hullStand;
    expect(trace(spawn, spawn, mins, maxs, brushes).startSolid).toBe(false);
  });

  it('player at spawn lands within 128 ticks', () => {
    const idle = { forward: 0, side: 0, jump: false, duck: false, yaw: 0, pitch: 0 };
    let p = newPlayer(spawn);
    let landed = false;
    for (let i = 0; i < 128 && !landed; i++) landed = (p = step(p, idle, brushes, 1 / 64)).onGround;
    expect(landed).toBe(true);
  });

  it('every ramp slope is surfable (normal.z < 0.7)', () => {
    const ramps = brushes.filter((b) => b.kind === 'ramp');
    expect(ramps.length).toBeGreaterThanOrEqual(5);
    for (const r of ramps) {
      const slope = r.planes.find((p) => p.normal.z > 0)!;
      expect(slope.normal.z).toBeLessThan(0.7);
    }
  });
});
