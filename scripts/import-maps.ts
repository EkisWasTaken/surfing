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
import { readCs2Mesh, meshToJson, b64 } from '../src/cs2model';
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
  const ANIMS = 'animation/anims/viewmodel/knife/';
  const knives: { id: string; name: string }[] = [];
  for (const [id, name] of Object.entries(KNIVES)) {
    try {
      const folder = ANIMS + (id === 'knife_default_ct' ? '_default_knife' : id) + '/';
      const inFolder = [...cs2.entries.keys()].filter((k) => k.startsWith(folder) && k.endsWith('.vnmclip_c'));
      const pick = (re: RegExp) => inFolder.find((k) => re.test(k.slice(folder.length)));
      const clipFiles = { draw: pick(/^draw_/), idle: pick(/^idle1?_/), lookat01: pick(/^lookat01_(?!draw|transfix)/) };
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
      writeFileSync(`public/cs2/knives/${id}.json`, JSON.stringify({ mesh: meshToJson(mesh), skeleton: knifeSkeleton, clips }));
      knives.push({ id, name });
      console.log(`${name}: ${mesh.positions.length / 3} vertices -> public/cs2/knives/${id}.json`);
    } catch (e) {
      console.log(`${name}: skipped (${e instanceof Error ? e.message : e})`);
    }
  }
  writeFileSync('public/cs2/knives/index.json', JSON.stringify(knives));
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
