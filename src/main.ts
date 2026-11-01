import './style.css';
import { config } from './config';
import { vec, add, sub, scale } from './math';
import { maps as builtins, findMap } from './maps';
import type { MapDef } from './maps';
import { bspToMap, goalBox, saveGoal } from './maps/imported';
import { parseBsp } from './bsp';
import { createGrid } from './grid';
import { newPlayer, unstick, Player } from './movement';
import { simTick, touching } from './sim';
import type { Push } from './bsp';
import { createAccumulator, tickYaw } from './loop';
import { createInput } from './input';
import { createRenderer } from './render';
import { createHud } from './hud';
import { newRun, tickRun, formatTime, loadBest, saveBest, Run } from './timer';
import { Settings, loadSettings, saveSettings, applySettings } from './settings';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const input = createInput(canvas);
const renderer = createRenderer(canvas);
const maps: (MapDef & { goalFromMap?: boolean })[] = [...builtins];

let settings = loadSettings();
const wantedMap = settings.map; // may be a maps-folder map, loaded once the folder list arrives
let map = findMap(settings.map);
settings = { ...settings, map: map.id };
applySettings(settings);
input.setJumpBind(settings.jumpBind);
renderer.setFov(settings.fov);
let acc = createAccumulator(1 / config.tickrate);
let grid = createGrid(map.brushes);
let prev: Player, cur: Player;
let run: Run = newRun();
let best = loadBest(map.id);
let inOncePush = new Set<Push>(); // once-pushes touched last tick, so the impulse fires on entry only
let lastTickYaw = 0; // yaw the previous tick used, for spreading mouse turn across ticks

function respawn() {
  prev = cur = newPlayer(map.spawn);
  input.setView(map.spawnYaw, 0);
  lastTickYaw = map.spawnYaw;
  run = newRun();
}

function useMap(m: MapDef) {
  map = m;
  grid = createGrid(m.brushes);
  m.spawn = unstick(m.spawn, m.brushes);
  const textures = renderer.setMap(m);
  best = loadBest(m.id);
  respawn();
  return textures;
}
useMap(map);

const hud = createHud(document.querySelector<HTMLElement>('#hud')!, {
  maps,
  settings,
  onPlay: input.requestLock,
  onChange(next: Settings) {
    const mapChanged = next.map !== settings.map, tickChanged = next.tickrate !== settings.tickrate;
    settings = next;
    applySettings(next);
    saveSettings(next);
    input.setJumpBind(next.jumpBind);
    renderer.setFov(next.fov);
    if (tickChanged) acc = createAccumulator(1 / config.tickrate);
    if (!mapChanged) return;
    const known = maps.find((m) => m.id === next.map);
    if (known) useMap(known);
    else if (next.map.startsWith('bsp:')) loadFolderMap(next.map.slice(4));
    else useMap(maps[0]);
  },
  onLoadFile: async (file: File) => loadBsp(() => file.arrayBuffer(), file.name),
});

async function loadBsp(read: () => Promise<ArrayBuffer>, name: string) {
  hud.setStatus(`Loading ${name}…`);
  try {
    const m = bspToMap(parseBsp(await read(), name), name);
    const i = maps.findIndex((x) => x.id === m.id);
    if (i >= 0) maps[i] = m;
    else maps.push(m);
    hud.addMap(m);
    settings = { ...settings, map: m.id };
    saveSettings(settings);
    const tex = useMap(m);
    const goal = m.goalFromMap ? 'goal found in map' : m.endZone ? 'using your saved goal' : 'no goal in map — press F at the finish to set one';
    // Texture report so a missing-texture problem shows what happened (decode path, GPU support).
    const texNote = tex ? ` Textures: ${tex.gpu + tex.cpu} loaded${tex.cpu ? ` (${tex.cpu} decoded on CPU: no GPU texture compression)` : ''}, ${tex.missing} not in map (stock CS:GO).` : '';
    hud.setStatus(`Loaded ${m.brushes.length} brushes, ${m.teleports.length} teleports, ${m.pushes.length} boosters; ${goal}.${texNote}`);
  } catch (e) {
    hud.setStatus(e instanceof Error ? e.message : String(e), true);
  }
}

