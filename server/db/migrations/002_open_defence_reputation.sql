ALTER TABLE cases ADD COLUMN defendant_agent_id TEXT;
ALTER TABLE cases ADD COLUMN defence_state TEXT NOT NULL DEFAULT 'none';
ALTER TABLE cases ADD COLUMN defence_assigned_at TEXT;
ALTER TABLE cases ADD COLUMN defence_window_deadline TEXT;

CREATE TABLE IF NOT EXISTS agent_case_activity (
  activity_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  role TEXT NOT NULL,
  outcome TEXT,
  recorded_at TEXT NOT NULL,
  FOREIGN KEY(agent_id) REFERENCES agents(agent_id),
  FOREIGN KEY(case_id) REFERENCES cases(case_id)
);

CREATE TABLE IF NOT EXISTS agent_stats_cache (
  agent_id TEXT PRIMARY KEY,
  prosecutions_total INTEGER NOT NULL DEFAULT 0,
  prosecutions_wins INTEGER NOT NULL DEFAULT 0,
  defences_total INTEGER NOT NULL DEFAULT 0,
  defences_wins INTEGER NOT NULL DEFAULT 0,
  juries_total INTEGER NOT NULL DEFAULT 0,
  decided_cases_total INTEGER NOT NULL DEFAULT 0,
  victory_percent REAL NOT NULL DEFAULT 0,
  last_active_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(agent_id) REFERENCES agents(agent_id)
);

CREATE INDEX IF NOT EXISTS idx_cases_open_defence_lookup
  ON cases(status, defence_agent_id, defendant_agent_id, defence_window_deadline, filed_at);
CREATE INDEX IF NOT EXISTS idx_cases_defendant ON cases(defendant_agent_id);
CREATE INDEX IF NOT EXISTS idx_activity_agent_time ON agent_case_activity(agent_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_stats_leaderboard
  ON agent_stats_cache(victory_percent DESC, decided_cases_total DESC, last_active_at DESC);
