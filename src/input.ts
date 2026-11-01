import { config } from './config';
import type { Cmd } from './movement';

const SPIKE = 500;

// Some browsers report a huge delta on the first event after pointer lock, and occasional spikes.
export function mouseFilter(): (dx: number, dy: number) => [number, number] {
  let first = true;
  return (dx, dy) => {
    if (first) {
      first = false;
      return [0, 0];
    }
    if (Math.abs(dx) > SPIKE || Math.abs(dy) > SPIKE) return [0, 0];
    return [dx, dy];
  };
}

export function createInput(canvas: HTMLCanvasElement) {
  const keys = new Set<string>();
  let yaw = 0, pitch = 0;
  let filter = mouseFilter();
  const listeners: ((locked: boolean) => void)[] = [];
  const locked = () => document.pointerLockElement === canvas;

  canvas.addEventListener('click', () => {
    // Raw input where supported (matches CS:GO raw input); fall back to plain lock.
    const req = canvas.requestPointerLock({ unadjustedMovement: true } as PointerLockOptions) as unknown as Promise<void> | undefined;
    req?.catch?.(() => canvas.requestPointerLock());
  });
  document.addEventListener('pointerlockchange', () => {
    filter = mouseFilter();
    keys.clear();
    listeners.forEach((cb) => cb(locked()));
  });
  document.addEventListener('pointerlockerror', () => listeners.forEach((cb) => cb(false)));
  document.addEventListener('mousemove', (e) => {
    if (!locked()) return;
    const [dx, dy] = filter(e.movementX, e.movementY);
    yaw -= dx * config.sensitivity * config.mYaw;
    pitch = Math.max(-89, Math.min(89, pitch + dy * config.sensitivity * config.mPitch));
  });
  window.addEventListener('keydown', (e) => {
    if (!locked()) return;
    keys.add(e.code);
    if (e.code === 'Space') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));

  const k = (c: string) => (keys.has(c) ? 1 : 0);
  return {
    cmd: (): Cmd => ({
      forward: k('KeyW') - k('KeyS'),
      side: k('KeyD') - k('KeyA'),
      jump: keys.has('Space'),
      // Not Ctrl: Ctrl+W closes the tab and can't be blocked.
      duck: keys.has('KeyC') || keys.has('ShiftLeft'),
      yaw,
      pitch,
    }),
    locked,
    onLockChange: (cb: (locked: boolean) => void) => listeners.push(cb),
    setView(y: number, p: number) {
      yaw = y;
      pitch = p;
    },
  };
}
