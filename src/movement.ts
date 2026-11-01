// Port of Source CGameMovement (FullWalkMove path) with CS:GO values from config.
import { Vec3, vec, copy, add, sub, scale, dot, cross, length, normalize, angleVectors } from './math';
import { Brush } from './brush';
import { trace, DIST_EPSILON } from './trace';
import { config } from './config';

export type Player = { pos: Vec3; vel: Vec3; onGround: boolean; ducked: boolean; groundNormal: Vec3 | null; jumpHeld: boolean };
export type Cmd = { forward: number; side: number; jump: boolean; duck: boolean; yaw: number; pitch: number };

const NON_JUMP_VELOCITY = 140;
const MAX_CLIP_PLANES = 5;

export const newPlayer = (pos: Vec3): Player => ({ pos: copy(pos), vel: vec(), onGround: false, ducked: false, groundNormal: null, jumpHeld: false });

export function clipVelocity(v: Vec3, n: Vec3, overbounce: number): Vec3 {
  let out = sub(v, scale(n, dot(v, n) * overbounce));
  const adjust = dot(out, n);
  if (adjust < 0) out = sub(out, scale(n, adjust));
  return out;
}

type State = Player & { brushes: Brush[]; dt: number };

const hull = (s: State) => (s.ducked ? config.hullDuck : config.hullStand);
const traceHull = (s: State, from: Vec3, to: Vec3) => trace(from, to, hull(s).mins, hull(s).maxs, s.brushes);

function wish(cmd: Cmd): { dir: Vec3; speed: number } {
  const { forward, right } = angleVectors(cmd.yaw, 0);
  const f = cmd.forward * config.maxspeed, sd = cmd.side * config.maxspeed;
  const v = vec(forward.x * f + right.x * sd, forward.y * f + right.y * sd, 0);
  return { dir: normalize(v), speed: Math.min(length(v), config.maxspeed) };
}

function friction(s: State) {
  const speed = length(s.vel);
  if (speed < 0.1) return;
  const control = speed < config.stopspeed ? config.stopspeed : speed;
  const newspeed = Math.max(speed - control * config.friction * s.dt, 0);
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
    if (tr.startSolid) {
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
  const start = add(s.pos, vec(0, 0, 2));
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
  const steppedToGround = tr.fraction < 1 && tr.normal!.z >= 0.7;

  const hdist = (p: Vec3) => (p.x - pos0.x) ** 2 + (p.y - pos0.y) ** 2;
  if (!steppedToGround || hdist(downPos) >= hdist(s.pos)) {
    s.pos = downPos;
    s.vel = downVel;
  } else {
    s.vel = vec(s.vel.x, s.vel.y, downVel.z);
  }
}

function walkMove(s: State, cmd: Cmd) {
  const w = wish(cmd);
  s.vel.z = 0;
  accelerate(s, w.dir, w.speed, config.accelerate);
  s.vel.z = 0;
  if (length(s.vel) < 1) {
    s.vel = vec();
    return;
  }
  const dest = add(s.pos, scale(s.vel, s.dt));
  const tr = traceHull(s, s.pos, dest);
  if (tr.fraction === 1) s.pos = tr.endPos;
  else stepMove(s);
  stayOnGround(s);
}

function airMove(s: State, cmd: Cmd) {
  const w = wish(cmd);
  airAccelerate(s, w.dir, w.speed);
  tryPlayerMove(s);
}

function categorizePosition(s: State) {
  if (s.vel.z > NON_JUMP_VELOCITY) {
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

  duck(s, cmd.duck);
  s.vel.z -= config.gravity * 0.5 * dt;
  // Without autobhop, jump needs a fresh press (Source m_nOldButtons & IN_JUMP check).
  if (cmd.jump && s.onGround && (config.autobhop || !p.jumpHeld)) {
    s.onGround = false;
    // CS:GO CheckJumpButton overwrites z then calls FinishGravity itself.
    s.vel.z = config.jumpVelocity - config.gravity * 0.5 * dt;
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

  return { pos: s.pos, vel: s.vel, onGround: s.onGround, ducked: s.ducked, groundNormal: s.groundNormal, jumpHeld: cmd.jump };
}
