import { describe, it, expect } from 'vitest';
import { parseBsp } from '../src/bsp';
import { buildBsp } from './bspBuilder';
import { trace } from '../src/trace';
import { config } from '../src/config';
import { vec } from '../src/math';

const entities = `
{ "classname" "worldspawn" }
{ "classname" "info_player_terrorist" "origin" "0 0 1" "angles" "0 90 0" }
{ "classname" "trigger_teleport" "model" "*1" "target" "dest1" }
{ "classname" "info_teleport_destination" "targetname" "dest1" "origin" "100 200 300" "angles" "0 180 0" }
{ "classname" "trigger_multiple" "model" "*2" "targetname" "map_end" }
`;
const floor = { mins: [-512, -512, -16], maxs: [512, 512, 0], contents: 1 };
const water = { mins: [600, 0, 0], maxs: [700, 100, 100], contents: 0x20 }; // not player-solid
const file = () =>
  buildBsp({
    entities,
    world: [floor, water],
    submodels: [[{ mins: [0, 0, -500], maxs: [64, 64, -400], contents: 1 }], [{ mins: [400, 400, 0], maxs: [500, 500, 100], contents: 1 }]],
    face: [
      { verts: [[-512, -512, 0], [512, -512, 0], [512, 512, 0], [-512, 512, 0]], reflectivity: [0.5, 0.4, 0.3], name: 'CONCRETE/FLOOR', flags: 0 },
      { verts: [[0, 0, 0], [1, 0, 0], [1, 1, 0]], reflectivity: [1, 1, 1], name: 'TOOLS/TOOLSNODRAW', flags: 0x80 },
    ],
  });

describe('parseBsp', () => {
  it('reads world collision brushes only (player-solid contents)', () => {
    const m = parseBsp(file(), 'test');
    expect(m.brushes).toHaveLength(1);
    expect(m.brushes[0].mins).toEqual({ x: -512, y: -512, z: -16 });
    expect(m.brushes[0].maxs).toEqual({ x: 512, y: 512, z: 0 });
    const t = trace(vec(0, 0, 50), vec(0, 0, -50), config.hullStand.mins, config.hullStand.maxs, m.brushes);
    expect(t.normal).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('finds the spawn and its facing', () => {
    const m = parseBsp(file(), 'test');
    expect(m.spawn).toEqual({ x: 0, y: 0, z: 1 });
    expect(m.spawnYaw).toBe(90);
  });

  it('links trigger_teleport to its destination', () => {
    const [tp] = parseBsp(file(), 'test').teleports;
    expect(tp.dest).toEqual({ x: 100, y: 200, z: 300 });
    expect(tp.yaw).toBe(180);
    expect(tp.brushes).toHaveLength(1);
    expect(tp.brushes[0].maxs.z).toBe(-400);
  });

  it('uses a trigger named like an end zone as the goal', () => {
    const m = parseBsp(file(), 'test');
    expect(m.endZone).toHaveLength(1);
    expect(m.endZone![0].mins).toEqual({ x: 400, y: 400, z: 0 });
  });

  it('triangulates visible faces with texture tint, skipping tool faces', () => {
    const m = parseBsp(file(), 'test');
    expect(m.mesh.positions.length).toBe(2 * 3 * 3);
    expect(Array.from(m.mesh.colors.slice(0, 3))).toEqual([0.5, 0.4, 0.3].map((v) => Math.fround(v)));
  });

  it('winds triangles to face along the face plane, even for clockwise (Source-style) faces', () => {
    const cw = buildBsp({
      entities,
      world: [floor],
      submodels: [],
      face: [{ verts: [[-512, 512, 0], [512, 512, 0], [512, -512, 0], [-512, -512, 0]], reflectivity: [1, 1, 1], name: 'A', flags: 0, normal: [0, 0, 1] }],
    });
    const p = parseBsp(cw, 'cw').mesh.positions;
    for (let i = 0; i < p.length; i += 9) {
      const u = [p[i + 3] - p[i], p[i + 4] - p[i + 1]], v = [p[i + 6] - p[i], p[i + 7] - p[i + 1]];
      expect(u[0] * v[1] - u[1] * v[0]).toBeGreaterThan(0); // normal.z > 0
    }
  });

  it('computes texture UVs from texinfo axes and groups triangles by texture', () => {
    const m = parseBsp(file(), 'test');
    // s = x / 128, t = -y / 128; first vertex is (-512, -512, 0)
    expect(Array.from(m.mesh.uvs.slice(0, 2))).toEqual([-4, 4]);
    expect(m.mesh.uvs.length).toBe((m.mesh.positions.length / 3) * 2);
    expect(m.mesh.groups).toEqual([{ texture: 'CONCRETE/FLOOR', start: 0, count: 6 }]);
    expect(m.pak).toBeInstanceOf(Map);
  });

  it('rejects non-BSP and compressed files with a clear error', () => {
    expect(() => parseBsp(buildBsp({ entities, world: [floor], submodels: [], ident: 'NOPE' }), 'x')).toThrow(/not a Source BSP/);
    expect(() => parseBsp(buildBsp({ entities, world: [floor], submodels: [], lzmaLump: true }), 'x')).toThrow(/compressed/);
  });
});

describe('spawn entity types', () => {
  it('falls back to info_player_teamspawn (maps ported from other Source games)', () => {
    const ents = `{ "classname" "worldspawn" }\n{ "classname" "info_player_teamspawn" "origin" "-64 1984 1664" "angles" "0 270 0" }`;
    const m = parseBsp(buildBsp({ entities: ents, world: [floor], submodels: [] }), 'tf');
    expect(m.spawn).toEqual({ x: -64, y: 1984, z: 1664 });
    expect(m.spawnYaw).toBe(270);
  });
});

describe('static props', () => {
  it.each([10, 11] as const)('reads sprp v%i: model, origin, angles, skin, scale', (version) => {
    const m = parseBsp(
      buildBsp({
        entities,
        world: [floor],
        submodels: [],
        staticProps: { version, models: ['models/rock/Rock01.mdl', 'models/tree.mdl'], props: [{ origin: [10, 20, 30], angles: [0, 90, 0], model: 1, skin: 2, scale: 1.5 }] },
      }),
      'p',
    );
    expect(m.props).toEqual([{ model: 'models/tree.mdl', origin: { x: 10, y: 20, z: 30 }, angles: { x: 0, y: 90, z: 0 }, skin: 2, scale: version === 11 ? 1.5 : 1 }]);
  });
  it('maps with no props give an empty list', () => {
    expect(parseBsp(file(), 't').props).toEqual([]);
  });
});
