import { config } from './config';
import type { Cmd } from './movement';
import { defaults, KeyBinds } from './settings';

const SPIKE = 500;
const SPIKE_RATIO = 8;
const RETRY_MS = 1500; // browsers refuse the mouse for about a second after Esc; the click that asked stays valid

// Some browsers report a huge delta on the first event after pointer lock, and occasional
// isolated spikes. Real flicks ramp up over several events, so only drop sudden jumps.
export function mouseFilter(): (dx: number, dy: number) => [number, number] {
  let first = true;
  let prev = 0;
  return (dx, dy) => {
    if (first) {
      first = false;
      return [0, 0];
    }
    const mag = Math.max(Math.abs(dx), Math.abs(dy));
    if (mag > SPIKE && mag > prev * SPIKE_RATIO) return [0, 0];
    prev = mag;
    return [dx, dy];
  };
}

export const wheelCode = (deltaY: number) => (deltaY > 0 ? 'WheelDown' : 'WheelUp');

export function bindLabel(code: string): string {
  if (code === 'WheelDown') return 'Mouse wheel down';
  if (code === 'WheelUp') return 'Mouse wheel up';
  return code.replace(/^(Key|Digit)/, '');
}

export function createInput(canvas: HTMLCanvasElement) {
  const keys = new Set<string>();
  let yaw = 0, pitch = 0;
  let filter = mouseFilter();
  let jumpBind = 'Space';
  let binds: KeyBinds = defaults.keys;
  let jumpPulse = false; // wheel notches are instant, so they count as one tick of jump
  let typing = false; // chat open: keys are text, not movement
  const listeners: ((locked: boolean) => void)[] = [];
  let onRefused = () => {};
  let raw = true, retryUntil = 0, fullscreen = false;
  const locked = () => document.pointerLockElement === canvas;

  // Raw input where supported (matches CS:GO raw input), plain lock where it isn't.
  // Refusals surface via 'pointerlockerror', so the promise only needs its rejection swallowed.
  const attempt = () => {
    const asked = canvas.requestPointerLock(raw ? { unadjustedMovement: true } : undefined) as unknown as Promise<void> | undefined;
    asked?.catch?.((e: Error) => {
      if (e?.name === 'NotSupportedError') raw = false;
    });
  };
  const requestLock = () => {
    retryUntil = performance.now() + RETRY_MS;
    attempt();
    // Lock first: entering fullscreen uses up the click. In fullscreen Esc reaches the game instead of freeing the mouse.
    if (!fullscreen || document.fullscreenElement) return;
    document.documentElement
      .requestFullscreen({ navigationUI: 'hide' })
      .then(() => (navigator as unknown as { keyboard: { lock(keys: string[]): Promise<void> } }).keyboard.lock(['Escape']))
      .then(() => !locked() && attempt()) // some browsers drop the lock on the switch
      .catch(() => {});
  };
  // Only when unlocked: re-requesting while locked fires another lockchange, which used to drop held keys mid-run
  // (every knife attack click stopped you until W was pressed again).
  canvas.addEventListener('click', () => !locked() && !typing && requestLock());
  document.addEventListener('pointerlockchange', () => {
    filter = mouseFilter();
    if (!locked()) keys.clear(); // keys released while unlocked never reach us
    else retryUntil = 0;
    listeners.forEach((cb) => cb(locked()));
  });
  document.addEventListener('pointerlockerror', () => {
    if (performance.now() < retryUntil) return void setTimeout(() => retryUntil && attempt(), 250);
    listeners.forEach((cb) => cb(false));
    onRefused();
  });
  document.addEventListener('mousemove', (e) => {
    if (!locked()) return;
    const [dx, dy] = filter(e.movementX, e.movementY);
    yaw -= dx * config.sensitivity * config.mYaw;
    pitch = Math.max(-89, Math.min(89, pitch + dy * config.sensitivity * config.mPitch));
  });
  window.addEventListener('keydown', (e) => {
    if (!locked() || typing) return;
    keys.add(e.code);
    if (e.code === 'Space' || e.code === jumpBind) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  document.addEventListener('wheel', (e) => {
    if (locked() && !typing && wheelCode(e.deltaY) === jumpBind) jumpPulse = true;
  });

  const k = (c: string) => (keys.has(c) ? 1 : 0);
  return {
    // Consumes a pending wheel jump, so call once per batch of ticks.
    cmd(): Cmd {
      const jump = keys.has(jumpBind) || jumpPulse;
      jumpPulse = false;
      return {
        forward: k(binds.forward) - k(binds.back),
        side: k(binds.right) - k(binds.left),
        jump,
        // Not Ctrl: Ctrl+W closes the tab and can't be blocked.
        duck: keys.has(binds.duck),
        walk: keys.has(binds.walk) || (binds.walk === 'ShiftLeft' && keys.has('ShiftRight')), // CS:GO: shift walks
        yaw,
        pitch,
      };
    },
    view: () => ({ yaw, pitch }),
    setTyping(on: boolean) {
      typing = on;
      keys.clear(); // whatever was held when chat opened is released
    },
    setKeys(b: KeyBinds) {
      binds = b;
    },
    setJumpBind(b: string) {
      jumpBind = b;
    },
    locked,
    requestLock,
    cancelLock: () => (retryUntil = 0),
    // Only where Esc can be held for the game; elsewhere fullscreen would just drop on every Esc.
    setFullscreen(on: boolean) {
      fullscreen = on && 'keyboard' in navigator;
      if (!on && document.fullscreenElement) document.exitFullscreen();
    },
    onLockChange: (cb: (locked: boolean) => void) => listeners.push(cb),
    onLockRefused: (cb: () => void) => (onRefused = cb), // browsers refuse the mouse for a moment after Esc
    setView(y: number, p: number) {
      yaw = y;
      pitch = p;
    },
  };
}
