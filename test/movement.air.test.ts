import { describe, it, expect } from 'vitest';
import { vec, Vec3 } from '../src/math';
import { makeBox, makeRamp, Brush } from '../src/brush';
import { step, newPlayer, Cmd, Player } from '../src/movement';

const dt = 1 / 64;
const idle: Cmd = { forward: 0, side: 0, jump: false, duck: false, yaw: 0, pitch: 0 };
const hspeed = (v: Vec3) => Math.hypot(v.x, v.y);
const floor = makeBox(vec(-5000, -5000, -16), vec(5000, 5000, 0));
const rampH = 512 * Math.tan((50 * Math.PI) / 180);

function run(p: Player, cmd: Cmd, brushes: Brush[], ticks: number, each?: (p: Player) => void): Player {
  for (let i = 0; i < ticks; i++) {
    p = step(p, cmd, brushes, dt);
    each?.(p);
  }
  return p;
}

// Drop onto the slope, then give the player a push along the ramp.
function onRamp(brushes: Brush[], x: number, vx: number): Player {
  let p = newPlayer(vec(x, 256, rampH + 100));
  let touched = false;
  for (let i = 0; i < 256 && !touched; i++) {
    const before = p.vel.y;
    p = step(p, idle, brushes, dt);
    touched = p.vel.y > before + 1e-6; // slope clip adds +Y speed
  }
  expect(touched).toBe(true);
  return { ...p, vel: vec(vx, p.vel.y, p.vel.z) };
}

describe('air movement', () => {
  it('air strafe gains the 30-cap amount per tick', () => {
    const p = step({ ...newPlayer(vec(0, 0, 1000)), vel: vec(300, 0, 0) }, { ...idle, side: -1 }, [], dt);
    expect(hspeed(p.vel)).toBeCloseTo(Math.hypot(300, 30), 2);
  });

  it('no gain holding forward', () => {
    const p = step({ ...newPlayer(vec(0, 0, 1000)), vel: vec(300, 0, 0) }, { ...idle, forward: 1 }, [], dt);
    expect(hspeed(p.vel)).toBeCloseTo(300, 6);
  });

  it('surf keeps speed along a 50° ramp', () => {
    const ramp = [makeRamp(vec(0, 0, 0), 4096, 512, rampH, 'left')];
    let p = onRamp(ramp, 100, 1000);
    p = run(p, idle, ramp, 64, (q) => {
      expect(q.onGround).toBe(false);
      expect(q.vel.x).toBeGreaterThanOrEqual(1000 - 1e-6);
    });
    expect(p.pos.x).toBeGreaterThan(100 + 1000 * 0.4);
  });

  it('ramp seam between two brushes keeps speed', () => {
    const ramps = [makeRamp(vec(0, 0, 0), 1024, 512, rampH, 'left'), makeRamp(vec(1024, 0, 0), 1024, 512, rampH, 'left')];
    let p = onRamp(ramps, 900, 1500);
    p = run(p, idle, ramps, 24);
    expect(p.pos.x).toBeGreaterThan(1024 + 200);
    expect(p.vel.x).toBeGreaterThan(1499);
  });

  it('clamps to sv_maxvelocity per axis', () => {
    const p = step({ ...newPlayer(vec(0, 0, 1000)), vel: vec(5000, 0, 0) }, idle, [], dt);
    expect(p.vel.x).toBe(3500);
  });

  it('stays crouched under a low ceiling', () => {
    const map = [floor, makeBox(vec(-500, -500, 60), vec(500, 500, 80))];
    const p = run({ ...newPlayer(vec(0, 0, 1)), ducked: true }, idle, map, 16);
    expect(p.ducked).toBe(true);
  });

  it('fits under a 60u gap only when crouched', () => {
    const map = [floor, makeBox(vec(100, -500, 60), vec(400, 500, 200))];
    const crouched = run(newPlayer(vec(0, 0, 1)), { ...idle, forward: 1, duck: true }, map, 192) // crouch-walk is 85 u/s;
    expect(crouched.pos.x).toBeGreaterThan(100);
    const standing = run(newPlayer(vec(0, 0, 1)), { ...idle, forward: 1 }, map, 64);
    expect(standing.pos.x).toBeLessThanOrEqual(84);
  });
});

import { applyPush } from '../src/movement';

describe('trigger_push base velocity (Source)', () => {
  it('moves the player by base velocity without changing their own velocity', () => {
    const p = step({ ...newPlayer(vec(0, 0, 1000)), baseVel: vec(640, 0, 0) }, idle, [], dt);
    expect(p.pos.x).toBeCloseTo(10, 6);
    expect(p.vel.x).toBeCloseTo(0, 6);
  });
  it('vertical base velocity acts as acceleration', () => {
    const p = step({ ...newPlayer(vec(0, 0, 1000)), baseVel: vec(0, 0, 1200) }, idle, [], dt);
    expect(p.vel.z).toBeCloseTo((1200 - 800) / 64, 3);
  });
  it('leaving the push folds base velocity into velocity', () => {
    const p = applyPush({ ...newPlayer(vec(0, 0, 0)), baseVel: vec(500, 0, 0) }, null, dt);
    expect(p.vel.x).toBeCloseTo(500 * (1 + dt * 0.5), 6);
    expect(p.baseVel).toEqual(vec(0, 0, 0));
  });
  it('an upward push lifts a grounded player off the ground', () => {
    const p = applyPush({ ...newPlayer(vec(0, 0, 0)), onGround: true }, vec(0, 0, 500), dt);
    expect(p.onGround).toBe(false);
    expect(p.pos.z).toBe(1);
    expect(p.baseVel).toEqual(vec(0, 0, 500));
  });
});
