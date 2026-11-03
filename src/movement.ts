// Port of Source CGameMovement (FullWalkMove path), with the GoldSrc/CS 1.6 differences behind config switches.
import { Vec3, vec, copy, add, sub, scale, dot, cross, length, normalize, angleVectors } from './math';
import { Brush } from './brush';
import { trace, DIST_EPSILON } from './trace';
import { config } from './config';

// baseVel: velocity from a trigger_push the player is inside (Source's base velocity).
// stamina: CS 1.6 jump penalty in ms (pmove->fuser2), 0 when unused.
export type Player = { pos: Vec3; vel: Vec3; onGround: boolean; ducked: boolean; groundNormal: Vec3 | null; jumpHeld: boolean; baseVel: Vec3; stamina: number };
export type Cmd = { forward: number; side: number; jump: boolean; duck: boolean; walk?: boolean; yaw: number; pitch: number };

const MAX_CLIP_PLANES = 5;
const STAMINA_JUMP = 1315.789429; // CS 1.6 PM_Jump: pmove->fuser2 after a jump (ms)
const staminaRatio = (st: number) => (100 - st * 0.001 * 19) * 0.01;

export const newPlayer = (pos: Vec3): Player => ({ pos: copy(pos), vel: vec(), onGround: false, ducked: false, groundNormal: null, jumpHeld: false, baseVel: vec(), stamina: 0 });

// Really inside geometry, not just touching it: the trace counts exact contact as inside (as Quake/Source do),
// but Source still lets a touching player move away, so stuck checks shrink the hull by a hair.
const TOUCH_TOLERANCE = 0.125;
export function embedded(pos: Vec3, ducked: boolean, brushes: Brush[]): boolean {
  const { mins, maxs } = ducked ? config.hullDuck : config.hullStand;
  const t = vec(TOUCH_TOLERANCE, TOUCH_TOLERANCE, TOUCH_TOLERANCE);
  return trace(pos, pos, add(mins, t), sub(maxs, t), brushes).startSolid;
}

// Spawns and teleport destinations often rest exactly on a floor (or touch a ceiling). A player starting in
// contact can't move, so find the nearest clear spot: up first (Source spawns players 1u above the spot), then down,
// then sideways like CS's stuck check (a destination flush against a full-height wall froze you mid-air).
export function unstick(pos: Vec3, brushes: Brush[]): Vec3 {
  const { mins, maxs } = config.hullStand;
  const clear = (p: Vec3) => !trace(p, p, mins, maxs, brushes).startSolid;
  if (clear(pos)) return pos;
  for (const dir of [1, -1])
    for (let dz = 1; dz <= 72; dz++) {
      const p = add(pos, vec(0, 0, dir * dz));
      if (clear(p)) return p;
    }
  for (let r = 1; r <= 32; r *= 2)
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const p = add(pos, vec(dx * r, dy * r, 0));
      if (clear(p)) return p;
    }
  return pos; // nothing clear nearby: leave it as the map placed it
}

export function clipVelocity(v: Vec3, n: Vec3, overbounce: number): Vec3 {
  let out = sub(v, scale(n, dot(v, n) * overbounce));
  const adjust = dot(out, n);
  if (adjust < 0) out = sub(out, scale(n, adjust));
  return out;
}

type State = Player & { brushes: Brush[]; dt: number };

// CS 1.6 PM_PreventMegaBunnyJumping: above 1.2x maxspeed, a jump crops speed to 65% of that cap.
function preventMegaBunnyJumping(s: State) {
  const cap = 1.2 * config.maxspeed, spd = length(s.vel);
  if (spd > cap) s.vel = scale(s.vel, (cap / spd) * 0.65);
}

const hull = (s: State) => (s.ducked ? config.hullDuck : config.hullStand);
const traceHull = (s: State, from: Vec3, to: Vec3) => trace(from, to, hull(s).mins, hull(s).maxs, s.brushes);

