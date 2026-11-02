// Writes latest.json for a release.
// Usage: vite-node scripts/write-release-manifest.ts <version> <installer.sig file> <installer url> <output file>
import { readFileSync, writeFileSync } from 'node:fs';
import { releaseManifest } from './release-manifest';

const [version, sigFile, url, out] = process.argv.slice(2);
if (!out) throw new Error('Usage: write-release-manifest <version> <installer.sig file> <installer url> <output file>');
writeFileSync(out, JSON.stringify(releaseManifest(version, readFileSync(sigFile, 'utf8'), url), null, 2));
console.log(`Wrote ${out} for ${version}`);
