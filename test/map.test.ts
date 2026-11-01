import { describe, it, expect } from 'vitest';
import { brushes, spawn } from '../src/map';
import { slopeOf } from '../src/brush';
import { trace } from '../src/trace';
import { step, newPlayer } from '../src/movement';
import { config } from '../src/config';
import { vec } from '../src/math';

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

  it('leaving ramp 1 at surf speed lands on ramp 2', () => {
    const idle = { forward: 0, side: 0, jump: false, duck: false, yaw: 0, pitch: 0 };
    const [r1, r2] = brushes.filter((b) => b.kind === 'ramp');
    let p = { ...newPlayer(vec(r1.maxs.x - 150, 0, r1.maxs.z + 40)), vel: vec(1000, 0, 0) };
    let hitR2 = false;
    for (let i = 0; i < 128 && !hitR2; i++) {
      const before = p.vel.y;
      p = step(p, idle, brushes, 1 / 64);
      // r2 is a right ramp: its slope faces -Y, so a clip on it pushes vel.y down.
      hitR2 = p.pos.x > r2.mins.x && p.vel.y < before - 1;
    }
    expect(hitR2).toBe(true);
  });

  it('every ramp slope is surfable (normal.z < 0.7)', () => {
    const ramps = brushes.filter((b) => b.kind === 'ramp');
    expect(ramps.length).toBeGreaterThanOrEqual(5);
    for (const r of ramps) {
      const slope = slopeOf(r);
      expect(slope.normal.z).toBeLessThan(0.7);
    }
  });
});
