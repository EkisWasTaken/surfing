// The friends' leaderboard: talks to the Cloudflare Worker in worker/, which holds the rules.
import type { Track } from './records';

export type BoardRow = { place: number; name: string; time: number; mine: boolean; players: number };
export type Account = { name: string; token: string };
export const WRONG_CODE = 'wrong group code', NAME_TAKEN = 'name taken', BAD_TOKEN = 'bad token';

// null when this build has no leaderboard service: the game then simply has no leaderboard.
export function createLeaderboard(url?: string) {
  if (!url) return null;
  const call = async (action: string, body: Record<string, unknown>) => {
    const res = await fetch(`${url.replace(/\/$/, '')}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error ?? `Leaderboard error ${res.status}`);
    return data;
  };
  return {
    register: (code: string, name: string): Promise<Account> => call('register', { code, name }),
    me: (code: string, token: string): Promise<{ name: string }> => call('me', { code, token }),
    rename: (code: string, token: string, name: string): Promise<{ name: string }> => call('rename', { code, token, name }),
    submit: (code: string, token: string, track: Track, map: string, time: number) => call('submit', { code, token, track, map, time }),
    top: async (code: string, token: string | null, track: Track, map: string): Promise<BoardRow[]> => (await call('top', { code, token, track, map })).rows,
  };
}

const KEY = 'surf-account';
export function loadAccount(): Account | null {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return a && typeof a.name === 'string' && typeof a.token === 'string' ? { name: a.name, token: a.token } : null;
  } catch {
    return null;
  }
}
export function saveAccount(a: Account | null) {
  try {
    if (a) localStorage.setItem(KEY, JSON.stringify(a));
    else localStorage.removeItem(KEY);
  } catch {}
}
