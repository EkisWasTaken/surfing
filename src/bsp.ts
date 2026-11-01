// Source engine BSP (v19–21, CS:GO/CS:S era) reader: collision brushes, visible faces, entities.
// The file is untrusted user input: every offset is bounds-checked by DataView, and failures throw clear errors.
import { Vec3, vec } from './math';
import type { Brush, Plane } from './brush';

export type Teleport = { brushes: Brush[]; dest: Vec3; yaw: number };
export type BspMap = {
  brushes: Brush[];
  mesh: { positions: Float32Array; colors: Float32Array };
  spawn: Vec3;
  spawnYaw: number;
  teleports: Teleport[];
  startZone: Brush[] | null;
  endZone: Brush[] | null;
  killZ: number;
};

const L = { ENTITIES: 0, PLANES: 1, TEXDATA: 2, VERTEXES: 3, NODES: 5, TEXINFO: 6, FACES: 7, LEAFS: 10, EDGES: 12, SURFEDGES: 13, MODELS: 14, LEAFBRUSHES: 17, BRUSHES: 18, BRUSHSIDES: 19, TEXSTR_DATA: 43, TEXSTR_TABLE: 44 };
// MASK_PLAYERSOLID: solid | window | grate | playerclip | monster.
const PLAYER_SOLID = 0x1 | 0x2 | 0x8 | 0x10000 | 0x2000000;
// sky2d | sky | trigger | nodraw | hint | skip
const HIDDEN_SURF = 0x2 | 0x4 | 0x40 | 0x80 | 0x100 | 0x200;

type Entity = Record<string, string>;

export function parseEntities(text: string): Entity[] {
  const out: Entity[] = [];
  for (const block of text.matchAll(/\{([^}]*)\}/g)) {
    const e: Entity = {};
    for (const kv of block[1].matchAll(/"([^"]*)"\s+"([^"]*)"/g)) e[kv[1]] = kv[2];
    out.push(e);
  }
  return out;
}

const parseVec = (s: string | undefined) => {
  const [x = 0, y = 0, z = 0] = (s ?? '').trim().split(/\s+/).map(Number);
  return vec(x || 0, y || 0, z || 0);
};

