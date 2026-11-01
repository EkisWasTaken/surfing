import { describe, it, expect } from 'vitest';
import { vec } from '../src/math';
import { makeRamp } from '../src/brush';
import { rampGeometry } from '../src/render';

describe('rampGeometry', () => {
  it.each([
    ['left', 'x'],
    ['right', 'x'],
    ['left', 'y'],
    ['right', 'y'],
  ] as const)('%s ramp along %s winds outward', (side, axis) => {
    const pos = rampGeometry(makeRamp(vec(0, 0, 0), 512, 256, 300, side, axis)).getAttribute('position');
    const pts = Array.from({ length: pos.count }, (_, i) => [pos.getX(i), pos.getY(i), pos.getZ(i)]);
    const center = [0, 1, 2].map((k) => pts.reduce((s, p) => s + p[k], 0) / pts.length);
    for (let i = 0; i < pts.length; i += 3) {
      const [a, b, c] = pts.slice(i, i + 3);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const out = [0, 1, 2].map((k) => (a[k] + b[k] + c[k]) / 3 - center[k]);
      expect(n[0] * out[0] + n[1] * out[1] + n[2] * out[2]).toBeGreaterThan(0);
    }
  });
});
