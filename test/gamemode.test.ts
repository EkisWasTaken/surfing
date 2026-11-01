// CS:GO vs CS 1.6 movement rules, and the trigger behaviour each game has (teleport velocity, trigger_hurt).
import { describe, it, expect, afterEach } from 'vitest';
import { vec, Vec3 } from '../src/math';
import { makeBox, Brush } from '../src/brush';
import { step, newPlayer, Cmd, Player } from '../src/movement';
import { config, setGameMode } from '../src/config';
import { simTick, newTickState, TickState } from '../src/sim';
import { createGrid } from '../src/grid';
import type { MapDef } from '../src/maps/build';

const idle: Cmd = { forward: 0, side: 0, jump: false, duck: false, yaw: 0, pitch: 0 };
const floor = makeBox(vec(-5000, -5000, -16), vec(5000, 5000, 0));
const hspeed = (v: Vec3) => Math.hypot(v.x, v.y);
const dtOf = () => 1 / (config.mode === 'cs16' ? 100 : 64);
function run(p: Player, cmd: Cmd, brushes: Brush[], ticks: number, each?: (p: Player) => void) {
  for (let i = 0; i < ticks; i++) (p = step(p, cmd, brushes, dtOf())), each?.(p);
  return p;
}
const grounded = () => run(newPlayer(vec(0, 0, 1)), idle, [floor], 10);
// Jump once from p; top = height gained over the start.
const peakJump = (p: Player) => {
  let q = step(p, { ...idle, jump: true }, [floor], dtOf()), top = q.pos.z;
  for (let i = 0; i < 200 && !q.onGround; i++) (q = step(q, idle, [floor], dtOf())), (top = Math.max(top, q.pos.z));
  return { top: top - p.pos.z, landed: q };
};

afterEach(() => setGameMode('csgo'));

describe('game modes', () => {
  it('CS:GO jumps ~57 units, CS 1.6 ~45', () => {
    expect(Math.abs(peakJump(grounded()).top - 57)).toBeLessThan(1.5); // discrete ticks overshoot a little
    setGameMode('cs16');
    expect(Math.abs(peakJump(grounded()).top - 45)).toBeLessThan(1.5);
  });

  it('CS 1.6 back-to-back jumps are lower (jump stamina); CS:GO ones are not', () => {
    for (const mode of ['csgo', 'cs16'] as const) {
      setGameMode(mode);
      const first = peakJump(grounded());
      const second = peakJump(first.landed);
      if (mode === 'csgo') expect(Math.abs(second.top - first.top)).toBeLessThan(1);
      else expect(second.top).toBeLessThan(first.top - 5);
    }
  });

  it('CS 1.6 jumping above 1.2x maxspeed crops speed to 65% of that cap; CS:GO (surf servers) does not', () => {
    const fast = { ...grounded(), vel: vec(500, 0, 0) };
    expect(hspeed(step(fast, { ...idle, jump: true }, [floor], dtOf()).vel)).toBeGreaterThan(450);
    setGameMode('cs16');
    expect(hspeed(step({ ...fast }, { ...idle, jump: true }, [floor], dtOf()).vel)).toBeCloseTo(0.65 * 300, 0);
  });

  it('CS 1.6 doubles friction with a drop just ahead (edge friction)', () => {
    setGameMode('cs16');
    const ledge = makeBox(vec(-500, -500, -16), vec(0, 500, 0)); // edge at x = 0
    const slide = (x: number) => step({ ...newPlayer(vec(x, 0, 0)), onGround: true, vel: vec(200, 0, 0) }, idle, [ledge], 0.01);
    // GoldSrc's check fires once the player's centre is past the edge (still standing on it with the hull).
    const lossMiddle = 200 - hspeed(slide(-300).vel), lossEdge = 200 - hspeed(slide(4).vel);
    expect(lossEdge).toBeCloseTo(lossMiddle * 2, 1);
  });
});

// A one-room map with a teleport pad and two hurt volumes.
function room(over: Partial<MapDef>): MapDef {
  return { id: 't', name: 't', brushes: [floor], spawn: vec(0, 0, 1), spawnYaw: 0, killZ: -5000, startZone: [], endZone: null, teleports: [], pushes: [], hurts: [], ...over };
}
const pad = (x: number) => [makeBox(vec(x - 64, -64, 0), vec(x + 64, 64, 128))];
function tick(map: MapDef, p: Player, state: TickState, cmd = idle) {
  return simTick(map, createGrid(map.brushes), p, cmd, dtOf(), state);
}

describe('trigger_teleport', () => {
  const tp = { brushes: pad(1000), dest: vec(-1000, 0, 1), yaw: 90, landmark: null, keepAngles: false };
  const moving = { ...newPlayer(vec(1000, 0, 10)), vel: vec(400, 0, 0) };
  it('keeps velocity in CS:GO (Source) and zeroes it in CS 1.6 (Half-Life)', () => {
    const r = tick(room({ teleports: [tp] }), moving, newTickState());
    expect(r.event).toBe('teleport');
    expect(r.player.vel.x).toBeGreaterThan(390);
    setGameMode('cs16');
    expect(tick(room({ teleports: [tp] }), moving, newTickState()).player.vel.x).toBe(0);
  });
  it('a landmark keeps the offset from it (and velocity)', () => {
    const lm = { ...tp, landmark: vec(1000, 0, 0), keepAngles: true };
    setGameMode('cs16');
    const r = tick(room({ teleports: [lm] }), { ...moving, pos: vec(1010, 20, 10) }, newTickState());
    expect(r.player.pos.x).toBeCloseTo(-1000 + 10 + 400 * dtOf(), 0);
    expect(r.player.pos.y).toBeCloseTo(20, 0);
    expect(r.player.vel.x).toBeGreaterThan(390);
  });
});

describe('trigger_hurt', () => {
  const standing = { ...newPlayer(vec(0, 0, 0)), onGround: true };
  const hurtMap = (damage: number) => room({ hurts: [{ brushes: pad(0), damage }] });
  const secondsToDie = (damage: number) => {
    let s = newTickState();
    for (let t = 0; t < 30 / dtOf(); t++) {
      const r = tick(hurtMap(damage), standing, s);
      if (r.event === 'respawn') return t * dtOf();
      s = r.state;
    }
    return Infinity;
  };
  it('kills on touch only at 200+ damage per second; lower damage takes its half-second doses', () => {
    expect(secondsToDie(1000)).toBe(0);
    expect(secondsToDie(100)).toBeCloseTo(0.5, 1); // 50 now, 50 half a second later
    expect(secondsToDie(10)).toBeCloseTo(9.5, 1); // 5 HP every half second
  });
  it('negative damage heals, never above 100', () => {
    const r = tick(hurtMap(-50), standing, { ...newTickState(), health: 40 });
    expect(r.state.health).toBe(65);
    expect(tick(hurtMap(-500), standing, newTickState()).state.health).toBe(100);
  });
});
