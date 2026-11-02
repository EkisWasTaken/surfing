// The friends' leaderboard, straight on Supabase's REST API. supabase/leaderboard.sql holds the rules: group code, best time per player.
import type { Track } from './records';

export type BoardRow = { place: number; name: string; time: number; mine: boolean; players: number };
export const WRONG_CODE = 'wrong group code';

// null when this build has no Supabase project: the game then simply has no leaderboard.
export function createLeaderboard(url?: string, key?: string) {
  if (!url || !key) return null;
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `Leaderboard error ${res.status}`);
    return res.status === 204 ? null : res.json();
  };
  return {
    submit: (code: string, player: string, name: string, track: Track, map: string, time: number) =>
      rpc('leaderboard_submit', { p_code: code, p_player: player, p_name: name, p_track: track, p_map: map, p_time: time }),
    top: async (code: string, player: string, track: Track, map: string): Promise<BoardRow[]> =>
      ((await rpc('leaderboard_top', { p_code: code, p_player: player, p_track: track, p_map: map })) as Record<string, unknown>[]).map((r) => ({
        place: Number(r.place),
        name: String(r.name),
        time: Number(r.run_time),
        mine: Boolean(r.mine),
        players: Number(r.players),
      })),
  };
}

// Who this browser is on the boards: names can change or clash, this stays. Never shown to anyone.
export function playerId() {
  const KEY = 'surf-player';
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && /^[0-9a-f-]{36}$/.test(saved)) return saved;
    const id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}
