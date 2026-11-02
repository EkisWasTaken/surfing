// Curved ramps: the seams between pieces must not cost speed, and every jump in a built course must land.
import { describe, it, expect } from 'vitest';
import { Track } from '../src/maps/track';
import { horizon } from '../src/maps/horizon';
import { createGrid } from '../src/grid';
import { slopeOf } from '../src/brush';
import { step, newPlayer, Cmd } from '../src/movement';
import { simTick, newTickState } from '../src/sim';
import { trace } from '../src/trace';
import { config } from '../src/config';
import { vec, scale, sub } from '../src/math';

const idle: Cmd = { forward: 0, side: 0, jump: false, duck: false, yaw: 0, pitch: 0 };
const DT = 1 / 64;

// Rides a curve hands-off from mid-slope, along it. Reports speed kept, the worst single tick, and how far round it got.
function ride(radius: number, degrees: number, speed: number, width = 460, angle = 54) {
  const t = new Track(0, 0, 0, 3000, 0).arc(radius, degrees, 'left', width, angle);
  const height = width * Math.tan((angle * Math.PI) / 180);
  let p = { ...newPlayer(vec(0, 0, 3000 - height / 2 + 40)), vel: vec(speed, 0, 0) };
  let worst = 0, last = speed, turned = 0;
  for (let i = 0; i < 64 * 12; i++) {
    p = step(p, idle, t.pieces, DT);
    const v = Math.hypot(p.vel.x, p.vel.y);
    if (Math.hypot(p.pos.x, p.pos.y - radius) - radius > -(width / 2 - 40)) worst = Math.max(worst, (last - v) / last); // on the slope: the seams
    last = v;
    turned = (Math.atan2(p.pos.x, radius - p.pos.y) * 180) / Math.PI;
    const across = Math.hypot(p.pos.x, p.pos.y - radius) - radius;
    if (turned >= degrees - 1 || across < -(width / 2 - 40) || across > width / 2 + 40) break; // round it, or off the bottom or top
  }
  return { kept: last / speed, worst, turned };
}

describe('curved ramps', () => {
  it('every piece has a surfable slope', () => {
    for (const b of new Track(0, 0, 30, 3000, 0).arc(2800, 120, 'right', 460, 54).pieces) expect(slopeOf(b).normal.z).toBeLessThan(0.7);
  });
  it.each([
    [2600, 1100], [2600, 1500], [2800, 1300], [3200, 1500], [3200, 2000], [3600, 1800], [3600, 2300],
  ])('radius %i at %i u/s: rides the curve with no seam stopping you', (radius, speed) => {
    const r = ride(radius, 80, speed);
    expect(r.worst).toBeLessThan(0.02); // a seam you'd feel takes far more than this in one tick
    expect(r.kept).toBeGreaterThan(0.9);
    expect(r.turned).toBeGreaterThan(30); // hands-off: at low speed you slide off unless you press into the slope
  });
});

describe('Horizon', () => {
  it('has five stages and stays clear of itself', () => {
    expect(horizon.stages).toHaveLength(5);
    expect(horizon.teleports).toHaveLength(4);
  });
  it('every piece and pad is reachable: each jump lands at riding speed', () => {
    const { mins, maxs } = config.hullStand, grid = createGrid(horizon.brushes), missed: string[] = [];
    horizon.jumps.forEach((j, n) => {
      for (const speed of [1100, 1500, 2000]) {
        const dir = vec(Math.cos((j.heading * Math.PI) / 180), Math.sin((j.heading * Math.PI) / 180), 0);
        let p = { ...newPlayer(j.from), vel: scale(dir, speed) }, state = newTickState(), hit = false;
        for (let t = 0; t < 64 * 5 && !hit; t++) {
          const r = simTick(horizon, grid, p, idle, DT, state);
          state = r.state;
          if (r.event === 'respawn') break;
          p = r.player;
          hit = r.event === 'teleport' || trace(p.pos, sub(p.pos, vec(0, 0, 8)), mins, maxs, j.to).fraction < 1 || trace(p.pos, p.pos, mins, maxs, j.to).startSolid;
        }
        if (!hit) missed.push(`jump ${n} (stage ${j.stage + 1}) at ${speed}`);
      }
    });
    expect(missed).toEqual([]);
  });
});
