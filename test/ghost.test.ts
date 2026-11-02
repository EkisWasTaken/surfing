import { describe, it, expect } from 'vitest';
import { ghostFromTicks, sampleGhost, encodeGhost, decodeGhost, GHOST_RATE, encodeShare, decodeShare } from '../src/ghost';

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

describe('share codes', () => {
  const frames = new Float32Array(32 * 20 * 4);
  for (let i = 0; i < 32 * 20; i++) frames.set([i * 10 - 3000, Math.sin(i / 20) * 500, 2000 - i * 3, 0], i * 4);
  it('round-trips a run closely, at a size people can send', async () => {
    const code = await encodeShare({ map: 'warmup', track: 'csgo', name: 'Sam', time: 19.5, ghost: { frames } });
    expect(code.startsWith('surf1.')).toBe(true);
    expect(code.length).toBeLessThan(4000);
    const s = (await decodeShare(code))!;
    expect(s).toMatchObject({ map: 'warmup', track: 'csgo', name: 'Sam', time: 19.5 });
    const a = sampleGhost({ frames }, 10), b = sampleGhost(s.ghost, 10);
    expect(Math.abs(a.pos.x - b.pos.x)).toBeLessThan(25);
    expect(Math.abs(a.pos.z - b.pos.z)).toBeLessThan(15);
  });
  it('rejects junk', async () => {
    expect(await decodeShare('hello')).toBeNull();
    expect(await decodeShare('surf1.!!!')).toBeNull();
    expect(await decodeShare('surf1.' + btoa('{"m":"a","t":"b","n":"c","s":-1,"g":""}'))).toBeNull();
  });
});
