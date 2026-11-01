import { describe, it, expect } from 'vitest';
import { vec, cross, normalize, length, angleVectors } from '../src/math';

const close = (a: { x: number; y: number; z: number }, x: number, y: number, z: number) => {
  expect(a.x).toBeCloseTo(x, 6);
  expect(a.y).toBeCloseTo(y, 6);
  expect(a.z).toBeCloseTo(z, 6);
};

describe('math', () => {
  it('angleVectors follows Source convention', () => {
    close(angleVectors(0, 0).forward, 1, 0, 0);
    close(angleVectors(90, 0).forward, 0, 1, 0);
    close(angleVectors(0, 0).right, 0, -1, 0);
  });
  it('normalize', () => {
    close(normalize(vec(0, 0, 0)), 0, 0, 0);
    expect(length(normalize(vec(3, 4, 0)))).toBeCloseTo(1, 9);
  });
  it('cross', () => {
    close(cross(vec(1, 0, 0), vec(0, 1, 0)), 0, 0, 1);
  });
});
