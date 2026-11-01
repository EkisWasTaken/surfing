import './style.css';
import { config } from './config';
import { vec, add, sub, scale } from './math';
import { maps as builtins, findMap } from './maps';
import type { MapDef } from './maps';
import { bspToMap, goalBox, saveGoal } from './maps/imported';
import { parseBsp } from './bsp';
import { readZip } from './pak';
import { meshFromJson, unb64, vtexFromJson, VtexJson } from './cs2model';
import { parseMdl } from './goldsrcmdl';
import { createGrid } from './grid';
import { newPlayer, unstick, Player } from './movement';
import { simTick, touching, newTickState } from './sim';
import { createAccumulator, tickYaw } from './loop';
import { newPose, stepPose } from './viewmodelPose';
import { createInput } from './input';
import { createRenderer } from './render';
import { createHud } from './hud';
import { newRun, tickRun, formatTime, Run } from './timer';
import { loadRecords, saveRecords, recordFinish, recordKey, FinishResult } from './records';
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
let records = loadRecords();
const best = () => records[recordKey(settings.game, map.id)]?.best ?? null; // per game: CS:GO and 1.6 times differ
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
    if (gameChanged) renderer.setGame(next.game);
    if (gameChanged && !mapChanged) respawn(); // hulls and rules differ: start the run over under the new ones
    if (gameChanged && !mapChanged) (announceMap(), refreshRecords());
    if (knifeChanged) loadKnife(next.knife);
    else if (finishChanged) applyFinish();
    if (!mapChanged) return;
    const known = maps.find((m) => m.id === next.map);
    if (known) (useMap(known), announceMap(), refreshRecords());
    else if (next.map.startsWith('bsp:')) loadFolderMap(next.map.slice(4));
    else (useMap(maps[0]), announceMap(), refreshRecords());
  },
  onLoadFile: async (file: File) => {
    showLoading(file.name, 'Reading map file…', 0.3);
    return loadBsp(() => file.arrayBuffer(), file.name);
  },
});

// Chat and records: CS server-style lines for map changes and finishes.
const gameName = () => (settings.game === 'cs16' ? 'CS 1.6' : 'CS:GO');
const mapShort = (m: MapDef) => (m.id.startsWith('bsp:') ? m.id.slice(4).replace(/\.bsp$/i, '') : m.name);
const player = () => settings.name.trim() || 'Player';
const signed = (d: number) => `${d < 0 ? '-' : '+'}${formatTime(Math.abs(d))}`;
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
function announceMap() {
  const pb = best();
  hud.chat([{ text: '[Surf] ', tone: 'tag' }, { text: `Now on ${mapShort(map)} with ${gameName()} movement. ` }, pb === null ? { text: 'No record here yet: leave the start zone to begin.' } : { text: `Your best: ${formatTime(pb)}`, tone: 'good' }]);
}
function announceFinish(r: FinishResult) {
  const t = formatTime(run.time), head = [{ text: '[Surf] ', tone: 'tag' as const }, { text: player(), tone: 'name' as const }];
  if (r.kind === 'first') {
    hud.chat([...head, { text: ` finished ${mapShort(map)} in ${t}. ` }, { text: 'First record on this map!', tone: 'good' }]);
    hud.flash(`First record: ${t}`);
  } else if (r.kind === 'pb') {
    hud.chat([...head, { text: ` broke their record on ${mapShort(map)}: ${t} ` }, { text: `(${signed(r.delta)})`, tone: 'good' }]);
    hud.flash(`New personal best: ${t}`);
  } else {
    const nth = r.record.recent.length >= 3 ? `, your ${ordinal(r.rank)} best of the last ${r.record.recent.length}` : '';
    hud.chat([...head, { text: ` finished ${mapShort(map)} in ${t} ` }, { text: `(${signed(r.delta)}${nth})`, tone: 'bad' }]);
    hud.flash(`Finished ${t}`);
  }
}
function refreshRecords() {
  const prefix = `${settings.game}:`;
  const rows = Object.entries(records)
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, r]) => ({ mapId: k.slice(prefix.length), best: r.best, finishes: r.finishes, bestAt: r.bestAt }))
    .sort((a, b) => b.bestAt - a.bestAt);
  hud.setRecords(gameName(), rows, map.id, records[recordKey(settings.game, map.id)]?.recent ?? []);
}
refreshRecords();
if (!wantedMap.startsWith('bsp:')) announceMap(); // folder maps announce once they've loaded

// Loading dialog steps; yields a frame between heavy steps so the bar actually paints.
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const showLoading = (mapName: string, step: string, fraction: number) =>
  hud.loading({ game: settings.game === 'cs16' ? 'Counter-Strike' : 'Counter-Strike: Global Offensive', map: mapName.replace(/\.bsp$/i, ''), step, fraction });
