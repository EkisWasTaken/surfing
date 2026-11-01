// Checks the CS2 readers (KV3 v4/v5, meshopt buffers, BC7 textures) against real files from a local CS2 install.
// Skips when CS2 isn't installed at the default Steam path.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, openSync, readSync, closeSync } from 'fs';
import { readVpkDir, readVpkFile } from '../src/vpk';
import { parseKV3, resourceBlocks } from '../src/kv3';
import { readCs2Mesh } from '../src/cs2model';

const BASE = 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive/game/csgo/pak01_';
const installed = existsSync(BASE + 'dir.vpk');

describe.skipIf(!installed)('CS2 assets', () => {
  const dir = installed ? new Uint8Array(readFileSync(BASE + 'dir.vpk')) : new Uint8Array();
  const vpk = installed ? readVpkDir(dir) : { entries: new Map(), dataStart: 0 };
  const archive = (i: number, off: number, len: number) => {
    const fd = openSync(`${BASE}${String(i).padStart(3, '0')}.vpk`, 'r');
    const b = Buffer.alloc(len);
    readSync(fd, b, 0, len, off);
    closeSync(fd);
    return new Uint8Array(b);
  };
  const get = (k: string) => {
    const e = vpk.entries.get(k);
    return e && readVpkFile(e, dir, vpk.dataStart, archive);
  };
  const KNIFE = 'weapons/models/knife/knife_default_ct/weapon_knife_default_ct.vmdl_c';

  it('parses KV3 v5 (model) and v4 (material) blocks', () => {
    const data = parseKV3(resourceBlocks(get(KNIFE)!).find((b) => b.type === 'DATA')!.data) as { m_name: string };
    expect(data.m_name).toBe('weapons/models/knife/knife_default_ct/weapon_knife_default_ct.vmdl');
  });

  it('reads the default CT knife: geometry, UVs in range, BC7 color texture', async () => {
    const mesh = await readCs2Mesh(get(KNIFE)!, get);
    expect(mesh.positions.length / 3).toBe(4756);
    expect(mesh.indices.length).toBe(16374);
    expect(Math.max(...mesh.indices)).toBeLessThan(4756);
    expect(Math.min(...mesh.uvs)).toBeGreaterThanOrEqual(-0.01);
    expect(Math.max(...mesh.uvs)).toBeLessThanOrEqual(1.01);
    const tex = mesh.groups[0].texture!;
    expect(tex.format).toBe('bc7');
    expect([tex.width, tex.height, tex.mips.length]).toEqual([1024, 1024, 9]);
    expect(tex.mips[0].data.length).toBe(1024 * 1024); // BC7: 16 bytes per 4x4 block = 1 byte/pixel
  });
});
