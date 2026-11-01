import { describe, it, expect } from 'vitest';
import { maps, findMap } from '../src/maps';
import { Brush, slopeOf } from '../src/brush';
import { trace } from '../src/trace';
import { step, newPlayer, Cmd, Player } from '../src/movement';
import { config } from '../src/config';
import { vec, scale, sub, dot } from '../src/math';

const { mins, maxs } = config.hullStand;
const idle: Cmd = { forward: 0, side: 0, jump: false, duck: false, yaw: 0, pitch: 0 };
const axisOf = (r: Brush) => (r.maxs.x - r.mins.x >= r.maxs.y - r.mins.y ? vec(1, 0, 0) : vec(0, 1, 0));
const touching = (p: Player, r: Brush) => trace(p.pos, sub(p.pos, scale(slopeOf(r).normal, 4)), mins, maxs, [r]).fraction < 1;

describe.each(maps.map((m) => [m.name, m] as const))('%s', (_, map) => {
  const ramps = map.brushes.filter((b) => b.kind === 'ramp');

  it('spawn is not inside geometry', () => {
    expect(trace(map.spawn, map.spawn, mins, maxs, map.brushes).startSolid).toBe(false);
  });

  it('player at spawn lands within 128 ticks', () => {
    let p = newPlayer(map.spawn);
    let landed = false;
    for (let i = 0; i < 128 && !landed; i++) landed = (p = step(p, idle, map.brushes, 1 / 64)).onGround;
    expect(landed).toBe(true);
  });

  it('spawn is inside the start zone', () => {
    expect(trace(map.spawn, map.spawn, mins, maxs, map.startZone).startSolid).toBe(true);
  });

  it('goal zone sits on the landing pad', () => {
    const pad = map.brushes[map.brushes.length - 1];
    const p = vec((pad.mins.x + pad.maxs.x) / 2, (pad.mins.y + pad.maxs.y) / 2, pad.maxs.z + 1);
    expect(trace(p, p, mins, maxs, map.endZone!).startSolid).toBe(true);
  });

  it('every ramp slope is surfable (normal.z < 0.7)', () => {
    expect(ramps.length).toBeGreaterThanOrEqual(5);
    for (const r of ramps) expect(slopeOf(r).normal.z).toBeLessThan(0.7);
  });

  it.each(ramps.slice(0, -1).map((_, i) => i))('leaving ramp %i at 1300 u/s reaches the next one', (i) => {
    const [r1, r2] = [ramps[i], ramps[i + 1]];
    const d1 = axisOf(r1), d2 = axisOf(r2);
    const turn = Math.sign(d1.x * d2.y - d1.y * d2.x); // +1 = left turn
    const cx = (r1.mins.x + r1.maxs.x) / 2, cy = (r1.mins.y + r1.maxs.y) / 2;
    const start = d1.x ? vec(r1.maxs.x - 150, cy, r1.maxs.z + 40) : vec(cx, r1.maxs.y - 150, r1.maxs.z + 40);
    let p = { ...newPlayer(start), vel: scale(d1, 1300) };
    let hit = false;
    for (let t = 0; t < 256 && !hit; t++) {
      // Perfect air strafe until heading matches the next ramp, then let go.
      const turning = turn !== 0 && dot(p.vel, d2) < 0.97 * Math.hypot(p.vel.x, p.vel.y);
      const yaw = (Math.atan2(p.vel.y, p.vel.x) * 180) / Math.PI;
      p = step(p, turning ? { ...idle, yaw, side: -turn } : idle, map.brushes, 1 / 64);
      hit = touching(p, r2);
    }
    expect(hit).toBe(true);
  });
});

describe('findMap', () => {
  it('falls back to the first map for unknown ids', () => {
    expect(findMap('nope')).toBe(maps[0]);
    expect(findMap('spire').id).toBe('spire');
  });
});
