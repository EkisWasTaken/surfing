import { describe, it, expect } from 'vitest';
import { ghostFromTicks, sampleGhost, encodeGhost, decodeGhost, GHOST_RATE } from '../src/ghost';

// A straight run along x at 100 u/s, recorded every 1/64 s tick for 2 s.
const tickDt = 1 / 64;
const ticks: number[] = [];
for (let i = 0; i <= 128; i++) ticks.push(i * tickDt * 100, 0, 0, 90);

describe('ghost', () => {
  const g = ghostFromTicks(ticks, tickDt)!;
  it('downsamples to the ghost rate and interpolates between samples', () => {
    expect(g.frames.length / 4).toBe(2 * GHOST_RATE + 1);
    expect(sampleGhost(g, 1).pos.x).toBeCloseTo(100, 3);
    expect(sampleGhost(g, 1.01).pos.x).toBeCloseTo(101, 3);
    expect(sampleGhost(g, 0.5).yaw).toBe(90);
  });
  it('waits at the start before the run and stays at the finish after it', () => {
    expect(sampleGhost(g, -1).pos.x).toBe(0);
    expect(sampleGhost(g, 99).pos.x).toBeCloseTo(200, 3);
  });
  it('turns the short way round across ±180° yaw', () => {
    const turn = ghostFromTicks([0, 0, 0, 170, 0, 0, 0, -170], 1 / GHOST_RATE)!;
    expect(Math.abs(sampleGhost(turn, 0.5 / GHOST_RATE).yaw)).toBeCloseTo(180, 3);
  });
  it('survives storage, and refuses runs that are too long to keep', () => {
    expect(Array.from(decodeGhost(encodeGhost(g))!.frames)).toEqual(Array.from(g.frames));
    expect(decodeGhost('garbage')).toBeNull();
    expect(ghostFromTicks(new Array(4 * 64 * 60 * 11).fill(0), tickDt)).toBeNull(); // 11 minutes
  });
});
