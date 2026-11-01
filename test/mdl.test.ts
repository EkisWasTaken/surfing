import { describe, it, expect } from 'vitest';
import { parseModel } from '../src/mdl';

// One bodypart → one model → one mesh → one strip group with a single triangle.
function buildModel(opts: { version?: number; tri?: number[]; skinFamilies?: number[][] } = {}) {
  const version = opts.version ?? 48;
  const verts = [[0, 0, 0], [10, 0, 0], [0, 10, 0]];
  const tri = opts.tri ?? [0, 1, 2];

  const mdl = new Uint8Array(1400);
  const m = new DataView(mdl.buffer);
  mdl.set([73, 68, 83, 84]); // IDST
  m.setInt32(4, version, true);
  const str = (off: number, s: string) => mdl.set(new TextEncoder().encode(s + '\0'), off);
  // textures: two (so skins can swap), at 900; names at 1100/1120 (clear of the model/mesh structs)
  m.setInt32(204, 2, true);
  m.setInt32(208, 900, true);
  m.setInt32(900, 1100 - 900, true);
  m.setInt32(964, 1120 - 964, true);
  str(1100, 'rock');
  str(1120, 'rock_mossy');
  // cd texture dirs at 1040 → string at 1140
  m.setInt32(212, 1, true);
  m.setInt32(216, 1040, true);
  m.setInt32(1040, 1140, true);
  str(1140, 'models\\rocks\\');
  // skin table at 1060: families × 2 refs
  const fams = opts.skinFamilies ?? [[0, 1]];
  m.setInt32(220, 2, true);
  m.setInt32(224, fams.length, true);
  m.setInt32(228, 1060, true);
  fams.flat().forEach((v, i) => m.setInt16(1060 + i * 2, v, true));
  // bodypart at 408 → model at 424 → mesh at 572
  m.setInt32(232, 1, true);
  m.setInt32(236, 408, true);
  m.setInt32(408 + 4, 1, true);
  m.setInt32(408 + 12, 16, true);
  const model = 424;
  m.setInt32(model + 72, 1, true);
  m.setInt32(model + 76, 800 - model, true);
  m.setInt32(model + 84, 0, true);
  m.setInt32(800, 0, true); // mesh material 0
  m.setInt32(800 + 12, 0, true); // vertexoffset

  const vvd = new Uint8Array(64 + verts.length * 48);
  const v = new DataView(vvd.buffer);
  vvd.set([73, 68, 83, 86]); // IDSV
  v.setInt32(4, 4, true);
  v.setInt32(12, 1, true);
  v.setInt32(16, verts.length, true);
  v.setInt32(56, 64, true);
  verts.forEach((p, i) => {
    const o = 64 + i * 48;
    p.forEach((c, k) => v.setFloat32(o + 16 + k * 4, c, true));
    v.setFloat32(o + 28 + 8, 1, true); // normal +Z
    v.setFloat32(o + 40, p[0] / 10, true);
    v.setFloat32(o + 44, p[1] / 10, true);
  });

  const sg = version >= 49 ? 33 : 25;
  const vtx = new Uint8Array(256);
  const x = new DataView(vtx.buffer);
  x.setInt32(0, 7, true);
  x.setInt32(28, 1, true);
  x.setInt32(32, 36, true); // bodypart at 36
  x.setInt32(36, 1, true);
  x.setInt32(40, 8, true); // model at 44
  x.setInt32(44, 1, true);
  x.setInt32(48, 8, true); // lod at 52
  x.setInt32(52, 1, true);
  x.setInt32(56, 12, true); // mesh at 64
  x.setInt32(64, 1, true);
  x.setInt32(68, 9, true); // strip group at 73
  const g = 73;
  x.setInt32(g, 3, true);
  x.setInt32(g + 4, sg, true); // verts right after header
  x.setInt32(g + 8, 3, true);
  x.setInt32(g + 12, sg + 27, true);
  [0, 1, 2].forEach((id, i) => x.setUint16(g + sg + i * 9 + 4, id, true));
  tri.forEach((id, i) => x.setUint16(g + sg + 27 + i * 2, id, true));
  return { mdl, vvd, vtx };
}

describe('parseModel', () => {
  it.each([48, 49])('builds triangles, normals, UVs and material candidates (MDL v%i)', (version) => {
    const { mdl, vvd, vtx } = buildModel({ version });
    const mesh = parseModel(mdl, vvd, vtx)!;
    expect(Array.from(mesh.positions)).toEqual([0, 0, 0, 10, 0, 0, 0, 10, 0]);
    expect(Array.from(mesh.normals.slice(0, 3))).toEqual([0, 0, 1]);
    expect(Array.from(mesh.uvs)).toEqual([0, 0, 1, 0, 0, 1]);
    expect(mesh.groups).toEqual([{ materials: ['models\\rocks\\rock'], start: 0, count: 3 }]);
  });

  it('winds triangles to agree with the vertex normals', () => {
    const { mdl, vvd, vtx } = buildModel({ tri: [0, 2, 1] }); // clockwise seen from +Z
    const p = parseModel(mdl, vvd, vtx)!.positions;
    const cz = (p[3] - p[0]) * (p[7] - p[1]) - (p[4] - p[1]) * (p[6] - p[0]);
    expect(cz).toBeGreaterThan(0);
  });

  it('uses the skin family to pick the texture', () => {
    const { mdl, vvd, vtx } = buildModel({ skinFamilies: [[0, 1], [1, 1]] });
    expect(parseModel(mdl, vvd, vtx, 1)!.groups[0].materials).toEqual(['models\\rocks\\rock_mossy']);
  });

  it('rejects junk', () => {
    expect(parseModel(new Uint8Array(10), new Uint8Array(10), new Uint8Array(10))).toBeNull();
  });
});
