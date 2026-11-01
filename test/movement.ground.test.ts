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
