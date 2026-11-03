// Every map in licensed-maps/ needs a manifest entry. Credit and proof are optional, but a named proof must exist.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REQUIRED = ['file', 'name'];

export function checkLicensedMaps(dir: string): string[] {
  let manifest: Record<string, unknown>[];
  try {
    manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    if (!Array.isArray(manifest)) return ['manifest.json must be a list'];
  } catch (e) {
    return [`manifest.json can't be read: ${e instanceof Error ? e.message : e}`];
  }
  const errors: string[] = [];
  const listed = new Set<string>();
  for (const m of manifest) {
    const label = String(m?.file ?? JSON.stringify(m));
    for (const k of REQUIRED) if (typeof m?.[k] !== 'string' || !(m[k] as string).trim()) errors.push(`${label}: "${k}" is missing`);
    if (typeof m?.file !== 'string') continue;
    if (!/^[\w.-]+\.bsp$/i.test(m.file)) errors.push(`${label}: "file" must be a plain .bsp file name`);
    else if (!existsSync(join(dir, m.file))) errors.push(`${label}: the map file isn't in the folder`);
    if (typeof m.proof === 'string' && m.proof.trim() && !existsSync(join(dir, m.proof))) errors.push(`${label}: the proof file ${m.proof} isn't in the folder`);
    const finish = m.finish;
    if (finish !== undefined && !(Array.isArray(finish) && finish.length === 3 && finish.every((v) => typeof v === 'number' && Number.isFinite(v)))) errors.push(`${label}: "finish" must be three numbers: [x, y, z]`);
    listed.add(m.file);
  }
  for (const f of readdirSync(dir)) if (/\.bsp$/i.test(f) && !listed.has(f)) errors.push(`${f}: has no entry in manifest.json`);
  return errors;
}
