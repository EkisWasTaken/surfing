import { MapDef, stagedMap, THEMES } from './build';

// Long gaps and big drops between medium ramps, in two stages: hold your speed through the air.
const LENGTH = 1400, GAP = 560;
export const longdrop: MapDef = stagedMap('longdrop', 'Long Drop (medium)', THEMES.dusk, [
  { topZ: 4576, length: LENGTH, gap: GAP, drop: 460, sections: [{ angle: 58, width: 320 }, { angle: 56, width: 300 }, { angle: 60, width: 320 }] },
  { topZ: 4576, length: LENGTH, gap: GAP, drop: 460, sections: [{ angle: 57, width: 280 }, { angle: 59, width: 300 }, { angle: 61, width: 320 }] },
]);
