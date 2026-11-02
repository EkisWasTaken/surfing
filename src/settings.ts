import { config, setGameMode, GameMode } from './config';

export type Settings = { name: string; game: GameMode; sensitivity: number; fov: number; tickrate: 64 | 128; autobhop: boolean; showSpeed: boolean; map: string; jumpBind: string; showGhost: boolean; showViewmodel: boolean; knife: string; finish: string; wear: number; seed: number };

export const defaults: Settings = { name: 'Player', game: 'csgo', sensitivity: 2, fov: 90, tickrate: 64, autobhop: true, showSpeed: true, map: 'sandbox', jumpBind: 'Space', showGhost: true, showViewmodel: true, knife: 'knife_default_ct', finish: '', wear: 0.01, seed: 0 };

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
    // CS 1.6 caps names at 31 characters; control characters would break the chat line.
    name: typeof o.name === 'string' && o.name.replace(/[\u0000-\u001f]/g, '').trim() ? o.name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 31) : defaults.name,
    game: o.game === 'cs16' ? 'cs16' : 'csgo',
    sensitivity: num(o.sensitivity, 0.01, 20, defaults.sensitivity),
    fov: num(o.fov, 60, 130, defaults.fov),
    tickrate: o.tickrate === 128 ? 128 : 64,
    autobhop: bool(o.autobhop, defaults.autobhop),
    showSpeed: bool(o.showSpeed, defaults.showSpeed),
    map: typeof o.map === 'string' ? o.map : defaults.map,
    // A KeyboardEvent.code or WheelUp/WheelDown; Escape is reserved for the menu.
    showGhost: bool(o.showGhost, defaults.showGhost),
    showViewmodel: bool(o.showViewmodel, defaults.showViewmodel),
    knife: typeof o.knife === 'string' && /^knife_[a-z0-9_]{1,32}$/.test(o.knife) ? o.knife : defaults.knife, // also a file name: keep it strict
    finish: typeof o.finish === 'string' && /^[a-z0-9_]{0,64}$/.test(o.finish) ? o.finish : defaults.finish, // '' = vanilla; also a file name
    wear: num(o.wear, 0, 1, defaults.wear),
    seed: Math.round(num(o.seed, 0, 1000, defaults.seed)),
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
  if (config.mode !== s.game) setGameMode(s.game); // only on a game switch, so console sv_ changes survive other settings changes
  config.tickrate = s.game === 'cs16' ? 100 : s.tickrate; // CS 1.6 moves per frame, at the usual fps_max 100
  config.autobhop = s.autobhop;
}
