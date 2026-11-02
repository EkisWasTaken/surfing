import { vec } from '../math';
import { makeBox, makeRamp } from '../brush';
import { MapDef, builtin, lowestZ } from './build';

const h = (width: number, angle: number) => width * Math.tan((angle * Math.PI) / 180);
// A ramp whose slope tops out at `top`.
const ramp = (x: number, y: number, top: number, length: number, width: number, angle: number, side: 'left' | 'right', axis: 'x' | 'y') =>
  makeRamp(vec(x, y, top - h(width, angle)), length, width, h(width, angle), side, axis);

// Three ramps along +X, an air-strafed left turn onto two ramps along +Y, a right turn back to +X.
const ramps = [
  ramp(400, -160, 3600, 1600, 320, 55, 'right', 'x'),
  ramp(2500, -160, 3200, 1600, 320, 57, 'left', 'x'),
  ramp(4600, -160, 2800, 1600, 320, 58, 'right', 'x'),
  ramp(6910, 700, 2000, 1800, 340, 57, 'left', 'y'),
  ramp(6910, 3000, 1600, 1600, 340, 60, 'right', 'y'),
  ramp(7800, 5310, 800, 1800, 340, 58, 'right', 'x'),
  ramp(10100, 5310, 400, 1600, 340, 62, 'left', 'x'),
];
const low = lowestZ(ramps);

export const hairpin: MapDef = builtin('hairpin', 'Hairpin (hard)', 3776, ramps, makeBox(vec(11700, 4800, low - 316), vec(12700, 6200, low - 300)));
