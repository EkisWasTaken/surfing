import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLeaderboard, WRONG_CODE } from '../src/leaderboard';

const respond = (status: number, body?: unknown) => vi.fn(async () => new Response(body === undefined ? 'oops' : JSON.stringify(body), { status }));
afterEach(() => void vi.unstubAllGlobals());

describe('leaderboard client', () => {
  it('is off without a service', () => {
    expect(createLeaderboard(undefined)).toBeNull();
    expect(createLeaderboard('')).toBeNull();
  });
  it('posts to the service, with secrets in the body rather than the address', async () => {
    const f = respond(200, { rows: [{ place: 2, name: 'Sam', time: 12.5, mine: true, players: 4 }] });
    vi.stubGlobal('fetch', f);
    const rows = await createLeaderboard('https://x.workers.dev/')!.top('code', 'tok', 'cs16', 'spire');
    expect(rows).toEqual([{ place: 2, name: 'Sam', time: 12.5, mine: true, players: 4 }]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://x.workers.dev/top');
    expect(JSON.parse(init.body as string)).toEqual({ code: 'code', token: 'tok', track: 'cs16', map: 'spire' });
    expect(init.signal).toBeInstanceOf(AbortSignal); // a hung service can't leave the board loading forever
  });
  it("passes on the service's reason, so a wrong code can be told from an outage", async () => {
    vi.stubGlobal('fetch', respond(403, { error: WRONG_CODE }));
    await expect(createLeaderboard('https://x')!.top('c', null, 'csgo', 'm')).rejects.toThrow(WRONG_CODE);
    vi.stubGlobal('fetch', respond(503));
    await expect(createLeaderboard('https://x')!.top('c', null, 'csgo', 'm')).rejects.toThrow('503');
  });
});
