import { describe, it, expect } from 'vitest';
import { newPose, stepPose } from '../src/viewmodelPose';

const run = (frames: number, input: Parameters<typeof stepPose>[1]) => {
  let p = newPose();
  for (let i = 0; i < frames; i++) p = stepPose(p, input, 1 / 60);
  return p;
};

describe('viewmodel pose', () => {
  it('stays still when standing and not turning', () => {
    const p = run(120, { speed: 0, onGround: true, yawDelta: 0, pitchDelta: 0 });
    expect(Math.abs(p.x) + Math.abs(p.y) + Math.abs(p.swayX) + Math.abs(p.swayY)).toBeLessThan(1e-6);
  });
  it('bobs while running on the ground, more at higher speed', () => {
    const amp = (speed: number) => {
      let p = newPose(), max = 0;
      for (let i = 0; i < 120; i++) max = Math.max(max, Math.abs((p = stepPose(p, { speed, onGround: true, yawDelta: 0, pitchDelta: 0 }, 1 / 60)).y));
      return max;
    };
    expect(amp(250)).toBeGreaterThan(amp(100));
    expect(amp(100)).toBeGreaterThan(0);
  });
  it('does not bob in the air (surfing/air strafing)', () => {
    const p = run(60, { speed: 1500, onGround: false, yawDelta: 0, pitchDelta: 0 });
    expect(Math.abs(p.y)).toBeLessThan(1e-3);
  });
  it('sways against a mouse turn and settles back', () => {
    let p = stepPose(newPose(), { speed: 0, onGround: true, yawDelta: 10, pitchDelta: 0 }, 1 / 60);
    expect(p.swayX).not.toBe(0);
    for (let i = 0; i < 120; i++) p = stepPose(p, { speed: 0, onGround: true, yawDelta: 0, pitchDelta: 0 }, 1 / 60);
    expect(Math.abs(p.swayX)).toBeLessThan(1e-3);
  });
});
