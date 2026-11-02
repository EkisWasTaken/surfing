// Builds surf courses piece by piece from a moving cursor: straight ramps at any heading, banked curves, gaps, boosts.
import { Vec3, vec, add, scale } from '../math';
import { Brush, makeBox, makePrism, translated } from '../brush';
import type { Push, Teleport } from '../bsp';
import type { MapDef, Theme } from './build';

const DEG = Math.PI / 180;
const STEP = 3; // degrees of curve per brush: small, so each seam barely changes your direction
const dirOf = (h: number) => vec(Math.cos(h * DEG), Math.sin(h * DEG), 0);
const leftOf = (h: number) => vec(-Math.sin(h * DEG), Math.cos(h * DEG), 0);

// A jump between two pieces, for checking the course can be ridden.
export type Jump = { from: Vec3; heading: number; to: Brush[]; stage: number };
type Turn = 'left' | 'right';

export class Track {
  pieces: Brush[] = [];
  pushes: Push[] = [];
  jumps: Jump[] = [];
  private pending: Omit<Jump, 'to'> | null = null;
  constructor(public x: number, public y: number, public h: number, public z: number, private stage: number) {}

  private place(brushes: Brush[], exitX: number, exitY: number, height: number) {
    if (this.pending) this.jumps.push({ ...this.pending, to: brushes });
    this.pieces.push(...brushes);
    // Leaving a piece you're around mid-slope, so that's where each jump is checked from.
    this.pending = { from: vec(exitX, exitY, this.z - height / 2 + 60), heading: this.h, stage: this.stage };
  }

  // A straight ramp ahead. face is which way its slope looks: you ride it pressing toward the other side.
  ramp(length: number, width: number, angle: number, face: Turn) {
    const height = width * Math.tan(angle * DEG), l = scale(leftOf(this.h), face === 'left' ? 1 : -1);
    const at = (a: number) => {
      const p = vec(this.x + dirOf(this.h).x * a, this.y + dirOf(this.h).y * a, 0);
      const wall = add(p, scale(l, -width / 2)), foot = add(p, scale(l, width / 2));
      return [vec(wall.x, wall.y, this.z - height), vec(wall.x, wall.y, this.z), vec(foot.x, foot.y, this.z - height)] as [Vec3, Vec3, Vec3];
    };
    const brush = makePrism(at(0), at(length));
    const d = dirOf(this.h);
    this.x += d.x * length;
    this.y += d.y * length;
    this.place([brush], this.x, this.y, height);
    return this;
  }

  // A banked curve at constant height. Its slope faces the inside of the turn, so speed presses you into it.
  arc(radius: number, degrees: number, turn: Turn, width: number, angle: number) {
    const height = width * Math.tan(angle * DEG), sign = turn === 'left' ? 1 : -1;
    const c = add(vec(this.x, this.y, 0), scale(leftOf(this.h), sign * radius));
    const n = Math.ceil(degrees / STEP), start = this.h;
    const at = (i: number) => {
      const h = start + (sign * degrees * i) / n, out = scale(leftOf(h), -sign); // from the centre, out through this point
      const wall = add(c, scale(out, radius + width / 2)), foot = add(c, scale(out, radius - width / 2));
      return [vec(wall.x, wall.y, this.z - height), vec(wall.x, wall.y, this.z), vec(foot.x, foot.y, this.z - height)] as [Vec3, Vec3, Vec3];
    };
    const brushes = Array.from({ length: n }, (_, i) => makePrism(at(i), at(i + 1)));
    this.h = start + sign * degrees;
    const end = add(c, scale(leftOf(this.h), -sign * radius));
    this.x = end.x;
    this.y = end.y;
    this.place(brushes, this.x, this.y, height);
    return this;
  }

  // Air between pieces: forward, and down.
  gap(distance: number, drop: number) {
    const d = dirOf(this.h);
    this.x += d.x * distance;
    this.y += d.y * distance;
    this.z -= drop;
    return this;
  }

