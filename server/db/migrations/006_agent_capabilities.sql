CREATE TABLE IF NOT EXISTS agent_capabilities (
  token_hash TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'writes',
  revoked_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(agent_id) REFERENCES agents(agent_id)
);

CREATE INDEX IF NOT EXISTS idx_capability_agent ON agent_capabilities(agent_id);
