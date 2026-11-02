import { Vec3, vec } from '../math';
import { Brush, makeBox, makeRamp, translated } from '../brush';
import type { Teleport, Push, BspMap, Hurt } from '../bsp';

// A built-in map's look. ramp and floor recolour the stone (null keeps its natural colour); light scales the sunlight.
export type Theme = { horizon: string; zenith: string; ground: string; haze: string; ramp: string | null; floor: string | null; light: number; scenery: 'mesa' | 'spire' | 'rock' | 'pillar' };
export const THEMES = {
  desert: { horizon: '#f0d2a0', zenith: '#5a8cc2', ground: '#c6a273', haze: '#e6c79c', ramp: null, floor: null, light: 1, scenery: 'mesa' },
  meadow: { horizon: '#d6e6b8', zenith: '#6fb0c9', ground: '#6f8f52', haze: '#cfe0b8', ramp: '#8fb56a', floor: '#a9a88a', light: 1, scenery: 'rock' },
  glacier: { horizon: '#d8ecf5', zenith: '#4f8fd0', ground: '#a9c8d8', haze: '#c9e2ee', ramp: '#9fd0ea', floor: '#dfeef5', light: 1, scenery: 'spire' },
  dusk: { horizon: '#f08a5d', zenith: '#3b2a6b', ground: '#4a2c55', haze: '#c77c74', ramp: '#c9668a', floor: '#6d4a78', light: 0.9, scenery: 'rock' },
  sunset: { horizon: '#f7b267', zenith: '#7a5fa8', ground: '#a8705a', haze: '#eeb07a', ramp: '#e08e5a', floor: '#c9a98a', light: 1, scenery: 'mesa' },
  ember: { horizon: '#e0603a', zenith: '#2a1a1e', ground: '#2e2020', haze: '#9a4a30', ramp: '#a65a44', floor: '#55403a', light: 0.85, scenery: 'spire' },
  night: { horizon: '#2c3f66', zenith: '#0a1230', ground: '#141a2e', haze: '#28406a', ramp: '#4fa0c8', floor: '#3a4a66', light: 0.75, scenery: 'pillar' },
} satisfies Record<string, Theme>;

export type MapDef = {
  id: string;
  name: string;
  theme?: Theme;
  stages?: { spawn: Vec3; yaw: number }[]; // where a fall returns you, once that stage is reached
  stageEnds?: number[]; // index of the last ramp in each stage
  brushes: Brush[];
  spawn: Vec3;
  spawnYaw: number;
  killZ: number;
  startZone: Brush[];
  endZone: Brush[] | null;
  teleports: Teleport[];
  pushes: Push[];
  hurts: Hurt[];
  mesh?: BspMap['mesh']; // imported maps render this instead of brushes
  pak?: BspMap['pak'];
  props?: BspMap['props'];
  lightmap?: BspMap['lightmap'];
  skyName?: string;
  fog?: BspMap['fog'];
};

type Section = { angle: number; width: number };

// Ramps in a straight line along +X, alternating sides on one shared footprint around y=0,
// so leaving one ramp's end at speed lands you mid-slope on the next.
export function straightChain(x0: number, topZ: number, length: number, gap: number, drop: number, sections: Section[]): Brush[] {
  return sections.map(({ angle, width }, i) => {
    const height = width * Math.tan((angle * Math.PI) / 180);
    return makeRamp(vec(x0 + i * (length + gap), -width / 2, topZ - i * drop - height), length, width, height, i % 2 === 0 ? 'left' : 'right');
  });
}

export const startPlatform = (topZ: number) => makeBox(vec(-256, -256, topZ - 16), vec(256, 256, topZ));
export const lowestZ = (bs: Brush[]) => Math.min(...bs.map((b) => b.mins.z));


const PAD = 3200; // long enough to land on at full speed
const LANE = 7000; // stages sit side by side, this far apart

export type StageSpec = { topZ: number; length: number; gap: number; drop: number; sections: Section[] };

