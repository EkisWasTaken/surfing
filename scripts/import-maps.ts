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
import { decodeClip, readNmSkeleton } from '../src/cs2anim';

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
// First-person knife from CS2's own model (written once; maps don't need it).
if (existsSync(cs2Dir)) {
  const cs2 = openVpk(cs2Dir);
  const get = (path: string) => (cs2.entries.has(path) ? cs2.read(path) : undefined);
  const KNIFE = 'weapons/models/knife/knife_default_ct/weapon_knife_default_ct.vmdl_c';
  try {
    const mesh = await readCs2Mesh(get(KNIFE)!, get);
    mkdirSync('public/cs2', { recursive: true });
    writeFileSync('public/cs2/knife.json', JSON.stringify(meshToJson(mesh)));
    console.log(`Knife: ${mesh.positions.length / 3} vertices, ${mesh.groups.length} material(s) -> public/cs2/knife.json`);
    // Arms + first-person animation: CS2's viewmodel skeleton, its knife clips, and the default CT arms.
    const data = (path: string) => parseKV3(resourceBlocks(get(path)!).find((b) => b.type === 'DATA')!.data);
    const CLIPS = 'animation/anims/viewmodel/knife/_default_knife/';
    const clips = Object.fromEntries(
      ['idle_knife', 'draw_knife', 'lookat01_knife'].map((n) => {
        const c = decodeClip(data(CLIPS + n + '.vnmclip_c'));
        return [n.replace('_knife', ''), { frames: c.frames, duration: c.duration, poses: b64(new Uint8Array(c.poses.buffer)) }];
      }),
    );
    // The default CT agent's own first-person gloves and sleeves, as CS2 shows them with no gloves equipped.
    const arms = await readCs2Mesh(get('agents/models/ctm_sas/ctm_sas.vmdl_c')!, get, ['firstperson_default_gloves_arms', 'firstperson_sleeves']);
    const skeleton = readNmSkeleton(data('animation/skeletons/characters/viewmodel.vnmskel_c'));
    writeFileSync('public/cs2/viewmodel.json', JSON.stringify({ skeleton, clips, arms: meshToJson(arms) }));
    console.log(`Arms: ${arms.positions.length / 3} vertices, ${skeleton.names.length} bones, clips ${Object.keys(clips).join(', ')} -> public/cs2/viewmodel.json`);
  } catch (e) {
    console.log(`Knife: skipped (${e instanceof Error ? e.message : e})`);
  }
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
