import { describe, it, expect } from 'vitest';
import { fitOffset } from '../src/hud';

const place = (x: number, y: number, left = 100 + x, top = 100 + y) => ({ left, top, width: 200, height: 100 });

describe('dragging a window', () => {
  it('moves freely on screen', () => {
    expect(fitOffset(0, 0, { x: 50, y: -30 }, place(0, 0), 800, 600)).toEqual({ x: 50, y: -30 });
  });
  it('stops at every edge, from wherever it already is', () => {
    expect(fitOffset(0, 0, { x: -500, y: -500 }, place(0, 0), 800, 600)).toEqual({ x: -100, y: -100 });
    expect(fitOffset(40, 40, { x: 5000, y: 5000 }, place(40, 40), 800, 600)).toEqual({ x: 500, y: 400 });
  });
  it('comes back on screen when the browser shrinks', () => {
    expect(fitOffset(500, 400, { x: 500, y: 400 }, place(500, 400), 400, 300)).toEqual({ x: 100, y: 100 });
  });
  it('a window taller than the screen moves sideways only', () => {
    expect(fitOffset(0, 20, { x: 30, y: 90 }, { left: 100, top: 20, width: 200, height: 900 }, 800, 600)).toEqual({ x: 30, y: 0 });
  });
});
