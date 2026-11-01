import { describe, it, expect } from 'vitest';
import { createAccumulator } from '../src/loop';
import { mouseFilter } from '../src/input';

describe('accumulator', () => {
  it('caps a long frame at 16 ticks', () => {
    expect(createAccumulator(1 / 64).advance(5)).toBe(16);
  });
  it('runs one tick per tick-length frame', () => {
    expect(createAccumulator(1 / 64).advance(1 / 64)).toBe(1);
  });
  it('reset clears interpolation', () => {
    const acc = createAccumulator(1 / 64);
    acc.advance(0.01);
    acc.reset();
    expect(acc.alpha()).toBe(0);
  });
});

describe('mouseFilter', () => {
  it('drops the first event and spikes', () => {
    const f = mouseFilter();
    expect(f(40, 40)).toEqual([0, 0]);
    expect(f(10, 0)).toEqual([10, 0]);
    expect(f(900, 0)).toEqual([0, 0]);
  });
});
