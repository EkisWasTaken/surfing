import { THEMES } from './build';
import { trackMap } from './track';

// The flagship: five stages that build up. Straight ramps to find your speed, then banked curves, S-bends,
// a long hairpin, a fast descent with big gaps, and a finale of two sweeping turns into one last drop.
export const horizon = trackMap('horizon', 'Horizon (medium)', THEMES.aurora, [
  {
    topZ: 7000,
    build: (t) =>
      t.ramp(1700, 420, 52, 'left').gap(420, 300).ramp(1700, 420, 54, 'right').gap(420, 320)
        .arc(2600, 75, 'left', 460, 54).gap(500, 320).ramp(1800, 420, 55, 'left'),
  },
  {
    topZ: 7000,
    build: (t) =>
      t.ramp(1600, 420, 53, 'right').gap(450, 300)
        .arc(2800, 70, 'left', 460, 54).gap(450, 280)
        .arc(2800, 90, 'right', 460, 54).gap(450, 280)
        .arc(2600, 60, 'left', 460, 55).gap(500, 300).ramp(1700, 420, 56, 'right'),
  },
  {
    topZ: 7600,
    build: (t) =>
      t.ramp(1800, 420, 54, 'left').gap(500, 320).ramp(1800, 400, 55, 'right').gap(560, 320).boost(500)
        .arc(3200, 180, 'right', 500, 55).gap(600, 350)
        .ramp(2000, 400, 56, 'left').gap(600, 340).ramp(1800, 380, 57, 'right'),
  },
  {
    topZ: 8200,
    build: (t) =>
      t.ramp(2000, 400, 55, 'right').gap(600, 400).boost(600)
        .ramp(2400, 380, 57, 'left').gap(820, 520).ramp(2200, 360, 58, 'right').gap(760, 470)
        .arc(3600, 90, 'left', 480, 56).gap(650, 380)
        .arc(3600, 90, 'right', 480, 56),
  },
  {
    topZ: 9000,
    build: (t) =>
      t.ramp(1800, 400, 55, 'left').gap(560, 340)
        .arc(3000, 120, 'left', 500, 55).gap(600, 360)
        .arc(3000, 120, 'right', 500, 55).gap(700, 420).boost(700)
        .ramp(2200, 380, 57, 'left').gap(950, 560).ramp(2600, 360, 58, 'right'),
  },
]);
