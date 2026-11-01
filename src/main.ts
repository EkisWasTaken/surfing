import './style.css';
import { config } from './config';
import { vec, add, sub, scale } from './math';
import { maps as builtins, findMap } from './maps';
import type { MapDef } from './maps';
import { bspToMap, goalBox, saveGoal } from './maps/imported';
import { parseBsp } from './bsp';
import { readZip } from './pak';
import { meshFromJson, unb64, vtexFromJson, VtexJson } from './cs2model';
import { createGrid } from './grid';
import { newPlayer, unstick, Player } from './movement';
import { simTick, touching, newTickState } from './sim';
import { createAccumulator, tickYaw } from './loop';
import { newPose, stepPose } from './viewmodelPose';
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
let simState = newTickState(); // once-pushes, health and hurt timing carried between ticks
let pose = newPose(); // knife bob/sway
let lastFrameView = { yaw: 0, pitch: 0 };
let lastTickYaw = 0; // yaw the previous tick used, for spreading mouse turn across ticks

function respawn() {
  prev = cur = newPlayer(map.spawn);
  simState = newTickState();
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
    const mapChanged = next.map !== settings.map, tickChanged = next.tickrate !== settings.tickrate || next.game !== settings.game;
    const gameChanged = next.game !== settings.game;
    const knifeChanged = next.knife !== settings.knife;
    const finishChanged = next.finish !== settings.finish || next.wear !== settings.wear || next.seed !== settings.seed;
    settings = next;
    applySettings(next);
    saveSettings(next);
    input.setJumpBind(next.jumpBind);
    renderer.setFov(next.fov);
    if (tickChanged) acc = createAccumulator(1 / config.tickrate);
    if (gameChanged && !mapChanged) respawn(); // hulls and rules differ: start the run over under the new ones
    if (knifeChanged) loadKnife(next.knife);
    else if (finishChanged) applyFinish();
    if (!mapChanged) return;
    const known = maps.find((m) => m.id === next.map);
    if (known) useMap(known);
    else if (next.map.startsWith('bsp:')) loadFolderMap(next.map.slice(4));
    else useMap(maps[0]);
  },
  onLoadFile: async (file: File) => loadBsp(() => file.arrayBuffer(), file.name),
});

// stock: stock CS:GO files bundled by import-maps for this map; the map's own packed files win.
async function loadBsp(read: () => Promise<ArrayBuffer>, name: string, stock?: Map<string, Uint8Array>) {
  hud.setStatus(`Loading ${name}…`);
  try {
    const bsp = parseBsp(await read(), name);
    for (const [k, v] of stock ?? []) if (!bsp.pak.has(k)) bsp.pak.set(k, v);
    const m = bspToMap(bsp, name);
    const i = maps.findIndex((x) => x.id === m.id);
    if (i >= 0) maps[i] = m;
    else maps.push(m);
    hud.addMap(m);
    settings = { ...settings, map: m.id };
    saveSettings(settings);
    const tex = useMap(m);
    const goal = m.goalFromMap ? 'goal found in map' : m.endZone ? 'using your saved goal' : 'no goal in map — press F at the finish to set one';
    // Texture report so a missing-texture problem shows what happened (decode path, GPU support).
    const texNote = tex ? ` Textures: ${tex.gpu + tex.cpu} loaded${tex.cpu ? ` (${tex.cpu} decoded on CPU: no GPU texture compression)` : ''}, ${tex.missing} missing${tex.missing && !stock ? ' (stock CS:GO: run npm run import-maps with CS:GO legacy installed)' : ''}.` : '';
    hud.setStatus(`Loaded ${m.brushes.length} brushes, ${m.teleports.length} teleports, ${m.pushes.length} boosters; ${goal}.${texNote}`);
  } catch (e) {
    hud.setStatus(e instanceof Error ? e.message : String(e), true);
  }
}

// Maps folder (public/maps, filled by `npm run import-maps`), served by the dev server.
async function loadFolderMap(file: string) {
  const zip = await fetch(`/maps/${encodeURIComponent(file.replace(/.bsp$/i, '.stock.zip'))}`).catch(() => null);
  // The dev server answers unknown paths with its HTML page, which reads as an empty zip: treat that as no bundle.
  const files = zip?.ok ? readZip(new Uint8Array(await zip.arrayBuffer())) : new Map<string, Uint8Array>();
  const stock = files.size ? files : undefined;
  return loadBsp(
    async () => {
      const res = await fetch(`/maps/${encodeURIComponent(file)}`);
      if (!res.ok) throw new Error(`${file} isn't in the maps folder anymore`);
      return res.arrayBuffer();
    },
    file,
    stock,
  );
}

