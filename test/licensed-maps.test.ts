import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { checkLicensedMaps } from '../scripts/licensed-maps';

describe('licensed-maps check', () => {
  let dir = '';
  const setup = (manifest: unknown, files: string[] = []) => {
    dir = mkdtempSync(join(tmpdir(), 'maps-'));
    mkdirSync(join(dir, 'proofs'));
    writeFileSync(join(dir, 'manifest.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
    for (const f of files) writeFileSync(join(dir, f), '');
    return dir;
  };
  const good = { file: 'a.bsp', name: 'A', author: 'Sam', permission: 'Said yes', proof: 'proofs/a.png' };
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('passes the real, empty folder and a complete entry', () => {
    expect(checkLicensedMaps('licensed-maps')).toEqual([]);
    expect(checkLicensedMaps(setup([good], ['a.bsp', 'proofs/a.png']))).toEqual([]);
  });
  it('accepts a finish point and refuses a broken one', () => {
    expect(checkLicensedMaps(setup([{ ...good, finish: [1, -2.5, 3] }], ['a.bsp', 'proofs/a.png']))).toEqual([]);
    for (const finish of [[1, 2], 'here', [1, 2, '3'], [1, 2, null]]) {
      expect(checkLicensedMaps(setup([{ ...good, finish }], ['a.bsp', 'proofs/a.png'])).join()).toContain('"finish"');
    }
  });
  it('refuses a map with no entry', () => {
    expect(checkLicensedMaps(setup([], ['b.bsp']))[0]).toContain('no entry');
  });
  it('refuses missing credit, permission or proof', () => {
    const e = checkLicensedMaps(setup([{ ...good, author: ' ', permission: undefined }], ['a.bsp']));
    expect(e.join()).toContain('"author"');
    expect(e.join()).toContain('"permission"');
    expect(e.join()).toContain('proof file');
  });
  it('refuses an entry whose map is gone, odd file names and a broken manifest', () => {
    expect(checkLicensedMaps(setup([good], ['proofs/a.png']))[0]).toContain("isn't in the folder");
    expect(checkLicensedMaps(setup([{ ...good, file: '../x.bsp' }], ['proofs/a.png'])).join()).toContain('plain .bsp');
    expect(checkLicensedMaps(setup('{oops'))[0]).toContain("can't be read");
  });
});
