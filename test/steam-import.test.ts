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
  it("a backup missing its file lists is ignored, and the game's own files are used", async () => {
    const mdl = new Uint8Array([1]);
    const { host, written } = fakeHost({ 'C:/B/files.txt': new Uint8Array(), 'C:/HL/cstrike/models/v_knife.mdl': mdl });
    const lines: string[] = [];
    await runImport(host, { csgo: null, halfLife: 'C:/HL', backup: 'C:/B' }, (l) => lines.push(l));
    expect(written.get('cs16/v_knife.mdl')).toBe(mdl);
    expect(lines.join()).not.toContain('backup');
  });
  it("a complete backup wins over the game's files, and works with no game installed", async () => {
    const own = new Uint8Array([2]), game = new Uint8Array([3]);
    const { host, written } = fakeHost({ 'C:/B/files.txt': new TextEncoder().encode('x  1  cs1.6/cstrike/models/v_knife.mdl\n'), 'C:/B/skin-names.txt': new Uint8Array(), 'C:/B/cs1.6/cstrike/models/v_knife.mdl': own, 'C:/HL/cstrike/models/v_knife.mdl': game });
    const lines: string[] = [];
    await runImport(host, { csgo: null, halfLife: 'C:/HL', backup: 'C:/B' }, (l) => lines.push(l));
    expect(written.get('cs16/v_knife.mdl')).toBe(own);
    expect(lines.join()).toContain('your backup folder');
  });
  it('a missing model in the backup skips that knife instead of stopping everything', async () => {
    const { host, written } = fakeHost({ 'C:/B/files.txt': new TextEncoder().encode('x  1  cs2/resource/csgo_english.txt\nx  1  cs2/scripts/items/items_game.txt\n'), 'C:/B/skin-names.txt': new Uint8Array(), 'C:/B/cs2/resource/csgo_english.txt': new Uint8Array(), 'C:/B/cs2/scripts/items/items_game.txt': new Uint8Array() });
    const r = await runImport(host, { csgo: null, halfLife: null, backup: 'C:/B' }, () => {});
    expect(r.knives).toBe(0);
    expect(written.get('cs2/knives/index.json')).toBe('[]');
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
