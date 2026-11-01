import './style.css';
import { config } from './config';
import { vec, add, sub, scale } from './math';
import { brushes, spawn, killZ } from './map';
import { step, newPlayer, Player } from './movement';
import { trace } from './trace';
import { createAccumulator } from './loop';
import { createInput } from './input';
import { createRenderer } from './render';
import { createHud } from './hud';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const hud = createHud(document.querySelector<HTMLElement>('#hud')!);
const input = createInput(canvas);
const renderer = createRenderer(canvas, brushes);
const tickDt = 1 / config.tickrate;
const acc = createAccumulator(tickDt);

let prev: Player, cur: Player;
function respawn() {
  prev = cur = newPlayer(spawn);
  input.setView(0, 0);
}
respawn();

input.onLockChange((locked) => {
  hud.showOverlay(!locked);
  acc.reset();
});
window.addEventListener('keydown', (e) => e.code === 'KeyR' && input.locked() && respawn());
window.addEventListener('resize', renderer.resize);
document.addEventListener('visibilitychange', () => acc.reset());

const stuck = (p: Player) => {
  const h = p.ducked ? config.hullDuck : config.hullStand;
  return trace(p.pos, p.pos, h.mins, h.maxs, brushes).startSolid;
};

let last = performance.now();
function frame(now: number) {
  const dt = (now - last) / 1000;
  last = now;
  // Pause while unlocked or hidden; the accumulator was reset on those transitions.
  if (input.locked() && !document.hidden) {
    const cmd = input.cmd();
    for (let i = acc.advance(dt); i > 0; i--) {
      prev = cur;
      cur = step(cur, cmd, brushes, tickDt);
      if (cur.pos.z < killZ || stuck(cur)) respawn();
    }
  }
  const pos = add(prev.pos, scale(sub(cur.pos, prev.pos), acc.alpha()));
  const { yaw, pitch } = input.cmd();
  renderer.draw(add(pos, vec(0, 0, cur.ducked ? config.eyeDuck : config.eyeStand)), yaw, pitch);
  hud.setSpeed(Math.hypot(cur.vel.x, cur.vel.y));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