// Maps folder (public/maps, filled by `npm run import-maps`), served by the dev server.
const loadFolderMap = (file: string) =>
  loadBsp(async () => {
    const res = await fetch(`/maps/${encodeURIComponent(file)}`);
    if (!res.ok) throw new Error(`${file} isn't in the maps folder anymore`);
    return res.arrayBuffer();
  }, file);

fetch('/maps/index.json')
  .then((r) => (r.ok ? r.json() : []))
  .then((files: string[]) => {
    for (const f of files) hud.addMap({ id: `bsp:${f}`, name: `CS:GO: ${f.replace(/\.bsp$/i, '')}` }, false);
    if (wantedMap.startsWith('bsp:') && files.includes(wantedMap.slice(4))) loadFolderMap(wantedMap.slice(4));
  })
  .catch(() => {}); // no dev server endpoint (e.g. static build): built-in maps and file loading still work

input.onLockChange((locked) => {
  hud.showOverlay(!locked);
  acc.reset();
});
window.addEventListener('keydown', (e) => {
  if (!input.locked()) return;
  if (e.code === 'KeyR') respawn();
  // Imported maps without a goal trigger: mark the finish where you stand.
  if (e.code === 'KeyF' && map.mesh && !(map as { goalFromMap?: boolean }).goalFromMap) {
    map.endZone = [goalBox(cur.pos)];
    saveGoal(map.id, cur.pos);
    hud.flash('Goal set here');
  }
});
window.addEventListener('resize', renderer.resize);
let last = performance.now();
document.addEventListener('visibilitychange', () => {
  acc.reset();
  last = performance.now();
});

const eye = (p: Player) => add(p.pos, vec(0, 0, p.ducked ? config.eyeDuck : config.eyeStand));

function tick(cmd: ReturnType<typeof input.cmd>, tickDt: number) {
  prev = cur;
  const r = simTick(map, grid, cur, cmd, tickDt, inOncePush);
  if (r.event === 'respawn') return respawn();
  cur = r.player;
  inOncePush = r.oncePushes;
  if (r.teleport) {
    prev = cur;
    input.setView(r.teleport.yaw, input.view().pitch);
    lastTickYaw = r.teleport.yaw;
  }
  const was = run.phase;
  run = tickRun(run, touching(cur, map.startZone), touching(cur, map.endZone), tickDt);
  if (was === 'running' && run.phase === 'finished') {
    const pb = best === null || run.time < best;
    if (pb) saveBest(map.id, (best = run.time));
    hud.flash(`Finished ${formatTime(run.time)}${pb ? ' — new best!' : ''}`);
  }
}

function frame(now: number) {
  const dt = (now - last) / 1000;
  last = now;
  // Pause while unlocked or hidden; the accumulator was reset on those transitions.
  if (input.locked() && !document.hidden) {
    const ticks = acc.advance(dt);
    if (ticks) {
      const cmd = input.cmd();
      const tickDt = 1 / config.tickrate;
      const from = lastTickYaw;
      for (let i = 0; i < ticks; i++) {
        lastTickYaw = tickYaw(from, cmd.yaw, i, ticks);
        tick({ ...cmd, yaw: lastTickYaw }, tickDt);
      }
    }
  }
  // Interpolate the eye point itself so crouch height changes don't snap the camera.
  const a = eye(prev), b = eye(cur);
  const { yaw, pitch } = input.view();
  renderer.draw(add(a, scale(sub(b, a), acc.alpha())), yaw, pitch);
  hud.setSpeed(Math.hypot(cur.vel.x, cur.vel.y));
  hud.setTimer(formatTime(run.time), best === null ? '' : `PB ${formatTime(best)}`);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
