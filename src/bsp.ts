// Source engine BSP (v19–21, CS:GO/CS:S era) reader: collision brushes, visible faces, entities.
// The file is untrusted user input: every offset is bounds-checked by DataView, and failures throw clear errors.
import { Vec3, vec, add, dot, scale, angleVectors } from './math';
import type { Brush, Plane } from './brush';
import { readZip } from './pak';

// landmark: arrive at the same offset from dest as from the landmark, keeping angles and velocity.
// keepAngles: landmark or the "preserve angles" flag; otherwise the view turns to the destination's yaw.
export type Teleport = { brushes: Brush[]; dest: Vec3; yaw: number; landmark: Vec3 | null; keepAngles: boolean };
// trigger_hurt: damage per second (Source/GoldSrc default 10), dealt in half-second doses.
export type Hurt = { brushes: Brush[]; damage: number };
// trigger_push: base velocity while inside; `once` pushes a single impulse on entry.
export type Push = { brushes: Brush[]; vel: Vec3; once: boolean };
// angles are Source (pitch, yaw, roll) in x, y, z.
export type StaticProp = { model: string; origin: Vec3; angles: Vec3; skin: number; scale: number };
export type BspMap = {
  brushes: Brush[];
  // Triangles sorted by texture; each group is one texture's range of vertices.
  mesh: { positions: Float32Array; colors: Float32Array; uvs: Float32Array; lmUvs: Float32Array; groups: { texture: string; start: number; count: number }[] };
  // Baked lighting atlas, RGBA8 with each channel = encodeLight(linear light).
  // exposure: map-wide brightness scale standing in for Source's overbright/auto-exposure.
  lightmap: { width: number; height: number; data: Uint8Array; exposure: number };
  pak: Map<string, Uint8Array>; // files packed in the map (materials, textures, models)
  props: StaticProp[];
  skyName: string; // worldspawn skyname: materials/skybox/<name>{rt,bk,lf,ft,up,dn}
  fog: { color: number[]; start: number; end: number; max: number } | null; // env_fog_controller, sRGB 0–1 color
  spawn: Vec3;
  spawnYaw: number;
  teleports: Teleport[];
  pushes: Push[];
  hurts: Hurt[];
  startZone: Brush[] | null;
  endZone: Brush[] | null;
  killZ: number;
};

const L = { LIGHTING: 8, LIGHTING_HDR: 53, FACES_HDR: 58, GAME: 35, PAKFILE: 40, ENTITIES: 0, PLANES: 1, TEXDATA: 2, VERTEXES: 3, NODES: 5, TEXINFO: 6, FACES: 7, LEAFS: 10, EDGES: 12, SURFEDGES: 13, MODELS: 14, LEAFBRUSHES: 17, BRUSHES: 18, BRUSHSIDES: 19, TEXSTR_DATA: 43, TEXSTR_TABLE: 44 };
// MASK_PLAYERSOLID: solid | window | grate | playerclip | monster.
const PLAYER_SOLID = 0x1 | 0x2 | 0x8 | 0x10000 | 0x2000000;
// sky2d | sky | trigger | nodraw | hint | skip
const HIDDEN_SURF = 0x2 | 0x4 | 0x40 | 0x80 | 0x100 | 0x200;
const SURF_NOLIGHT = 0x400;
// Brush entities that are solid in their starting position (doors/movers are treated as static).
const SOLID_ENTITIES = /^func_(brush|wall|wall_toggle|breakable|door|door_rotating|movelinear|button)$/;
// Brush entities that are drawn (includes non-solid decoration like func_illusionary).
const VISIBLE_ENTITIES = /^func_(brush|wall|wall_toggle|breakable|door|door_rotating|movelinear|button|illusionary|rotating|lod)$/;

// Lightmaps go into 8 bits as sqrt(light / 4): keeps 4× overbright with precision where it matters (darks).
export const encodeLight = (v: number) => Math.round(Math.sqrt(Math.min(1, Math.max(0, v / 4))) * 255);
export const decodeLight = (b: number) => (b / 255) ** 2 * 4;

