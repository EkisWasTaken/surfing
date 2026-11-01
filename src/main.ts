import './style.css';
import { config } from './config';
import { vec, add, sub, scale } from './math';
import type { Brush } from './brush';
import { maps as builtins, findMap } from './maps';
import type { MapDef } from './maps';
import { bspToMap, goalBox, saveGoal } from './maps/imported';
import { parseBsp } from './bsp';
import { createGrid } from './grid';
import { step, newPlayer, unstick, Player } from './movement';
import { trace } from './trace';
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
let lastTickYaw = 0; // yaw the previous tick used, for spreading mouse turn across ticks

const touching = (p: Player, zone: Brush[] | null) => {
  if (!zone) return false;
  const h = p.ducked ? config.hullDuck : config.hullStand;
  return trace(p.pos, p.pos, h.mins, h.maxs, zone).startSolid;
};

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
  renderer.setMap(m);
  best = loadBest(m.id);
  respawn();
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
    if (mapChanged) useMap(maps.find((m) => m.id === next.map) ?? maps[0]);
  },
  async onLoadFile(file: File) {
    hud.setStatus(`Loading ${file.name}…`);
    try {
      const m = bspToMap(parseBsp(await file.arrayBuffer(), file.name), file.name);
      const i = maps.findIndex((x) => x.id === m.id);
      if (i >= 0) maps[i] = m;
      else maps.push(m);
      hud.addMap(m);
      settings = { ...settings, map: m.id };
      useMap(m);
      const goal = m.goalFromMap ? 'goal found in map' : m.endZone ? 'using your saved goal' : 'no goal in map — press F at the finish to set one';
      hud.setStatus(`Loaded ${m.brushes.length} brushes, ${m.teleports.length} teleports; ${goal}.`);
    } catch (e) {
      hud.setStatus(e instanceof Error ? e.message : String(e), true);
    }
  },
});

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
  // Only brushes near the player: enough margin for this tick's travel plus step and ground checks.
  const r = 256 + Math.hypot(cur.vel.x, cur.vel.y, cur.vel.z) * tickDt * 2;
  const near = grid.query(sub(cur.pos, vec(r, r, r)), add(cur.pos, vec(r, r, r + 128)));
  prev = cur;
  cur = step(cur, cmd, near, tickDt);
  if (cur.pos.z < map.killZ || touching(cur, near)) return respawn();
  const tp = map.teleports.find((t) => touching(cur, t.brushes));
  if (tp) {
    // shortcut: teleports zero velocity (what surf servers do); Source's trigger_teleport keeps it.
    prev = cur = { ...cur, pos: unstick(tp.dest, grid.query(sub(tp.dest, vec(256, 256, 256)), add(tp.dest, vec(256, 256, 256)))), vel: vec(), onGround: false };
    input.setView(tp.yaw, input.view().pitch);
    lastTickYaw = tp.yaw;
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
