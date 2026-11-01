import { Vec3, vec, add, sub, scale, dot } from './math';
import { Brush } from './brush';

// startSolid: the box starts in (or exactly touching) a brush; allSolid: it stays inside for the whole move.
export type TraceResult = { fraction: number; endPos: Vec3; normal: Vec3 | null; startSolid: boolean; allSolid: boolean };

export const DIST_EPSILON = 0.03125;

// Sweep an AABB (mins/maxs relative to origin) from start to end against convex brushes.
// Port of Quake's CM_ClipBoxToBrush: each plane is pushed out by the box corner nearest it.
export function trace(start: Vec3, end: Vec3, mins: Vec3, maxs: Vec3, brushes: Brush[]): TraceResult {
  let fraction = 1;
  let normal: Vec3 | null = null;
  let startSolid = false, allSolid = false;
  const bmin = add(vec(Math.min(start.x, end.x), Math.min(start.y, end.y), Math.min(start.z, end.z)), mins);
  const bmax = add(vec(Math.max(start.x, end.x), Math.max(start.y, end.y), Math.max(start.z, end.z)), maxs);

  for (const b of brushes) {
    if (bmin.x > b.maxs.x || bmax.x < b.mins.x || bmin.y > b.maxs.y || bmax.y < b.mins.y || bmin.z > b.maxs.z || bmax.z < b.mins.z) continue;

    let enter = -1, leave = 1, clip: Vec3 | null = null, startOut = false, getOut = false, missed = false;
    for (const p of b.planes) {
      const n = p.normal;
      const ofs = vec(n.x < 0 ? maxs.x : mins.x, n.y < 0 ? maxs.y : mins.y, n.z < 0 ? maxs.z : mins.z);
      const dist = p.dist - dot(ofs, n);
      const d1 = dot(start, n) - dist;
      const d2 = dot(end, n) - dist;
      if (d1 > 0) startOut = true;
      if (d2 > 0) getOut = true;
      if (d1 > 0 && d2 >= d1) { missed = true; break; }
      if (d1 <= 0 && d2 <= 0) continue;
      if (d1 > d2) {
        const f = (d1 - DIST_EPSILON) / (d1 - d2);
        if (f > enter) { enter = f; clip = n; }
      } else {
        const f = (d1 + DIST_EPSILON) / (d1 - d2);
        if (f < leave) leave = f;
      }
    }
    if (missed) continue;
    if (!startOut) {
      // Starting inside: only a move that never leaves the brush is blocked (Quake CM_ClipBoxToBrush).
      startSolid = true;
      if (!getOut) {
        allSolid = true;
        fraction = 0;
        normal = null;
      }
      continue;
    }
    if (enter < leave && enter > -1 && enter < fraction) {
      fraction = Math.max(0, enter);
      normal = clip;
    }
  }
  return { fraction, endPos: add(start, scale(sub(end, start), fraction)), normal, startSolid, allSolid };
}
