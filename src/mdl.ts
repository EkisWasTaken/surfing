// Source studio model reader (MDL v44–49 + VVD + VTX v7), LOD 0, first model of each body part.
// Untrusted input: any out-of-range read throws inside DataView and the model is skipped (null).
export type ModelMesh = {
  positions: Float32Array; // Source coords
  normals: Float32Array;
  uvs: Float32Array;
  // Triangles grouped by texture; `materials` are candidate paths (each cdmaterials dir + texture name).
  groups: { materials: string[]; start: number; count: number }[];
};

export function parseModel(mdl: Uint8Array, vvd: Uint8Array, vtx: Uint8Array, skin = 0): ModelMesh | null {
  try {
    return read(mdl, vvd, vtx, skin);
  } catch {
    return null;
  }
}

function read(mdlBytes: Uint8Array, vvdBytes: Uint8Array, vtxBytes: Uint8Array, skin: number): ModelMesh | null {
  const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
  const m = view(mdlBytes), v = view(vvdBytes), x = view(vtxBytes);
  if (m.getUint32(0, true) !== 0x54534449 || v.getUint32(0, true) !== 0x56534449 || x.getInt32(0, true) !== 7) return null;
  const mi = (o: number) => m.getInt32(o, true);
  const cstr = (o: number) => {
    let e = o;
    while (e < mdlBytes.length && mdlBytes[e] !== 0) e++;
    return new TextDecoder('latin1').decode(mdlBytes.subarray(o, e));
  };

  const version = mi(4);
  const textures = Array.from({ length: mi(204) }, (_, i) => {
    const t = mi(208) + i * 64;
    return cstr(t + mi(t));
  });
  const dirs = Array.from({ length: mi(212) }, (_, i) => cstr(mi(mi(216) + i * 4)));
  const numRefs = mi(220), families = mi(224), skinTable = mi(228);
  const textureFor = (material: number) =>
    skin > 0 && skin < families && material < numRefs ? m.getInt16(skinTable + (skin * numRefs + material) * 2, true) : material;

  // VVD LOD 0 vertices, applying the fixup table when present.
  const numVerts = v.getInt32(16, true), numFixups = v.getInt32(48, true), fixups = v.getInt32(52, true), data = v.getInt32(56, true);
  let order: number[] = [];
  if (numFixups > 0) {
    for (let f = 0; f < numFixups; f++) {
      const o = fixups + f * 12;
      if (v.getInt32(o, true) < 0) continue;
      const src = v.getInt32(o + 4, true), n = v.getInt32(o + 8, true);
      for (let k = 0; k < n; k++) order.push(src + k);
    }
  } else order = Array.from({ length: numVerts }, (_, i) => i);
  const vert = (i: number) => data + order[i] * 48;
  if (order.some((i) => data + i * 48 + 48 > vvdBytes.length)) return null;

  // CS:GO (v49) VTX strip-group headers carry two extra topology ints.
  const sgSize = version >= 49 ? 33 : 25;
  const buckets = new Map<number, { p: number[]; n: number[]; uv: number[] }>();
  const xi = (o: number) => x.getInt32(o, true);

  for (let b = 0; b < Math.min(mi(232), xi(28)); b++) {
    const bp = mi(236) + b * 16;
    if (mi(bp + 4) < 1) continue;
    const model = bp + mi(bp + 12);
    const vertexBase = mi(model + 84) / 48;
    const xbp = xi(32) + b * 8;
    if (xi(xbp) < 1) continue;
    const xmodel = xbp + xi(xbp + 4);
    if (xi(xmodel) < 1) continue;
    const lod = xmodel + xi(xmodel + 4);
    for (let k = 0; k < Math.min(mi(model + 72), xi(lod)); k++) {
      const mesh = model + mi(model + 76) + k * 116;
      const tex = textureFor(mi(mesh));
      const vertexOffset = mi(mesh + 12);
      const xmesh = lod + xi(lod + 4) + k * 9;
      let bucket = buckets.get(tex);
      if (!bucket) buckets.set(tex, (bucket = { p: [], n: [], uv: [] }));
      for (let s = 0; s < xi(xmesh); s++) {
        const sg = xmesh + xi(xmesh + 4) + s * sgSize;
        const vertsAt = sg + xi(sg + 4), indicesAt = sg + xi(sg + 12), numIndices = xi(sg + 8);
        const idx = (i: number) => vertexBase + vertexOffset + x.getUint16(vertsAt + x.getUint16(indicesAt + i * 2, true) * 9 + 4, true);
        for (let i = 0; i + 2 < numIndices; i += 3) {
          const tri = [idx(i), idx(i + 1), idx(i + 2)].map(vert);
          const pos = tri.map((o) => [v.getFloat32(o + 16, true), v.getFloat32(o + 20, true), v.getFloat32(o + 24, true)]);
          const nrm = tri.map((o) => [v.getFloat32(o + 28, true), v.getFloat32(o + 32, true), v.getFloat32(o + 36, true)]);
          // Orient so the geometric normal agrees with the averaged vertex normals.
          const [a, c, d] = pos;
          const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2], wx = d[0] - a[0], wy = d[1] - a[1], wz = d[2] - a[2];
          const sn = [0, 1, 2].map((q) => nrm[0][q] + nrm[1][q] + nrm[2][q]);
          const agree = (uy * wz - uz * wy) * sn[0] + (uz * wx - ux * wz) * sn[1] + (ux * wy - uy * wx) * sn[2] >= 0;
          for (const j of agree ? [0, 1, 2] : [0, 2, 1]) {
            bucket.p.push(...pos[j]);
            bucket.n.push(...nrm[j]);
            bucket.uv.push(v.getFloat32(tri[j] + 40, true), v.getFloat32(tri[j] + 44, true));
          }
        }
      }
    }
  }

  const groups: ModelMesh['groups'] = [];
  const p: number[] = [], n: number[] = [], uv: number[] = [];
  for (const [tex, bucket] of buckets) {
    if (!bucket.p.length) continue;
    const name = textures[tex] ?? '';
    groups.push({ materials: dirs.map((d) => d + name), start: p.length / 3, count: bucket.p.length / 3 });
    for (let i = 0; i < bucket.p.length; i++) p.push(bucket.p[i]), n.push(bucket.n[i]);
    for (let i = 0; i < bucket.uv.length; i++) uv.push(bucket.uv[i]);
  }
  return groups.length ? { positions: new Float32Array(p), normals: new Float32Array(n), uvs: new Float32Array(uv), groups } : null;
}
