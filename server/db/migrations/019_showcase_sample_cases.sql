ALTER TABLE cases ADD COLUMN showcase_sample INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_cases_showcase_sample ON cases(showcase_sample, created_at);