function wish(cmd: Cmd, s: State): { dir: Vec3; speed: number } {
  const { forward, right } = angleVectors(cmd.yaw, 0);
  const max = config.maxspeed * (cmd.walk ? config.walkModifier : 1) * (s.ducked && s.onGround ? config.duckModifier : 1);
  const f = cmd.forward * max, sd = cmd.side * max;
  const v = vec(forward.x * f + right.x * sd, forward.y * f + right.y * sd, 0);
  return { dir: normalize(v), speed: Math.min(length(v), max) };
}

// Called by the game after each tick with the summed velocity of trigger_push volumes touched (null if none).
// Mirrors Source: inside, the push is base velocity; leaving folds it into velocity (with the half-frame bonus).
export function applyPush(p: Player, push: Vec3 | null, dt: number): Player {
  if (push) {
    const lift = push.z > 0 && p.onGround; // CTriggerPush lifts grounded players so the push can take effect
    return { ...p, baseVel: push, onGround: lift ? false : p.onGround, pos: lift ? add(p.pos, vec(0, 0, 1)) : p.pos };
  }
  if (!p.baseVel.x && !p.baseVel.y && !p.baseVel.z) return p;
  return { ...p, vel: add(p.vel, scale(p.baseVel, 1 + dt * 0.5)), baseVel: vec() };
}

function friction(s: State) {
  const speed = length(s.vel);
  if (speed < 0.1) return;
  let fric = config.friction;
  if (config.edgeFriction !== 1) {
    // GoldSrc PM_Friction: trace 34u down from 16u ahead, hull centred at the feet; nothing there = dropoff.
    const h = hull(s).maxs.z;
    const start = add(s.pos, vec((s.vel.x / speed) * 16, (s.vel.y / speed) * 16, -h / 2));
    const tr = traceHull(s, start, sub(start, vec(0, 0, 34)));
    if (!tr.startSolid && tr.fraction === 1) fric *= config.edgeFriction;
  }
  const control = speed < config.stopspeed ? config.stopspeed : speed;
  const newspeed = Math.max(speed - control * fric * s.dt, 0);
  s.vel = scale(s.vel, newspeed / speed);
}

function accelerate(s: State, dir: Vec3, speed: number, accel: number) {
  const add_ = speed - dot(s.vel, dir);
  if (add_ <= 0) return;
  s.vel = add(s.vel, scale(dir, Math.min(accel * s.dt * speed, add_)));
}

function airAccelerate(s: State, dir: Vec3, speed: number) {
  const add_ = Math.min(speed, config.airWishCap) - dot(s.vel, dir);
  if (add_ <= 0) return;
  // Uncapped wishspeed in the accel term, as in Source.
  s.vel = add(s.vel, scale(dir, Math.min(config.airaccelerate * speed * s.dt, add_)));
}

