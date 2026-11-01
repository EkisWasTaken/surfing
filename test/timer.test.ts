import { describe, it, expect } from 'vitest';
import { newRun, tickRun, formatTime } from '../src/timer';

const dt = 1 / 64;

describe('run timer', () => {
  it('waits in the start zone, runs after leaving, stops in the end zone', () => {
    let r = newRun();
    r = tickRun(r, true, false, dt);
    expect(r).toEqual({ phase: 'ready', time: 0 });
    for (let i = 0; i < 64; i++) r = tickRun(r, false, false, dt);
    expect(r.phase).toBe('running');
    expect(r.time).toBeCloseTo(1, 9);
    r = tickRun(r, false, true, dt);
    expect(r.phase).toBe('finished');
    expect(r.time).toBeCloseTo(1 + dt, 9);
    expect(tickRun(r, false, false, dt)).toBe(r); // frozen once finished
  });
  it('re-entering the start zone resets the run', () => {
    let r = tickRun(tickRun(newRun(), false, false, dt), false, false, dt);
    r = tickRun(r, true, false, dt);
    expect(r).toEqual({ phase: 'ready', time: 0 });
  });
  it('formats m:ss.mmm', () => {
    expect(formatTime(0)).toBe('0:00.000');
    expect(formatTime(65.4321)).toBe('1:05.432');
  });
});
