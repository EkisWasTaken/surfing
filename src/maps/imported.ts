import { Vec3, vec, add } from '../math';
import { makeBox } from '../brush';
import type { BspMap } from '../bsp';
import type { MapDef } from './build';

const GOALS = 'surf-goals';

// A goal volume around where the player stood when they pressed F.
export const goalBox = (p: Vec3) => makeBox(add(p, vec(-64, -64, -16)), add(p, vec(64, 64, 128)));

export function loadGoal(mapId: string): Vec3 | null {
  try {
    const v = JSON.parse(localStorage.getItem(GOALS) ?? '{}')[mapId];
    return Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) ? vec(v[0], v[1], v[2]) : null;
  } catch {
    return null;
  }
}

export function saveGoal(mapId: string, p: Vec3) {
  try {
    const all = JSON.parse(localStorage.getItem(GOALS) ?? '{}');
    localStorage.setItem(GOALS, JSON.stringify({ ...(all && typeof all === 'object' ? all : {}), [mapId]: [p.x, p.y, p.z] }));
  } catch {}
}

// Whether a map's finish is the same for every player, so its times can be compared on a leaderboard.
export const sharedFinish = (m: { mesh?: unknown; goalFromMap?: boolean }) => !m.mesh || !!m.goalFromMap;

// finish: the point licensed-maps/manifest.json gives for a map with no finish of its own, the same for everyone.
export function bspToMap(bsp: BspMap, fileName: string, finish?: number[]): MapDef & { goalFromMap: boolean } {
  const id = `bsp:${fileName}`;
  const saved = loadGoal(id);
  const given = finish && vec(finish[0], finish[1], finish[2]);
  return {
    id,
    name: `Imported: ${fileName.replace(/\.bsp$/i, '')}`,
    brushes: bsp.brushes,
    spawn: bsp.spawn,
    spawnYaw: bsp.spawnYaw,
    killZ: bsp.killZ,
    // No start trigger: a box around spawn, so the timer starts when you leave it.
    startZone: bsp.startZone ?? [makeBox(add(bsp.spawn, vec(-96, -96, -16)), add(bsp.spawn, vec(96, 96, 128)))],
    endZone: bsp.endZone ?? (given ? [goalBox(given)] : saved ? [goalBox(saved)] : null),
    goalFromMap: !!bsp.endZone || !!given,
    teleports: bsp.teleports,
    pushes: bsp.pushes,
    hurts: bsp.hurts,
    mesh: bsp.mesh,
    props: bsp.props,
    lightmap: bsp.lightmap,
    skyName: bsp.skyName,
    fog: bsp.fog,
    pak: bsp.pak,
  };
}
