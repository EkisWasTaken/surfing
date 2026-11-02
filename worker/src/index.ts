// The friends' leaderboard: a Cloudflare Worker in front of a D1 database. Every request needs the group code, which
// keeps strangers out. Each player has a unique name and a secret token, also their recovery code on another PC.
// Only a hash of the token is stored, and tokens and player ids never appear on a board.

type Statement = { bind(...values: unknown[]): Statement; run(): Promise<unknown>; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }> };
type Env = { DB: { prepare(sql: string): Statement }; GROUP_CODE?: string };
type Body = Record<string, unknown>;

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const refuse = (error: string, status: number) => reply({ error }, status);

const TRACKS = ['csgo', 'csgo128', 'cs16'];
const MAX_BODY = 2000;

const cleanName = (v: unknown) => {
  if (typeof v !== 'string') return null;
  const name = v.trim();
  return name.length >= 1 && name.length <= 31 && !/[\u0000-\u001f\u007f]/.test(name) ? name : null;
};
const hashOf = async (token: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};
const newToken = () => [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, '0')).join('');
const findPlayer = async (env: Env, token: unknown) =>
  typeof token === 'string' && /^[0-9a-f]{40}$/.test(token) ? env.DB.prepare('SELECT id, name FROM players WHERE token_hash = ?').bind(await hashOf(token)).first<{ id: number; name: string }>() : null;
const isNameClash = (e: unknown) => /UNIQUE/i.test(e instanceof Error ? e.message : String(e));
const boardOf = (b: Body) => (typeof b.track === 'string' && TRACKS.includes(b.track) && typeof b.map === 'string' && b.map.length >= 1 && b.map.length <= 80 ? { track: b.track, map: b.map } : null);

const routes: Record<string, (b: Body, env: Env) => Promise<Response>> = {
  async register(b, env) {
    const name = cleanName(b.name);
    if (!name) return refuse('bad name', 400);
    const token = newToken();
    try {
      await env.DB.prepare('INSERT INTO players (name, token_hash) VALUES (?, ?)').bind(name, await hashOf(token)).run();
    } catch (e) {
      if (isNameClash(e)) return refuse('name taken', 409);
      throw e;
    }
    return reply({ name, token });
  },
  async me(b, env) {
    const player = await findPlayer(env, b.token);
    return player ? reply({ name: player.name }) : refuse('bad token', 401);
  },
  async rename(b, env) {
    const player = await findPlayer(env, b.token), name = cleanName(b.name);
    if (!player) return refuse('bad token', 401);
    if (!name) return refuse('bad name', 400);
    try {
      await env.DB.prepare('UPDATE players SET name = ? WHERE id = ?').bind(name, player.id).run();
    } catch (e) {
      if (isNameClash(e)) return refuse('name taken', 409);
      throw e;
    }
    return reply({ name });
  },
  // Keeps a player's best, and the date it was set.
  async submit(b, env) {
    const player = await findPlayer(env, b.token), where = boardOf(b), time = b.time;
    if (!player) return refuse('bad token', 401);
    if (!where) return refuse('bad board', 400);
    if (typeof time !== 'number' || !Number.isFinite(time) || time <= 0 || time >= 86400) return refuse('bad time', 400);
    await env.DB.prepare(
      `INSERT INTO times (player_id, track, map, run_time, set_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (track, map, player_id) DO UPDATE SET
         set_at = CASE WHEN excluded.run_time < run_time THEN excluded.set_at ELSE set_at END,
         run_time = min(run_time, excluded.run_time)`,
    ).bind(player.id, where.track, where.map, time, Date.now()).run();
    return reply({ ok: true });
  },
  // The top 10, plus the asking player's own row if they're further down.
  async top(b, env) {
    const where = boardOf(b);
    if (!where) return refuse('bad board', 400);
    const player = await findPlayer(env, b.token);
    const { results } = await env.DB.prepare(
      `SELECT place, name, run_time AS time, player_id = ? AS mine, players FROM (
         SELECT t.player_id, t.run_time, t.set_at, p.name, RANK() OVER (ORDER BY t.run_time) AS place, COUNT(*) OVER () AS players
         FROM times t JOIN players p ON p.id = t.player_id
         WHERE t.track = ? AND t.map = ?
       ) WHERE place <= 10 OR player_id = ?
       ORDER BY place, set_at`,
    ).bind(player?.id ?? -1, where.track, where.map, player?.id ?? -1).all<{ place: number; name: string; time: number; mine: number; players: number }>();
    return reply({ rows: results.map((r) => ({ ...r, mine: !!r.mine })) });
  },
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const path = new URL(request.url).pathname.slice(1);
    if (request.method !== 'POST' || !Object.hasOwn(routes, path)) return refuse('not found', 404);
    const route = routes[path];
    const text = await request.text();
    if (text.length > MAX_BODY) return refuse('too large', 413);
    let body: Body;
    try {
      body = JSON.parse(text);
    } catch {
      return refuse('bad request', 400);
    }
    if (!body || typeof body !== 'object') return refuse('bad request', 400);
    // No code set on the Worker: nobody gets in.
    if (!env.GROUP_CODE || body.code !== env.GROUP_CODE) return refuse('wrong group code', 403);
    try {
      return await route(body, env);
    } catch (e) {
      console.error(e);
      return refuse('server error', 500);
    }
  },
};
