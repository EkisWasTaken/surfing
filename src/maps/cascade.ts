import { MapDef, stagedMap, THEMES } from './build';

// Wide, forgiving ramps with short gaps, in three stages: a first long run.
const LENGTH = 1500, GAP = 320;
export const cascade: MapDef = stagedMap('cascade', 'Cascade (easy)', THEMES.glacier, [
  { topZ: 3176, length: LENGTH, gap: GAP, drop: 300, sections: [{ angle: 52, width: 440 }, { angle: 50, width: 420 }, { angle: 54, width: 460 }] },
  { topZ: 3176, length: LENGTH, gap: GAP, drop: 300, sections: [{ angle: 50, width: 420 }, { angle: 53, width: 440 }, { angle: 51, width: 420 }] },
  { topZ: 3176, length: LENGTH, gap: GAP, drop: 300, sections: [{ angle: 55, width: 460 }, { angle: 52, width: 440 }] },
]);
