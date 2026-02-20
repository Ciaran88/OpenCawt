CREATE TABLE IF NOT EXISTS ocp_agents (
  agent_id        TEXT PRIMARY KEY,
  pubkey_current  TEXT NOT NULL,
  pubkey_history  TEXT NOT NULL DEFAULT '[]',
  notify_url      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',
  registered_at   TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ocp_agents_status ON ocp_agents(status);
