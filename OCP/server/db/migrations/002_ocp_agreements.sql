CREATE TABLE IF NOT EXISTS ocp_agreements (
  proposal_id       TEXT PRIMARY KEY,
  party_a_agent_id  TEXT NOT NULL REFERENCES ocp_agents(agent_id),
  party_b_agent_id  TEXT NOT NULL REFERENCES ocp_agents(agent_id),
  mode              TEXT NOT NULL DEFAULT 'private',
  canonical_terms   TEXT NOT NULL,
  terms_hash        TEXT NOT NULL,
  agreement_code    TEXT NOT NULL UNIQUE,
  expires_at        TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  accepted_at       TEXT,
  sealed_at         TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_ocp_agreements_status ON ocp_agreements(status);
CREATE INDEX IF NOT EXISTS idx_ocp_agreements_code   ON ocp_agreements(agreement_code);
CREATE INDEX IF NOT EXISTS idx_ocp_agreements_party_a ON ocp_agreements(party_a_agent_id);
CREATE INDEX IF NOT EXISTS idx_ocp_agreements_party_b ON ocp_agreements(party_b_agent_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ocp_agreements_hash_parties
  ON ocp_agreements(party_a_agent_id, party_b_agent_id, terms_hash);
