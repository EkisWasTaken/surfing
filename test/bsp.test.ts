import { describe, it, expect } from 'vitest';
import { parseBsp, decodeLight } from '../src/bsp';
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

describe('lightmaps', () => {
  // 5×5 luxels: corner (0,0) is orange-ish, everything else is a half-strength gray (128 * 2^-1).
  const samples = Array.from({ length: 25 }, (_, i) => (i === 0 ? [128, 64, 32, 0] : [128, 128, 128, -1]));
  const lit = (hdrOnly: boolean) =>
    parseBsp(
      buildBsp({
        entities,
        world: [floor],
        submodels: [],
        hdrOnly,
        face: [
          { verts: [[-512, -512, 0], [512, -512, 0], [512, 512, 0], [-512, 512, 0]], reflectivity: [1, 1, 1], name: 'LIT', flags: 0, light: { size: [4, 4], samples } },
          { verts: [[600, 0, 0], [700, 0, 0], [700, 100, 0]], reflectivity: [1, 1, 1], name: 'UNLIT', flags: 0 },
        ],
      }),
      'l',
    );
  const texel = (m: ReturnType<typeof parseBsp>, vertex: number) => {
    const { width, height, data } = m.lightmap;
    const x = Math.floor(m.mesh.lmUvs[vertex * 2] * width), y = Math.floor(m.mesh.lmUvs[vertex * 2 + 1] * height);
    return Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 3)).map(decodeLight);
  };
  const vertexAt = (m: ReturnType<typeof parseBsp>, x: number, y: number) => {
    const p = m.mesh.positions;
    for (let i = 0; i < p.length / 3; i++) if (p[i * 3] === x && p[i * 3 + 1] === y) return i;
    throw new Error('vertex not found');
  };

  it.each([false, true])('maps each vertex to its luxel and decodes RGBE (hdrOnly=%s)', (hdrOnly) => {
    const m = lit(hdrOnly);
    texel(m, vertexAt(m, -512, -512)).forEach((v, k) => expect(v).toBeCloseTo([128, 64, 32][k] / 255, 2));
    texel(m, vertexAt(m, 512, 512)).forEach((v) => expect(v).toBeCloseTo(64 / 255, 2));
  });

  it('points faces without lighting at a white texel', () => {
    const m = lit(false);
    texel(m, vertexAt(m, 600, 0)).forEach((v) => expect(v).toBeCloseTo(1, 1));
  });
});

describe('lightmap exposure', () => {
  const withLight = (value: number) =>
    parseBsp(
      buildBsp({
        entities,
        world: [floor],
        submodels: [],
        face: [{ verts: [[-512, -512, 0], [512, -512, 0], [512, 512, 0], [-512, 512, 0]], reflectivity: [1, 1, 1], name: 'LIT', flags: 0, light: { size: [4, 4], samples: Array.from({ length: 25 }, () => [value, value, value, 0]) } }],
      }),
      'e',
    ).lightmap.exposure;
  it('scales so the brighter lit surfaces land at 0.5, clamped to 1–8×', () => {
    expect(withLight(64)).toBeCloseTo(0.5 / (64 / 255), 1); // ≈ 2×
    expect(withLight(8)).toBe(8); // very dark map: capped
    expect(withLight(255)).toBe(1); // already bright: never darkened
  });
});

describe('brush entities', () => {
  const box = { mins: [-16, -16, -16], maxs: [16, 16, 16], contents: 1 };
  const ents = `{ "classname" "worldspawn" }
{ "classname" "info_player_terrorist" "origin" "0 0 1" }
{ "classname" "trigger_teleport" "model" "*1" "origin" "1000 0 0" "target" "d" }
{ "classname" "info_teleport_destination" "targetname" "d" "origin" "0 0 64" }
{ "classname" "func_brush" "model" "*2" "origin" "0 2000 0" "Solidity" "0" }
{ "classname" "func_brush" "model" "*3" "origin" "0 3000 0" "Solidity" "1" }
{ "classname" "func_illusionary" "model" "*4" "origin" "0 4000 0" }
{ "classname" "trigger_push" "model" "*5" "origin" "0 5000 0" "speed" "500" "pushdir" "0 90 0" "spawnflags" "1" }
{ "classname" "trigger_push" "model" "*6" "origin" "0 6000 0" "speed" "1200" "pushdir" "-90 0 0" "spawnflags" "1" }
{ "classname" "trigger_hurt" "model" "*7" "origin" "0 7000 0" "damage" "1000" }
{ "classname" "trigger_teleport" "model" "*8" "origin" "0 8000 0" "target" "d" "StartDisabled" "1" }
{ "classname" "trigger_momentum_timer_start" "model" "*9" "origin" "0 9000 0" }
{ "classname" "func_wall" "model" "*10" "origin" "0 10000 0" }`;
  const m = parseBsp(buildBsp({ entities: ents, world: [floor], submodels: Array.from({ length: 10 }, () => [box]) }), 'ents');
  const at = (y: number) => m.brushes.some((b) => b.mins.y === y - 16 && b.maxs.y === y + 16);

  it('places entity brushes at the entity origin (models are stored origin-relative)', () => {
    expect(m.teleports).toHaveLength(1); // the StartDisabled one is skipped
    expect(m.teleports[0].brushes[0].mins).toEqual({ x: 984, y: -16, z: -16 });
  });
  it('makes solid brush entities collide, and leaves non-solid ones out', () => {
    expect(at(2000)).toBe(true); // func_brush, Solidity 0
    expect(at(10000)).toBe(true); // func_wall
    expect(at(3000)).toBe(false); // func_brush, Solidity 1 = never solid
    expect(at(4000)).toBe(false); // func_illusionary
  });
  it('reads trigger_push speed and direction', () => {
    expect(m.pushes).toHaveLength(2);
    const [side, up] = m.pushes;
    expect(side.vel.x).toBeCloseTo(0, 6);
    expect(side.vel.y).toBeCloseTo(500, 6);
    expect(up.vel.z).toBeCloseTo(1200, 6); // pitch -90 points straight up
    expect(side.brushes[0].mins.y).toBe(5000 - 16);
  });
  it('reads trigger_hurt as respawn volumes and Momentum timer triggers as zones', () => {
    expect(m.hurts[0].brushes[0].mins.y).toBe(7000 - 16);
    expect(m.startZone![0].mins.y).toBe(9000 - 16);
  });
});

