import { vec } from './math';
import { Brush, makeBox, makeRamp } from './brush';

// Original sandbox layout: start platform, five alternating ramps stepping down along +X, landing pad.
const RAMP_LENGTH = 1800;
const GAP = 400;
const DROP = 500;
const sections: { angle: number; width: number }[] = [
  { angle: 55, width: 320 },
  { angle: 52, width: 300 },
  { angle: 58, width: 360 },
  { angle: 50, width: 280 },
  { angle: 60, width: 400 },
];

const ramps: Brush[] = sections.map(({ angle, width }, i) => {
  const left = i % 2 === 0;
  const height = width * Math.tan((angle * Math.PI) / 180);
  // Left ramps sit around y=0 and push riders toward +Y onto the next (right) ramp, and back.
  const y = left ? -width / 2 : 260;
  return makeRamp(vec(400 + i * (RAMP_LENGTH + GAP), y, 2400 - i * DROP - height), RAMP_LENGTH, width, height, left ? 'left' : 'right');
});

const endX = 400 + sections.length * (RAMP_LENGTH + GAP);
const lowest = Math.min(...ramps.map((r) => r.mins.z));

export const brushes: Brush[] = [
  makeBox(vec(-256, -256, 2560), vec(256, 256, 2576)), // start platform
  ...ramps,
  makeBox(vec(endX - GAP, -1024, lowest - 300), vec(endX + 1024, 1024, lowest - 284)), // landing pad
];

export const spawn = vec(0, 0, 2577);
export const killZ = lowest - 800;