async function download(url: string, onProgress: (f: number) => void): Promise<Response & { bytes: ArrayBuffer }> {
  const res = await fetch(url);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.ok || !res.body || !total) return Object.assign(res, { bytes: res.ok ? await res.arrayBuffer() : new ArrayBuffer(0) });
  const reader = res.body.getReader(), parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    onProgress(Math.min(1, got / total));
  }
  const bytes = new Uint8Array(got);
  let at = 0;
  for (const p of parts) bytes.set(p, at), (at += p.length);
  return Object.assign(res, { bytes: bytes.buffer });
}

// stock: stock CS:GO files bundled by import-maps for this map; the map's own packed files win.
async function loadBsp(read: () => Promise<ArrayBuffer>, name: string, stock?: Map<string, Uint8Array>) {
  hud.setStatus(`Loading ${name}…`);
  try {
    const bytes = await read();
    showLoading(name, 'Parsing map resources…', 0.7);
    await nextFrame();
    const bsp = parseBsp(bytes, name);
    for (const [k, v] of stock ?? []) if (!bsp.pak.has(k)) bsp.pak.set(k, v);
    const m = bspToMap(bsp, name);
    const i = maps.findIndex((x) => x.id === m.id);
    if (i >= 0) maps[i] = m;
    else maps.push(m);
    hud.addMap(m);
    settings = { ...settings, map: m.id };
    saveSettings(settings);
    showLoading(name, 'Precaching textures and models…', 0.85);
    await nextFrame();
    const tex = useMap(m);
    showLoading(name, 'Entering the game…', 1);
    await nextFrame();
    announceMap();
    refreshRecords();
    const goal = m.goalFromMap ? 'goal found in map' : m.endZone ? 'using your saved goal' : 'no goal in map — press F at the finish to set one';
    // Texture report so a missing-texture problem shows what happened (decode path, GPU support).
    const texNote = tex ? ` Textures: ${tex.gpu + tex.cpu} loaded${tex.cpu ? ` (${tex.cpu} decoded on CPU: no GPU texture compression)` : ''}, ${tex.missing} missing${tex.missing && !stock ? ' (stock CS:GO: run npm run import-maps with CS:GO legacy installed)' : ''}.` : '';
    hud.setStatus(`Loaded ${m.brushes.length} brushes, ${m.teleports.length} teleports, ${m.pushes.length} boosters; ${goal}.${texNote}`);
  } catch (e) {
    hud.setStatus(e instanceof Error ? e.message : String(e), true);
    hud.chat([{ text: '[Surf] ', tone: 'tag' }, { text: `Couldn't load ${name}: ${e instanceof Error ? e.message : e}`, tone: 'bad' }]);
  } finally {
    hud.loading(null);
  }
}

// Maps folder (public/maps, filled by `npm run import-maps`), served by the dev server.
async function loadFolderMap(file: string) {
  showLoading(file, 'Retrieving stock textures…', 0);
  const zip = await download(`/maps/${encodeURIComponent(file.replace(/.bsp$/i, '.stock.zip'))}`, (f) => showLoading(file, 'Retrieving stock textures…', f * 0.2)).catch(() => null);
  // The dev server answers unknown paths with its HTML page, which reads as an empty zip: treat that as no bundle.
  const files = zip?.ok ? readZip(new Uint8Array(zip.bytes)) : new Map<string, Uint8Array>();
  const stock = files.size ? files : undefined;
  return loadBsp(
    async () => {
      const res = await download(`/maps/${encodeURIComponent(file)}`, (f) => showLoading(file, 'Downloading map…', 0.2 + f * 0.45));
      if (!res.ok) throw new Error(`${file} isn't in the maps folder anymore`);
      return res.bytes;
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
// CS 1.6's knife and hands (v_knife.mdl from your Counter-Strike install, copied by the import).
renderer.setGame(settings.game);
fetch('/cs16/v_knife.mdl')
  .then((r) => (r.ok && !r.headers.get('content-type')?.includes('html') ? r.arrayBuffer() : null))
  .then((b) => b && renderer.setKnife16(parseMdl(b)))
  .catch((e) => console.warn('CS 1.6 knife:', e));
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
    const r = recordFinish(records, settings.game, map.id, run.time, Date.now());
    records = r.all;
    saveRecords(records);
    announceFinish(r);
    refreshRecords();
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
  const pb = best();
  hud.setTimer(formatTime(run.time), pb === null ? '' : `PB ${formatTime(pb)}`);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