// Source TryPlayerMove: slide along up to 4 surfaces this tick.
function tryPlayerMove(s: State) {
  const primal = copy(s.vel);
  let original = copy(s.vel);
  const planes: Vec3[] = [];
  let timeLeft = s.dt;
  let allFraction = 0;

  for (let bump = 0; bump < 4; bump++) {
    if (length(s.vel) === 0) break;
    const tr = traceHull(s, s.pos, add(s.pos, scale(s.vel, timeLeft)));
    allFraction += tr.fraction;
    // Source zeroes velocity only when the whole move is inside solid; merely starting in contact still slides away.
    if (tr.allSolid) {
      s.vel = vec();
      return;
    }
    // Rampbug fix: float error leaves us closer than DIST_EPSILON to a slope, so every bump
    // hits it at fraction 0 and Source zeroes velocity. Step back out instead.
    if (!config.rampbug && tr.fraction === 0 && tr.normal && tr.normal.z < 0.7) {
      s.pos = add(s.pos, scale(tr.normal, DIST_EPSILON));
    }
    if (tr.fraction > 0) {
      s.pos = tr.endPos;
      original = copy(s.vel);
      planes.length = 0;
    }
    if (tr.fraction === 1) break;
    timeLeft -= timeLeft * tr.fraction;
    if (planes.length >= MAX_CLIP_PLANES) {
      s.vel = vec();
      break;
    }
    // Rampbug fix (Quake 2 PM_StepSlideMove): re-hitting the same plane would make a zero crease
    // vector and kill all speed; nudge velocity out along it instead.
    if (!config.rampbug && planes.some((p) => dot(p, tr.normal!) > 0.99)) {
      s.vel = add(s.vel, tr.normal!);
      continue;
    }
    planes.push(tr.normal!);

    if (planes.length === 1 && !s.onGround) {
      s.vel = clipVelocity(original, planes[0], 1);
      original = copy(s.vel);
    } else {
      let i = 0;
      for (; i < planes.length; i++) {
        s.vel = clipVelocity(original, planes[i], 1);
        let j = 0;
        for (; j < planes.length; j++) if (j !== i && dot(s.vel, planes[j]) < 0) break;
        if (j === planes.length) break;
      }
      if (i === planes.length) {
        if (planes.length !== 2) {
          s.vel = vec();
          break;
        }
        // Slide along the crease between the two planes.
        const dir = normalize(cross(planes[0], planes[1]));
        s.vel = scale(dir, dot(dir, s.vel));
      }
    }
    if (dot(s.vel, primal) <= 0) {
      s.vel = vec();
      break;
    }
  }
  if (allFraction === 0) s.vel = vec();
}

function stayOnGround(s: State) {
  // Source: first see how far up (2u) we can go without getting stuck, then trace down from there.
  const start = traceHull(s, s.pos, add(s.pos, vec(0, 0, 2))).endPos;
  const tr = traceHull(s, start, sub(s.pos, vec(0, 0, config.stepSize)));
  if (tr.fraction > 0 && tr.fraction < 1 && !tr.startSolid && tr.normal!.z >= 0.7) s.pos = tr.endPos;
}

function stepMove(s: State) {
  const pos0 = copy(s.pos), vel0 = copy(s.vel);
  tryPlayerMove(s);
  const downPos = s.pos, downVel = s.vel;

  s.pos = pos0;
  s.vel = vel0;
  s.pos = traceHull(s, s.pos, add(s.pos, vec(0, 0, config.stepSize))).endPos;
  tryPlayerMove(s);
  const tr = traceHull(s, s.pos, sub(s.pos, vec(0, 0, config.stepSize)));
  if (!tr.startSolid) s.pos = tr.endPos;
  const steppedToGround = tr.fraction < 1 && (tr.normal?.z ?? 0) >= 0.7; // no normal: the whole trace was inside something

  const hdist = (p: Vec3) => (p.x - pos0.x) ** 2 + (p.y - pos0.y) ** 2;
  if (!steppedToGround || hdist(downPos) >= hdist(s.pos)) {
    s.pos = downPos;
    s.vel = downVel;
  } else {
    s.vel = vec(s.vel.x, s.vel.y, downVel.z);
  }
}

function walkMove(s: State, cmd: Cmd) {
  if (config.jumpStamina && s.stamina > 0) {
    // CS 1.6 PM_WalkMove: speed held down for a moment after each jump
    const r = staminaRatio(s.stamina);
    s.vel = vec(s.vel.x * r, s.vel.y * r, s.vel.z);
  }
  const w = wish(cmd, s);
  s.vel.z = 0;
  accelerate(s, w.dir, w.speed, config.accelerate);
  s.vel.z = 0;
  s.vel = add(s.vel, s.baseVel); // moves with the push, removed again below
  if (length(s.vel) < 1) {
    s.vel = sub(vec(), s.baseVel); // Source zeroes, then still removes the base velocity
    return;
  }
  const dest = add(s.pos, scale(s.vel, s.dt));
  const tr = traceHull(s, s.pos, dest);
  if (tr.fraction === 1) s.pos = tr.endPos;
  else stepMove(s);
  stayOnGround(s);
  s.vel = sub(s.vel, s.baseVel);
}

