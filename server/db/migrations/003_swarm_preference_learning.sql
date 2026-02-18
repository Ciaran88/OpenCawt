ALTER TABLE cases ADD COLUMN case_topic TEXT NOT NULL DEFAULT 'other';
ALTER TABLE cases ADD COLUMN stake_level TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE cases ADD COLUMN void_reason_group TEXT;
ALTER TABLE cases ADD COLUMN replacement_count_ready INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cases ADD COLUMN replacement_count_vote INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cases ADD COLUMN decided_at TEXT;
ALTER TABLE cases ADD COLUMN outcome TEXT;
ALTER TABLE cases ADD COLUMN outcome_detail_json TEXT;
ALTER TABLE cases ADD COLUMN prosecution_principles_cited_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE cases ADD COLUMN defence_principles_cited_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE claims ADD COLUMN claim_outcome TEXT NOT NULL DEFAULT 'undecided';

ALTER TABLE submissions ADD COLUMN claim_principle_citations_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE ballots ADD COLUMN vote TEXT;
ALTER TABLE ballots ADD COLUMN principles_relied_on_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE ballots ADD COLUMN confidence TEXT;

ALTER TABLE evidence_items ADD COLUMN evidence_types_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE evidence_items ADD COLUMN evidence_strength TEXT;

UPDATE cases
SET case_topic = COALESCE(NULLIF(case_topic, ''), 'other');

UPDATE cases
SET stake_level = COALESCE(NULLIF(stake_level, ''), 'medium');

UPDATE cases
SET decided_at = COALESCE(decided_at, closed_at, voided_at)
WHERE status IN ('closed', 'sealed', 'void');

UPDATE cases
SET outcome = CASE
  WHEN status = 'void' THEN 'void'
  WHEN verdict_bundle_json LIKE '%for_prosecution%' THEN 'for_prosecution'
  WHEN verdict_bundle_json LIKE '%for_defence%' THEN 'for_defence'
  ELSE 'void'
END
WHERE status IN ('closed', 'sealed', 'void') AND (outcome IS NULL OR outcome = '');

UPDATE cases
SET void_reason_group = CASE
  WHEN void_reason = 'missing_defence_assignment' THEN 'no_defence'
  WHEN void_reason IN ('missing_opening_submission', 'missing_evidence_submission', 'missing_closing_submission', 'missing_summing_submission') THEN 'other_timeout'
  WHEN void_reason = 'voting_timeout' THEN 'other_timeout'
  WHEN void_reason = 'manual_void' THEN 'admin_void'
  WHEN void_reason = 'inconclusive_verdict' THEN 'other'
  ELSE 'other'
END
WHERE status = 'void' AND (void_reason_group IS NULL OR void_reason_group = '');
