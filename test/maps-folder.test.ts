// Playability check for every map in public/maps (filled by `npm run import-maps`). Skips when the folder is empty.
// Runs the real game tick (src/sim.ts) with bots; prints a per-map report and fails on hard breakage.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setGameMode, GameMode } from '../src/config';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { parseBsp } from '../src/bsp';
import { bspToMap } from '../src/maps/imported';
import { createGrid } from '../src/grid';
import { simTick, touching, newTickState } from '../src/sim';
import { newPlayer, unstick, embedded, Cmd, Player } from '../src/movement';
import type { MapDef } from '../src/maps/build';

const DIR = 'public/maps/';
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => /\.bsp$/i.test(f)) : [];
let dt = 1 / 64; // per game mode below
const idle: Cmd = { forward: 0, side: 0, jump: false, duck: false, yaw: 0, pitch: 0 };

type Tally = { fell: number; hurt: number; stuck: number; teleports: number; maxSpeed: number };
function play(map: MapDef, grid: ReturnType<typeof createGrid>, start: Player, ticks: number, bot: (p: Player, t: number) => Cmd): Tally {
  const tally: Tally = { fell: 0, hurt: 0, stuck: 0, teleports: 0, maxSpeed: 0 };
  let p = start;
  let state = newTickState();
  for (let t = 0; t < ticks; t++) {
    const r = simTick(map, grid, p, bot(p, t), dt, state);
    state = r.state;
    if (r.event === 'respawn') {
      tally[r.reason!]++;
      p = newPlayer(map.spawn);
      continue;
    }
    if (r.event === 'teleport') tally.teleports++;
    p = r.player;
    tally.maxSpeed = Math.max(tally.maxSpeed, Math.hypot(p.vel.x, p.vel.y));
  }
  return tally;
}

// Runs up to speed, then bhops and air-strafes perfectly, switching direction every half second.
const surfer = (spawnYaw: number) => (p: Player, t: number): Cmd => {
  const speed = Math.hypot(p.vel.x, p.vel.y);
  if (speed < 240) return { ...idle, forward: 1, yaw: spawnYaw };
  return { ...idle, jump: true, side: Math.floor((t * dt) / 0.5) % 2 ? 1 : -1, yaw: (Math.atan2(p.vel.y, p.vel.x) * 180) / Math.PI };
};

describe.skipIf(!files.length).each(['csgo', 'cs16'] as GameMode[])('maps folder playability (%s)', (mode) => {
  beforeAll(() => {
    setGameMode(mode);
    dt = mode === 'cs16' ? 1 / 100 : 1 / 64;
  });
  afterAll(() => setGameMode('csgo'));
  const report: string[] = [];
  it.each(files)('%s', (file) => {
    const buf = readFileSync(DIR + file);
    const map = bspToMap(parseBsp(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), file), file);
    const grid = createGrid(map.brushes);
    map.spawn = unstick(map.spawn, map.brushes);
    expect(embedded(map.spawn, false, map.brushes), 'spawn is inside geometry').toBe(false);

    const dests = [...new Map(map.teleports.map((t) => [`${t.dest.x},${t.dest.y},${t.dest.z}`, t.dest])).values()].map((d) => unstick(d, map.brushes));
    // A destination inside geometry is how the map itself is built (e.g. inside a player clip): reported, not failed.
    const badDests = dests.filter((d) => embedded(d, false, map.brushes));
    const atSpawn = play(map, grid, newPlayer(map.spawn), Math.round(3 / dt), () => idle);
    const atStages = dests.filter((d) => !embedded(d, false, map.brushes)).map((d) => play(map, grid, newPlayer(d), Math.round(2 / dt), () => idle));
    const surfing = play(map, grid, newPlayer(map.spawn), Math.round(20 / dt), surfer(map.spawnYaw));
    const stuck = atSpawn.stuck + surfing.stuck + atStages.reduce((s, a) => s + a.stuck, 0);

    report.push(
      `${file.replace(/\.bsp$/, '').padEnd(28)} brushes=${String(map.brushes.length).padStart(5)} tps=${String(map.teleports.length).padStart(3)} boost=${String(map.pushes.length).padStart(2)} hurt=${String(map.hurts.length).padStart(2)} ` +
        `zones=${touching(newPlayer(map.spawn), map.startZone) ? 'S' : 's'}${map.endZone ? 'E' : '-'} spawn=${atSpawn.fell || atSpawn.hurt ? 'DIES' : 'ok'} ` +
        `stagesDie=${atStages.filter((a) => a.fell || a.hurt).length}/${atStages.length} destsInMapGeometry=${badDests.length} ` +
        `bot: tp=${surfing.teleports} fell=${surfing.fell} hurt=${surfing.hurt} max=${Math.round(surfing.maxSpeed)}`,
    );
    expect(stuck, 'player got stuck inside geometry').toBe(0);
    expect(atSpawn.fell + atSpawn.hurt, 'standing at spawn kills you').toBe(0);
    expect(surfing.maxSpeed, 'player can get moving from spawn').toBeGreaterThan(200);
  }, 120000);

  it('report', () => console.log('\n' + report.join('\n')));
});
