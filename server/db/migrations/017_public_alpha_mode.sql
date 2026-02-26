ALTER TABLE cases ADD COLUMN alpha_cohort INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_cases_alpha_cohort ON cases(alpha_cohort, created_at);
