// Builds a minimal synthetic Source BSP (v21) for parser tests.
type Lump = { index: number; size: number; count: number; write: (dv: DataView, off: number, i: number) => void } | { index: number; bytes: Uint8Array };

export type BoxSpec = { mins: number[]; maxs: number[]; contents: number };

export function buildBsp(opts: {
  entities: string;
  world: BoxSpec[];
  submodels: BoxSpec[][]; // models 1..n
  // light.size = luxels per axis minus one (Source's LightmapTextureSizeInLuxels); samples are [r, g, b, exp] per luxel.
  // Lightmap axes: s = x/256 + 2, t = y/256 + 2 (so a ±512 face spans luxels 0..4).
  face?: { verts: number[][]; reflectivity: number[]; name: string; flags: number; normal?: number[]; light?: { size: number[]; samples: number[][] }; model?: number; side?: number }[]; // faces must be grouped by model, in order
  // Put lighting in the HDR lumps only (53 + face table 58), leaving the LDR face offsets meaningless, as real HDR-only maps do.
  hdrOnly?: boolean;
  lzmaLump?: boolean;
  ident?: string;
  // Static props game lump ('sprp'), version 10 (76-byte entries) or 11 (80, with scale).
  staticProps?: { version: 10 | 11; models: string[]; props: { origin: number[]; angles: number[]; model: number; skin?: number; scale?: number }[] };
}): ArrayBuffer {
  const planes: { n: number[]; d: number }[] = [];
  const brushes: { first: number; num: number; contents: number }[] = [];
  const sides: number[] = [];
  const addBox = (b: BoxSpec) => {
    const first = sides.length;
    const ps = [
      { n: [1, 0, 0], d: b.maxs[0] }, { n: [-1, 0, 0], d: -b.mins[0] },
      { n: [0, 1, 0], d: b.maxs[1] }, { n: [0, -1, 0], d: -b.mins[1] },
      { n: [0, 0, 1], d: b.maxs[2] }, { n: [0, 0, -1], d: -b.mins[2] },
    ];
    for (const p of ps) {
      sides.push(planes.length);
      planes.push(p);
    }
    brushes.push({ first, num: 6, contents: b.contents });
    return brushes.length - 1;
  };

  // One node per model, both children pointing at that model's single leaf.
  const leafBrushLists: number[][] = [];
  const models = [opts.world, ...opts.submodels];
  for (const m of models) leafBrushLists.push(m.map(addBox));
  const leafbrushes: number[] = [];
  const leafs = leafBrushLists.map((list) => {
    const first = leafbrushes.length;
    leafbrushes.push(...list);
    return { first, num: list.length };
  });

  const faces = opts.face ?? [];
  const verts: number[][] = [];
  const edges: number[][] = [[0, 0]];
  const surfedges: number[] = [];
  const names: string[] = [];
  const faceRecs = faces.map((f) => {
    const firstedge = surfedges.length;
    const base = verts.length;
    verts.push(...f.verts);
    for (let i = 0; i < f.verts.length; i++) {
      edges.push([base + i, base + ((i + 1) % f.verts.length)]);
      surfedges.push(edges.length - 1);
    }
    names.push(f.name);
    // Face plane: given, or from the first three verts (counter-clockwise = front).
    const [a, b, c] = f.verts;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = f.normal ?? [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const len = Math.hypot(n[0], n[1], n[2]);
    planes.push({ n: n.map((x) => x / len), d: 0 });
    return { firstedge, numedges: f.verts.length, texinfo: names.length - 1, plane: planes.length - 1 };
  });
  const lighting: number[] = [];
  const lightOfs = faces.map((f) => {
    if (!f.light) return -1;
    const o = lighting.length;
    for (const s of f.light.samples) lighting.push(s[0], s[1], s[2], s[3] & 0xff);
    return o;
  });
  const writeFace = (lightofsFor: (i: number) => number) => (dv: DataView, o: number, i: number) => {
    dv.setUint16(o, faceRecs[i].plane, true);
    dv.setUint8(o + 2, faces[i].side ?? 0);
    dv.setInt32(o + 4, faceRecs[i].firstedge, true);
    dv.setInt16(o + 8, faceRecs[i].numedges, true);
    dv.setInt16(o + 10, faceRecs[i].texinfo, true);
    dv.setInt16(o + 12, -1, true);
    dv.setUint8(o + 16, 0); // style 0 = normal light; rest unused (255)
    dv.setUint8(o + 17, 255);
    dv.setUint8(o + 18, 255);
    dv.setUint8(o + 19, 255);
    dv.setInt32(o + 20, lightofsFor(i), true);
    const size = faces[i].light?.size ?? [0, 0];
    dv.setInt32(o + 36, size[0], true);
    dv.setInt32(o + 40, size[1], true);
  };
  const strData = names.map((n) => n + '\0').join('');
  const strOffsets: number[] = [];
  names.reduce((off, n) => (strOffsets.push(off), off + n.length + 1), 0);

  const lumps: Lump[] = [
    { index: 0, bytes: new TextEncoder().encode(opts.entities + '\0') },
    { index: 1, size: 20, count: planes.length, write: (dv, o, i) => { planes[i].n.forEach((v, k) => dv.setFloat32(o + k * 4, v, true)); dv.setFloat32(o + 12, planes[i].d, true); } },
    { index: 2, size: 32, count: faces.length, write: (dv, o, i) => { faces[i].reflectivity.forEach((v, k) => dv.setFloat32(o + k * 4, v, true)); dv.setInt32(o + 12, i, true); dv.setInt32(o + 16, 128, true); dv.setInt32(o + 20, 128, true); } },
    { index: 3, size: 12, count: verts.length, write: (dv, o, i) => verts[i].forEach((v, k) => dv.setFloat32(o + k * 4, v, true)) },
    { index: 5, size: 32, count: models.length, write: (dv, o, i) => { dv.setInt32(o + 4, -(i + 1), true); dv.setInt32(o + 8, -(i + 1), true); } },
    { index: 6, size: 72, count: faces.length, write: (dv, o, i) => { dv.setFloat32(o, 1, true); dv.setFloat32(o + 20, -1, true); dv.setFloat32(o + 32, 1 / 256, true); dv.setFloat32(o + 44, 2, true); dv.setFloat32(o + 52, 1 / 256, true); dv.setFloat32(o + 60, 2, true); dv.setInt32(o + 64, faces[i].flags, true); dv.setInt32(o + 68, i, true); } },
    { index: 7, size: 56, count: faceRecs.length, write: writeFace((i) => (opts.hdrOnly ? 0 : lightOfs[i])) },
    { index: opts.hdrOnly ? 53 : 8, bytes: new Uint8Array(lighting) },
    ...(opts.hdrOnly ? [{ index: 58, size: 56, count: faceRecs.length, write: writeFace((i) => lightOfs[i]) }] : []),
    { index: 10, size: 32, count: leafs.length, write: (dv, o, i) => { dv.setInt32(o, 1, true); dv.setUint16(o + 24, leafs[i].first, true); dv.setUint16(o + 26, leafs[i].num, true); } },
    { index: 12, size: 4, count: edges.length, write: (dv, o, i) => { dv.setUint16(o, edges[i][0], true); dv.setUint16(o + 2, edges[i][1], true); } },
    { index: 13, size: 4, count: surfedges.length, write: (dv, o, i) => dv.setInt32(o, surfedges[i], true) },
    { index: 14, size: 48, count: models.length, write: (dv, o, i) => { dv.setFloat32(o + 8, -100, true); dv.setInt32(o + 36, i, true); const first = faces.findIndex((f) => (f.model ?? 0) === i); dv.setInt32(o + 40, Math.max(0, first), true); dv.setInt32(o + 44, faces.filter((f) => (f.model ?? 0) === i).length, true); } },
    { index: 17, size: 2, count: leafbrushes.length, write: (dv, o, i) => dv.setUint16(o, leafbrushes[i], true) },
    { index: 18, size: 12, count: brushes.length, write: (dv, o, i) => { dv.setInt32(o, brushes[i].first, true); dv.setInt32(o + 4, brushes[i].num, true); dv.setInt32(o + 8, brushes[i].contents, true); } },
    { index: 19, size: 8, count: sides.length, write: (dv, o, i) => dv.setUint16(o, sides[i], true) },
    { index: 43, bytes: new TextEncoder().encode(strData) },
    { index: 35, bytes: gameLump(opts.staticProps) },
    { index: 44, size: 4, count: strOffsets.length, write: (dv, o, i) => dv.setInt32(o, strOffsets[i], true) },
  ];

  const HEADER = 1036;
  const sizes = lumps.map((l) => ('bytes' in l ? l.bytes.length : l.size * l.count));
  const total = HEADER + sizes.reduce((a, b) => a + b, 0);
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  const ident = opts.ident ?? 'VBSP';
  for (let i = 0; i < 4; i++) dv.setUint8(i, ident.charCodeAt(i));
  dv.setInt32(4, 21, true);
  let off = HEADER;
  lumps.forEach((l, k) => {
    dv.setInt32(8 + l.index * 16, off, true);
    dv.setInt32(8 + l.index * 16 + 4, sizes[k], true);
    if ('bytes' in l) new Uint8Array(buf, off, l.bytes.length).set(l.bytes);
    else for (let i = 0; i < l.count; i++) l.write(dv, off + i * l.size, i);
    // Game lump entries point at absolute file offsets; the sprp data follows the 20-byte directory.
    if (l.index === 35 && opts.staticProps) dv.setInt32(off + 12, off + 20, true);
    if (opts.lzmaLump && l.index === 1) 'LZMA'.split('').forEach((c, j) => dv.setUint8(off + j, c.charCodeAt(0)));
    off += sizes[k];
  });
  return buf;
}

function gameLump(sp?: { version: 10 | 11; models: string[]; props: { origin: number[]; angles: number[]; model: number; skin?: number; scale?: number }[] }): Uint8Array {
  if (!sp) return new Uint8Array(4); // zero game lumps
  const size = sp.version === 11 ? 80 : 76;
  const dataLen = 4 + sp.models.length * 128 + 4 + 4 + sp.props.length * size;
  const out = new Uint8Array(20 + dataLen);
  const dv = new DataView(out.buffer);
  dv.setInt32(0, 1, true);
  dv.setInt32(4, 0x73707270, true); // 'sprp'
  dv.setUint16(10, sp.version, true);
  dv.setInt32(16, dataLen, true);
  let p = 20;
  dv.setInt32(p, sp.models.length, true);
  p += 4;
  for (const m of sp.models) out.set(new TextEncoder().encode(m), p), (p += 128);
  dv.setInt32(p, 0, true); // no leaves
  p += 4;
  dv.setInt32(p, sp.props.length, true);
  p += 4;
  for (const pr of sp.props) {
    pr.origin.forEach((v, k) => dv.setFloat32(p + k * 4, v, true));
    pr.angles.forEach((v, k) => dv.setFloat32(p + 12 + k * 4, v, true));
    dv.setUint16(p + 24, pr.model, true);
    dv.setInt32(p + 32, pr.skin ?? 0, true);
    if (size === 80) dv.setFloat32(p + 76, pr.scale ?? 1, true);
    p += size;
  }
  return out;
}
