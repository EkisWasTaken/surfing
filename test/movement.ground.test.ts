import { describe, it, expect } from 'vitest';
import { vec, Vec3 } from '../src/math';
import { makeBox, makeRamp, Brush } from '../src/brush';
import { step, newPlayer, Cmd, Player } from '../src/movement';

const dt = 1 / 64;
const floor = makeBox(vec(-5000, -5000, -16), vec(5000, 5000, 0));
const idle: Cmd = { forward: 0, side: 0, jump: false, duck: false, yaw: 0, pitch: 0 };
const hspeed = (v: Vec3) => Math.hypot(v.x, v.y);

function run(p: Player, cmd: Cmd, brushes: Brush[], ticks: number, each?: (p: Player) => void): Player {
  for (let i = 0; i < ticks; i++) {
    p = step(p, cmd, brushes, dt);
    each?.(p);
  }
  return p;
}

const grounded = (pos: Vec3, brushes: Brush[]) => run(newPlayer(pos), idle, brushes, 8);

describe('ground movement', () => {
  it('ground speed caps at 250', () => {
    const p = run(grounded(vec(0, 0, 1), [floor]), { ...idle, forward: 1 }, [floor], 200);
    expect(p.onGround).toBe(true);
    expect(hspeed(p.vel)).toBeGreaterThan(249.5);
    expect(hspeed(p.vel)).toBeLessThan(250.5);
  });

  it('friction stops player', () => {
    const p0 = grounded(vec(0, 0, 1), [floor]);
    const p = run({ ...p0, vel: vec(250, 0, 0) }, idle, [floor], 64);
    expect(hspeed(p.vel)).toBeLessThan(1);
  });

  it('jump apex ≈ 57', () => {
    let p = grounded(vec(0, 0, 1), [floor]);
    const z0 = p.pos.z;
    p = step(p, { ...idle, jump: true }, [floor], dt);
    let apex = p.pos.z;
    run(p, idle, [floor], 64, (q) => (apex = Math.max(apex, q.pos.z)));
    expect(apex - z0).toBeGreaterThanOrEqual(56);
    expect(apex - z0).toBeLessThanOrEqual(58);
  });

  it('autobhop keeps speed across landings', () => {
    const p0 = grounded(vec(0, 0, 1), [floor]);
    let landings = 0;
    let was = true;
    const p = run({ ...p0, vel: vec(300, 0, 0) }, { ...idle, jump: true }, [floor], 200, (q) => {
      if (q.onGround && !was) landings++;
      was = q.onGround;
    });
    expect(landings).toBeGreaterThanOrEqual(3);
    expect(hspeed(p.vel)).toBeGreaterThanOrEqual(299);
  });

  it('steps up 16u but not 20u', () => {
    const low = [floor, makeBox(vec(100, -500, 0), vec(400, 500, 16))];
    const a = run(grounded(vec(0, 0, 1), low), { ...idle, forward: 1 }, low, 64);
    expect(a.pos.x).toBeGreaterThan(100);
    expect(a.pos.z).toBeCloseTo(16, 0);

    const high = [floor, makeBox(vec(100, -500, 0), vec(400, 500, 20))];
    const b = run(grounded(vec(0, 0, 1), high), { ...idle, forward: 1 }, high, 64);
    expect(b.pos.x).toBeLessThanOrEqual(84);
  });

  it('ground only when normal.z ≥ 0.7', () => {
    // 45° (normal.z 0.7071) is still standable in Source; surf ramps start just past 45.57°.
    const steep = [makeRamp(vec(0, 0, 0), 512, 256, 256 * Math.tan((50 * Math.PI) / 180), 'left')];
    let everGrounded = false;
    run(newPlayer(vec(256, 128, 300)), idle, steep, 128, (q) => (everGrounded ||= q.onGround));
    expect(everGrounded).toBe(false);

    const gentle = [makeRamp(vec(0, 0, 0), 512, 256, 256 * Math.tan(Math.PI / 6), 'left')];
    const p = run(newPlayer(vec(256, 128, 300)), idle, gentle, 128);
    expect(p.onGround).toBe(true);
  });
});

describe('autobhop off', () => {
  it('holding jump only jumps once', async () => {
    const { config } = await import('../src/config');
    config.autobhop = false;
    try {
      let takeoffs = 0;
      let was = true;
      run(grounded(vec(0, 0, 1), [floor]), { ...idle, jump: true }, [floor], 200, (q) => {
        if (!q.onGround && was) takeoffs++;
        was = q.onGround;
      });
      expect(takeoffs).toBe(1);
    } finally {
      config.autobhop = true;
    }
  });
});

import { unstick } from '../src/movement';

describe('unstick', () => {
  it('lifts a point sunk slightly into the floor until the hull fits', () => {
    const p = unstick(vec(0, 0, -2), [floor]);
    expect(p.z).toBeGreaterThanOrEqual(0);
    expect(p.z).toBeLessThanOrEqual(4);
  });
  it('leaves a free point alone', () => {
    expect(unstick(vec(0, 0, 10), [floor])).toEqual(vec(0, 0, 10));
  });
});

describe('CS:GO walk and crouch speeds', () => {
  it('walking (shift) caps at 250 × 0.52', () => {
    const p = run(grounded(vec(0, 0, 1), [floor]), { ...idle, forward: 1, walk: true }, [floor], 200);
    expect(Math.hypot(p.vel.x, p.vel.y)).toBeCloseTo(130, 0);
  });
  it('crouch-walking caps at 250 × 0.34', () => {
    const p = run(grounded(vec(0, 0, 1), [floor]), { ...idle, forward: 1, duck: true }, [floor], 200);
    expect(Math.hypot(p.vel.x, p.vel.y)).toBeCloseTo(85, 0);
  });
});

import { embedded } from '../src/movement';

describe('embedded vs touching', () => {
  const ceiling = makeBox(vec(-100, -100, 72), vec(100, 100, 80));
  it('touching a floor and a ceiling exactly is not stuck (Source lets you move out)', () => {
    expect(embedded(vec(0, 0, 0), false, [floor, ceiling])).toBe(false);
    expect(unstick(vec(0, 0, 0), [floor, ceiling])).toEqual(vec(0, 0, 0)); // lifting would push the head into the ceiling
  });
  it('really overlapping geometry is stuck', () => {
    expect(embedded(vec(0, 0, -4), false, [floor])).toBe(true);
  });
});

describe('unstick (Source spawns 1u above the spot)', () => {
  it('lifts a spot resting exactly on a floor by 1 unit, so the player can move', () => {
    const p = unstick(vec(0, 0, 0), [floor]);
    expect(p.z).toBeCloseTo(1, 6);
    const moved = run(newPlayer(p), { ...idle, forward: 1 }, [floor], 32);
    expect(moved.pos.x).toBeGreaterThan(10);
  });
  it('lowers a spot whose head touches a ceiling', () => {
    const ceiling = makeBox(vec(-100, -100, 172), vec(100, 100, 180));
    expect(unstick(vec(0, 0, 100), [floor, ceiling]).z).toBeCloseTo(99, 6);
  });
});
