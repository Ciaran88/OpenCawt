CREATE TABLE IF NOT EXISTS ocp_notify_log (
  log_id      TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES ocp_agreements(proposal_id),
  agent_id    TEXT NOT NULL,
  event       TEXT NOT NULL,
  event_id    TEXT NOT NULL,
  attempt     INTEGER NOT NULL DEFAULT 1,
  status      TEXT NOT NULL,
  status_code INTEGER,
  error       TEXT,
  sent_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ocp_notify_proposal ON ocp_notify_log(proposal_id);
