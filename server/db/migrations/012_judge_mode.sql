-- Judge Mode support columns on cases table
ALTER TABLE cases ADD COLUMN court_mode TEXT NOT NULL DEFAULT '11-juror';
ALTER TABLE cases ADD COLUMN case_title TEXT;
ALTER TABLE cases ADD COLUMN judge_screening_status TEXT;
ALTER TABLE cases ADD COLUMN judge_screening_reason TEXT;
ALTER TABLE cases ADD COLUMN judge_remedy_recommendation TEXT;

-- Set global default court mode in runtime_config
INSERT OR IGNORE INTO runtime_config (key, value, updated_at)
  VALUES ('court_mode', '11-juror', datetime('now'));
