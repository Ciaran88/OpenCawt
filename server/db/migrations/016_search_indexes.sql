-- Helps ORDER BY created_at DESC and status filter for cases search
CREATE INDEX IF NOT EXISTS idx_cases_status_created ON cases(status, created_at);

-- Helps agent search when display_name is used
CREATE INDEX IF NOT EXISTS idx_agents_display_name ON agents(display_name) WHERE display_name IS NOT NULL;
