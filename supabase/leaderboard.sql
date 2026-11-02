-- Friends' leaderboard. Run once in the Supabase SQL editor; running it again is safe and keeps the times.
-- The game's public key can't touch these tables, only call the two functions below, which check the group code.

create table if not exists public.leaderboard (
  player uuid not null,
  track text not null check (track in ('csgo', 'csgo128', 'cs16')),
  map text not null check (char_length(map) between 1 and 80),
  name text not null check (char_length(name) between 1 and 31),
  run_time double precision not null check (run_time > 0 and run_time < 86400),
  set_at timestamptz not null default now(),
  primary key (track, map, player)
);
create index if not exists leaderboard_board on public.leaderboard (track, map, run_time);

-- Holds the one group code. Empty until you set it (see the README), and nobody gets in until then.
create table if not exists public.leaderboard_group (
  only_row boolean primary key default true check (only_row),
  code text not null check (char_length(code) >= 6)
);

alter table public.leaderboard enable row level security;
alter table public.leaderboard_group enable row level security;
revoke all on public.leaderboard, public.leaderboard_group from anon, authenticated;

-- Keeps a player's best time on a board, and always their latest name.
create or replace function public.leaderboard_submit(p_code text, p_player uuid, p_name text, p_track text, p_map text, p_time double precision)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.leaderboard_group g where g.code = p_code) then
    raise exception 'wrong group code';
  end if;
  insert into public.leaderboard as l (player, track, map, name, run_time)
  values (p_player, p_track, p_map, left(trim(p_name), 31), p_time)
  on conflict (track, map, player) do update set
    name = excluded.name,
    set_at = case when excluded.run_time < l.run_time then now() else l.set_at end,
    run_time = least(l.run_time, excluded.run_time);
end $$;

-- The top 10 of a board, plus the asking player's own row if they're further down. Player ids never leave the database.
create or replace function public.leaderboard_top(p_code text, p_player uuid, p_track text, p_map text)
returns table (place bigint, name text, run_time double precision, set_at timestamptz, mine boolean, players bigint)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not exists (select 1 from public.leaderboard_group g where g.code = p_code) then
    raise exception 'wrong group code';
  end if;
  return query
    select r.place, r.name, r.run_time, r.set_at, r.mine, r.players
    from (
      select rank() over (order by l.run_time) as place, l.name, l.run_time, l.set_at, l.player = p_player as mine, count(*) over () as players
      from public.leaderboard l
      where l.track = p_track and l.map = p_map
    ) r
    where r.place <= 10 or r.mine
    order by r.place, r.set_at;
end $$;

revoke all on function public.leaderboard_submit(text, uuid, text, text, text, double precision) from public;
revoke all on function public.leaderboard_top(text, uuid, text, text) from public;
grant execute on function public.leaderboard_submit(text, uuid, text, text, text, double precision) to anon, authenticated;
grant execute on function public.leaderboard_top(text, uuid, text, text) to anon, authenticated;