  // A glowing gate that adds speed once as you pass through. Set back from the cursor, in the gap you're crossing.
  boost(speed: number) {
    const d = dirOf(this.h), cx = this.x - d.x * 200, cy = this.y - d.y * 200;
    const v = scale(d, speed);
    this.pushes.push({ brushes: [makeBox(vec(cx - 260, cy - 260, this.z - 560), vec(cx + 260, cy + 260, this.z + 120))], vel: vec(v.x, v.y, 60), once: true });
    return this;
  }
}

// A map of several tracks, side by side with clear space between. Each runs platform, pieces, pad; the last pad finishes.
export function trackMap(id: string, name: string, theme: Theme, stages: { topZ: number; build: (t: Track) => void }[]): MapDef & { jumps: Jump[] } {
  const brushes: Brush[] = [], pushes: Push[] = [], teleports: Teleport[] = [], jumps: Jump[] = [], spawns: Vec3[] = [];
  let endZone: Brush[] = [], lowest = Infinity, offset = 0;
  const zones: { zone: Brush; stage: number }[] = [];
  stages.forEach((s, i) => {
    const t = new Track(400, 0, 0, s.topZ - 176, i);
    s.build(t);
    const low = Math.min(...t.pieces.map((b) => b.mins.z)), d = dirOf(t.h);
    // A big pad well ahead: you arrive at speed, from whatever direction the course left you.
    const px = t.x + d.x * 1500, py = t.y + d.y * 1500, R = 2000;
    const pad = makeBox(vec(px - R, py - R, low - 316), vec(px + R, py + R, low - 300));
    const zone = makeBox(vec(px - R, py - R, low - 300), vec(px + R, py + R, low - 172));
    const platform = makeBox(vec(-256, -256, s.topZ - 16), vec(256, 256, s.topZ));
    const own = [platform, ...t.pieces, pad];
    const minY = Math.min(...own.map((b) => b.mins.y)), maxY = Math.max(...own.map((b) => b.maxs.y));
    const shift = vec(0, i === 0 ? 0 : offset - minY + 5000, 0);
    offset = maxY + shift.y;
    const move = (b: Brush) => translated(b, shift);
    brushes.push(...own.map(move));
    if (i > 0) pushes.push({ brushes: [move(makeBox(vec(130, -256, s.topZ), vec(256, 256, s.topZ + 48)))], vel: vec(620, 0, 120), once: true });
    pushes.push(...t.pushes.map((q) => ({ ...q, brushes: q.brushes.map(move) })));
    const moved = new Map(t.pieces.map((b, k) => [b, own[k + 1]]));
    jumps.push(...t.jumps.map((j) => ({ ...j, from: add(j.from, shift), to: j.to.map((b) => move(moved.get(b)!)) })));
    if (t.jumps.length || t.pieces.length) jumps.push({ from: add(vec(t.x + d.x * 60, t.y + d.y * 60, t.z - 250), shift), heading: t.h, to: [move(zone)], stage: i });
    spawns.push(vec(0, shift.y, s.topZ + 1));
    lowest = Math.min(lowest, low);
    zones.push({ zone: move(zone), stage: i });
  });
  zones.forEach(({ zone, stage }) => {
    if (stage === stages.length - 1) endZone = [zone];
    else teleports.push({ brushes: [zone], dest: spawns[stage + 1], yaw: 0, landmark: null, keepAngles: false, stop: true, stage: stage + 1 });
  });
  const top = stages[0].topZ;
  return { id, name, theme, stages: spawns.map((spawn) => ({ spawn, yaw: 0 })), jumps, brushes, spawn: spawns[0], spawnYaw: 0, killZ: lowest - 800, startZone: [makeBox(vec(-256, -256, top), vec(256, 256, top + 128))], endZone, teleports, pushes, hurts: [] };
}
