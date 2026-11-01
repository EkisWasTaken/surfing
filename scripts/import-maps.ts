// Copies surf maps from your own CS:GO/CS2 install into public/maps, where the game lists them, and bundles the
// stock textures each map needs as <map>.stock.zip: from CS:GO legacy archives when installed (exact), otherwise
// from the converted copies CS2 still ships (partial).
// Usage: npm run import-maps [-- "path/to/csgo/maps"]
// Everything stays on this machine (public/maps is git-ignored): maps and game files belong to their authors.
import { copyFileSync, mkdirSync, readdirSync, existsSync, readFileSync, writeFileSync, openSync, readSync, closeSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parseBsp } from '../src/bsp';
import { readVpkDir, readVpkFile } from '../src/vpk';
import { stockFilesFor } from '../src/stock';
import { createCs2Lookup } from '../src/cs2';
import { writeZip } from '../src/pak';
import { readCs2Mesh, meshToJson, b64, vtexToJson } from '../src/cs2model';
import { readVtex, Vtex } from '../src/cs2';
import { finishParams, compmatInfo, readLocalization, Finish } from '../src/cs2finish';
import { parseKV3, resourceBlocks } from '../src/kv3';
import { decodeClip, readNmSkeleton, NmSkeleton } from '../src/cs2anim';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
// CS2 knife model folders and their in-game names.
const KNIVES: Record<string, string> = {
  knife_default_ct: 'Default CT Knife', knife_default_t: 'Default T Knife', knife_bayonet: 'Bayonet', knife_bowie: 'Bowie Knife',
  knife_butterfly: 'Butterfly Knife', knife_canis: 'Survival Knife', knife_cord: 'Paracord Knife', knife_css: 'Classic Knife',
  knife_falchion: 'Falchion Knife', knife_flip: 'Flip Knife', knife_gut: 'Gut Knife', knife_karambit: 'Karambit',
  knife_kukri: 'Kukri Knife', knife_m9: 'M9 Bayonet', knife_navaja: 'Navaja Knife', knife_outdoor: 'Nomad Knife',
  knife_push: 'Shadow Daggers', knife_skeleton: 'Skeleton Knife', knife_stiletto: 'Stiletto Knife', knife_tactical: 'Huntsman Knife',
  knife_talon: 'Talon Knife', knife_ursus: 'Ursus Knife',
};

const src = process.argv[2] ?? 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive/csgo/maps';
if (!existsSync(src)) {
  console.error(`CS:GO maps folder not found: ${src}\nPass it explicitly: npm run import-maps -- "<path to csgo/maps>"`);
  process.exit(1);
}
const OUT = 'public/maps';
mkdirSync(OUT, { recursive: true });
const copied = readdirSync(src).filter((f) => /^surf_.*\.bsp$/i.test(f));
for (const f of copied) copyFileSync(join(src, f), join(OUT, f));
console.log(`Copied ${copied.length} surf maps into ${OUT}`);

const fds = new Map<string, number>();
function openVpk(dirFile: string) {
  const dir = new Uint8Array(readFileSync(dirFile));
  const vpk = readVpkDir(dir);
  const archive = (i: number, offset: number, length: number) => {
    const part = dirFile.replace(/_dir\.vpk$/, `_${String(i).padStart(3, '0')}.vpk`);
    if (!fds.has(part)) fds.set(part, openSync(part, 'r'));
    const b = Buffer.alloc(length);
    readSync(fds.get(part)!, b, 0, length, offset);
    return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  };
  return { entries: vpk.entries, read: (key: string) => readVpkFile(vpk.entries.get(key)!, dir, vpk.dataStart, archive) };
}

