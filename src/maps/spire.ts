import { vec } from '../math';
import { makeBox } from '../brush';
import { MapDef, straightChain, startPlatform, lowestZ } from './build';

// Steep, narrow ramps with long gaps and big drops: lose strafe sync and you fall.
const LENGTH = 1600, GAP = 640;
const ramps = straightChain(400, 4000, LENGTH, GAP, 520, [
  { angle: 62, width: 220 },
  { angle: 65, width: 200 },
  { angle: 63, width: 240 },
  { angle: 67, width: 190 },
  { angle: 64, width: 210 },
  { angle: 68, width: 180 },
  { angle: 66, width: 200 },
]);
const endX = 400 + ramps.length * (LENGTH + GAP);
const low = lowestZ(ramps);

export const spire: MapDef = {
  id: 'spire',
  name: 'Spire (hard)',
  brushes: [startPlatform(4176), ...ramps, makeBox(vec(endX - GAP, -512, low - 316), vec(endX + 512, 512, low - 300))],
  spawn: vec(0, 0, 4177),
  spawnYaw: 0,
  killZ: low - 800,
};
