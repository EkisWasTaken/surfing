import { describe, it, expect } from 'vitest';
import { runImport, ImportHost } from '../src/steam-import';

const fakeHost = (files: Record<string, Uint8Array> = {}) => {
  const written = new Map<string, string | Uint8Array>();
  const host: ImportHost = {
    exists: (p) => p in files,
    read: (p) => files[p],
    readRange: (p, o, l) => files[p].subarray(o, o + l),
    write: (f, d) => void written.set(f, d),
    prepareMaps: () => [],
  };
  return { host, written };
};

describe('Steam import', () => {
  it('without any CS installed, writes nothing and reports nothing found', async () => {
    const { host, written } = fakeHost();
    expect(await runImport(host, { csgo: null, halfLife: null }, () => {})).toEqual({ knives: 0, finishes: 0, cs16: false, maps: 0 });
    expect(written.size).toBe(0);
  });
  it('a game folder without the expected files is the same as not installed', async () => {
    const { host, written } = fakeHost();
    expect(await runImport(host, { csgo: 'C:/CS', halfLife: 'C:/HL' }, () => {})).toEqual({ knives: 0, finishes: 0, cs16: false, maps: 0 });
    expect(written.size).toBe(0);
  });
  it('with only CS 1.6, copies its knife', async () => {
    const mdl = new Uint8Array([1, 2, 3]);
    const { host, written } = fakeHost({ 'C:/HL/cstrike/models/v_knife.mdl': mdl });
    const lines: string[] = [];
    const r = await runImport(host, { csgo: null, halfLife: 'C:/HL' }, (l) => lines.push(l));
    expect(r.cs16).toBe(true);
    expect(written.get('cs16/v_knife.mdl')).toBe(mdl);
    expect(lines.join()).toContain('CS 1.6 knife copied');
  });
});