function airMove(s: State, cmd: Cmd) {
  const w = wish(cmd, s);
  airAccelerate(s, w.dir, w.speed);
  s.vel = add(s.vel, s.baseVel);
  tryPlayerMove(s);
  s.vel = sub(s.vel, s.baseVel);
}

function categorizePosition(s: State) {
  if (s.vel.z > config.nonJumpVelocity) {
    s.onGround = false;
    s.groundNormal = null;
    return;
  }
  const tr = traceHull(s, s.pos, sub(s.pos, vec(0, 0, 2)));
  const ok = tr.fraction < 1 && !tr.startSolid && tr.normal!.z >= 0.7;
  s.onGround = ok;
  s.groundNormal = ok ? tr.normal : null;
}

// Instant duck (no CS:GO duck-speed transition). In the air the feet pull up so the head stays put.
function duck(s: State, wantDuck: boolean) {
  const lift = vec(0, 0, config.hullStand.maxs.z - config.hullDuck.maxs.z);
  const fits = (pos: Vec3, h: { mins: Vec3; maxs: Vec3 }) => !trace(pos, pos, h.mins, h.maxs, s.brushes).startSolid;
  if (wantDuck && !s.ducked) {
    s.ducked = true;
    if (!s.onGround && fits(add(s.pos, lift), config.hullDuck)) s.pos = add(s.pos, lift);
  } else if (!wantDuck && s.ducked) {
    const candidates = s.onGround ? [s.pos] : [sub(s.pos, lift), s.pos];
    const ok = candidates.find((p) => fits(p, config.hullStand));
    if (ok) {
      s.pos = ok;
      s.ducked = false;
    }
  }
}

function checkVelocity(s: State) {
  const m = config.maxvelocity;
  const c = (v: number) => Math.max(-m, Math.min(m, v));
  s.vel = vec(c(s.vel.x), c(s.vel.y), c(s.vel.z));
}

export function step(p: Player, cmd: Cmd, brushes: Brush[], dt: number): Player {
  const s: State = { ...p, pos: copy(p.pos), vel: copy(p.vel), brushes, dt };
  if (s.stamina > 0) s.stamina = Math.max(0, s.stamina - dt * 1000); // PM_ReduceTimers, per msec

  duck(s, cmd.duck);
  s.vel.z -= config.gravity * 0.5 * dt;
  // StartGravity: vertical base velocity is applied as acceleration, then cleared for this tick.
  s.vel.z += s.baseVel.z * dt;
  s.baseVel = vec(s.baseVel.x, s.baseVel.y, 0);
  // Without autobhop, jump needs a fresh press (Source m_nOldButtons & IN_JUMP check).
  if (cmd.jump && s.onGround && (config.autobhop || !p.jumpHeld)) {
    s.onGround = false;
    if (config.bunnyCap) preventMegaBunnyJumping(s);
    // CS:GO CheckJumpButton overwrites z then calls FinishGravity itself.
    let jump = config.jumpVelocity;
    if (config.jumpStamina) {
      if (s.stamina > 0) jump *= staminaRatio(s.stamina); // CS 1.6: back-to-back jumps are lower
      s.stamina = STAMINA_JUMP;
    }
    s.vel.z = jump - config.gravity * 0.5 * dt;
  }
  if (s.onGround) {
    s.vel.z = 0;
    friction(s);
  }
  checkVelocity(s);
  if (s.onGround) walkMove(s, cmd);
  else airMove(s, cmd);
  categorizePosition(s);
  checkVelocity(s);
  s.vel.z -= config.gravity * 0.5 * dt;
  checkVelocity(s);
  if (s.onGround) s.vel.z = 0;

  return { pos: s.pos, vel: s.vel, onGround: s.onGround, ducked: s.ducked, groundNormal: s.groundNormal, jumpHeld: cmd.jump, baseVel: p.baseVel, stamina: s.stamina };
}