// A map in stages: each is a platform, a ramp chain and a landing pad. Touching the pad moves you on to the next
// stage standing still; the last pad is the finish. Falling returns you to the stage you're on.
export function stagedMap(id: string, name: string, theme: Theme, specs: StageSpec[]): MapDef {
  const pushes: Push[] = [], brushes: Brush[] = [], teleports: Teleport[] = [], stages: NonNullable<MapDef['stages']> = [], stageEnds: number[] = [];
  let endZone: Brush[] = [], lowest = Infinity, rampCount = 0;
  specs.forEach((s, i) => {
    const y = i * LANE, at = vec(0, y, 0);
    const ramps = straightChain(400, s.topZ - 176, s.length, s.gap, s.drop, s.sections);
    const low = lowestZ(ramps), endX = 400 + ramps.length * (s.length + s.gap);
    const zone = translated(makeBox(vec(endX - s.gap, -1024, low - 300), vec(endX + PAD, 1024, low - 172)), at);
    brushes.push(translated(startPlatform(s.topZ), at), ...ramps.map((r) => translated(r, at)), translated(makeBox(vec(endX - s.gap, -1024, low - 316), vec(endX + PAD, 1024, low - 300)), at));
    stages.push({ spawn: vec(0, y, s.topZ + 1), yaw: 0 });
    lowest = Math.min(lowest, low);
    rampCount += ramps.length;
    stageEnds.push(rampCount - 1);
    if (i > 0) pushes.push({ brushes: [translated(makeBox(vec(130, -256, s.topZ), vec(256, 256, s.topZ + 48)), at)], vel: vec(620, 0, 120), once: true }); // no standing start on a later stage
    if (i === specs.length - 1) endZone = [zone];
    else teleports.push({ brushes: [zone], dest: vec(0, y + LANE, specs[i + 1].topZ + 1), yaw: 0, landmark: null, keepAngles: false, stop: true, stage: i + 1 });
  });
  const top = specs[0].topZ;
  return { id, name, theme, stages, stageEnds, brushes, spawn: stages[0].spawn, spawnYaw: 0, killZ: lowest - 800, startZone: [makeBox(vec(-256, -256, top), vec(256, 256, top + 128))], endZone, teleports, pushes, hurts: [] };
}

// Built-in map: spawn on the start platform (timer starts on leaving it), goal is the landing pad.
export function builtin(id: string, name: string, theme: Theme, topZ: number, ramps: Brush[], pad: Brush): MapDef {
  const platform = startPlatform(topZ);
  return {
    id,
    name,
    theme,
    brushes: [platform, ...ramps, pad],
    spawn: vec(0, 0, topZ + 1),
    spawnYaw: 0,
    killZ: lowestZ(ramps) - 800,
    startZone: [makeBox(vec(-256, -256, topZ), vec(256, 256, topZ + 128))],
    endZone: [makeBox(vec(pad.mins.x, pad.mins.y, pad.maxs.z), vec(pad.maxs.x, pad.maxs.y, pad.maxs.z + 128))],
    teleports: [],
    pushes: [],
    hurts: [],
  };
}

// Medal targets from the course length at a typical speed for each medal. shortcut: estimates, not times from real runs; set them by hand once maps have been played.
export function medalTimes(map: MapDef) {
  const length = map.brushes.filter((b) => b.kind === 'ramp').reduce((sum, b) => sum + Math.max(b.maxs.x - b.mins.x, b.maxs.y - b.mins.y), 0) * 1.2;
  return { gold: length / 1500, silver: length / 1150, bronze: length / 850 };
}
export function medalFor(map: MapDef, time: number): 'Gold' | 'Silver' | 'Bronze' | null {
  if (map.mesh) return null; // imported maps have no targets
  const m = medalTimes(map);
  return time <= m.gold ? 'Gold' : time <= m.silver ? 'Silver' : time <= m.bronze ? 'Bronze' : null;
}
