# Browser Surf Sandbox — Design

## Goal

A browser-playable surf movement sandbox whose movement feels the same as CS:GO surf.
Success = a CS:GO surfer can load it, use their usual sensitivity, and strafe/surf
with no noticeable difference in feel.

**Scope (v1):** one map, ramps, speed meter, respawn. No timer, zones, checkpoints,
multiplayer, sounds, or weapons.

**Boundary:** mechanics are replicated faithfully; content is original. No Valve
assets, branding, sounds, or recreations of specific community maps.

## Stack

Vite + TypeScript + three.js (rendering only). No physics library. Run with `npm run dev`.

## Architecture

```
src/
  config.ts    all movement constants in one exported object
  math.ts      minimal Vec3 helpers (physics does not use three.js types)
  brush.ts     Brush = convex set of planes {normal, dist}; makeBox(), makeRamp()
  trace.ts     trace(start, end, mins, maxs, brushes) -> {fraction, endPos, normal, startSolid}
  movement.ts  pure step(player, input, brushes, dt) -> player
  input.ts     pointer lock, raw mouse yaw/pitch, WASD/space/ctrl -> input command
  map.ts       sandbox map as makeBox()/makeRamp() calls + spawn point
  render.ts    three.js scene: one mesh per brush, camera at player eye
  hud.ts       speed meter + crosshair + "click to play" overlay (DOM)
  main.ts      fixed-tick loop with accumulator, render interpolation, R = respawn
```

- Physics in Source coordinates (Z up, Hammer units). Only `render.ts` converts to three.js axes.
- `trace.ts` is the single collision interface. A future glTF loader decomposes meshes
  into convex brushes; nothing else changes.
- `movement.ts` and `trace.ts` have no browser/three.js dependencies and are tested headless (Vitest).

## Collision

Each brush is a list of planes. A trace expands each plane outward by the player's
AABB extents along the plane normal (Minkowski sum) and clips the start→end segment
against the expanded brush, returning the earliest hit fraction and its plane normal.
`startSolid` is reported when the start point is inside an expanded brush.

## Movement (Source-faithful)

### Constants

| Name | Value |
|---|---|
| tickrate | 64 (128 selectable) |
| sv_gravity | 800 |
| sv_maxspeed | 250 |
| sv_accelerate | 5.5 |
| sv_friction | 5.2 |
| sv_stopspeed | 80 |
| sv_airaccelerate | 150 |
| air wishspeed cap | 30 |
| sv_maxvelocity | 3500 (per axis) |
| jump velocity | sqrt(2 · 800 · 57) ≈ 301.993 |
| hull standing / crouched | 32×32×72 / 32×32×54 |
| step size | 18 |
| eye height standing / crouched | 64 / 46 |
| m_yaw / m_pitch | 0.022 |
| autobhop | true (toggle) |
| rampbug | false (toggle; off = fixed, as on surf servers) |

### Per-tick order

1. Apply half gravity.
2. Ground check: trace 2 units down; grounded only if hit normal.z ≥ 0.7.
3. Grounded: jump if held (autobhop) else friction → accelerate → walk-move with 18-unit step-up.
4. Airborne: air-accelerate (wishspeed capped at 30, add speed only along wish dir,
   max `airaccelerate · wishspeed · dt` per tick) → slide-move (trace, clipVelocity
   with overbounce 1.0, up to 4 bumps, crease handling between two planes).
5. Apply second half gravity; clamp each velocity axis to sv_maxvelocity.

Surf ramps (normal.z < 0.7) are always airborne; surfing emerges from step 4.
Crouch switches hull and eye height; un-crouch only if the standing hull fits.

## Map, visuals, HUD

- Map: spawn platform → drop onto first ramp → 4–5 ramp sections (≈50–60°,
  200–400 u wide) with gaps → landing platform. Falling below a kill height respawns.
- Visuals: grid-textured brushes, simple directional + ambient light, sky gradient.
- Camera: first person; mouse uses m_yaw so CS:GO sensitivity carries over 1:1.
- HUD: large horizontal speed (u/s) bottom centre, crosshair, click-to-play overlay on Esc.

## Error handling

- Pointer lock refused or released → show click-to-play overlay.
- Tab hidden → pause simulation; reset accumulator on return (no catch-up burst).
- Player starts inside a brush (`startSolid`) → respawn.

## Testing (headless, Vitest)

- Ground speed caps at 250 when running on flat ground.
- Jump apex ≈ 57 units above takeoff.
- Sliding down a 45° ramp with no input: speed along the ramp is never lost to clipping.
- Air strafe: holding A with constant yaw turn gains speed per tick matching the
  Source air-accelerate formula.
- Trace: hits on box faces and ramp faces return correct fraction and normal; no
  tunnelling at 3500 u/s.
- Manual: play-test in browser for feel.