// CS:GO legacy (Steam: CS2 → Properties → Betas → csgo_legacy) keeps the original files in csgo/pak01_*.vpk.
const legacyDir = join(dirname(src), 'pak01_dir.vpk');
const cs2Dir = join(dirname(dirname(src)), 'game', 'csgo', 'pak01_dir.vpk');
let lookup: ((path: string) => Uint8Array | undefined) | null = null;
if (existsSync(legacyDir)) {
  const legacy = openVpk(legacyDir);
  if ([...legacy.entries.keys()].some((k) => k.endsWith('.vtf'))) {
    lookup = (path) => (legacy.entries.has(path) ? legacy.read(path) : undefined);
    console.log('Stock textures: CS:GO legacy archives (exact).');
  }
}
if (!lookup && existsSync(cs2Dir)) {
  const cs2 = openVpk(cs2Dir);
  lookup = createCs2Lookup(cs2.entries, cs2.read);
  console.log('Stock textures: converted from CS2 (partial; install csgo_legacy for the exact set).');
}
// First-person viewmodel from CS2's own files (maps don't need it): the arms, and every knife with its animations.
if (existsSync(cs2Dir)) {
  const cs2 = openVpk(cs2Dir);
  const get = (path: string) => (cs2.entries.has(path) ? cs2.read(path) : undefined);
  const data = (path: string) => parseKV3(resourceBlocks(get(path)!).find((b) => b.type === 'DATA')!.data) as Any;
  const f32 = (a: Float32Array) => b64(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  mkdirSync('public/cs2/knives', { recursive: true });
  try {
    // The default CT agent's own first-person gloves and sleeves, as CS2 shows them with no gloves equipped.
    const arms = await readCs2Mesh(get('agents/models/ctm_sas/ctm_sas.vmdl_c')!, get, ['firstperson_default_gloves_arms', 'firstperson_sleeves']);
    const skeleton = readNmSkeleton(data('animation/skeletons/characters/viewmodel.vnmskel_c'));
    writeFileSync('public/cs2/viewmodel.json', JSON.stringify({ skeleton, arms: meshToJson(arms) }));
    console.log(`Arms: ${arms.positions.length / 3} vertices, ${skeleton.names.length} bones -> public/cs2/viewmodel.json`);
  } catch (e) {
    console.log(`Arms: skipped (${e instanceof Error ? e.message : e})`);
  }
  const keys = [...cs2.entries.keys()];
  const tex = (path: string | undefined) => {
    const b = path && get(path.toLowerCase() + '_c');
    return b ? readVtex(b) : null;
  };
  // Every 4th texel of the largest mip: the position map is smooth, and full size is 8 MB of half floats.
  const shrink = (t: Vtex, by: number): Vtex => {
    const m = t.mips[0], w = m.width / by, h = m.height / by, px = m.data.length / (m.width * m.height), out = new Uint8Array(w * h * px);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.set(m.data.subarray(((y * by) * m.width + x * by) * px, ((y * by) * m.width + x * by + 1) * px), (y * w + x) * px);
    return { width: w, height: h, format: t.format, mips: [{ width: w, height: h, data: out }] };
  };
  // Inputs the finish shader paints over: which areas take paint, ambient occlusion, object-space position.
  const paintInputs = (id: string) => {
    const file = keys.find((k) => k.startsWith(`weapons/models/knife/${id}/materials/composite_inputs/`) && k.endsWith('_composite_inputs.vmat_c'));
    if (!file) return null;
    const p = finishParams(data(file));
    const masks = tex(p.textures.g_tMasks), ao = tex(p.textures.g_tAmbientOcclusion), pos = tex(p.textures.g_tPosition);
    if (!masks || !ao || !pos) return null;
    return { masks: vtexToJson(masks), ao: vtexToJson(ao), pos: vtexToJson(pos.mips[0].width > 256 ? shrink(pos, pos.mips[0].width / 256) : pos), uvScale: p.floats.g_flUvScale1 ?? 1, weaponLength: p.floats.g_flWeaponLength1 ?? 1 };
  };
  // Finishes each knife comes in: CS2 ships a preview image for every knife × finish pair.
  const ECON = 'panorama/images/econ/default_generated/weapon_';
  // Item names that differ from the model folder.
  const ITEM_NAMES: Record<string, string> = { knife_bayonet: 'bayonet', knife_m9: 'knife_m9_bayonet', knife_bowie: 'knife_survival_bowie', knife_navaja: 'knife_gypsy_jackknife', knife_talon: 'knife_widowmaker' };
  const finishesFor = (knife: string) => {
    const id = ITEM_NAMES[knife] ?? knife;
    return keys.filter((k) => k.startsWith(ECON + id + '_') && k.endsWith('_light_png.vtex_c')).map((k) => k.slice(ECON.length + id.length + 1, -'_light_png.vtex_c'.length));
  };
  const ANIMS = 'animation/anims/viewmodel/knife/';
  const knives: { id: string; name: string; finishes: string[] }[] = [];
  for (const [id, name] of Object.entries(KNIVES)) {
    try {
      const folder = ANIMS + (id === 'knife_default_ct' ? '_default_knife' : id) + '/';
      const inFolder = [...cs2.entries.keys()].filter((k) => k.startsWith(folder) && k.endsWith('.vnmclip_c'));
      const pick = (re: RegExp) => inFolder.find((k) => re.test(k.slice(folder.length)));
      // Attacks: the two alternating slashes (left click) and the stab (right click), in their "miss" versions.
      const clipFiles = {
        draw: pick(/^draw_/), idle: pick(/^idle1?_/), lookat01: pick(/^lookat01_(?!draw|transfix)/),
        light1: pick(/^light_miss1_/), light2: pick(/^light_miss2_/), heavy: pick(/^heavy_miss1_(?!noflip)/),
      };
      let knifeSkeleton: NmSkeleton | null = null;
      const clips = Object.fromEntries(
        Object.entries(clipFiles).map(([k, file]) => {
          if (!file) throw new Error(`no ${k} animation`);
          const raw = data(file);
          const c = decodeClip(raw);
          // The knife's own bones (blades, handles) ride along as the clip's secondary animation.
          const sec = raw.m_secondaryAnimations?.[0];
          const kc = sec && decodeClip(sec);
          if (sec && !knifeSkeleton) knifeSkeleton = readNmSkeleton(data(String(sec.m_skeleton) + '_c'));
          return [k, { frames: c.frames, duration: c.duration, poses: f32(c.poses), knife: kc && { frames: kc.frames, duration: kc.duration, poses: f32(kc.poses) } }];
        }),
      );
      const mesh = await readCs2Mesh(get(`weapons/models/knife/${id}/weapon_${id}.vmdl_c`)!, get);
      const paint = paintInputs(id);
      writeFileSync(`public/cs2/knives/${id}.json`, JSON.stringify({ mesh: meshToJson(mesh), skeleton: knifeSkeleton, clips, paint }));
      knives.push({ id, name, finishes: paint ? finishesFor(id) : [] });
      console.log(`${name}: ${mesh.positions.length / 3} vertices -> public/cs2/knives/${id}.json`);
    } catch (e) {
      console.log(`${name}: skipped (${e instanceof Error ? e.message : e})`);
    }
  }
  writeFileSync('public/cs2/knives/index.json', JSON.stringify(knives));

  // Finishes: parameters + pattern per paint kit, plus the shared wear/grunge textures.
  mkdirSync('public/cs2/finishes', { recursive: true });
  const english = readLocalization(new TextDecoder().decode(get('resource/csgo_english.txt') ?? new Uint8Array()));
  const itemsGame = new TextDecoder().decode(get('scripts/items/items_game.txt') ?? new Uint8Array());
  const kitText = (kit: string, field: string) => {
    const at = itemsGame.search(new RegExp(`"name"\\s+"${kit}"`));
    const block = at < 0 ? '' : itemsGame.slice(at, itemsGame.indexOf('}', at));
    return block.match(new RegExp(`"${field}"\\s+"([^"]+)"`))?.[1] ?? null;
  };
  const kitField = (kit: string, field: string) => {
    const v = kitText(kit, field);
    return v === null ? null : Number(v);
  };
  // In-game name (the kit's tag), plus the variant CS shows separately for Dopplers etc.
  const kitName = (kit: string) => {
    const name = english.get((kitText(kit, 'description_tag') ?? '').replace(/^#/, '').toLowerCase()) ?? kit;
    const variant = kit.match(/phase(\d)/)?.[1] ?? '';
    const gem = ['ruby', 'sapphire', 'emerald', 'blackpearl'].find((g) => kit.includes(g));
    return variant ? `${name} (Phase ${variant})` : gem ? `${name} (${gem === 'blackpearl' ? 'Black Pearl' : gem[0].toUpperCase() + gem.slice(1)})` : name;
  };
  const shared: Record<string, string> = {};
  const names: Record<string, string> = {};
  for (const kit of [...new Set(knives.flatMap((k) => k.finishes))]) {
    try {
      const compmat = keys.find((k) => k.startsWith('weapons/paints/') && k.endsWith(`/${kit}.vcompmat_c`));
      const info = compmat ? compmatInfo(data(compmat)) : { vmat: null, ranges: [] };
      const vmat = (info.vmat ?? `materials/models/weapons/customization/paints/vmats/${kit}.vmat`).toLowerCase() + '_c';
      if (!get(vmat)) throw new Error('no paint material');
      const p = finishParams(data(vmat));
      shared.wear ??= p.textures.g_tWear;
      shared.grunge ??= p.textures.g_tGrunge;
      const pattern = tex(p.textures.g_tPattern);
      const finish: Finish = {
        id: kit,
        name: kitName(kit),
        style: p.style,
        ints: p.ints,
        floats: p.floats,
        vectors: p.vectors,
        ranges: info.ranges,
        wear: [kitField(kit, 'wear_remap_min') ?? 0.06, kitField(kit, 'wear_remap_max') ?? 0.8],
      };
      writeFileSync(`public/cs2/finishes/${kit}.json`, JSON.stringify({ ...finish, pattern: pattern && vtexToJson(pattern) }));
      names[kit] = finish.name;
    } catch (e) {
      console.log(`Finish ${kit}: skipped (${e instanceof Error ? e.message : e})`);
    }
  }
  const wear = tex(shared.wear), grunge = tex(shared.grunge);
  writeFileSync('public/cs2/finishes/shared.json', JSON.stringify({ wear: wear && vtexToJson(wear), grunge: grunge && vtexToJson(grunge) }));
  writeFileSync('public/cs2/finishes/index.json', JSON.stringify(names));
  writeFileSync('public/cs2/knives/index.json', JSON.stringify(knives.map((k) => ({ ...k, finishes: k.finishes.filter((f) => f in names) }))));
  console.log(`Finishes: ${Object.keys(names).length} -> public/cs2/finishes`);
}

if (!lookup) {
  console.log('No CS:GO or CS2 archives found: stock textures skipped.');
  process.exit(0);
}

for (const f of readdirSync(OUT).filter((n) => /\.bsp$/i.test(n))) {
  try {
    const buf = readFileSync(join(OUT, f));
    const bsp = parseBsp(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), f);
    const files = stockFilesFor(bsp, lookup);
    const textures = [...files.keys()].filter((k) => k.endsWith('.vtf')).length;
    const zip = join(OUT, f.replace(/\.bsp$/i, '.stock.zip'));
    if (textures) writeFileSync(zip, writeZip(files));
    console.log(`${f}: ${textures} stock textures bundled`);
  } catch (e) {
    console.log(`${f}: skipped (${e instanceof Error ? e.message : e})`);
  }
}
for (const fd of fds.values()) closeSync(fd);
