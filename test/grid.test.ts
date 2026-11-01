import { describe, it, expect } from 'vitest';
import { createGrid } from '../src/grid';
import { makeBox } from '../src/brush';
import { vec } from '../src/math';

describe('grid', () => {
  const near = makeBox(vec(0, 0, 0), vec(100, 100, 100));
  const far = makeBox(vec(20000, 20000, 0), vec(20100, 20100, 100));
  const huge = makeBox(vec(-1e6, -1e6, -1e6), vec(1e6, 1e6, -1e6 + 10)); // e.g. a skybox wall
  const grid = createGrid([near, far, huge]);

  it('returns brushes overlapping the query box and skips far ones', () => {
    const got = grid.query(vec(-50, -50, -50), vec(50, 50, 50));
    expect(got).toContain(near);
    expect(got).not.toContain(far);
  });
  it('always includes brushes too big to bucket', () => {
    expect(grid.query(vec(20000, 20000, 0), vec(20050, 20050, 50))).toContain(huge);
  });
  it('returns each brush once', () => {
    const got = grid.query(vec(-5000, -5000, -5000), vec(5000, 5000, 5000));
    expect(got.filter((b) => b === near)).toHaveLength(1);
  });
});
