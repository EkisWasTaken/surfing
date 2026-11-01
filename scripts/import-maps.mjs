// Copies surf maps from your own CS:GO install into public/maps, where the game lists them.
// Usage: npm run import-maps [-- "path/to/csgo/maps"]
// The maps stay on this machine (public/maps is git-ignored): they belong to their authors, so don't redistribute them.
import { copyFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const src = process.argv[2] ?? 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive/csgo/maps';
if (!existsSync(src)) {
  console.error(`CS:GO maps folder not found: ${src}\nPass it explicitly: npm run import-maps -- "<path to csgo/maps>"`);
  process.exit(1);
}
mkdirSync('public/maps', { recursive: true });
const maps = readdirSync(src).filter((f) => /^surf_.*\.bsp$/i.test(f));
for (const f of maps) copyFileSync(join(src, f), join('public/maps', f));
console.log(`Copied ${maps.length} surf maps into public/maps`);
