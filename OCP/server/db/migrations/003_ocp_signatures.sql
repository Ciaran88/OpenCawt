CREATE TABLE IF NOT EXISTS ocp_signatures (
  proposal_id TEXT NOT NULL REFERENCES ocp_agreements(proposal_id),
  party       TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  sig         TEXT NOT NULL,
  signed_at   TEXT NOT NULL,
  PRIMARY KEY (proposal_id, party)
);
