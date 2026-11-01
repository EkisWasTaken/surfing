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
// reason: why a respawn happened (fell out of the map, trigger_hurt, or stuck inside geometry, which would be a bug).
export type TickResult = { player: Player; event: null | 'respawn' | 'teleport'; reason?: 'fell' | 'hurt' | 'stuck'; teleport?: Teleport; oncePushes: Set<Push> };

export const touching = (p: Player, zone: Brush[] | null) => {
  if (!zone) return false;
  const h = p.ducked ? config.hullDuck : config.hullStand;
  return trace(p.pos, p.pos, h.mins, h.maxs, zone).startSolid;
};

const around = (grid: Grid, p: Vec3, r: number) => grid.query(sub(p, vec(r, r, r)), add(p, vec(r, r, r + 128)));

// oncePushes: "once" trigger_pushes touched last tick, so their impulse fires on entry only.
export function simTick(map: MapDef, grid: Grid, cur: Player, cmd: Cmd, dt: number, oncePushes: Set<Push>): TickResult {
  // Only brushes near the player: enough margin for this tick's travel plus step and ground checks.
  const near = around(grid, cur.pos, 256 + Math.hypot(cur.vel.x, cur.vel.y, cur.vel.z) * dt * 2);
  let p = step(cur, cmd, near, dt);
  const reason = p.pos.z < map.killZ ? 'fell' : embedded(p.pos, p.ducked, near) ? 'stuck' : touching(p, map.hurts) ? 'hurt' : null;
  if (reason) return { player: p, event: 'respawn', reason, oncePushes: new Set() };
  // Boosters: summed base velocity while inside; "once" pushes give one impulse on entry.
  const inPush = map.pushes.filter((q) => touching(p, q.brushes));
  let push: Vec3 | null = null;
  for (const q of inPush) {
    if (!q.once) push = add(push ?? vec(), q.vel);
    else if (!oncePushes.has(q)) p = { ...p, vel: add(p.vel, q.vel) };
  }
  p = applyPush(p, push, dt);
  const next = new Set(inPush.filter((q) => q.once));
  const tp = map.teleports.find((t) => touching(p, t.brushes));
  if (!tp) return { player: p, event: null, oncePushes: next };
  // Source's trigger_teleport zeroes velocity (no landmark), so stage resets stop you.
  return { player: { ...newPlayer(unstick(tp.dest, around(grid, tp.dest, 256))), ducked: p.ducked }, event: 'teleport', teleport: tp, oncePushes: next };
}
