-- Idempotency store: cache response body + status for idempotent requests.
CREATE TABLE IF NOT EXISTS ocp_idempotency (
  idem_key     TEXT NOT NULL,
  agent_id     TEXT NOT NULL,
  endpoint     TEXT NOT NULL,   -- e.g. 'propose' or 'decisions.draft'
  response_status INTEGER NOT NULL,
  response_body TEXT NOT NULL,  -- JSON string of the cached response
  created_at   TEXT NOT NULL,
  PRIMARY KEY (idem_key, agent_id, endpoint)
);
CREATE INDEX IF NOT EXISTS idx_ocp_idem_created ON ocp_idempotency(created_at);
