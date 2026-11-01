import type { Vec3 } from './math';
import type { Brush } from './brush';

const CELL = 1024;
const MAX_CELLS = 512; // bigger brushes (skybox walls, huge floors) go in an always-checked list

// Uniform 3D grid so collision only checks brushes near the player on maps with thousands of brushes.
export function createGrid(brushes: Brush[]) {
  const cells = new Map<string, Brush[]>();
  const always: Brush[] = [];
  const c = (v: number) => Math.floor(v / CELL);
  for (const b of brushes) {
    const [x0, y0, z0, x1, y1, z1] = [c(b.mins.x), c(b.mins.y), c(b.mins.z), c(b.maxs.x), c(b.maxs.y), c(b.maxs.z)];
    if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > MAX_CELLS) {
      always.push(b);
      continue;
    }
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) {
          const k = `${x},${y},${z}`;
          const list = cells.get(k);
          if (list) list.push(b);
          else cells.set(k, [b]);
        }
  }
  return {
    query(mins: Vec3, maxs: Vec3): Brush[] {
      const out = new Set<Brush>(always);
      for (let x = c(mins.x); x <= c(maxs.x); x++)
        for (let y = c(mins.y); y <= c(maxs.y); y++)
          for (let z = c(mins.z); z <= c(maxs.z); z++) for (const b of cells.get(`${x},${y},${z}`) ?? []) out.add(b);
      return [...out];
    },
  };
}
