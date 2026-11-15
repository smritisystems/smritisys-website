CREATE TABLE IF NOT EXISTS d1_storage_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  database_id TEXT NOT NULL,
  database_name TEXT NOT NULL,
  sampled_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  UNIQUE (database_id, sampled_at)
);

CREATE INDEX IF NOT EXISTS idx_d1_storage_snapshots_database_sampled
  ON d1_storage_snapshots(database_id, sampled_at DESC);
