import { MapDef, stagedMap, THEMES } from './build';

// Steep, narrow ramps with long gaps and big drops, in two stages: lose strafe sync and you fall.
const LENGTH = 1600, GAP = 640;
export const spire: MapDef = stagedMap('spire', 'Spire (hard)', THEMES.ember, [
  { topZ: 4176, length: LENGTH, gap: GAP, drop: 520, sections: [{ angle: 62, width: 220 }, { angle: 65, width: 200 }, { angle: 63, width: 240 }, { angle: 67, width: 190 }] },
  { topZ: 4176, length: LENGTH, gap: GAP, drop: 520, sections: [{ angle: 64, width: 210 }, { angle: 68, width: 180 }, { angle: 66, width: 200 }] },
]);
