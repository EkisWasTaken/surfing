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

export function bspToMap(bsp: BspMap, fileName: string): MapDef & { goalFromMap: boolean } {
  const id = `bsp:${fileName}`;
  const saved = loadGoal(id);
  return {
    id,
    name: `Imported: ${fileName.replace(/\.bsp$/i, '')}`,
    brushes: bsp.brushes,
    spawn: bsp.spawn,
    spawnYaw: bsp.spawnYaw,
    killZ: bsp.killZ,
    // No start trigger: a box around spawn, so the timer starts when you leave it.
    startZone: bsp.startZone ?? [makeBox(add(bsp.spawn, vec(-96, -96, -16)), add(bsp.spawn, vec(96, 96, 128)))],
    endZone: bsp.endZone ?? (saved ? [goalBox(saved)] : null),
    goalFromMap: !!bsp.endZone,
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
