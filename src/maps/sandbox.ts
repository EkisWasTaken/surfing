import { vec } from '../math';
import { makeBox } from '../brush';
import { MapDef, builtin, straightChain, lowestZ } from './build';

const LENGTH = 1800, GAP = 400;
const ramps = straightChain(400, 2400, LENGTH, GAP, 400, [
  { angle: 55, width: 320 },
  { angle: 52, width: 300 },
  { angle: 58, width: 360 },
  { angle: 50, width: 280 },
  { angle: 60, width: 400 },
]);
const endX = 400 + ramps.length * (LENGTH + GAP);
const low = lowestZ(ramps);

export const sandbox: MapDef = builtin('sandbox', 'Sandbox (easy)', 2576, ramps, makeBox(vec(endX - GAP, -1024, low - 316), vec(endX + 1024, 1024, low - 300)));