describe('brush entity faces', () => {
  it('draws func_illusionary faces at the entity origin', () => {
    const ents = `{ "classname" "worldspawn" }\n{ "classname" "func_illusionary" "model" "*1" "origin" "1000 0 0" }`;
    const m = parseBsp(
      buildBsp({
        entities: ents,
        world: [floor],
        submodels: [[{ mins: [-16, -16, -16], maxs: [16, 16, 16], contents: 0 }]],
        face: [{ verts: [[-16, -16, 0], [16, -16, 0], [16, 16, 0]], reflectivity: [1, 1, 1], name: 'DECOR', flags: 0, model: 1 }],
      }),
      'f',
    );
    expect(m.mesh.groups.map((g) => g.texture)).toEqual(['DECOR']);
    const xs = [0, 3, 6].map((i) => m.mesh.positions[i]).sort((a, b) => a - b);
    expect(xs).toEqual([984, 1016, 1016]); // triangle x = -16, 16, 16 shifted by the origin
  });
});

describe('sky and fog', () => {
  it('reads the skybox name and an enabled env_fog_controller', () => {
    const ents = `{ "classname" "worldspawn" "skyname" "sky_day01_09" }
{ "classname" "env_fog_controller" "fogenable" "1" "fogcolor" "255 128 0" "fogstart" "500" "fogend" "4000" "fogmaxdensity" ".8" }`;
    const m = parseBsp(buildBsp({ entities: ents, world: [floor], submodels: [] }), 'f');
    expect(m.skyName).toBe('sky_day01_09');
    expect(m.fog).toEqual({ color: [1, 128 / 255, 0], start: 500, end: 4000, max: 0.8 });
  });
  it('has no fog when the controller is off or missing', () => {
    expect(parseBsp(file(), 't').fog).toBeNull();
    const off = `{ "classname" "worldspawn" }\n{ "classname" "env_fog_controller" "fogenable" "0" "fogcolor" "1 2 3" }`;
    expect(parseBsp(buildBsp({ entities: off, world: [floor], submodels: [] }), 'o').fog).toBeNull();
  });
});

describe('face orientation with the side flag', () => {
  it('faces along the plane normal even when side = 1 (the flag is about the BSP node, not the face)', () => {
    const m = parseBsp(
      buildBsp({
        entities,
        world: [floor],
        submodels: [],
        face: [{ verts: [[-512, 512, 0], [512, 512, 0], [512, -512, 0], [-512, -512, 0]], reflectivity: [1, 1, 1], name: 'A', flags: 0, normal: [0, 0, 1], side: 1 }],
      }),
      's',
    );
    const p = m.mesh.positions;
    for (let i = 0; i < p.length; i += 9) {
      const u = [p[i + 3] - p[i], p[i + 4] - p[i + 1]], v = [p[i + 6] - p[i], p[i + 7] - p[i + 1]];
      expect(u[0] * v[1] - u[1] * v[0]).toBeGreaterThan(0); // front faces +Z, the plane normal
    }
  });
});

describe('finding the finish', () => {
  const base = `{ "classname" "worldspawn" }
{ "classname" "info_player_terrorist" "origin" "0 0 1" "angles" "0 0 0" }`;
  const box = (x: number) => [{ mins: [x, 0, 0], maxs: [x + 64, 64, 64], contents: 1 }];
  const endOf = (ents: string, count = 3) => parseBsp(buildBsp({ entities: base + ents, world: [floor], submodels: [box(1000), box(2000), box(3000)].slice(0, count) }), 'test').endZone;

  it('skips stage and bonus triggers when the map has its own end', () => {
    const z = endOf(`
{ "classname" "trigger_multiple" "model" "*1" "targetname" "bonus1_end" }
{ "classname" "trigger_multiple" "model" "*2" "targetname" "b2_end" }
{ "classname" "trigger_multiple" "model" "*3" "targetname" "map_end" }`);
    expect(z![0].mins.x).toBe(3000);
  });
  it('treats a teleport into a room named end as the finish', () => {
    const z = endOf(`
{ "classname" "trigger_teleport" "model" "*1" "target" "EndRoom" }
{ "classname" "info_teleport_destination" "targetname" "EndRoom" "origin" "500 600 700" }`);
    expect(z![0].mins).toEqual({ x: 436, y: 536, z: 684 });
    expect(z![0].maxs).toEqual({ x: 564, y: 664, z: 828 });
  });
  it('ignores an end room nothing teleports to', () => {
    expect(endOf(`{ "classname" "info_teleport_destination" "targetname" "end" "origin" "500 600 700" }`)).toBeNull();
  });
  it('falls back to the end of the last stage', () => {
    const z = endOf(`
{ "classname" "trigger_multiple" "model" "*1" "targetname" "stage1_end" }
{ "classname" "trigger_multiple" "model" "*2" "targetname" "stage3_end" }
{ "classname" "trigger_multiple" "model" "*3" "targetname" "stage2_end" }`);
    expect(z![0].mins.x).toBe(2000);
  });
  it('finds none on a map with no markers', () => {
    expect(endOf('', 0)).toBeNull();
  });
});
