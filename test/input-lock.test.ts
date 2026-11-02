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
  it('a click while typing in the console does not take the mouse', () => {
    createInput(canvas as unknown as HTMLCanvasElement).setTyping(true);
    canvas.dispatchEvent(new Event('click'));
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
  });
});

describe('refused lock requests', () => {
  beforeEach(() => void vi.useFakeTimers({ toFake: ['setTimeout', 'performance'] }));
  afterEach(() => void vi.useRealTimers());
  const refuse = () => doc.dispatchEvent(new Event('pointerlockerror'));

  it('keep asking through the pause after Esc, then report it', () => {
    const input = createInput(canvas as unknown as HTMLCanvasElement), refused = vi.fn(), changes = vi.fn();
    input.onLockRefused(refused);
    input.onLockChange(changes);
    input.requestLock();
    refuse();
    vi.advanceTimersByTime(250);
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(2);
    expect(refused).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    refuse();
    vi.advanceTimersByTime(1000);
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(2);
    expect(refused).toHaveBeenCalledOnce();
    expect(changes).toHaveBeenCalledWith(false);
  });
  it('stop asking once the player opens the menu', () => {
    const input = createInput(canvas as unknown as HTMLCanvasElement);
    input.requestLock();
    refuse();
    input.cancelLock();
    vi.advanceTimersByTime(250);
    expect(canvas.requestPointerLock).toHaveBeenCalledOnce();
  });
  it('drop raw input only where the browser lacks it', async () => {
    const input = createInput(canvas as unknown as HTMLCanvasElement);
    canvas.requestPointerLock.mockImplementationOnce(() => Promise.reject(Object.assign(new Error(), { name: 'NotSupportedError' })));
    input.requestLock();
    await vi.advanceTimersByTimeAsync(0);
    refuse();
    vi.advanceTimersByTime(250);
    expect(canvas.requestPointerLock.mock.calls[0][0]).toEqual({ unadjustedMovement: true });
    expect(canvas.requestPointerLock.mock.calls[1][0]).toBeUndefined();
  });
});
