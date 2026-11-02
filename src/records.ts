// Personal records per map and per game (CS:GO and CS 1.6 times aren't comparable), kept in this browser.
import type { GameMode } from './config';
import type { Run } from './timer';

export const RECENT = 10; // finishes kept per map, newest first
export type Finish = { time: number; at: number }; // at: epoch ms
export type MapRecord = { best: number; bestAt: number; finishes: number; recent: Finish[] };
export type Records = Record<string, MapRecord>;
// first: no earlier finish; pb: beat the best; slower: didn't. delta = time - previous best; rank among recent finishes.
export type FinishResult = { all: Records; record: MapRecord; kind: 'first' | 'pb' | 'slower'; delta: number; rank: number };

// Runs compared with each other: each game, and CS:GO's two tick rates (64 keeps the plain name, so old records stay there).
export type Track = GameMode | 'csgo128';
export const recordTrack = (game: GameMode, tickrate: 64 | 128): Track => (game === 'csgo' && tickrate === 128 ? 'csgo128' : game);
export const recordKey = (track: Track, mapId: string) => `${track}:${mapId}`;

// What crossing the finish means for this tick: nothing unless a running run just finished; then practice beats changed settings.
export function finishKind(was: Run['phase'], now: Run['phase'], practice: boolean, serverChanged: boolean): 'record' | 'practice' | 'settings' | null {
  if (was !== 'running' || now !== 'finished') return null;
  return practice ? 'practice' : serverChanged ? 'settings' : 'record';
}

export function recordFinish(all: Records, game: Track, mapId: string, time: number, now: number): FinishResult {
  const key = recordKey(game, mapId), prev = all[key];
  const recent = [{ time, at: now }, ...(prev?.recent ?? [])].slice(0, RECENT);
  const pb = !prev || time < prev.best;
  const record: MapRecord = { best: pb ? time : prev.best, bestAt: pb ? now : prev.bestAt, finishes: (prev?.finishes ?? 0) + 1, recent };
  return {
    all: { ...all, [key]: record },
    record,
    kind: !prev ? 'first' : pb ? 'pb' : 'slower',
    delta: prev ? time - prev.best : 0,
    rank: 1 + recent.filter((f) => f.time < time).length,
  };
}

const pos = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

// Stored data is untrusted (hand edits, old versions): keep only well-formed records. `legacy` is the old
// per-map best list (CS:GO only), folded in where no record exists yet.
export function parseRecords(raw: string | null, legacy: string | null): Records {
  const read = (s: string | null) => {
    try {
      const v = JSON.parse(s ?? '{}');
      return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };
  const out: Records = {};
  for (const [k, v] of Object.entries(read(raw))) {
    const r = v as Partial<MapRecord>;
    if (!/^(csgo|csgo128|cs16):/.test(k) || !r || !pos(r.best)) continue;
    const recent = Array.isArray(r.recent) ? r.recent.filter((f) => f && pos(f.time) && typeof f.at === 'number').slice(0, RECENT) : [];
    out[k] = { best: r.best, bestAt: typeof r.bestAt === 'number' ? r.bestAt : 0, finishes: pos(r.finishes) ? Math.floor(r.finishes) : Math.max(1, recent.length), recent };
  }
  for (const [map, t] of Object.entries(read(legacy))) {
    const key = recordKey('csgo', map);
    if (pos(t) && !out[key]) out[key] = { best: t, bestAt: 0, finishes: 1, recent: [] };
  }
  return out;
}

const KEY = 'surf-records', LEGACY = 'surf-bests';

export function loadRecords(): Records {
  try {
    return parseRecords(localStorage.getItem(KEY), localStorage.getItem(LEGACY));
  } catch {
    return {};
  }
}

export function saveRecords(all: Records) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {}
}
