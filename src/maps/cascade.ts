import { vec } from '../math';
import { makeBox } from '../brush';
import { MapDef, builtin, straightChain, lowestZ } from './build';

// Wide, forgiving ramps with short gaps: a first long run.
const LENGTH = 1500, GAP = 320;
const ramps = straightChain(400, 3000, LENGTH, GAP, 300, [
  { angle: 52, width: 440 },
  { angle: 50, width: 420 },
  { angle: 54, width: 460 },
  { angle: 50, width: 420 },
  { angle: 53, width: 440 },
  { angle: 51, width: 420 },
  { angle: 55, width: 460 },
  { angle: 52, width: 440 },
]);
const endX = 400 + ramps.length * (LENGTH + GAP);
const low = lowestZ(ramps);

export const cascade: MapDef = builtin('cascade', 'Cascade (easy)', 3176, ramps, makeBox(vec(endX - GAP, -1024, low - 316), vec(endX + 1024, 1024, low - 300)));
