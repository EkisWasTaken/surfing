import { vec } from './math';

// CS:GO defaults + common surf-server settings. Units: Hammer units, seconds.
export const config = {
  tickrate: 64,
  gravity: 800,
  maxspeed: 250,
  accelerate: 5.5,
  friction: 5.2,
  stopspeed: 80,
  airaccelerate: 150,
  airWishCap: 30,
  maxvelocity: 3500,
  jumpVelocity: Math.sqrt(2 * 800 * 57), // ≈ 301.993
  hullStand: { mins: vec(-16, -16, 0), maxs: vec(16, 16, 72) },
  hullDuck: { mins: vec(-16, -16, 0), maxs: vec(16, 16, 54) },
  stepSize: 18,
  eyeStand: 64,
  eyeDuck: 46,
  mYaw: 0.022,
  mPitch: 0.022,
  sensitivity: 2,
  autobhop: true,
  rampbug: false,
};
