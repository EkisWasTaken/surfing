// GoldSrc (Half-Life / CS 1.6) studio model reader, .mdl version 10: meshes, 8-bit textures, bones and animations.
// Vertices and normals are stored in their bone's space, so skinning with identity inverse-bind matrices poses them.

export type MdlTexture = { name: string; width: number; height: number; rgba: Uint8Array; masked: boolean };
export type MdlBone = { name: string; parent: number };
// Triangles unrolled per texture: positions/normals in bone space, uvs 0..1, bone index per vertex.
export type MdlMesh = { texture: number; positions: Float32Array; normals: Float32Array; uvs: Float32Array; bones: Uint16Array };
// poses: per frame, per bone: [px, py, pz, qx, qy, qz, qw] (parent space).
export type MdlSequence = { label: string; fps: number; frames: number; poses: Float32Array };
export type Mdl = { bones: MdlBone[]; textures: MdlTexture[]; meshes: MdlMesh[]; sequences: MdlSequence[] };

const MASKED = 0x40; // STUDIO_NF_MASKED: palette index 255 is transparent

// Quake/GoldSrc AngleQuaternion (angles in radians: x = roll, y = pitch, z = yaw).
export function angleQuaternion(x: number, y: number, z: number): [number, number, number, number] {
  const sy = Math.sin(z / 2), cy = Math.cos(z / 2), sp = Math.sin(y / 2), cp = Math.cos(y / 2), sr = Math.sin(x / 2), cr = Math.cos(x / 2);
  return [sr * cp * cy - cr * sp * sy, cr * sp * cy + sr * cp * sy, cr * cp * sy - sr * sp * cy, cr * cp * cy + sr * sp * sy];
}

export function parseMdl(buf: ArrayBuffer): Mdl {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  const i32 = (o: number) => dv.getInt32(o, true), f32 = (o: number) => dv.getFloat32(o, true), i16 = (o: number) => dv.getInt16(o, true);
  const str = (o: number, n: number) => {
    const b = u8.subarray(o, o + n), end = b.indexOf(0);
    return new TextDecoder().decode(end < 0 ? b : b.subarray(0, end));
  };
  if (str(0, 4) !== 'IDST' || i32(4) !== 10) throw new Error('mdl: not a GoldSrc studio model (IDST v10)');

  // Bones: name[32], parent, flags, bonecontroller[6], value[6], scale[6] (112 bytes).
  const numBones = i32(140), boneAt = i32(144);
  const raw = Array.from({ length: numBones }, (_, i) => {
    const o = boneAt + i * 112;
    return { name: str(o, 32), parent: i32(o + 32), value: Array.from({ length: 6 }, (_, k) => f32(o + 64 + k * 4)), scale: Array.from({ length: 6 }, (_, k) => f32(o + 88 + k * 4)) };
  });

  // Textures: name[64], flags, width, height, index → w*h palette indices then a 256-colour RGB palette.
  const textures: MdlTexture[] = Array.from({ length: i32(180) }, (_, i) => {
    const o = i32(184) + i * 80, flags = i32(o + 64), w = i32(o + 68), h = i32(o + 72), at = i32(o + 76);
    const pal = at + w * h, rgba = new Uint8Array(w * h * 4), masked = (flags & MASKED) !== 0;
    for (let p = 0; p < w * h; p++) {
      const c = u8[at + p];
      rgba.set([u8[pal + c * 3], u8[pal + c * 3 + 1], u8[pal + c * 3 + 2], masked && c === 255 ? 0 : 255], p * 4);
    }
    return { name: str(o, 64), width: w, height: h, rgba, masked };
  });
  const skinRefs = i32(192), skins = Array.from({ length: skinRefs }, (_, k) => i16(i32(200) + k * 2)); // skin family 0

  // Body parts → first model of each (default body) → meshes of triangle strip/fan commands.
  const byTexture = new Map<number, { p: number[]; n: number[]; uv: number[]; b: number[] }>();
  for (let bp = 0; bp < i32(204); bp++) {
    const bo = i32(208) + bp * 76;
    if (i32(bo + 64) < 1) continue;
    const mo = i32(bo + 72); // model 0: name[64], type, radius, nummesh, meshindex, numverts, vertinfo, verts, numnorms, norminfo, norms…
    const vertInfo = i32(mo + 84), verts = i32(mo + 88), norms = i32(mo + 100);
    for (let m = 0; m < i32(mo + 72); m++) {
      const me = i32(mo + 76) + m * 20, tex = skins[i32(me + 8)] ?? 0, t = textures[tex];
      if (!byTexture.has(tex)) byTexture.set(tex, { p: [], n: [], uv: [], b: [] });
      const out = byTexture.get(tex)!;
      const corner = (c: number) => {
        const v = i16(c), n = i16(c + 2);
        out.p.push(f32(verts + v * 12), f32(verts + v * 12 + 4), f32(verts + v * 12 + 8));
        out.n.push(f32(norms + n * 12), f32(norms + n * 12 + 4), f32(norms + n * 12 + 8));
        out.uv.push(i16(c + 4) / (t?.width || 1), i16(c + 6) / (t?.height || 1));
        out.b.push(u8[vertInfo + v]); // normals share their vertex's bone
      };
      let c = i32(me + 4);
      for (;;) {
        let count = i16(c);
        c += 2;
        if (count === 0) break;
        const fan = count < 0;
        count = Math.abs(count);
        const at = (k: number) => c + k * 8;
        for (let k = 0; k + 2 < count; k++) {
          // Fans pivot on the first corner; strips alternate winding every other triangle.
          if (fan) [0, k + 1, k + 2].forEach((x) => corner(at(x)));
          else (k % 2 ? [k + 1, k, k + 2] : [k, k + 1, k + 2]).forEach((x) => corner(at(x)));
        }
        c += count * 8;
      }
    }
  }
  const meshes: MdlMesh[] = [...byTexture].map(([texture, d]) => ({ texture, positions: new Float32Array(d.p), normals: new Float32Array(d.n), uvs: new Float32Array(d.uv), bones: new Uint16Array(d.b) }));

  // Sequences (176 bytes each); animation data of sequence group 0 lives in this file (others: v_*01.mdl, skipped).
  const sequences: MdlSequence[] = [];
  for (let s = 0; s < i32(164); s++) {
    const so = i32(168) + s * 176, frames = Math.max(1, i32(so + 56));
    if (i32(so + 156) !== 0) continue;
    const anim = i32(so + 124), poses = new Float32Array(frames * numBones * 7);
    for (let b = 0; b < numBones; b++) {
      const ao = anim + b * 12, bone = raw[b];
      for (let f = 0; f < frames; f++) {
        const ch = bone.value.slice();
        for (let j = 0; j < 6; j++) {
          const off = dv.getUint16(ao + j * 2, true);
          if (!off) continue;
          // RLE: each run is {valid, total} then `valid` shorts; a run's last value repeats for the rest of `total`.
          let v = ao + off, k = f;
          while (u8[v + 1] <= k && u8[v + 1] > 0) {
            k -= u8[v + 1];
            v += (u8[v] + 1) * 2;
          }
          ch[j] += i16(v + 2 * (u8[v] > k ? k + 1 : u8[v])) * bone.scale[j];
        }
        poses.set([ch[0], ch[1], ch[2], ...angleQuaternion(ch[3], ch[4], ch[5])], (f * numBones + b) * 7);
      }
    }
    sequences.push({ label: str(so, 32), fps: f32(so + 32) || 30, frames, poses });
  }
  return { bones: raw.map((b) => ({ name: b.name, parent: b.parent })), textures, meshes, sequences };
}
