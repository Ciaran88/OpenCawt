-- Decisions: generalised signed decisions for external apps.
-- Supports ATTESTATION, MULTISIG_DECISION, APP_DECISION, AGREEMENT types.
CREATE TABLE IF NOT EXISTS ocp_decisions (
  draft_id        TEXT PRIMARY KEY,
  decision_type   TEXT NOT NULL,  -- 'ATTESTATION'|'MULTISIG_DECISION'|'APP_DECISION'|'AGREEMENT'
  mode            TEXT NOT NULL DEFAULT 'private',  -- 'public'|'private'
  subject         TEXT NOT NULL,  -- human-readable subject
  payload_hash    TEXT NOT NULL,  -- sha256 hex of the canonical payload JSON
  canonical_payload TEXT NOT NULL, -- JSON string, always stored
  decision_code   TEXT,           -- set on seal (10-char Crockford)
  required_signers INTEGER NOT NULL DEFAULT 1,  -- k-of-n threshold
  status          TEXT NOT NULL DEFAULT 'draft',  -- 'draft'|'sealed'|'cancelled'
  initiator_agent_id TEXT NOT NULL REFERENCES ocp_agents(agent_id),
  created_at      TEXT NOT NULL,
  sealed_at       TEXT,
  idempotency_key TEXT            -- optional caller-supplied key
);
CREATE INDEX IF NOT EXISTS idx_ocp_decisions_code    ON ocp_decisions(decision_code);
CREATE INDEX IF NOT EXISTS idx_ocp_decisions_status  ON ocp_decisions(status);
CREATE INDEX IF NOT EXISTS idx_ocp_decisions_idem    ON ocp_decisions(idempotency_key);

-- Declared signers (the n in k-of-n)
CREATE TABLE IF NOT EXISTS ocp_decision_signers (
  draft_id   TEXT NOT NULL REFERENCES ocp_decisions(draft_id),
  agent_id   TEXT NOT NULL REFERENCES ocp_agents(agent_id),
  added_at   TEXT NOT NULL,
  PRIMARY KEY (draft_id, agent_id)
);

-- Collected signatures (the k actually received)
CREATE TABLE IF NOT EXISTS ocp_decision_signatures (
  draft_id   TEXT NOT NULL REFERENCES ocp_decisions(draft_id),
  agent_id   TEXT NOT NULL REFERENCES ocp_agents(agent_id),
  sig        TEXT NOT NULL,  -- base64 Ed25519 over payload_hash
  signed_at  TEXT NOT NULL,
  PRIMARY KEY (draft_id, agent_id)
);
