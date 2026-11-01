# Browser Surf Sandbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser surf sandbox whose movement matches CS:GO surf (Source movement, 64 tick).

**Architecture:** Pure-TS physics core (`brush`, `trace`, `movement`) in Source coordinates (Z up, Hammer units) with no browser deps, tested headless. A thin browser shell (`input`, `render`, `hud`, `main`) drives it with a fixed-tick accumulator and renders via three.js.

**Tech Stack:** Vite, TypeScript (strict), three.js, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-01-surf-sandbox-design.md`

## Global Constraints

- All movement constants live in `src/config.ts` with the spec's exact values (sv_gravity 800, sv_maxspeed 250, sv_accelerate 5.5, sv_friction 5.2, sv_stopspeed 80, sv_airaccelerate 150, air wishspeed cap 30, sv_maxvelocity 3500, jump 301.993, hull 32×32×72 / 32×32×54, step 18, eye 64 / 46, m_yaw/m_pitch 0.022, tickrate 64, autobhop true, rampbug false).
- Physics files (`math`, `brush`, `trace`, `movement`, `map`) must not import three.js or touch `window`/`document`.
- Only `render.ts` converts Source coords (x fwd, y left, z up) to three.js (x, y up, z): `three = (x, z, -y)`.
- No Valve assets, branding, sounds, or recreated community maps.
- No dependencies beyond `three`, `@types/three`, `vite`, `typescript`, `vitest`.

## Review Focus

1. **Slow frame / tab-switch spike** → accumulator must cap at 0.25 s (max 16 ticks per frame) so the game never freezes in a catch-up spiral. Test in Task 5.
2. **Two ramp brushes touching edge-to-edge (ramp seam)** → sliding across the seam keeps speed (the rampbug-fixed behaviour). Test in Task 4.
3. **Un-crouching under a low ceiling** → stays crouched instead of getting stuck in geometry. Test in Task 4.
4. **Mouse delta spikes** (some browsers report huge `movementX` after pointer lock engages) → ignore the first mouse event after lock, and discard any single delta > 500 px. Test in Task 5.
5. **Moving at 3500 u/s into a thin (16 u) wall** → no tunnelling. Test in Task 2.

---

### Task 1: Scaffold, config, vector math

**Files:**
- Create: `package.json`, `tsconfig.json`, `index.html`, `vite.config.ts`
- Create: `src/config.ts`, `src/math.ts`
- Test: `test/math.test.ts`

**Interfaces:**
- Produces:
  - `type Vec3 = { x: number; y: number; z: number }`
  - `vec(x,y,z): Vec3`, `add(a,b)`, `sub(a,b)`, `scale(a,s)`, `dot(a,b): number`, `cross(a,b)`, `length(a): number`, `normalize(a): Vec3` (zero vector stays zero), `copy(a)`. All return new objects.
  - `angleVectors(yawDeg, pitchDeg): { forward: Vec3; right: Vec3 }`, Source convention (yaw 0 = +X, yaw 90 = +Y, positive pitch looks down).
  - `export const config = { tickrate, gravity, maxspeed, accelerate, friction, stopspeed, airaccelerate, airWishCap, maxvelocity, jumpVelocity, hullStand: {mins, maxs}, hullDuck: {mins, maxs}, stepSize, eyeStand, eyeDuck, mYaw, mPitch, sensitivity, autobhop, rampbug }`. Hull stand `mins (-16,-16,0) maxs (16,16,72)`, duck `maxs z 54`. `sensitivity` default 2.

- [ ] **Step 1: Scaffold.** `npm create vite@latest . -- --template vanilla-ts`, then `npm i three` and `npm i -D @types/three vitest`. Add `"test": "vitest run"` to scripts. Delete the template's demo files.
- [ ] **Step 2: Write failing tests** in `test/math.test.ts`:
  - `angleVectors(0,0).forward ≈ (1,0,0)`, `angleVectors(90,0).forward ≈ (0,1,0)`, `angleVectors(0,0).right ≈ (0,-1,0)`
  - `normalize(vec(0,0,0))` equals `(0,0,0)`. `length(normalize(vec(3,4,0))) ≈ 1`
  - `cross(vec(1,0,0), vec(0,1,0))` equals `(0,0,1)`
- [ ] **Step 3: Run** `npm test`. Expected: FAIL (module not found).
- [ ] **Step 4: Implement** `src/math.ts` and `src/config.ts` with the values in Global Constraints.
- [ ] **Step 5: Run** `npm test`. Expected: PASS. `npx tsc --noEmit` is clean.
- [ ] **Step 6: Commit** `git init` (first task only), then `git add -A && git commit -m "feat: scaffold, config, vector math"`

---

### Task 2: Brushes and trace

**Files:**
- Create: `src/brush.ts`, `src/trace.ts`
- Test: `test/trace.test.ts`

**Interfaces:**
- Consumes: `Vec3` and helpers from `math.ts`.
- Produces:
  - `type Plane = { normal: Vec3; dist: number }` (point p is inside when `dot(normal,p) - dist <= 0` for every plane)
  - `type Brush = { planes: Plane[]; mins: Vec3; maxs: Vec3 }` (mins/maxs = AABB, used by render and for early-out)
  - `makeBox(mins: Vec3, maxs: Vec3): Brush`: 6 axis planes
  - `makeRamp(origin: Vec3, length: number, width: number, height: number, side: 'left' | 'right'): Brush`: a triangular prism running along +X from `origin` for `length`. Cross-section in YZ is a right triangle of base `width` and `height`, with the slope facing `side` (`left` = slope normal has +Y component). 5 planes. Slope angle = atan(height/width).
  - `type TraceResult = { fraction: number; endPos: Vec3; normal: Vec3 | null; startSolid: boolean }`
  - `trace(start: Vec3, end: Vec3, mins: Vec3, maxs: Vec3, brushes: Brush[]): TraceResult`

- [ ] **Step 1: Write failing tests:**
  - Box `(-100,-100,-16)-(100,100,0)`, stand hull, trace from `(0,0,50)` to `(0,0,-50)`: `fraction ≈ 50/100` (minus epsilon), `normal ≈ (0,0,1)`, `endPos.z ≈ 0`
  - Same box, trace from `(0,0,50)` to `(0,0,10)`: `fraction === 1`, `normal === null`
  - Start inside the box: `startSolid === true`
  - `makeRamp(vec(0,0,0), 512, 256, 256, 'left')`: slope normal ≈ `(0, 0.7071, 0.7071)`. A downward trace onto the slope's midpoint hits with that normal.
  - Review Focus 5: wall `makeBox((100,-500,0),(116,500,200))`, trace from `(0,0,10)` moving +X by `3500/64` per tick for 10 ticks. One of them hits with `normal ≈ (-1,0,0)`, and no `endPos.x` ever exceeds `100 - 16`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.** For each brush: expand each plane by the hull, `dist' = dist + dot(|normal|, hullExtentTowardPlane)`, using `offset = (n.x<0 ? maxs.x : mins.x, …)` the Quake way, so `dist' = dist - dot(n, offset)`. Clip the segment by Quake `CM_ClipBoxToBrush`: track `enterFrac`/`leaveFrac`, back off by `DIST_EPSILON = 0.03125`, and record the plane at the latest entry. Keep the minimum fraction over all brushes.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: convex brushes and box trace"`

