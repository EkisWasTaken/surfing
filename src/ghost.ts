// Ghost of your best run: positions and yaw sampled at a fixed rate, replayed alongside your next attempts
// (surf servers' replay bots, for one player). Stored per map and game in this browser.
import type { Vec3 } from './math';
import type { Track } from './records';
import { b64, unb64 } from './b64';

export const GHOST_RATE = 32; // samples per second: smooth enough with interpolation, small enough to store
const MAX_SECONDS = 600; // longer runs aren't kept (localStorage space)
export type Ghost = { frames: Float32Array; rate?: number }; // x, y, z, yaw per sample; rate defaults to GHOST_RATE

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
  const n = g.frames.length / 4, x = Math.min(n - 1, Math.max(0, t * (g.rate ?? GHOST_RATE))), a = Math.floor(x), b = Math.min(n - 1, a + 1), f = x - a;
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

// How long a ghost's run lasts.
export const ghostSeconds = (g: Ghost) => (g.frames.length / 4 - 1) / (g.rate ?? GHOST_RATE);

// Share codes: your time and a thinned-out ghost as text a friend can paste. 8 samples a second, whole units, each
// sample stored as its change from the last, gzipped: about 1-2 KB per minute of run.
const SHARE_RATE = 8;
export type Shared = { map: string; track: string; name: string; time: number; ghost: Ghost };
const gz = async (data: Uint8Array, stream: CompressionStream | DecompressionStream) =>
  new Uint8Array(await new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream)).arrayBuffer());

export async function encodeShare(s: Shared): Promise<string> {
  const step = (s.ghost.rate ?? GHOST_RATE) / SHARE_RATE, count = Math.floor(s.ghost.frames.length / 4 / step);
  const out = new Int16Array(count * 3);
  let px = 0, py = 0, pz = 0;
  for (let i = 0; i < count; i++) {
    const at = Math.floor(i * step) * 4;
    const x = Math.round(s.ghost.frames[at]), y = Math.round(s.ghost.frames[at + 1]), z = Math.round(s.ghost.frames[at + 2]);
    out[i * 3] = x - px;
    out[i * 3 + 1] = y - py;
    out[i * 3 + 2] = z - pz;
    (px = x), (py = y), (pz = z);
  }
  const body = JSON.stringify({ m: s.map, t: s.track, n: s.name, s: s.time, g: b64(await gz(new Uint8Array(out.buffer), new CompressionStream('gzip'))) });
  return 'surf1.' + b64(new TextEncoder().encode(body));
}

// Null for anything that isn't a good code: it's text from someone else.
export async function decodeShare(code: string): Promise<Shared | null> {
  try {
    if (!code.startsWith('surf1.') || code.length > 400000) return null;
    const j = JSON.parse(new TextDecoder().decode(unb64(code.slice(6).trim())));
    if (typeof j.m !== 'string' || typeof j.t !== 'string' || typeof j.n !== 'string' || !(j.s > 0) || !Number.isFinite(j.s)) return null;
    const bytes = await gz(unb64(j.g), new DecompressionStream('gzip'));
    if (!bytes.length || bytes.length % 6 || bytes.length > 3000000) return null;
    const d = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2), frames = new Float32Array((d.length / 3) * 4);
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < d.length / 3; i++) {
      (x += d[i * 3]), (y += d[i * 3 + 1]), (z += d[i * 3 + 2]);
      frames.set([x, y, z, 0], i * 4);
    }
    return { map: j.m.slice(0, 200), track: j.t.slice(0, 16), name: j.n.replace(/[\u0000-\u001f]/g, '').slice(0, 31) || 'Friend', time: j.s, ghost: { frames, rate: SHARE_RATE } };
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
