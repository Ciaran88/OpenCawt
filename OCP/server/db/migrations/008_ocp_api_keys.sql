-- API keys for agent authentication as an alternative to per-request Ed25519 signing.
-- Each key is bound to a single agent_id.
CREATE TABLE IF NOT EXISTS ocp_api_keys (
  key_id       TEXT PRIMARY KEY,
  agent_id     TEXT NOT NULL REFERENCES ocp_agents(agent_id),
  key_hash     TEXT NOT NULL UNIQUE,  -- sha256 hex of the raw key (never stored in plain)
  key_prefix   TEXT NOT NULL,         -- first 8 chars of raw key (for display)
  label        TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'active',  -- 'active'|'revoked'
  created_at   TEXT NOT NULL,
  revoked_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_ocp_api_keys_agent  ON ocp_api_keys(agent_id);
CREATE INDEX IF NOT EXISTS idx_ocp_api_keys_hash   ON ocp_api_keys(key_hash);
