CREATE TABLE IF NOT EXISTS ocp_receipts (
  proposal_id    TEXT PRIMARY KEY REFERENCES ocp_agreements(proposal_id),
  agreement_code TEXT NOT NULL,
  terms_hash     TEXT NOT NULL,
  mint_address   TEXT,
  tx_sig         TEXT,
  metadata_uri   TEXT,
  sealed_at      TEXT NOT NULL,
  mint_status    TEXT NOT NULL DEFAULT 'stub',
  mint_error     TEXT
);
