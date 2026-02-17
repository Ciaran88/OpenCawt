ALTER TABLE cases ADD COLUMN session_stage TEXT NOT NULL DEFAULT 'pre_session';
ALTER TABLE cases ADD COLUMN session_started_at TEXT;
ALTER TABLE cases ADD COLUMN void_reason TEXT;
ALTER TABLE cases ADD COLUMN voided_at TEXT;
ALTER TABLE cases ADD COLUMN last_event_seq_no INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cases ADD COLUMN sealed_disabled INTEGER NOT NULL DEFAULT 0;

ALTER TABLE jury_panel_members ADD COLUMN member_status TEXT NOT NULL DEFAULT 'pending_ready';
ALTER TABLE jury_panel_members ADD COLUMN ready_deadline_at TEXT;
ALTER TABLE jury_panel_members ADD COLUMN ready_confirmed_at TEXT;
ALTER TABLE jury_panel_members ADD COLUMN voting_deadline_at TEXT;
ALTER TABLE jury_panel_members ADD COLUMN replacement_of_juror_id TEXT;
ALTER TABLE jury_panel_members ADD COLUMN replaced_by_juror_id TEXT;
ALTER TABLE jury_panel_members ADD COLUMN selection_run_id TEXT;

ALTER TABLE ballots ADD COLUMN reasoning_summary TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS jury_selection_runs (
  run_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  run_type TEXT NOT NULL,
  drand_round INTEGER NOT NULL,
  drand_randomness TEXT NOT NULL,
  pool_snapshot_hash TEXT NOT NULL,
  selection_proof_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(case_id) REFERENCES cases(case_id)
);

CREATE TABLE IF NOT EXISTS case_runtime (
  case_id TEXT PRIMARY KEY,
  current_stage TEXT NOT NULL,
  stage_started_at TEXT NOT NULL,
  stage_deadline_at TEXT,
  scheduled_session_start_at TEXT,
  voting_hard_deadline_at TEXT,
  void_reason TEXT,
  voided_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(case_id) REFERENCES cases(case_id)
);

CREATE TABLE IF NOT EXISTS case_transcript_events (
  event_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  seq_no INTEGER NOT NULL,
  actor_role TEXT NOT NULL,
  actor_agent_id TEXT,
  event_type TEXT NOT NULL,
  stage TEXT,
  message_text TEXT NOT NULL,
  artefact_type TEXT,
  artefact_id TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(case_id) REFERENCES cases(case_id),
  UNIQUE(case_id, seq_no)
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  case_id TEXT,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE(agent_id, method, path, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_cases_session_stage ON cases(session_stage);
CREATE INDEX IF NOT EXISTS idx_runtime_stage ON case_runtime(current_stage);
CREATE INDEX IF NOT EXISTS idx_transcript_case_seq ON case_transcript_events(case_id, seq_no);
CREATE INDEX IF NOT EXISTS idx_idempotency_expiry ON idempotency_records(expires_at);
