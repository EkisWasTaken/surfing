// Ghost of your best run: positions and yaw sampled at a fixed rate, replayed alongside your next attempts
// (surf servers' replay bots, for one player). Stored per map and game in this browser.
import type { Vec3 } from './math';
import type { Track } from './records';
import { b64, unb64 } from './cs2model';

export const GHOST_RATE = 32; // samples per second: smooth enough with interpolation, small enough to store
const MAX_SECONDS = 600; // longer runs aren't kept (localStorage space)
export type Ghost = { frames: Float32Array }; // x, y, z, yaw per sample

// ticks: x, y, z, yaw per physics tick of the run, from its first tick.
export function ghostFromTicks(ticks: number[], tickDt: number): Ghost | null {
  const n = ticks.length / 4, duration = (n - 1) * tickDt;
  if (n < 2 || duration > MAX_SECONDS) return null;
  const count = Math.floor(duration * GHOST_RATE + 1e-6) + 1, frames = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const x = (i / GHOST_RATE) / tickDt, a = Math.min(n - 1, Math.floor(x)), b = Math.min(n - 1, a + 1), f = x - a;
    for (let k = 0; k < 3; k++) frames[i * 4 + k] = ticks[a * 4 + k] + (ticks[b * 4 + k] - ticks[a * 4 + k]) * f;
    frames[i * 4 + 3] = lerpYaw(ticks[a * 4 + 3], ticks[b * 4 + 3], f);
  }
  return { frames };
}

const lerpYaw = (a: number, b: number, f: number) => {
  const d = ((((b - a) % 360) + 540) % 360) - 180; // shortest way round
  const y = a + d * f;
  return ((((y + 180) % 360) + 360) % 360) - 180;
};

// Where the ghost is t seconds into its run: waiting at the start before, parked at the finish after.
export function sampleGhost(g: Ghost, t: number): { pos: Vec3; yaw: number } {
  const n = g.frames.length / 4, x = Math.min(n - 1, Math.max(0, t * GHOST_RATE)), a = Math.floor(x), b = Math.min(n - 1, a + 1), f = x - a;
  const at = (k: number) => g.frames[a * 4 + k] + (g.frames[b * 4 + k] - g.frames[a * 4 + k]) * f;
  return { pos: { x: at(0), y: at(1), z: at(2) }, yaw: lerpYaw(g.frames[a * 4 + 3], g.frames[b * 4 + 3], f) };
}

export const encodeGhost = (g: Ghost) => b64(new Uint8Array(g.frames.buffer, g.frames.byteOffset, g.frames.byteLength));

export function decodeGhost(s: string): Ghost | null {
  try {
    const bytes = unb64(s);
    if (!bytes.length || bytes.length % 16) return null;
    return { frames: new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4) };
  } catch {
    return null;
  }
}

const key = (game: Track, mapId: string) => `surf-ghost:${game}:${mapId}`;

export function loadGhost(game: Track, mapId: string): Ghost | null {
  try {
    const s = localStorage.getItem(key(game, mapId));
    return s ? decodeGhost(s) : null;
  } catch {
    return null;
  }
}

export function saveGhost(game: Track, mapId: string, g: Ghost) {
  try {
    localStorage.setItem(key(game, mapId), encodeGhost(g));
  } catch {} // storage full: the ghost just isn't kept
}