---

### Task 3: Ground movement

**Files:**
- Create: `src/movement.ts`
- Test: `test/movement.ground.test.ts`

**Interfaces:**
- Consumes: `trace`, `Brush`, `config`, math helpers.
- Produces:
  - `type Player = { pos: Vec3; vel: Vec3; onGround: boolean; ducked: boolean; groundNormal: Vec3 | null }`
  - `type Cmd = { forward: number; side: number; jump: boolean; duck: boolean; yaw: number; pitch: number }`. forward/side are in `[-1,1]` and scaled internally by `maxspeed`.
  - `step(p: Player, cmd: Cmd, brushes: Brush[], dt: number): Player`: returns a new Player and never mutates its input.
  - `newPlayer(pos: Vec3): Player`
  - Exported for tests: `clipVelocity(v: Vec3, n: Vec3, overbounce: number): Vec3`

Per-tick order exactly as the spec's "Per-tick order". This task implements steps 1–3 and 5. Air (step 4) is just `pos += vel*dt` via trace, filled in properly by Task 4. Wish direction = forward/right from `angleVectors(yaw, 0)` with z zeroed and renormalized. Friction, Accelerate and WalkMove follow Source `CGameMovement` semantics. The step-up tries the move raised by `stepSize` and keeps whichever result went further horizontally.

