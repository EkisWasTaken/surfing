import { vec } from '../math';
import { makeBox, makeRamp } from '../brush';
import { MapDef, THEMES, builtin, lowestZ } from './build';

const h = (width: number, angle: number) => width * Math.tan((angle * Math.PI) / 180);
// A ramp whose slope tops out at `top`.
const ramp = (x: number, y: number, top: number, length: number, width: number, angle: number, side: 'left' | 'right', axis: 'x' | 'y') =>
  makeRamp(vec(x, y, top - h(width, angle)), length, width, h(width, angle), side, axis);

// Two ramps along +X, an air-strafed left turn onto two ramps along +Y, a right turn back to +X.
// Turn ramps sit where a perfect strafe at ~1300 u/s comes out (~880 forward, ~920 across, ~630 down).
const ramps = [
  ramp(400, -150, 3200, 1600, 300, 56, 'left', 'x'),
  ramp(2500, -150, 2800, 1600, 300, 58, 'right', 'x'),
  ramp(4810, 700, 2000, 1800, 340, 57, 'left', 'y'),
  ramp(4810, 3000, 1600, 1600, 340, 60, 'right', 'y'),
  ramp(5700, 5310, 800, 1800, 340, 58, 'right', 'x'),
  ramp(8000, 5310, 400, 1600, 340, 62, 'left', 'x'),
];
const low = lowestZ(ramps);

export const switchback: MapDef = builtin('switchback', 'Switchback (hard)', THEMES.night, 3376, ramps, makeBox(vec(9600, 4800, low - 316), vec(10600, 6200, low - 300)));
