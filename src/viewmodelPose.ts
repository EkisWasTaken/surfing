// First-person knife motion: walk bob (ground only, scaled by speed) and sway that lags behind mouse turns.
// Offsets are in viewmodel-camera units (roughly metres at arm's length).
export type Pose = { phase: number; bobAmp: number; x: number; y: number; swayX: number; swayY: number };
export type PoseInput = { speed: number; onGround: boolean; yawDelta: number; pitchDelta: number }; // deltas in degrees this frame

export const newPose = (): Pose => ({ phase: 0, bobAmp: 0, x: 0, y: 0, swayX: 0, swayY: 0 });

const ease = (from: number, to: number, rate: number, dt: number) => from + (to - from) * Math.min(1, rate * dt);
const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));

export function stepPose(p: Pose, i: PoseInput, dt: number): Pose {
  const run = Math.min(i.speed / 250, 1.2);
  const bobAmp = ease(p.bobAmp, i.onGround ? run * 0.012 : 0, 8, dt);
  const phase = p.phase + dt * Math.PI * 2 * 1.8 * run;
  return {
    phase,
    bobAmp,
    x: Math.sin(phase) * bobAmp,
    y: -Math.abs(Math.cos(phase)) * bobAmp + (bobAmp ? bobAmp * 0.5 : 0),
    // Turning right (negative yaw delta) swings the knife left, then it springs back.
    swayX: ease(p.swayX, clamp(i.yawDelta * 0.0012, 0.035), 10, dt),
    swayY: ease(p.swayY, clamp(i.pitchDelta * 0.0012, 0.025), 10, dt),
  };
}
