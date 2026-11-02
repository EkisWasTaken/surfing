// The public build (npm run build) ships no Steam files: no knives or skins, and neutral names for the two movement modes.
// The desktop app can build those files from the player's own CS install; they stay on that player's machine.
import type { GameMode } from './config';

export const DESKTOP = typeof window !== 'undefined' && '__TAURI__' in window;
export const STEAM = 'http://surfsteam.localhost'; // the desktop app's file service, see src-tauri/src/main.rs
const REAL_KEY = 'surf-real-models';
const readReal = () => {
  try {
    return localStorage.getItem(REAL_KEY) === '1';
  } catch {
    return false;
  }
};
// This player imported their own files. Read once: switching reloads the page.
export const USING_REAL = DESKTOP && readReal();
export const setUsingReal = (on: boolean) => {
  try {
    if (on) localStorage.setItem(REAL_KEY, '1');
    else localStorage.removeItem(REAL_KEY);
  } catch {}
};
export const HOSTED = import.meta.env.PROD && !USING_REAL;
// The game's own models only: the public build, or any build with ?own in the address (to try them locally).
export const OWN_MODELS = HOSTED || (typeof location !== 'undefined' && new URLSearchParams(location.search).has('own'));
// Where a Steam file is: public/ on the dev server, the app's file service in the desktop app.
export const assetUrl = (path: string) => (USING_REAL ? `${STEAM}/asset?p=${encodeURIComponent(decodeURIComponent(path.replace(/^\//, '')))}` : path);
export const gameLabel = (g: GameMode) => (HOSTED ? (g === 'cs16' ? 'Classic' : 'Modern') : g === 'cs16' ? 'CS 1.6' : 'CS:GO');
export const gameTitle = (g: GameMode) => (HOSTED ? gameLabel(g) : g === 'cs16' ? 'Counter-Strike' : 'Counter-Strike: Global Offensive');
// What the console and chat accept for a game, under either name.
export const parseGame = (v: string): GameMode | null => (/1\.?6|classic/i.test(v) ? 'cs16' : /go|cs2|modern/i.test(v) ? 'csgo' : null);
