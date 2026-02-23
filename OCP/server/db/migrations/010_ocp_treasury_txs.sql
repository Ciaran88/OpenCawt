-- Track treasury transactions used to pay minting fees (replay protection).
CREATE TABLE IF NOT EXISTS ocp_used_treasury_txs (
  tx_sig          TEXT PRIMARY KEY,
  proposal_id     TEXT NOT NULL REFERENCES ocp_agreements(proposal_id),
  agent_id        TEXT NOT NULL,
  amount_lamports INTEGER NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Store which treasury TX funded each agreement proposal.
ALTER TABLE ocp_agreements ADD COLUMN treasury_tx_sig TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ocp_agreements_treasury_tx
  ON ocp_agreements(treasury_tx_sig) WHERE treasury_tx_sig IS NOT NULL;
