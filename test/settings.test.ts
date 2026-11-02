import { describe, it, expect } from 'vitest';
import { parseSettings, defaults } from '../src/settings';

describe('parseSettings', () => {
  it('falls back to defaults on missing or broken data', () => {
    expect(parseSettings(null)).toEqual(defaults);
    expect(parseSettings('{not json')).toEqual(defaults);
    expect(parseSettings('42')).toEqual(defaults);
  });
  it('clamps and validates each field', () => {
    const s = parseSettings(JSON.stringify({ sensitivity: 999, fov: 10, tickrate: 100, autobhop: 'yes', showSpeed: false, map: 'spire' }));
    expect(s).toEqual({ ...defaults, sensitivity: 20, fov: 60, tickrate: 64, showSpeed: false, map: 'spire' });
    expect(parseSettings(JSON.stringify({ tickrate: 128, sensitivity: 1.25 }))).toMatchObject({ tickrate: 128, sensitivity: 1.25 });
  });
});

describe('jumpBind', () => {
  it('defaults to Space and rejects junk or Escape', () => {
    expect(defaults.jumpBind).toBe('Space');
    expect(parseSettings(JSON.stringify({ jumpBind: 'WheelDown' })).jumpBind).toBe('WheelDown');
    expect(parseSettings(JSON.stringify({ jumpBind: 'Escape' })).jumpBind).toBe('Space');
    expect(parseSettings(JSON.stringify({ jumpBind: '<script>' })).jumpBind).toBe('Space');
  });
  it('keeps a knife id only when it is a plain knife_ name (it becomes a file path)', () => {
    expect(parseSettings('{"knife":"knife_karambit"}').knife).toBe('knife_karambit');
    expect(parseSettings('{"knife":"../knife_x"}').knife).toBe(defaults.knife);
    expect(parseSettings('{"knife":"bayonet"}').knife).toBe(defaults.knife);
  });
  it('validates finish, wear and seed', () => {
    expect(parseSettings('{"finish":"aa_fade","wear":0.5,"seed":661}')).toMatchObject({ finish: 'aa_fade', wear: 0.5, seed: 661 });
    expect(parseSettings('{"finish":"../x","wear":7,"seed":-3.6}')).toMatchObject({ finish: defaults.finish, wear: 1, seed: 0 });
    expect(parseSettings('{"seed":12.4}').seed).toBe(12);
  });
});

describe('key binds', () => {
  it('keeps good codes and falls back on junk, per key', () => {
    const k = parseSettings(JSON.stringify({ keys: { forward: 'KeyZ', back: '<x>', left: 'Escape' } })).keys;
    expect(k).toEqual({ ...defaults.keys, forward: 'KeyZ' });
  });
});
