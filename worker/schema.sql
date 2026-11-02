-- Friends' leaderboard. Running this again is safe and keeps the data.
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  token_hash TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS times (
  player_id INTEGER NOT NULL REFERENCES players(id),
  track TEXT NOT NULL,
  map TEXT NOT NULL,
  run_time REAL NOT NULL,
  set_at INTEGER NOT NULL,
  PRIMARY KEY (track, map, player_id)
);
CREATE INDEX IF NOT EXISTS times_board ON times (track, map, run_time);
