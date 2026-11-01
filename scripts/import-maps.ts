// Copies surf maps from your own CS:GO install into public/maps, where the game lists them, and — when the
// CS:GO legacy archives are installed — bundles the stock textures/models each map needs as <map>.stock.zip.
// Usage: npm run import-maps [-- "path/to/csgo/maps"]
// Everything stays on this machine (public/maps is git-ignored): maps and game files belong to their authors.
import { copyFileSync, mkdirSync, readdirSync, existsSync, readFileSync, writeFileSync, openSync, readSync, closeSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parseBsp } from '../src/bsp';
import { readVpkDir, readVpkFile } from '../src/vpk';
import { stockFilesFor } from '../src/stock';
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

// CS:GO legacy (Steam: CS2 → Properties → Betas → csgo_legacy) keeps the stock game files in csgo/pak01_*.vpk.
const dirFile = join(dirname(src), 'pak01_dir.vpk');
if (!existsSync(dirFile)) {
  console.log(`No CS:GO archives at ${dirFile}: stock textures skipped.\nSwitch CS2 to the "csgo_legacy" beta in Steam, then run this again.`);
  process.exit(0);
}
const dir = new Uint8Array(readFileSync(dirFile));
const vpk = readVpkDir(dir);
const fds = new Map<number, number>();
const archive = (i: number, offset: number, length: number) => {
  if (!fds.has(i)) fds.set(i, openSync(dirFile.replace(/_dir\.vpk$/, `_${String(i).padStart(3, '0')}.vpk`), 'r'));
  const b = Buffer.alloc(length);
  readSync(fds.get(i)!, b, 0, length, offset);
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
};
const lookup = (path: string) => {
  const e = vpk.entries.get(path);
  return e && readVpkFile(e, dir, vpk.dataStart, archive);
};
if (!vpk.entries.size || ![...vpk.entries.keys()].some((k) => k.endsWith('.vtf'))) {
  console.log(`${dirFile} has no .vtf textures (this looks like CS2, not CS:GO legacy): stock textures skipped.`);
  process.exit(0);
}

for (const f of readdirSync(OUT).filter((n) => /\.bsp$/i.test(n))) {
  try {
    const buf = readFileSync(join(OUT, f));
    const bsp = parseBsp(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), f);
    const files = stockFilesFor(bsp, lookup);
    if (files.size) writeFileSync(join(OUT, f.replace(/\.bsp$/i, '.stock.zip')), writeZip(files));
    console.log(`${f}: ${files.size} stock files bundled`);
  } catch (e) {
    console.log(`${f}: skipped (${e instanceof Error ? e.message : e})`);
  }
}
for (const fd of fds.values()) closeSync(fd);
