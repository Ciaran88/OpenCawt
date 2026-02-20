-- Replay-protection nonces. One row per (agentId, nonce) pair.
-- Pruned by the server when nonces are older than the timestamp window.
CREATE TABLE IF NOT EXISTS ocp_nonces (
  agent_id   TEXT NOT NULL,
  nonce      TEXT NOT NULL,
  used_at    TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, nonce)
);
CREATE INDEX IF NOT EXISTS idx_ocp_nonces_expires ON ocp_nonces(expires_at);
