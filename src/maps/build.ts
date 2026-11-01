import { Vec3, vec } from '../math';
import { Brush, makeBox, makeRamp } from '../brush';
import type { Teleport, BspMap } from '../bsp';

export type MapDef = {
  id: string;
  name: string;
  brushes: Brush[];
  spawn: Vec3;
  spawnYaw: number;
  killZ: number;
  startZone: Brush[];
  endZone: Brush[] | null;
  teleports: Teleport[];
  mesh?: BspMap['mesh']; // imported maps render this instead of brushes
  pak?: BspMap['pak'];
  props?: BspMap['props'];
  lightmap?: BspMap['lightmap'];
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


// Built-in map: spawn on the start platform (timer starts on leaving it), goal is the landing pad.
export function builtin(id: string, name: string, topZ: number, ramps: Brush[], pad: Brush): MapDef {
  const platform = startPlatform(topZ);
  return {
    id,
    name,
    brushes: [platform, ...ramps, pad],
    spawn: vec(0, 0, topZ + 1),
    spawnYaw: 0,
    killZ: lowestZ(ramps) - 800,
    startZone: [makeBox(vec(-256, -256, topZ), vec(256, 256, topZ + 128))],
    endZone: [makeBox(vec(pad.mins.x, pad.mins.y, pad.maxs.z), vec(pad.maxs.x, pad.maxs.y, pad.maxs.z + 128))],
    teleports: [],
  };
}
