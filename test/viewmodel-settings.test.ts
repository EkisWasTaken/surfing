import { describe, it, expect } from 'vitest';
import { parseSettings, defaults, viewmodelFov, VM_FOV_MAX, VM_FOV_MIN, VM_OFFSET } from '../src/settings';

describe('viewmodel settings', () => {
  it('default to the game\'s own field of view, which follows the game', () => {
    const s = parseSettings(null);
    expect([s.vmFov, s.vmX, s.vmY, s.vmZ, s.vmLeft]).toEqual([0, 0, 0, 0, false]);
    expect(viewmodelFov({ vmFov: 0, game: 'csgo' })).toBe(68);
    expect(viewmodelFov({ vmFov: 0, game: 'cs16' })).toBe(90);
    expect(viewmodelFov({ vmFov: 75, game: 'cs16' })).toBe(75);
  });
  it('keep what was saved', () => {
    const s = parseSettings(JSON.stringify({ ...defaults, vmFov: 80, vmX: 2.5, vmY: -1, vmZ: 0.5, vmLeft: true }));
    expect([s.vmFov, s.vmX, s.vmY, s.vmZ, s.vmLeft]).toEqual([80, 2.5, -1, 0.5, true]);
  });
  it('clamp saved values that are out of range or broken', () => {
    const s = parseSettings(JSON.stringify({ vmFov: 999, vmX: 500, vmY: -500, vmZ: 'high', vmLeft: 'yes' }));
    expect([s.vmFov, s.vmX, s.vmY, s.vmZ, s.vmLeft]).toEqual([VM_FOV_MAX, VM_OFFSET, -VM_OFFSET, 0, false]);
    expect(parseSettings(JSON.stringify({ vmFov: 5 })).vmFov).toBe(VM_FOV_MIN);
  });
});
