import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createInput } from '../src/input';

// createInput only needs event targets: stand-ins for document, window and the canvas.
const g = globalThis as unknown as Record<string, unknown>;
let doc: EventTarget & { pointerLockElement: unknown }, canvas: EventTarget & { requestPointerLock: ReturnType<typeof vi.fn> };
const key = (type: string, code: string) => Object.assign(new Event(type), { code, preventDefault() {} });

beforeEach(() => {
  doc = Object.assign(new EventTarget(), { pointerLockElement: null as unknown });
  canvas = Object.assign(new EventTarget(), { requestPointerLock: vi.fn(() => Promise.resolve()) });
  g.document = doc;
  g.window = new EventTarget();
});
afterEach(() => {
  delete g.document;
  delete g.window;
});

describe('pointer lock and held keys', () => {
  it('clicking while locked (knife attacks) neither re-locks nor drops held keys', () => {
    const input = createInput(canvas as unknown as HTMLCanvasElement);
    doc.pointerLockElement = canvas;
    doc.dispatchEvent(new Event('pointerlockchange'));
    (g.window as EventTarget).dispatchEvent(key('keydown', 'KeyW'));
    canvas.dispatchEvent(new Event('click'));
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    doc.dispatchEvent(new Event('pointerlockchange')); // a stray lockchange while still locked
    expect(input.cmd().forward).toBe(1);
  });
  it('clears held keys when the lock is lost, and clicking then locks again', () => {
    const input = createInput(canvas as unknown as HTMLCanvasElement);
    doc.pointerLockElement = canvas;
    (g.window as EventTarget).dispatchEvent(key('keydown', 'KeyW'));
    doc.pointerLockElement = null;
    doc.dispatchEvent(new Event('pointerlockchange'));
    expect(input.cmd().forward).toBe(0);
    canvas.dispatchEvent(new Event('click'));
    expect(canvas.requestPointerLock).toHaveBeenCalled();
  });
});
