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
