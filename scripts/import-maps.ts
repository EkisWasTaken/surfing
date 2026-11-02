// Runs the Steam import for local development: fills public/, which the dev server serves and is git-ignored.
// Usage: npm run import-maps [-- "path/to/csgo/maps" [output folder]]
// Everything stays on this machine: maps and game files belong to their authors.
import { copyFileSync, mkdirSync, readdirSync, existsSync, readFileSync, writeFileSync, openSync, readSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { runImport } from '../src/steam-import';

const src = process.argv[2] ?? 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive/csgo/maps';
const OUT = process.argv[3] ?? 'public';
if (!existsSync(src)) {
  console.error(`CS:GO maps folder not found: ${src}\nPass it explicitly: npm run import-maps -- "<path to csgo/maps>"`);
  process.exit(1);
}
const fds = new Map<string, number>();
const root = dirname(dirname(src));
await runImport(
  {
    exists: existsSync,
    read: (path) => new Uint8Array(readFileSync(path)),
    readRange(path, offset, length) {
      if (!fds.has(path)) fds.set(path, openSync(path, 'r'));
      const b = Buffer.alloc(length);
      readSync(fds.get(path)!, b, 0, length, offset);
      return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    },
    write(file, data) {
      mkdirSync(dirname(join(OUT, file)), { recursive: true });
      writeFileSync(join(OUT, file), data);
    },
    prepareMaps(mapsDir) {
      const out = join(OUT, 'maps');
      mkdirSync(out, { recursive: true });
      const copied = readdirSync(mapsDir).filter((f) => /^surf_.*\.bsp$/i.test(f));
      for (const f of copied) copyFileSync(join(mapsDir, f), join(out, f));
      console.log(`Copied ${copied.length} surf maps into ${out}`);
      return readdirSync(out).filter((f) => /\.bsp$/i.test(f)).map((file) => ({ file, path: join(out, file) }));
    },
  },
  { csgo: root.replace(/\\/g, '/'), halfLife: join(dirname(root), 'Half-Life').replace(/\\/g, '/') },
  (line) => console.log(line),
);
process.exit(0); // the archives stay open until here
