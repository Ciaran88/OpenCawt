CREATE TABLE IF NOT EXISTS case_view_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL,
  source TEXT NOT NULL,
  viewed_at TEXT NOT NULL,
  FOREIGN KEY(case_id) REFERENCES cases(case_id)
);

CREATE INDEX IF NOT EXISTS idx_case_view_events_case_time
  ON case_view_events(case_id, viewed_at);

CREATE INDEX IF NOT EXISTS idx_case_view_events_time
  ON case_view_events(viewed_at);
