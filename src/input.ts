import { config } from './config';
import type { Cmd } from './movement';

const SPIKE = 500;
const SPIKE_RATIO = 8;

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
  let jumpPulse = false; // wheel notches are instant, so they count as one tick of jump
  let typing = false; // chat open: keys are text, not movement
  const listeners: ((locked: boolean) => void)[] = [];
  const locked = () => document.pointerLockElement === canvas;

  const requestLock = () => {
    // Raw input where supported (matches CS:GO raw input); fall back to plain lock.
    // Failures surface via 'pointerlockerror', so the promises only need their rejections swallowed.
    const lock = (opts?: PointerLockOptions) => canvas.requestPointerLock(opts) as unknown as Promise<void> | undefined;
    lock({ unadjustedMovement: true })?.catch?.(() => lock()?.catch?.(() => {}));
  };
  // Only when unlocked: re-requesting while locked fires another lockchange, which used to drop held keys mid-run
  // (every knife attack click stopped you until W was pressed again).
  canvas.addEventListener('click', () => !locked() && requestLock());
  document.addEventListener('pointerlockchange', () => {
    filter = mouseFilter();
    if (!locked()) keys.clear(); // keys released while unlocked never reach us
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
        forward: k('KeyW') - k('KeyS'),
        side: k('KeyD') - k('KeyA'),
        jump,
        // Not Ctrl: Ctrl+W closes the tab and can't be blocked.
        duck: keys.has('KeyC'),
        walk: keys.has('ShiftLeft') || keys.has('ShiftRight'), // CS:GO: shift walks
        yaw,
        pitch,
      };
    },
    view: () => ({ yaw, pitch }),
    setTyping(on: boolean) {
      typing = on;
      keys.clear(); // whatever was held when chat opened is released
    },
    setJumpBind(b: string) {
      jumpBind = b;
    },
    locked,
    requestLock,
    onLockChange: (cb: (locked: boolean) => void) => listeners.push(cb),
    setView(y: number, p: number) {
      yaw = y;
      pitch = p;
    },
  };
}
