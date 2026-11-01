import { vec } from './math';

export type GameMode = 'csgo' | 'cs16';

// CS:GO defaults + common surf-server settings. Units: Hammer units, seconds.
export const config = {
  mode: 'csgo' as GameMode,
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
  nonJumpVelocity: 140, // rising faster than this never counts as on ground
  walkModifier: 0.52,
  duckModifier: 0.34,
  edgeFriction: 1, // GoldSrc doubles friction with a drop just ahead; Source has no edge friction
  jumpStamina: false, // CS 1.6: lower jumps and slowdown right after jumping (pmove fuser2)
  bunnyCap: false, // CS 1.6 PM_PreventMegaBunnyJumping: jumping above 1.2x maxspeed cuts speed
  teleportKeepsVelocity: true, // Source trigger_teleport keeps velocity (its "BUGBUG"); Half-Life zeroes it
};

// Movement values per game. CS:GO: engine defaults with surf-server airaccelerate.
// CS 1.6: GoldSrc/cstrike pm_shared defaults, with the usual 1.6 surf server airaccelerate, run at fps_max 100.
const MODES: Record<GameMode, Partial<typeof config>> = {
  csgo: {
    accelerate: 5.5, friction: 5.2, stopspeed: 80, airaccelerate: 150, maxvelocity: 3500,
    jumpVelocity: Math.sqrt(2 * 800 * 57),
    hullDuck: { mins: vec(-16, -16, 0), maxs: vec(16, 16, 54) },
    eyeStand: 64, eyeDuck: 46, nonJumpVelocity: 140, walkModifier: 0.52, duckModifier: 0.34,
    edgeFriction: 1, jumpStamina: false, bunnyCap: false, teleportKeepsVelocity: true,
  },
  cs16: {
    accelerate: 5, friction: 4, stopspeed: 75, airaccelerate: 100, maxvelocity: 2000,
    jumpVelocity: Math.sqrt(2 * 800 * 45), // ≈ 268.3
    hullDuck: { mins: vec(-16, -16, 0), maxs: vec(16, 16, 36) },
    eyeStand: 36 + 17, eyeDuck: 18 + 12, // VEC_VIEW / VEC_DUCK_VIEW above the hull centre
    nonJumpVelocity: 180, walkModifier: 0.52, duckModifier: 0.333,
    edgeFriction: 2, jumpStamina: true, bunnyCap: true, teleportKeepsVelocity: false,
  },
};

// The game's movement rules; tick rate is the caller's (CS 1.6 movement runs per frame at 100 fps).
export function setGameMode(mode: GameMode) {
  Object.assign(config, MODES[mode], { mode });
}
