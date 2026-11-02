import { MapDef, stagedMap, THEMES } from './build';

// A relaxed warm-up: very wide ramps and short gaps, in three stages.
const wide = (n: number, angle: number, width: number) => Array.from({ length: n }, (_, i) => ({ angle: angle + (i % 2), width }));

export const warmup: MapDef = stagedMap('warmup', 'Warmup (easy)', THEMES.meadow, [
  { topZ: 2000, length: 1500, gap: 160, drop: 170, sections: wide(3, 47, 620) },
  { topZ: 2200, length: 1500, gap: 200, drop: 200, sections: wide(4, 47, 560) },
  { topZ: 2600, length: 1500, gap: 260, drop: 240, sections: wide(4, 48, 500) },
]);
