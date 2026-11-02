// One game tick of the world around the player: movement, death, boosters, teleports.
// Pure (no DOM), so the browser game and the map playability check run the exact same logic.
import { config } from './config';
import { vec, add, sub, Vec3 } from './math';
import type { Brush } from './brush';
import type { Push, Teleport } from './bsp';
import type { MapDef } from './maps/build';
import { step, newPlayer, unstick, embedded, applyPush, Player, Cmd } from './movement';
import { trace } from './trace';
import type { createGrid } from './grid';

export type Grid = ReturnType<typeof createGrid>;
// What a tick carries over besides the player: "once" pushes touched last tick (their impulse fires on entry only),
// health, and when the next trigger_hurt dose is due.
export type TickState = { oncePushes: Set<Push>; health: number; hurtWait: number };
export const newTickState = (): TickState => ({ oncePushes: new Set(), health: 100, hurtWait: 0 });
const HURT_INTERVAL = 0.5; // Source/GoldSrc trigger_hurt: half the damage-per-second every half second

// reason: why a respawn happened (fell out of the map, killed by trigger_hurt, or stuck inside geometry, which would be a bug).
export type TickResult = { player: Player; event: null | 'respawn' | 'teleport'; reason?: 'fell' | 'hurt' | 'stuck'; teleport?: Teleport; state: TickState };

export const touching = (p: Player, zone: Brush[] | null) => {
  if (!zone) return false;
  const h = p.ducked ? config.hullDuck : config.hullStand;
  return trace(p.pos, p.pos, h.mins, h.maxs, zone).startSolid;
};

const around = (grid: Grid, p: Vec3, r: number) => grid.query(sub(p, vec(r, r, r)), add(p, vec(r, r, r + 128)));

export function simTick(map: MapDef, grid: Grid, cur: Player, cmd: Cmd, dt: number, state: TickState): TickResult {
  // Only brushes near the player: enough margin for this tick's travel plus step and ground checks.
  const near = around(grid, cur.pos, 256 + Math.hypot(cur.vel.x, cur.vel.y, cur.vel.z) * dt * 2);
  let p = step(cur, cmd, near, dt);
  // trigger_hurt: a dose on contact, then every half second while touching; dead at 0 HP (negative damage heals).
  let { health, hurtWait } = state;
  const hurts = map.hurts.filter((h) => touching(p, h.brushes));
  hurtWait = Math.max(0, hurtWait - dt);
  if (!hurts.length) hurtWait = 0;
  else if (hurtWait === 0) {
    health = Math.min(100, health - hurts.reduce((sum, h) => sum + h.damage * HURT_INTERVAL, 0));
    hurtWait = HURT_INTERVAL;
  }
  const reason = p.pos.z < map.killZ ? 'fell' : embedded(p.pos, p.ducked, near) ? 'stuck' : health <= 0 ? 'hurt' : null;
  if (reason) return { player: p, event: 'respawn', reason, state: newTickState() };
  // Boosters: summed base velocity while inside; "once" pushes give one impulse on entry.
  const inPush = map.pushes.filter((q) => touching(p, q.brushes));
  let push: Vec3 | null = null;
  for (const q of inPush) {
    if (!q.once) push = add(push ?? vec(), q.vel);
    else if (!state.oncePushes.has(q)) p = { ...p, vel: add(p.vel, q.vel) };
  }
  p = applyPush(p, push, dt);
  const next: TickState = { oncePushes: new Set(inPush.filter((q) => q.once)), health, hurtWait };
  const tp = map.teleports.find((t) => touching(p, t.brushes));
  if (!tp) return { player: p, event: null, state: next };
  // Source keeps velocity through a trigger_teleport (it only sets angles); Half-Life/CS 1.6 zero it.
  // A landmark keeps the player's offset from it, and the velocity, in both.
  const dest = tp.landmark ? add(tp.dest, sub(p.pos, tp.landmark)) : tp.dest;
  const keep = !tp.stop && (config.teleportKeepsVelocity || !!tp.landmark);
  const arrived = { ...newPlayer(unstick(dest, around(grid, dest, 256))), ducked: p.ducked, vel: keep ? p.vel : vec(), stamina: p.stamina };
  return { player: arrived, event: 'teleport', teleport: tp, state: next };
}
