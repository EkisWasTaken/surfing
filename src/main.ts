import './style.css';
import { config } from './config';
import { vec, add, sub, scale } from './math';
import { maps, findMap } from './maps';
import { step, newPlayer, Player } from './movement';
import { trace } from './trace';
import { createAccumulator } from './loop';
import { createInput } from './input';
import { createRenderer } from './render';
import { createHud } from './hud';
import { Settings, loadSettings, saveSettings, applySettings } from './settings';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const input = createInput(canvas);
const renderer = createRenderer(canvas);

let settings = loadSettings();
let map = findMap(settings.map);
settings = { ...settings, map: map.id };
applySettings(settings);
renderer.setMap(map.brushes);
renderer.setFov(settings.fov);
let acc = createAccumulator(1 / config.tickrate);

let prev: Player, cur: Player;
function respawn() {
  prev = cur = newPlayer(map.spawn);
  input.setView(map.spawnYaw, 0);
}
respawn();

const hud = createHud(document.querySelector<HTMLElement>('#hud')!, {
  maps,
  settings,
  onPlay: input.requestLock,
  onChange(next: Settings) {
    const mapChanged = next.map !== settings.map, tickChanged = next.tickrate !== settings.tickrate;
    settings = next;
    applySettings(next);
    saveSettings(next);
    renderer.setFov(next.fov);
    if (tickChanged) acc = createAccumulator(1 / config.tickrate);
    if (mapChanged) {
      map = findMap(next.map);
      renderer.setMap(map.brushes);
      respawn();
    }
  },
});

let last = performance.now();
input.onLockChange((locked) => {
  hud.showOverlay(!locked);
  acc.reset();
});
window.addEventListener('keydown', (e) => e.code === 'KeyR' && input.locked() && respawn());
window.addEventListener('resize', renderer.resize);
document.addEventListener('visibilitychange', () => {
  acc.reset();
  last = performance.now();
});

const stuck = (p: Player) => {
  const h = p.ducked ? config.hullDuck : config.hullStand;
  return trace(p.pos, p.pos, h.mins, h.maxs, map.brushes).startSolid;
};
const eye = (p: Player) => add(p.pos, vec(0, 0, p.ducked ? config.eyeDuck : config.eyeStand));

function frame(now: number) {
  const dt = (now - last) / 1000;
  last = now;
  // Pause while unlocked or hidden; the accumulator was reset on those transitions.
  if (input.locked() && !document.hidden) {
    const cmd = input.cmd();
    const tickDt = 1 / config.tickrate;
    for (let i = acc.advance(dt); i > 0; i--) {
      prev = cur;
      cur = step(cur, cmd, map.brushes, tickDt);
      if (cur.pos.z < map.killZ || stuck(cur)) respawn();
    }
  }
  // Interpolate the eye point itself so crouch height changes don't snap the camera.
  const a = eye(prev), b = eye(cur);
  const { yaw, pitch } = input.cmd();
  renderer.draw(add(a, scale(sub(b, a), acc.alpha())), yaw, pitch);
  hud.setSpeed(Math.hypot(cur.vel.x, cur.vel.y));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
