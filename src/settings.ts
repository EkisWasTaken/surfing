import { config } from './config';

export type Settings = { sensitivity: number; fov: number; tickrate: 64 | 128; autobhop: boolean; showSpeed: boolean; map: string; jumpBind: string };

export const defaults: Settings = { sensitivity: 2, fov: 90, tickrate: 64, autobhop: true, showSpeed: true, map: 'sandbox', jumpBind: 'Space' };

const KEY = 'surf-settings';
const num = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

// Stored data is untrusted (old versions, hand edits): validate every field.
export function parseSettings(raw: string | null): Settings {
  let o: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(raw ?? '{}');
    if (parsed && typeof parsed === 'object') o = parsed;
  } catch {}
  return {
    sensitivity: num(o.sensitivity, 0.01, 20, defaults.sensitivity),
    fov: num(o.fov, 60, 130, defaults.fov),
    tickrate: o.tickrate === 128 ? 128 : 64,
    autobhop: bool(o.autobhop, defaults.autobhop),
    showSpeed: bool(o.showSpeed, defaults.showSpeed),
    map: typeof o.map === 'string' ? o.map : defaults.map,
    // A KeyboardEvent.code or WheelUp/WheelDown; Escape is reserved for the menu.
    jumpBind: typeof o.jumpBind === 'string' && /^[A-Za-z0-9]{1,24}$/.test(o.jumpBind) && o.jumpBind !== 'Escape' ? o.jumpBind : defaults.jumpBind,
  };
}

export function loadSettings(): Settings {
  try {
    return parseSettings(localStorage.getItem(KEY));
  } catch {
    return { ...defaults };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}

export function applySettings(s: Settings) {
  config.sensitivity = s.sensitivity;
  config.tickrate = s.tickrate;
  config.autobhop = s.autobhop;
}
