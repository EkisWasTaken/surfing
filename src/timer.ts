// Surf-timer style run state, advanced once per physics tick so times are exact.
export type Run = { phase: 'ready' | 'running' | 'finished'; time: number };

export const newRun = (): Run => ({ phase: 'ready', time: 0 });

export function tickRun(r: Run, inStart: boolean, inEnd: boolean, dt: number): Run {
  if (r.phase === 'finished') return r;
  if (inStart) return r.phase === 'ready' ? r : newRun();
  const time = r.time + dt;
  return { phase: inEnd ? 'finished' : 'running', time };
}

export function formatTime(t: number): string {
  const ms = Math.floor(t * 1000);
  const m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60;
  return `${m}:${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