// One exposure per map: put the 75th-percentile lit luxel at 0.5 linear, within 1–8×.
function exposureFor(lums: number[]): number {
  if (!lums.length) return 1;
  lums.sort((a, b) => a - b);
  const p75 = lums[Math.floor(lums.length * 0.75)];
  return p75 > 0 ? Math.min(8, Math.max(1, 0.5 / p75)) : 8;
}

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
  // Brush entity models are stored relative to the entity's origin key.
  // shortcut: entity angles are ignored (rotated brush entities are rare on surf maps); apply them if a map needs it.
  const moved = (b: Brush, o: Vec3): Brush =>
    o.x || o.y || o.z ? { ...b, planes: b.planes.map((p) => ({ normal: p.normal, dist: p.dist + dot(p.normal, o) })), mins: add(b.mins, o), maxs: add(b.maxs, o) } : b;
  const modelOf = (e: Entity, mask: number | null = null) =>
    e.model?.startsWith('*') ? modelBrushes(Number(e.model.slice(1)), mask).map((b) => moved(b, parseVec(e.origin))) : [];
  const enabled = (e: Entity) => e.StartDisabled !== '1';
  const solidEntity = (e: Entity) =>
    SOLID_ENTITIES.test(e.classname ?? '') &&
    enabled(e) &&
    !(e.classname === 'func_brush' && e.Solidity === '1') &&
    !(e.classname === 'func_wall_toggle' && Number(e.spawnflags) & 1);

  const spawnEnt = ['info_player_terrorist', 'info_player_counterterrorist', 'info_player_start', 'info_player_teamspawn', 'info_player_deathmatch'].map((c) => entities.find((e) => e.classname === c)).find(Boolean);
  const teleports: Teleport[] = entities
    .filter((e) => e.classname === 'trigger_teleport' && enabled(e) && e.target && byName.has(e.target))
    .map((e) => {
      const d = byName.get(e.target)!, lm = e.landmark ? byName.get(e.landmark) : undefined;
      const landmark = lm ? parseVec(lm.origin) : null;
      return { brushes: modelOf(e), dest: parseVec(d.origin), yaw: parseVec(d.angles).y, landmark, keepAngles: !!landmark || (Number(e.spawnflags) & 32) !== 0 };
    })
    .filter((t) => t.brushes.length);

  // Surf timers keep zones on the server; some maps still ship triggers named like zones.
  const zone = (re: RegExp, timerClass: string) => {
    const e =
      entities.find((x) => x.classname === timerClass) ??
      entities.find((x) => x.classname?.startsWith('trigger_') && re.test(x.targetname ?? '') && !/stage|bonus|bns/i.test(x.targetname ?? ''));
    const bs = e ? modelOf(e) : [];
    return bs.length ? bs : null;
  };

  return {
    brushes: [...modelBrushes(0, PLAYER_SOLID), ...entities.filter(solidEntity).flatMap((e) => modelOf(e, PLAYER_SOLID))],
    ...readFaces(),
    props: readProps(),
    pak: (() => {
      const { ofs, len } = lump(L.PAKFILE);
      return readZip(new Uint8Array(buffer, ofs, len));
    })(),
    spawn: parseVec(spawnEnt?.origin),
    spawnYaw: parseVec(spawnEnt?.angles).y,
    teleports,
    pushes: entities
      .filter((e) => e.classname === 'trigger_push' && enabled(e) && (Number(e.spawnflags ?? 1) & 1) !== 0)
      .map((e) => {
        const d = parseVec(e.pushdir);
        return { brushes: modelOf(e), vel: scale(angleVectors(d.y, d.x).forward, Number(e.speed) || 0), once: (Number(e.spawnflags) & 128) !== 0 };
      })
      .filter((p) => p.brushes.length),
    hurts: entities
      .filter((e) => e.classname === 'trigger_hurt' && enabled(e))
      .map((e) => ({ brushes: modelOf(e), damage: e.damage === undefined ? 10 : Number(e.damage) || 0 }))
      .filter((h) => h.brushes.length),
    startZone: zone(/start|begin/i, 'trigger_momentum_timer_start'),
    endZone: zone(/end|finish/i, 'trigger_momentum_timer_stop'),
    killZ: models[0].minZ - 1000,
    skyName: entities.find((e) => e.classname === 'worldspawn')?.skyname ?? '',
    fog: (() => {
      const f = entities.find((e) => e.classname === 'env_fog_controller' && e.fogenable === '1');
      if (!f) return null;
      const c = parseVec(f.fogcolor);
      return { color: [c.x, c.y, c.z].map((v) => v / 255), start: Number(f.fogstart) || 0, end: Number(f.fogend) || 10000, max: f.fogmaxdensity === undefined ? 1 : Number(f.fogmaxdensity) };
    })(),
  };

  // Static props live in the 'sprp' game lump. Entry size varies by version, so derive it from the lump length.
  function readProps(): StaticProp[] {
    const { ofs, len } = lump(L.GAME);
    if (len < 4) return [];
    const count = i32(ofs);
    for (let i = 0; i < count && ofs + 4 + i * 16 + 16 <= ofs + len; i++) {
      const e = ofs + 4 + i * 16;
      if (i32(e) !== 0x73707270) continue;
      let p = i32(e + 8);
      const end = p + i32(e + 12);
      // Compressed game lumps (flag 1) aren't supported; the map still loads without props.
      if (dv.getUint16(e + 4, true) & 1 || p < 0 || end > buffer.byteLength || end - p < 12) return [];
      const dict = i32(p);
      p += 4;
      const names: string[] = [];
      for (let k = 0; k < dict && p + 128 <= end; k++, p += 128) {
        const raw = new Uint8Array(buffer, p, 128);
        names.push(new TextDecoder().decode(raw.subarray(0, Math.max(0, raw.indexOf(0)) || 128)).toLowerCase().replace(/\\/g, '/'));
      }
      p += 4 + i32(p) * 2; // leaf list
      const n = i32(p);
      p += 4;
      const size = n > 0 ? Math.floor((end - p) / n) : 0;
      if (size < 56) return [];
      const out: StaticProp[] = [];
      for (let k = 0; k < n; k++, p += size) {
        const model = names[u16(p + 24)];
        if (!model) continue;
        out.push({
          model,
          origin: vec(f32(p), f32(p + 4), f32(p + 8)),
          angles: vec(f32(p + 12), f32(p + 16), f32(p + 20)),
          skin: i32(p + 32),
          scale: size >= 80 ? f32(p + 76) || 1 : 1,
        });
      }
      return out;
    }
    return [];
  }

  function readFaces() {
    const verts = records(L.VERTEXES, 12, (o) => [f32(o), f32(o + 4), f32(o + 8)]);
    const edges = records(L.EDGES, 4, (o) => [u16(o), u16(o + 2)]);
    const surfedges = records(L.SURFEDGES, 4, i32);
    const texinfo = records(L.TEXINFO, 72, (o) => ({ s: [f32(o), f32(o + 4), f32(o + 8), f32(o + 12)], t: [f32(o + 16), f32(o + 20), f32(o + 24), f32(o + 28)], flags: i32(o + 64), texdata: i32(o + 68) }));
    const texdata = records(L.TEXDATA, 32, (o) => ({ color: [f32(o), f32(o + 4), f32(o + 8)], nameId: i32(o + 12), w: i32(o + 16) || 1, h: i32(o + 20) || 1 }));
    const strTable = records(L.TEXSTR_TABLE, 4, i32);
    const { ofs: strOfs, len: strLen } = lump(L.TEXSTR_DATA);
    const texName = (id: number) => {
      const start = strOfs + (strTable[id] ?? strLen);
      let end = start;
      while (end < strOfs + strLen && dv.getUint8(end) !== 0) end++;
      return new TextDecoder().decode(new Uint8Array(buffer, start, end - start));
    };
    const faceRec = (o: number) => ({ plane: u16(o), firstedge: i32(o + 4), numedges: i16(o + 8), texinfo: i16(o + 10), style0: dv.getUint8(o + 16), lightofs: i32(o + 20), lmMins: [i32(o + 28), i32(o + 32)], lmSize: [i32(o + 36), i32(o + 40)] });
    const faces = records(L.FACES, 56, faceRec);
    // LDR lighting uses the main face table; HDR-only maps keep light offsets in a parallel HDR face table.
    let light = lump(L.LIGHTING);
    let lightFaces = faces;
    if (!light.len) {
      light = lump(L.LIGHTING_HDR);
      const hdrFaces = records(L.FACES_HDR, 56, faceRec);
      lightFaces = hdrFaces.length === faces.length ? hdrFaces : [];
    }
    const lmS = (o: number) => [f32(o + 32), f32(o + 36), f32(o + 40), f32(o + 44)];
    const lmT = (o: number) => [f32(o + 48), f32(o + 52), f32(o + 56), f32(o + 60)];
    const lmAxes = records(L.TEXINFO, 72, (o) => ({ s: lmS(o), t: lmT(o) }));

    // poly is in model space (texture/lightmap axes are too); offset places brush entities at their origin.
    type Item = { tex: string; poly: number[][]; offset: Vec3; color: number[]; ti: number; face: number; rect: { x: number; y: number; w: number; h: number } | null };
    const items: Item[] = [];
    const ranges = [
      { model: models[0], offset: vec() },
      ...entities
        .filter((e) => VISIBLE_ENTITIES.test(e.classname ?? '') && e.model?.startsWith('*'))
        .map((e) => ({ model: models[Number(e.model.slice(1))], offset: parseVec(e.origin) }))
        .filter((r) => r.model),
    ];
    for (const { model, offset } of ranges)
    for (let fi = model.firstface; fi < model.firstface + model.numfaces && fi < faces.length; fi++) {
      const f = faces[fi];
      const ti = texinfo[f.texinfo];
      if (!ti || ti.flags & HIDDEN_SURF) continue;
      const td = texdata[ti.texdata];
      const tex = td ? texName(td.nameId) : '';
      if (/^tools\//i.test(tex)) continue;
      const poly: number[][] = [];
      for (let k = 0; k < f.numedges; k++) {
        const se = surfedges[f.firstedge + k];
        const e = edges[Math.abs(se)];
        const v = e && verts[se >= 0 ? e[0] : e[1]];
        if (v) poly.push(v);
      }
      const lf = lightFaces[fi];
      const w = lf ? lf.lmSize[0] + 1 : 0, h = lf ? lf.lmSize[1] + 1 : 0;
      const hasLight = lf && !(ti.flags & SURF_NOLIGHT) && lf.style0 !== 255 && lf.lightofs >= 0 && w > 0 && h > 0 && w <= 512 && h <= 512 && lf.lightofs + w * h * 4 <= light.len;
      items.push({ tex, poly, offset, color: td?.color ?? [0.6, 0.6, 0.6], ti: f.texinfo, face: fi, rect: hasLight ? { x: 0, y: 0, w, h } : null });
    }

    // Shelf-pack every face's luxel rectangle into one atlas; texel (0,0) is reserved white for unlit faces.
    const rects = items.map((it) => it.rect).filter((r): r is NonNullable<Item['rect']> => !!r);
    const area = rects.reduce((s, r) => s + r.w * r.h, 1);
    let W = 256;
    while (W < 8192 && W * W < area * 1.3) W *= 2;
    W = Math.max(W, ...rects.map((r) => r.w));
    let x = 1, y = 0, shelf = 1;
    for (const r of [...rects].sort((a, b) => b.h - a.h)) {
      if (x + r.w > W) (x = 0), (y += shelf), (shelf = 0);
      r.x = x;
      r.y = y;
      x += r.w;
      shelf = Math.max(shelf, r.h);
    }
    let H = 1;
    while (H < y + shelf) H *= 2;
    const atlas = new Uint8Array(W * H * 4).fill(255);
    atlas.set([encodeLight(1), encodeLight(1), encodeLight(1), 255], 0);
    for (const it of items) {
      if (!it.rect) continue;
      const r = it.rect;
      let o = light.ofs + lightFaces[it.face].lightofs;
      for (let ty = 0; ty < r.h; ty++)
        for (let tx = 0; tx < r.w; tx++, o += 4) {
          // ColorRGBExp32: channel * 2^exponent (signed), in 0..255 linear units.
          const scale = Math.pow(2, dv.getInt8(o + 3)) / 255;
          const a = ((r.y + ty) * W + r.x + tx) * 4;
          atlas[a] = encodeLight(dv.getUint8(o) * scale);
          atlas[a + 1] = encodeLight(dv.getUint8(o + 1) * scale);
          atlas[a + 2] = encodeLight(dv.getUint8(o + 2) * scale);
        }
    }

    const buckets = new Map<string, { pos: number[]; col: number[]; uv: number[]; lm: number[] }>();
    const lums: number[] = [];
    for (const it of items) {
      let bucket = buckets.get(it.tex);
      if (!bucket) buckets.set(it.tex, (bucket = { pos: [], col: [], uv: [], lm: [] }));
      const ti = texinfo[it.ti], ax = lmAxes[it.ti], td = texdata[ti.texdata];
      const tw = td?.w ?? 1, th = td?.h ?? 1;
      const lf = lightFaces[it.face];
      // Wind counter-clockwise around the face plane normal: that is always the front. (dface side only says how the
      // face sits on its BSP node; flipping by it culled ~40% of real surfaces.)
      const f = faces[it.face];
      const pn = planes[f.plane]?.normal ?? vec(0, 0, 1);
      const { poly, rect: r } = it;
      for (let k = 1; k + 1 < poly.length; k++) {
        const [a, b, d] = [poly[0], poly[k], poly[k + 1]];
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
        const facing = ((uy * vz - uz * vy) * pn.x + (uz * vx - ux * vz) * pn.y + (ux * vy - uy * vx) * pn.z);
        for (const v of facing >= 0 ? [a, b, d] : [a, d, b]) {
          bucket.pos.push(v[0] + it.offset.x, v[1] + it.offset.y, v[2] + it.offset.z);
          bucket.col.push(...it.color);
          bucket.uv.push((v[0] * ti.s[0] + v[1] * ti.s[1] + v[2] * ti.s[2] + ti.s[3]) / tw, (v[0] * ti.t[0] + v[1] * ti.t[1] + v[2] * ti.t[2] + ti.t[3]) / th);
          if (r) {
            // Luxel coordinates within the face, sampled at luxel centres so filtering stays inside the rectangle.
            const s = Math.min(r.w - 1, Math.max(0, v[0] * ax.s[0] + v[1] * ax.s[1] + v[2] * ax.s[2] + ax.s[3] - lf.lmMins[0]));
            const t = Math.min(r.h - 1, Math.max(0, v[0] * ax.t[0] + v[1] * ax.t[1] + v[2] * ax.t[2] + ax.t[3] - lf.lmMins[1]));
            bucket.lm.push((r.x + s + 0.5) / W, (r.y + t + 0.5) / H);
            const a = ((r.y + Math.floor(t)) * W + r.x + Math.floor(s)) * 4;
            lums.push(0.2126 * decodeLight(atlas[a]) + 0.7152 * decodeLight(atlas[a + 1]) + 0.0722 * decodeLight(atlas[a + 2]));
          } else bucket.lm.push(0.5 / W, 0.5 / H);
        }
      }
    }
    const groups: BspMap['mesh']['groups'] = [];
    const pos: number[] = [], col: number[] = [], uv: number[] = [], lm: number[] = [];
    for (const [texture, b] of buckets) {
      if (!b.pos.length) continue;
      groups.push({ texture, start: pos.length / 3, count: b.pos.length / 3 });
      for (let i = 0; i < b.pos.length; i++) pos.push(b.pos[i]), col.push(b.col[i]);
      for (let i = 0; i < b.uv.length; i++) uv.push(b.uv[i]), lm.push(b.lm[i]);
    }
    return {
      mesh: { positions: new Float32Array(pos), colors: new Float32Array(col), uvs: new Float32Array(uv), lmUvs: new Float32Array(lm), groups },
      lightmap: { width: W, height: H, data: atlas, exposure: exposureFor(lums) },
    };
  }
}
