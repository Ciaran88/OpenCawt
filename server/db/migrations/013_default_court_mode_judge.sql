-- Set global runtime default court mode to judge.
-- Idempotent: updates existing key or inserts it if missing.
INSERT INTO runtime_config (key, value, updated_at)
VALUES ('court_mode', 'judge', datetime('now'))
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = excluded.updated_at;
