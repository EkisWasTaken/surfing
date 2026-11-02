import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLeaderboard, WRONG_CODE } from '../src/leaderboard';

const respond = (status: number, body?: unknown) => vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }));
afterEach(() => void vi.unstubAllGlobals());

describe('leaderboard client', () => {
  it('is off without a project', () => {
    expect(createLeaderboard(undefined, undefined)).toBeNull();
    expect(createLeaderboard('https://x.supabase.co', '')).toBeNull();
  });
  it('calls the database functions with the key and reads the rows', async () => {
    const f = respond(200, [{ place: '2', name: 'Sam', run_time: 12.5, mine: true, players: '4', set_at: 'x' }]);
    vi.stubGlobal('fetch', f);
    const rows = await createLeaderboard('https://x.supabase.co/', 'key')!.top('code', 'me', 'cs16', 'spire');
    expect(rows).toEqual([{ place: 2, name: 'Sam', time: 12.5, mine: true, players: 4 }]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://x.supabase.co/rest/v1/rpc/leaderboard_top');
    expect((init.headers as Record<string, string>).apikey).toBe('key');
    expect(JSON.parse(init.body as string)).toEqual({ p_code: 'code', p_player: 'me', p_track: 'cs16', p_map: 'spire' });
  });
  it('a submit answers with no body', async () => {
    vi.stubGlobal('fetch', respond(204));
    await expect(createLeaderboard('https://x', 'k')!.submit('c', 'me', 'Sam', 'csgo', 'm', 1)).resolves.toBeNull();
  });
  it('passes on the database message, so a wrong code can be told from an outage', async () => {
    vi.stubGlobal('fetch', respond(400, { message: WRONG_CODE }));
    await expect(createLeaderboard('https://x', 'k')!.top('c', 'me', 'csgo', 'm')).rejects.toThrow(WRONG_CODE);
    vi.stubGlobal('fetch', respond(503));
    await expect(createLeaderboard('https://x', 'k')!.top('c', 'me', 'csgo', 'm')).rejects.toThrow('503');
  });
});
