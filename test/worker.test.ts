import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import worker from '../worker/src/index';

// The Worker's real SQL on real SQLite (D1 is SQLite), through a thin stand-in for D1's statements.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const d1 = () => {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync('worker/schema.sql', 'utf8'));
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => statement(sql, a),
    run: async () => db.prepare(sql).run(...args),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
  });
  return { prepare: (sql: string) => statement(sql), db };
};

let env: { DB: ReturnType<typeof d1>; GROUP_CODE?: string };
const CODE = 'friends-123';
const post = async (action: string, body: Record<string, unknown>, code: unknown = CODE) => {
  const res = await worker.fetch(new Request(`https://x/${action}`, { method: 'POST', body: JSON.stringify({ code, ...body }) }), env as never);
  return { status: res.status, ...(await res.json()) } as Record<string, any>;
};
const join = async (name: string) => (await post('register', { name })).token as string;
const board = async (token: string | null, track = 'csgo', map = 'warmup') => (await post('top', { token, track, map })).rows as { place: number; name: string; time: number; mine: boolean; players: number }[];
const send = (token: string, time: number, track = 'csgo', map = 'warmup') => post('submit', { token, track, map, time });

beforeEach(() => {
  env = { DB: d1(), GROUP_CODE: CODE };
});

describe('leaderboard service: who gets in', () => {
  it('refuses a wrong or missing group code on everything', async () => {
    for (const action of ['register', 'me', 'rename', 'submit', 'top']) {
      expect((await post(action, { name: 'Sam' }, 'nope')).status).toBe(403);
      expect((await post(action, { name: 'Sam' }, null)).status).toBe(403);
    }
  });
  it('lets nobody in when no code is set on the Worker', async () => {
    env.GROUP_CODE = undefined;
    expect((await post('top', { track: 'csgo', map: 'warmup' }, undefined)).status).toBe(403);
    expect((await post('top', { track: 'csgo', map: 'warmup' }, '')).status).toBe(403);
  });
  it('answers browsers from any origin, and refuses unknown paths and other methods', async () => {
    const options = await worker.fetch(new Request('https://x/top', { method: 'OPTIONS' }), env as never);
    expect(options.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect((await post('nothing', {})).status).toBe(404);
    expect((await post('__proto__', {})).status).toBe(404);
    expect((await worker.fetch(new Request('https://x/top'), env as never)).status).toBe(404);
  });
  it('refuses broken and oversized requests', async () => {
    const raw = (body: string) => worker.fetch(new Request('https://x/top', { method: 'POST', body }), env as never);
    expect((await raw('{oops')).status).toBe(400);
    expect((await raw('null')).status).toBe(400);
    expect((await raw('x'.repeat(2001))).status).toBe(413);
  });
});

describe('leaderboard service: players', () => {
  it('gives each new player a secret token and stores only its hash', async () => {
    const r = await post('register', { name: 'Sam' });
    expect(r.name).toBe('Sam');
    expect(r.token).toMatch(/^[0-9a-f]{40}$/);
    const stored = env.DB.db.prepare('SELECT * FROM players').get();
    expect(JSON.stringify(stored)).not.toContain(r.token);
  });
  it('keeps names unique, ignoring case, and tidies them', async () => {
    await join('Sam');
    expect((await post('register', { name: 'sAM' })).status).toBe(409);
    expect((await post('register', { name: '  Ali  ' })).name).toBe('Ali');
    for (const name of ['', '   ', 'x'.repeat(32), 'a\nb', 7, null]) expect((await post('register', { name })).status).toBe(400);
  });
  it('finds a player from their recovery code, and no one from a wrong one', async () => {
    const token = await join('Sam');
    expect((await post('me', { token })).name).toBe('Sam');
    for (const bad of ['f'.repeat(40), 'short', null, { $ne: 1 }]) expect((await post('me', { token: bad })).status).toBe(401);
  });
  it('renames, even to a different case of the same name, but not onto someone else', async () => {
    const sam = await join('Sam');
    await join('Ali');
    expect((await post('rename', { token: sam, name: 'SAM' })).name).toBe('SAM');
    expect((await post('rename', { token: sam, name: 'ali' })).status).toBe(409);
    expect((await post('rename', { token: 'f'.repeat(40), name: 'New' })).status).toBe(401);
    await send(sam, 10);
    await post('rename', { token: sam, name: 'Samuel' });
    expect((await board(sam))[0].name).toBe('Samuel');
  });
});

describe('leaderboard service: times', () => {
  it('keeps each player\'s best, and its date', async () => {
    const sam = await join('Sam');
    await send(sam, 30);
    const first = env.DB.db.prepare('SELECT set_at FROM times').get().set_at;
    env.DB.db.prepare('UPDATE times SET set_at = 5').run();
    await send(sam, 99);
    expect((await board(sam))[0].time).toBe(30);
    expect(env.DB.db.prepare('SELECT set_at FROM times').get().set_at).toBe(5);
    await send(sam, 10);
    expect((await board(sam))[0].time).toBe(10);
    expect(env.DB.db.prepare('SELECT set_at FROM times').get().set_at).toBeGreaterThanOrEqual(first);
  });
  it('ranks fastest first, marks only your own row, and hides tokens and ids', async () => {
    const sam = await join('Sam'), ali = await join('Ali');
    await send(sam, 30);
    await send(ali, 20);
    const rows = await board(sam);
    expect(rows.map((r) => [r.place, r.name, r.time, r.mine, r.players])).toEqual([[1, 'Ali', 20, false, 2], [2, 'Sam', 30, true, 2]]);
    expect(Object.keys(rows[0]).sort()).toEqual(['mine', 'name', 'place', 'players', 'time']);
    expect((await board(null)).some((r) => r.mine)).toBe(false);
  });
  it('keeps boards apart per mode and map', async () => {
    const sam = await join('Sam');
    await send(sam, 30);
    expect(await board(sam, 'cs16')).toEqual([]);
    expect(await board(sam, 'csgo', 'spire')).toEqual([]);
  });
  it('shows the top 10, plus your own row further down', async () => {
    for (let i = 0; i < 12; i++) await send(await join(`P${i}`), 1 + i);
    const me = await join('Me');
    await send(me, 50);
    const rows = await board(me);
    expect(rows.length).toBe(11);
    expect([rows.at(-1)!.place, rows.at(-1)!.mine, rows.at(-1)!.players]).toEqual([13, true, 13]);
    expect((await board(null)).length).toBe(10);
  });
  it('refuses bad times, boards and tokens', async () => {
    const sam = await join('Sam');
    for (const t of [0, -1, 86400, '5', null]) expect((await post('submit', { token: sam, track: 'csgo', map: 'm', time: t })).status).toBe(400);
    expect((await send(sam, 5, 'hacked')).status).toBe(400);
    expect((await send(sam, 5, 'csgo', 'x'.repeat(81))).status).toBe(400);
    expect((await send('f'.repeat(40), 5)).status).toBe(401);
    expect(await board(sam)).toEqual([]);
  });
  it("can't be broken by a name or map full of SQL", async () => {
    const evil = "x'); DROP TABLE times;--";
    const token = await join(evil);
    await send(token, 5, 'csgo', evil);
    expect((await board(token, 'csgo', evil))[0].name).toBe(evil);
  });
});