export function parseBsp(buffer: ArrayBuffer, name: string): BspMap {
  const dv = new DataView(buffer);
  if (buffer.byteLength < 1036 || String.fromCharCode(...new Uint8Array(buffer, 0, 4)) !== 'VBSP')
    throw new Error(`${name} is not a Source BSP map (CS2 maps are .vpk and aren't supported)`);
  const version = dv.getInt32(4, true);
  if (version < 20 || version > 21) throw new Error(`${name}: BSP version ${version} isn't supported (need 20–21, CS:S or CS:GO)`);

  const lump = (i: number) => {
    const ofs = dv.getInt32(8 + i * 16, true), len = dv.getInt32(8 + i * 16 + 4, true);
    if (ofs < 0 || len < 0 || ofs + len > buffer.byteLength) throw new Error(`${name}: lump ${i} is out of bounds (corrupt file?)`);
    if (len >= 4 && String.fromCharCode(...new Uint8Array(buffer, ofs, 4)) === 'LZMA')
      throw new Error(`${name}: this map uses compressed lumps, which aren't supported`);
    return { ofs, len };
  };
  const records = <T>(i: number, size: number, read: (o: number) => T): T[] => {
    const { ofs, len } = lump(i);
    return Array.from({ length: Math.floor(len / size) }, (_, k) => read(ofs + k * size));
  };
  const f32 = (o: number) => dv.getFloat32(o, true);
  const i32 = (o: number) => dv.getInt32(o, true);
  const u16 = (o: number) => dv.getUint16(o, true);
  const i16 = (o: number) => dv.getInt16(o, true);

  const planes = records(L.PLANES, 20, (o) => ({ normal: vec(f32(o), f32(o + 4), f32(o + 8)), dist: f32(o + 12) }));
  const sides = records(L.BRUSHSIDES, 8, (o) => u16(o));
  const rawBrushes = records(L.BRUSHES, 12, (o) => ({ first: i32(o), num: i32(o + 4), contents: i32(o + 8) }));
  const nodes = records(L.NODES, 32, (o) => [i32(o + 4), i32(o + 8)]);
  const leafs = records(L.LEAFS, 32, (o) => ({ first: u16(o + 24), num: u16(o + 26) }));
  const leafbrushes = records(L.LEAFBRUSHES, 2, (o) => u16(o));
  const models = records(L.MODELS, 48, (o) => ({ minZ: f32(o + 8), headnode: i32(o + 36), firstface: i32(o + 40), numfaces: i32(o + 44) }));
  if (!models.length) throw new Error(`${name}: no world model found`);

  const brushCache = new Map<number, Brush>();
  const toBrush = (bi: number): Brush => {
    const cached = brushCache.get(bi);
    if (cached) return cached;
    const rb = rawBrushes[bi];
    const ps: Plane[] = [];
    for (let s = rb.first; s < rb.first + rb.num; s++) {
      const p = planes[sides[s]];
      if (p) ps.push(p);
    }
    // vbsp always emits the six axial bevels; they give the bounding box.
    const BIG = 1e6;
    const mins = vec(-BIG, -BIG, -BIG), maxs = vec(BIG, BIG, BIG);
    for (const p of ps) {
      const n = p.normal;
      if (n.x === 1) maxs.x = p.dist; else if (n.x === -1) mins.x = -p.dist;
      else if (n.y === 1) maxs.y = p.dist; else if (n.y === -1) mins.y = -p.dist;
      else if (n.z === 1) maxs.z = p.dist; else if (n.z === -1) mins.z = -p.dist;
    }
    const b: Brush = { kind: 'bsp', planes: ps, mins, maxs };
    brushCache.set(bi, b);
    return b;
  };

  // Brushes of one model = brushes referenced by the leaves under its head node.
  const modelBrushes = (mi: number, mask: number | null): Brush[] => {
    const found = new Set<number>();
    const stack = [models[mi]?.headnode ?? -1];
    const seen = new Set<number>();
    while (stack.length) {
      const n = stack.pop()!;
      if (seen.has(n)) continue;
      seen.add(n);
      if (n < 0) {
        const leaf = leafs[-n - 1];
        if (!leaf) continue;
        for (let k = leaf.first; k < leaf.first + leaf.num; k++) found.add(leafbrushes[k]);
      } else if (nodes[n]) stack.push(...nodes[n]);
    }
    return [...found].filter((bi) => rawBrushes[bi] && (mask === null || rawBrushes[bi].contents & mask)).map(toBrush);
  };

  const { ofs: entOfs, len: entLen } = lump(L.ENTITIES);
  const entities = parseEntities(new TextDecoder().decode(new Uint8Array(buffer, entOfs, entLen)));
  const byName = new Map(entities.filter((e) => e.targetname).map((e) => [e.targetname, e]));
  const modelOf = (e: Entity) => (e.model?.startsWith('*') ? modelBrushes(Number(e.model.slice(1)), null) : []);

  const spawnEnt = ['info_player_terrorist', 'info_player_counterterrorist', 'info_player_start'].map((c) => entities.find((e) => e.classname === c)).find(Boolean);
  const teleports: Teleport[] = entities
    .filter((e) => e.classname === 'trigger_teleport' && e.target && byName.has(e.target))
    .map((e) => {
      const d = byName.get(e.target)!;
      return { brushes: modelOf(e), dest: parseVec(d.origin), yaw: parseVec(d.angles).y };
    })
    .filter((t) => t.brushes.length);

  // Surf timers keep zones on the server; some maps still ship triggers named like zones.
  const zone = (re: RegExp) => {
    const e = entities.find((x) => x.classname?.startsWith('trigger_') && re.test(x.targetname ?? '') && !/stage|bonus|bns/i.test(x.targetname ?? ''));
    const bs = e ? modelOf(e) : [];
    return bs.length ? bs : null;
  };

  return {
    brushes: modelBrushes(0, PLAYER_SOLID),
    mesh: readFaces(),
    spawn: parseVec(spawnEnt?.origin),
    spawnYaw: parseVec(spawnEnt?.angles).y,
    teleports,
    startZone: zone(/start|begin/i),
    endZone: zone(/end|finish/i),
    killZ: models[0].minZ - 1000,
  };

  function readFaces() {
    const verts = records(L.VERTEXES, 12, (o) => [f32(o), f32(o + 4), f32(o + 8)]);
    const edges = records(L.EDGES, 4, (o) => [u16(o), u16(o + 2)]);
    const surfedges = records(L.SURFEDGES, 4, i32);
    const texinfo = records(L.TEXINFO, 72, (o) => ({ flags: i32(o + 64), texdata: i32(o + 68) }));
    const texdata = records(L.TEXDATA, 32, (o) => ({ color: [f32(o), f32(o + 4), f32(o + 8)], nameId: i32(o + 12) }));
    const strTable = records(L.TEXSTR_TABLE, 4, i32);
    const { ofs: strOfs, len: strLen } = lump(L.TEXSTR_DATA);
    const texName = (id: number) => {
      const start = strOfs + (strTable[id] ?? strLen);
      let end = start;
      while (end < strOfs + strLen && dv.getUint8(end) !== 0) end++;
      return new TextDecoder().decode(new Uint8Array(buffer, start, end - start));
    };
    const faces = records(L.FACES, 56, (o) => ({ plane: u16(o), side: dv.getUint8(o + 2), firstedge: i32(o + 4), numedges: i16(o + 8), texinfo: i16(o + 10) }));
    const pos: number[] = [], col: number[] = [];
    const world = models[0];
    for (let fi = world.firstface; fi < world.firstface + world.numfaces && fi < faces.length; fi++) {
      const f = faces[fi];
      const ti = texinfo[f.texinfo];
      if (!ti || ti.flags & HIDDEN_SURF) continue;
      const td = texdata[ti.texdata];
      if (td && /^tools\//i.test(texName(td.nameId))) continue;
      const poly: number[][] = [];
      for (let k = 0; k < f.numedges; k++) {
        const se = surfedges[f.firstedge + k];
        const e = edges[Math.abs(se)];
        const v = e && verts[se >= 0 ? e[0] : e[1]];
        if (v) poly.push(v);
      }
      const c = td?.color ?? [0.6, 0.6, 0.6];
      // Wind counter-clockwise around the face's front normal (Source stores faces clockwise).
      const pn = planes[f.plane]?.normal ?? vec(0, 0, 1);
      const sign = f.side ? -1 : 1;
      for (let k = 1; k + 1 < poly.length; k++) {
        const [a, b, d] = [poly[0], poly[k], poly[k + 1]];
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
        const facing = ((uy * vz - uz * vy) * pn.x + (uz * vx - ux * vz) * pn.y + (ux * vy - uy * vx) * pn.z) * sign;
        for (const v of facing >= 0 ? [a, b, d] : [a, d, b]) pos.push(...v), col.push(...c);
      }
    }
    return { positions: new Float32Array(pos), colors: new Float32Array(col) };
  }
}