- [ ] **Step 1: Write failing tests** (flat floor `makeBox((-5000,-5000,-16),(5000,5000,0))`, dt = 1/64):
  - `ground speed caps at 250`: forward=1 for 200 ticks. Horizontal speed ≈ 250 (±0.5).
  - `friction stops player`: start at vel (250,0,0) with no input. Below 1 u/s within 64 ticks.
  - `jump apex ≈ 57`: with autobhop, jump held for 1 tick from rest. The max z over the next 64 ticks is in `[56, 58]`.
  - `autobhop`: holding jump with forward=0 and a start vel of (300,0,0) never applies friction across 3 landings. Speed stays ≥ 299.
  - `step up 18`: a box 16 high in the path is climbed. A box 20 high blocks.
  - `ground only on normal.z ≥ 0.7`: standing on a 45° ramp → `onGround === false`. On a 30° slope → `true`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** ground check (trace 2 u down), friction, accelerate, walkMove with step-up, jump, half-gravity before/after, and the per-axis maxvelocity clamp.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: source ground movement"`

---

### Task 4: Air movement, surfing, crouch

**Files:**
- Modify: `src/movement.ts`
- Test: `test/movement.air.test.ts`

**Interfaces:**
- Consumes/Produces: same `step` and `Player` as Task 3. No signature changes.

AirAccelerate: `wishspd = min(wishspeed, airWishCap)`, `addspeed = wishspd - dot(vel, wishdir)`, and if it's positive add `min(airaccelerate * wishspeed * dt, addspeed)` along wishdir (note: uncapped `wishspeed` in the accel term, as in Source). SlideMove = Source `TryPlayerMove`: up to 4 bumps and up to 5 clip planes, using `clipVelocity` with overbounce 1.0. If two planes are hit, move along their crease (`cross(n1, n2)`). If blocked by three, zero the velocity. If `config.rampbug` is false: when a bump returns `fraction === 0` while sliding on a plane with `normal.z < 0.7`, retry from `pos` nudged `0.03125` along that plane's normal instead of zeroing velocity. Duck: switching to duck shrinks the hull at once. Un-duck only if a trace of the stand hull at the current position is not `startSolid`.

- [ ] **Step 1: Write failing tests:**
  - `air strafe gain`: airborne (no floor) at vel (300,0,0), side=-1 (strafe left), yaw rotating left at `ω` per tick where `ω` keeps wishdir ≈ 90° to vel. After 1 tick, horizontal speed matches `sqrt(300² + 30²)` within 0.01 (the 30-cap gain).
  - `no gain straight ahead`: forward=1 at speed 300 in the air. Speed stays 300 (gravity is vertical only).
  - `surf keeps speed`: on `makeRamp(..., 'left')` at 45°, start on the slope with vel (1000,0,0) and no input for 128 ticks. Horizontal X speed never drops (gravity adds a downhill +Y slide). `onGround` stays false the whole time.
  - Review Focus 2, `ramp seam`: two ramps butted end to end along X (same angle). Sliding across the seam at 1500 u/s loses < 1 u/s of X speed.
  - `maxvelocity clamp`: vel (5000,0,0) → x clamped to 3500 after one step.
  - Review Focus 3, `uncrouch blocked`: crouched under a ceiling at z=60 with duck released. Stays `ducked === true`.
  - `crouch fits under 54`: walking crouched into a 60-high gap succeeds. Standing does not.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** airAccelerate, slideMove/clipVelocity with the crease and rampbug-fix logic, and the duck hull switch.
