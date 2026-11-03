import { describe, it, expect } from 'vitest';
import { mapColours, scoreView } from '../src/mapPictures';

const image = (f: (i: number) => number) => {
  const p = new Uint8Array(400 * 4);
  for (let i = 0; i < 400; i++) { const v = f(i); p.set([v, v, v, 255], i * 4); }
  return p;
};

describe('map picker pictures', () => {
  it('gives each map its own lasting colours', () => {
    expect(mapColours('surf_void')).toBe(mapColours('surf_void'));
    expect(mapColours('surf_void')).not.toBe(mapColours('surf_lux'));
    const hues = new Set(['surf_3', 'surf_lux', 'surf_void', 'surf_orion', 'surf_deoa', 'surf_mom_fix'].map(mapColours));
    expect(hues.size).toBe(6);
  });
  it('prefers a view with something in it over a flat wall, black or glare', () => {
    const detail = scoreView(image((i) => 60 + ((i * 37) % 120)));
    expect(detail).toBeGreaterThan(scoreView(image(() => 120))); // a plain wall
    expect(detail).toBeGreaterThan(scoreView(image(() => 0))); // black
    expect(detail).toBeGreaterThan(scoreView(image(() => 255))); // blown out
    expect(detail).toBeGreaterThan(scoreView(image((i) => (i % 2 ? 2 : 8)))); // nearly black, however detailed
  });
});