// CS2's arms and knives, decoded by `npm run import-maps` from the local CS2 install (absent → no viewmodel).
const json = (url: string) => fetch(url).then((r) => (r.ok && r.headers.get('content-type')?.includes('json') ? r.json() : null));
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type Any = any;
let knives: { id: string; name: string; finishes: string[] }[] = [];
const finishNames: Record<string, string> = {};
type TrackJson = { frames: number; duration: number; poses: string };
const track = (c: TrackJson) => ({ ...c, poses: new Float32Array(unb64(c.poses).buffer) });
function loadKnife(id: string) {
  json(`/cs2/knives/${id}.json`)
    .then((j) => {
      if (!j || settings.knife !== id) return; // a newer pick won the race
      const clips = Object.fromEntries(Object.entries(j.clips as Record<string, TrackJson & { knife: TrackJson | null }>).map(([k, c]) => [k, { ...track(c), knife: c.knife && track(c.knife) }]));
      const p = j.paint;
      const paint = p && { ...p, masks: vtexFromJson(p.masks), ao: vtexFromJson(p.ao), pos: vtexFromJson(p.pos) };
      renderer.setKnife({ mesh: meshFromJson(j.mesh), skeleton: j.skeleton, clips: clips as Parameters<typeof renderer.setKnife>[0]['clips'], paint });
      hud.setFinishes((knives.find((k) => k.id === id)?.finishes ?? []).map((f) => ({ id: f, name: finishNames[f] ?? f })));
      applyFinish();
    })
    .catch((e) => console.warn('knife:', e));
}
// Finishes load on demand: each is a few MB (its pattern), the shared wear/grunge set once.
const finishCache = new Map<string, Promise<unknown>>();
const cached = (url: string, decode: (j: Any) => unknown) => {
  if (!finishCache.has(url)) finishCache.set(url, json(url).then((j) => j && decode(j)));
  return finishCache.get(url)!;
};
function applyFinish() {
  const want = settings.finish, offered = knives.find((k) => k.id === settings.knife)?.finishes ?? [];
  if (!want || !offered.includes(want)) return void renderer.setFinish(null);
  Promise.all([
    cached(`/cs2/finishes/${want}.json`, (j) => ({ ...j, pattern: j.pattern && vtexFromJson(j.pattern) })),
    cached('/cs2/finishes/shared.json', (j) => ({ wear: j.wear && vtexFromJson(j.wear as VtexJson), grunge: j.grunge && vtexFromJson(j.grunge as VtexJson) })),
  ])
    .then(([finish, shared]) => {
      if (settings.finish !== want || !finish || !shared) return; // a newer pick won the race, or the file is gone
      if (!renderer.setFinish({ finish, shared, wear: settings.wear, seed: settings.seed } as Parameters<typeof renderer.setFinish>[0])) hud.flash('This finish needs BC7 texture support (not available in this browser)');
    })
    .catch((e) => console.warn('finish:', e));
}
json('/cs2/viewmodel.json')
  .then((j) => j && renderer.setArms({ skeleton: j.skeleton, arms: meshFromJson(j.arms) }))
  .catch((e) => console.warn('viewmodel arms:', e));
json('/cs2/finishes/index.json')
  .then((names) => names && Object.assign(finishNames, names))
  .catch(() => {})
  .then(() => json('/cs2/knives/index.json'))
  .then((list: typeof knives | null) => {
    if (!list?.length) return;
    knives = list;
    hud.setKnives(list);
    if (!list.some((k) => k.id === settings.knife)) settings = { ...settings, knife: list[0].id };
    loadKnife(settings.knife);
  })
  .catch(() => {});

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
  held.clear();
});
window.addEventListener('keydown', (e) => {
  if (!input.locked()) return;
  if (e.code === 'KeyR') respawn();
  // Imported maps without a goal trigger: mark the finish where you stand.
  if (e.code === 'KeyF' && map.mesh && !(map as { goalFromMap?: boolean }).goalFromMap) {
    map.endZone = [goalBox(cur.pos)];
    saveGoal(map.id, cur.pos);
    hud.flash('Goal set here');
  } else if (e.code === 'KeyF') renderer.inspect(); // CS's inspect key
});
// Knife attacks: left click slashes, right click stabs; holding keeps attacking at CS's rate.
const held = new Set<number>();
window.addEventListener('mousedown', (e) => {
  if (input.locked() && (e.button === 0 || e.button === 2)) held.add(e.button);
});
window.addEventListener('mouseup', (e) => held.delete(e.button));
window.addEventListener('contextmenu', (e) => input.locked() && e.preventDefault());
window.addEventListener('resize', renderer.resize);
let last = performance.now();
document.addEventListener('visibilitychange', () => {
  acc.reset();
  last = performance.now();
});

const eye = (p: Player) => add(p.pos, vec(0, 0, p.ducked ? config.eyeDuck : config.eyeStand));

function tick(cmd: ReturnType<typeof input.cmd>, tickDt: number) {
  prev = cur;
  const r = simTick(map, grid, cur, cmd, tickDt, simState);
  if (r.event === 'respawn') return respawn();
  cur = r.player;
  simState = r.state;
  if (r.teleport) {
    prev = cur;
    if (!r.teleport.keepAngles) {
      input.setView(r.teleport.yaw, input.view().pitch);
      lastTickYaw = r.teleport.yaw;
    }
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
    if (held.has(0)) renderer.attack('light');
    else if (held.has(2)) renderer.attack('heavy');
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
  pose = stepPose(pose, { speed: Math.hypot(cur.vel.x, cur.vel.y), onGround: cur.onGround, yawDelta: yaw - lastFrameView.yaw, pitchDelta: pitch - lastFrameView.pitch }, Math.min(dt, 0.1));
  lastFrameView = { yaw, pitch };
  renderer.draw(add(a, scale(sub(b, a), acc.alpha())), yaw, pitch, pose);
  hud.setSpeed(Math.hypot(cur.vel.x, cur.vel.y));
  hud.setTimer(formatTime(run.time), best === null ? '' : `PB ${formatTime(best)}`);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
