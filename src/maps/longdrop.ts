import { vec } from '../math';
import { makeBox } from '../brush';
import { MapDef, builtin, straightChain, lowestZ } from './build';

// Long gaps and big drops between medium ramps: hold your speed through the air.
const LENGTH = 1400, GAP = 560;
const ramps = straightChain(400, 4400, LENGTH, GAP, 460, [
  { angle: 58, width: 320 },
  { angle: 56, width: 300 },
  { angle: 60, width: 320 },
  { angle: 57, width: 280 },
  { angle: 59, width: 300 },
  { angle: 61, width: 320 },
]);
const endX = 400 + ramps.length * (LENGTH + GAP);
const low = lowestZ(ramps);

export const longdrop: MapDef = builtin('longdrop', 'Long Drop (medium)', 4576, ramps, makeBox(vec(endX - GAP, -768, low - 316), vec(endX + 768, 768, low - 300)));
