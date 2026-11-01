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
});
