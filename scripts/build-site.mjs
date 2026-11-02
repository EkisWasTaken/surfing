// Puts the public website together in _site: the download page at the top, the browser version of the game under play/.
import { cpSync, rmSync, existsSync } from 'node:fs';

if (!existsSync('dist/index.html')) throw new Error('Run npm run build first');
rmSync('_site', { recursive: true, force: true });
cpSync('site', '_site', { recursive: true });
cpSync('src-tauri/icons/icon.png', '_site/icon.png');
cpSync('dist', '_site/play', { recursive: true });
console.log('Website ready in _site');
