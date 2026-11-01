import { describe, it, expect } from 'vitest';
import { parseMdl, angleQuaternion } from '../src/goldsrcmdl';

// A minimal studio model laid out by hand: 2 bones, one 2x2 masked texture, one body part / model / mesh
// drawn as a 4-corner strip, and one 3-frame sequence whose bone 1 x-position is RLE-animated.
function buildMdl() {
  const b = new ArrayBuffer(4096), dv = new DataView(b), u8 = new Uint8Array(b);
  const str = (o: number, s: string) => u8.set(new TextEncoder().encode(s), o);
  const i32 = (o: number, v: number) => dv.setInt32(o, v, true), f32 = (o: number, v: number) => dv.setFloat32(o, v, true);
  const i16 = (o: number, v: number) => dv.setInt16(o, v, true);
  str(0, 'IDST');
  i32(4, 10);
  // bones at 300
  i32(140, 2), i32(144, 300);
  str(300, 'root'), i32(332, -1);
  str(412, 'blade'), i32(444, 0);
  f32(412 + 64, 5); // blade value x = 5
  for (let k = 0; k < 6; k++) f32(412 + 88 + k * 4, k === 0 ? 0.5 : 0); // scale x = 0.5
  // texture at 600, pixels at 700 (+4 indices, then palette)
  i32(180, 1), i32(184, 600);
  str(600, 'knife.bmp'), i32(664, 0x40), i32(668, 2), i32(672, 2), i32(676, 700);
  u8.set([0, 1, 255, 1], 700);
  u8.set([10, 20, 30], 704 + 0 * 3), u8.set([40, 50, 60], 704 + 1 * 3);
  // skin table at 1500: skinref 0 → texture 0
  i32(192, 1), i32(196, 1), i32(200, 1500), i16(1500, 0);
  // body part at 1600 → model at 1700 → mesh at 1900; verts at 2000, vertinfo at 2100, norms at 2200, tris at 2300
  i32(204, 1), i32(208, 1600);
  i32(1600 + 64, 1), i32(1600 + 72, 1700);
  i32(1700 + 72, 1), i32(1700 + 76, 1900), i32(1700 + 80, 4), i32(1700 + 84, 2100), i32(1700 + 88, 2000), i32(1700 + 100, 2200);
  [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]].forEach((v, i) => v.forEach((c, k) => f32(2000 + i * 12 + k * 4, c)));
  u8.set([0, 1, 1, 0], 2100);
  for (let i = 0; i < 4; i++) f32(2200 + i * 12 + 8, 1);
  i32(1900, 2), i32(1904, 2300), i32(1908, 0);
  i16(2300, 4); // strip of 4 corners: (vert, norm, s, t)
  [[0, 0, 0, 0], [1, 1, 2, 0], [2, 2, 0, 2], [3, 3, 2, 2]].forEach((c, i) => c.forEach((v, k) => i16(2302 + i * 8 + k * 2, v)));
  i16(2302 + 32, 0);
  // sequence at 2500, anim at 2700 (2 bones x 6 offsets); bone 1 channel 0 data at 2800
  i32(164, 1), i32(168, 2500);
  str(2500, 'idle'), f32(2532, 15), i32(2556, 3), i32(2500 + 124, 2700), i32(2500 + 156, 0);
  dv.setUint16(2712, 2800 - 2712, true); // bone 1, channel x
  u8.set([2, 3], 2800); // valid 2, total 3 → values for frames 0,1; frame 2 repeats the last
  i16(2802, 4), i16(2804, 10);
  return b;
}

describe('parseMdl', () => {
  const m = parseMdl(buildMdl());
  it('reads bones, the masked palette texture and the strip as two triangles', () => {
    expect(m.bones).toEqual([{ name: 'root', parent: -1 }, { name: 'blade', parent: 0 }]);
    const t = m.textures[0];
    expect([t.width, t.height, t.masked]).toEqual([2, 2, true]);
    expect(Array.from(t.rgba.subarray(0, 8))).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
    expect(t.rgba[2 * 4 + 3]).toBe(0); // index 255 is see-through on masked textures
    const mesh = m.meshes[0];
    expect(mesh.positions.length / 3).toBe(6);
    expect(Array.from(mesh.bones)).toEqual([0, 1, 1, 1, 1, 0]); // corners 0,1,2 then 2,1,3
    // second triangle of a strip flips winding: corners 2,1,3
    expect(Array.from(mesh.positions.subarray(9, 18))).toEqual([0, 1, 0, 1, 0, 0, 1, 1, 0]);
    expect(Array.from(mesh.uvs.subarray(0, 6))).toEqual([0, 0, 1, 0, 0, 1]);
  });
  it('decodes RLE animation channels on top of the bone defaults', () => {
    const s = m.sequences[0];
    expect([s.label, s.fps, s.frames]).toEqual(['idle', 15, 3]);
    const x = (f: number) => s.poses[(f * 2 + 1) * 7];
    expect([x(0), x(1), x(2)]).toEqual([5 + 4 * 0.5, 5 + 10 * 0.5, 5 + 10 * 0.5]);
    expect(Array.from(s.poses.subarray(3, 7))).toEqual([0, 0, 0, 1]);
  });
});

describe('angleQuaternion', () => {
  it('turns yaw (z) into a rotation about z', () => {
    const q = angleQuaternion(0, 0, Math.PI / 2);
    expect(q[2]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(q[3]).toBeCloseTo(Math.SQRT1_2, 6);
  });
});
