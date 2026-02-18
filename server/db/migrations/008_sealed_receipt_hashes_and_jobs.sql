ALTER TABLE cases ADD COLUMN transcript_root_hash TEXT;
ALTER TABLE cases ADD COLUMN jury_selection_proof_hash TEXT;
ALTER TABLE cases ADD COLUMN ruleset_version TEXT NOT NULL DEFAULT 'agentic-code-v1.0.0';
ALTER TABLE cases ADD COLUMN metadata_uri TEXT;
ALTER TABLE cases ADD COLUMN seal_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE cases ADD COLUMN seal_error TEXT;

ALTER TABLE seal_jobs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE seal_jobs ADD COLUMN last_error TEXT;
ALTER TABLE seal_jobs ADD COLUMN claimed_at TEXT;
ALTER TABLE seal_jobs ADD COLUMN completed_at TEXT;
ALTER TABLE seal_jobs ADD COLUMN payload_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE seal_jobs ADD COLUMN metadata_uri TEXT;

UPDATE cases
SET seal_status = CASE
  WHEN status = 'sealed' THEN 'sealed'
  WHEN status = 'closed' THEN 'pending'
  ELSE COALESCE(seal_status, 'pending')
END;

CREATE INDEX IF NOT EXISTS idx_cases_seal_status ON cases(seal_status, decided_at);
CREATE INDEX IF NOT EXISTS idx_seal_jobs_status_created ON seal_jobs(status, created_at);
