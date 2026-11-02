// The public build (npm run build) ships no Steam files: no knives or skins, and neutral names for the two movement modes.
import type { GameMode } from './config';

export const HOSTED = import.meta.env.PROD;
export const gameLabel = (g: GameMode) => (HOSTED ? (g === 'cs16' ? 'Classic' : 'Modern') : g === 'cs16' ? 'CS 1.6' : 'CS:GO');
export const gameTitle = (g: GameMode) => (HOSTED ? gameLabel(g) : g === 'cs16' ? 'Counter-Strike' : 'Counter-Strike: Global Offensive');
// What the console and chat accept for a game, under either name.
export const parseGame = (v: string): GameMode | null => (/1\.?6|classic/i.test(v) ? 'cs16' : /go|cs2|modern/i.test(v) ? 'csgo' : null);