- [ ] **Step 4: Run** `npm test`. Expected: PASS (Task 3 tests still green).
- [ ] **Step 5: Commit** `git commit -am "feat: air movement, surf, crouch"`

---

### Task 5: Map, input, render, HUD, game loop

**Files:**
- Create: `src/map.ts`, `src/input.ts`, `src/render.ts`, `src/hud.ts`, `src/loop.ts`, `src/main.ts`
- Modify: `index.html` (canvas + HUD container), `src/style.css`
- Test: `test/map.test.ts`, `test/loop.test.ts`, `test/input.test.ts`

**Interfaces:**
- Consumes: `step`, `newPlayer`, `Player`, `Cmd`, `trace`, `makeBox`, `makeRamp`, `config`.
- Produces:
  - `map.ts`: `export const brushes: Brush[]; export const spawn: Vec3; export const killZ: number`. Spawn platform → drop to the first ramp → 5 ramp sections alternating left/right, 50–60°, 200–400 u wide, with gaps → landing platform. `killZ` is 500 below the lowest brush.
  - `loop.ts`: `createAccumulator(tickDt: number): { advance(frameDt: number): number /* ticks to run, frameDt clamped to 0.25 */; alpha(): number /* 0..1 interpolation */; reset(): void }`
  - `input.ts`: `mouseFilter(): (dx: number, dy: number) => [number, number]` (drops the first event after lock and any |delta| > 500). `createInput(canvas): { cmd(): Cmd; locked(): boolean; onLockChange(cb) }`. yaw −= dx·sensitivity·mYaw, pitch += dy·sensitivity·mPitch, clamped to ±89. Keys: WASD, Space, Ctrl/C duck, R respawn.
  - `render.ts`: `createRenderer(canvas, brushes): { draw(eye: Vec3, yaw: number, pitch: number): void; resize(): void }`. One mesh per brush built from its planes (box → BoxGeometry, ramp → triangular prism), grid texture generated on a canvas, hemisphere + directional light, sky gradient background. Source→three axis conversion happens only here.
  - `hud.ts`: `createHud(root): { setSpeed(uPerSec: number): void; showOverlay(show: boolean): void }`. Horizontal speed shown as an integer.
  - `main.ts`: wires it all together. Each frame: `ticks = acc.advance(dt)`, run `step` that many times, interpolate the eye between the previous and current player positions with `alpha()`, then draw. Respawn when `pos.z < killZ`, on R, or when `trace(pos,pos,hull).startSolid`. On `visibilitychange` → hidden, pause and `acc.reset()`.

- [ ] **Step 1: Write failing tests:**
  - `map.test.ts`: the spawn hull is not `startSolid`. A player at spawn with no input lands (`onGround`) within 128 ticks. Every ramp slope normal has `z < 0.7`.
  - `loop.test.ts` (Review Focus 1): `advance(5)` at tickDt 1/64 returns 16. `advance(1/64)` returns 1. After `reset()`, `alpha()` is 0.
  - `input.test.ts` (Review Focus 4): `mouseFilter()`: first call → `[0,0]`, then `(10,0)` → `[10,0]`, then `(900,0)` → `[0,0]`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** all six files.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Manual play-test.** `npm run dev`, open it in a browser, click to lock the mouse. Check: walk speed shows 250. Dropping onto the first ramp and holding A/D toward the ramp keeps you surfing. Strafe-syncing in the air gains speed. Falling off respawns. Esc shows the overlay. The view is smooth on a 144 Hz monitor.
- [ ] **Step 6: Commit** `git add -A && git commit -m "feat: sandbox map, input, render, HUD, loop"`
