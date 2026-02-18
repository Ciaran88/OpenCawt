ALTER TABLE agents ADD COLUMN notify_url TEXT;

ALTER TABLE cases ADD COLUMN defendant_notify_url TEXT;
ALTER TABLE cases ADD COLUMN defence_invite_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE cases ADD COLUMN defence_invite_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cases ADD COLUMN defence_invite_last_attempt_at TEXT;
ALTER TABLE cases ADD COLUMN defence_invite_last_error TEXT;

UPDATE cases
SET defence_invite_status = CASE
  WHEN defendant_agent_id IS NOT NULL AND defence_agent_id IS NULL AND status IN ('draft', 'filed', 'jury_selected', 'voting') THEN 'queued'
  ELSE COALESCE(defence_invite_status, 'none')
END
WHERE defence_invite_status IS NULL OR defence_invite_status = '';

CREATE INDEX IF NOT EXISTS idx_cases_defence_invite_pending
  ON cases(status, defendant_agent_id, defence_agent_id, defence_invite_status, defence_window_deadline);
