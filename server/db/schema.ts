export const schemaSql = `
CREATE TABLE IF NOT EXISTS agents (
  agent_id TEXT PRIMARY KEY,
  juror_eligible INTEGER NOT NULL DEFAULT 1,
  banned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS juror_availability (
  agent_id TEXT PRIMARY KEY,
  availability TEXT NOT NULL,
  profile TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(agent_id) REFERENCES agents(agent_id)
);

CREATE TABLE IF NOT EXISTS cases (
  case_id TEXT PRIMARY KEY,
  public_slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  session_stage TEXT NOT NULL DEFAULT 'pre_session',
  prosecution_agent_id TEXT NOT NULL,
  defendant_agent_id TEXT,
  defence_agent_id TEXT,
  defence_state TEXT NOT NULL DEFAULT 'none',
  defence_assigned_at TEXT,
  defence_window_deadline TEXT,
  open_defence INTEGER NOT NULL,
  summary TEXT NOT NULL,
  requested_remedy TEXT NOT NULL,
  created_at TEXT NOT NULL,
  filed_at TEXT,
  jury_selected_at TEXT,
  session_started_at TEXT,
  closed_at TEXT,
  sealed_at TEXT,
  void_reason TEXT,
  voided_at TEXT,
  scheduled_for TEXT,
  countdown_end_at TEXT,
  countdown_total_ms INTEGER,
  treasury_tx_sig TEXT UNIQUE,
  filing_warning TEXT,
  drand_round INTEGER,
  drand_randomness TEXT,
  pool_snapshot_hash TEXT,
  selection_proof_json TEXT,
  verdict_hash TEXT,
  verdict_bundle_json TEXT,
  seal_asset_id TEXT,
  seal_tx_sig TEXT,
  seal_uri TEXT,
  last_event_seq_no INTEGER NOT NULL DEFAULT 0,
  sealed_disabled INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(prosecution_agent_id) REFERENCES agents(agent_id),
  FOREIGN KEY(defendant_agent_id) REFERENCES agents(agent_id),
  FOREIGN KEY(defence_agent_id) REFERENCES agents(agent_id)
);

CREATE TABLE IF NOT EXISTS claims (
  claim_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  claim_index INTEGER NOT NULL,
  summary TEXT NOT NULL,
  requested_remedy TEXT NOT NULL,
  alleged_principles_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(case_id) REFERENCES cases(case_id)
);

CREATE TABLE IF NOT EXISTS evidence_items (
  evidence_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  submitted_by TEXT NOT NULL,
  kind TEXT NOT NULL,
  body_text TEXT NOT NULL,
  references_json TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(case_id) REFERENCES cases(case_id),
  FOREIGN KEY(submitted_by) REFERENCES agents(agent_id)
);

CREATE TABLE IF NOT EXISTS submissions (
  submission_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  side TEXT NOT NULL,
  phase TEXT NOT NULL,
  text_body TEXT NOT NULL,
  principle_citations_json TEXT NOT NULL,
  evidence_citations_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(case_id) REFERENCES cases(case_id),
  UNIQUE(case_id, side, phase)
);

CREATE TABLE IF NOT EXISTS jury_panels (
  case_id TEXT PRIMARY KEY,
  drand_round INTEGER NOT NULL,
  drand_randomness TEXT NOT NULL,
  pool_snapshot_hash TEXT NOT NULL,
  selection_proof_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(case_id) REFERENCES cases(case_id)
);

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

CREATE TABLE IF NOT EXISTS jury_panel_members (
  case_id TEXT NOT NULL,
  juror_id TEXT NOT NULL,
  score_hash TEXT NOT NULL,
  member_status TEXT NOT NULL DEFAULT 'pending_ready',
  ready_deadline_at TEXT,
  ready_confirmed_at TEXT,
  voting_deadline_at TEXT,
  replacement_of_juror_id TEXT,
  replaced_by_juror_id TEXT,
  selection_run_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(case_id, juror_id),
  FOREIGN KEY(case_id) REFERENCES cases(case_id),
  FOREIGN KEY(juror_id) REFERENCES agents(agent_id)
);

CREATE TABLE IF NOT EXISTS ballots (
  ballot_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  juror_id TEXT NOT NULL,
  ballot_json TEXT NOT NULL,
  ballot_hash TEXT NOT NULL,
  reasoning_summary TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(case_id) REFERENCES cases(case_id),
  FOREIGN KEY(juror_id) REFERENCES agents(agent_id),
  UNIQUE(case_id, juror_id)
);

CREATE TABLE IF NOT EXISTS verdicts (
  case_id TEXT PRIMARY KEY,
  verdict_json TEXT NOT NULL,
  verdict_hash TEXT NOT NULL,
  majority_summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  asset_id TEXT,
  tx_sig TEXT,
  sealed_uri TEXT,
  FOREIGN KEY(case_id) REFERENCES cases(case_id)
);

CREATE TABLE IF NOT EXISTS seal_jobs (
  job_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  request_json TEXT NOT NULL,
  response_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(case_id) REFERENCES cases(case_id)
);

CREATE TABLE IF NOT EXISTS used_treasury_txs (
  tx_sig TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  amount_lamports INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(case_id) REFERENCES cases(case_id),
  FOREIGN KEY(agent_id) REFERENCES agents(agent_id)
);

CREATE TABLE IF NOT EXISTS agent_action_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  case_id TEXT,
  signature TEXT NOT NULL,
  timestamp_sec INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(agent_id, signature, timestamp_sec),
  FOREIGN KEY(agent_id) REFERENCES agents(agent_id)
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

CREATE TABLE IF NOT EXISTS agent_case_activity (
  activity_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  role TEXT NOT NULL,
  outcome TEXT,
  recorded_at TEXT NOT NULL,
  FOREIGN KEY(agent_id) REFERENCES agents(agent_id),
  FOREIGN KEY(case_id) REFERENCES cases(case_id)
);

CREATE TABLE IF NOT EXISTS agent_stats_cache (
  agent_id TEXT PRIMARY KEY,
  prosecutions_total INTEGER NOT NULL DEFAULT 0,
  prosecutions_wins INTEGER NOT NULL DEFAULT 0,
  defences_total INTEGER NOT NULL DEFAULT 0,
  defences_wins INTEGER NOT NULL DEFAULT 0,
  juries_total INTEGER NOT NULL DEFAULT 0,
  decided_cases_total INTEGER NOT NULL DEFAULT 0,
  victory_percent REAL NOT NULL DEFAULT 0,
  last_active_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(agent_id) REFERENCES agents(agent_id)
);

CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_session_stage ON cases(session_stage);
CREATE INDEX IF NOT EXISTS idx_cases_filed_at ON cases(filed_at);
CREATE INDEX IF NOT EXISTS idx_cases_open_defence_lookup ON cases(status, defence_agent_id, defendant_agent_id, defence_window_deadline, filed_at);
CREATE INDEX IF NOT EXISTS idx_cases_defendant ON cases(defendant_agent_id);
CREATE INDEX IF NOT EXISTS idx_action_agent_time ON agent_action_log(agent_id, action_type, created_at);
CREATE INDEX IF NOT EXISTS idx_evidence_case ON evidence_items(case_id);
CREATE INDEX IF NOT EXISTS idx_submissions_case ON submissions(case_id);
CREATE INDEX IF NOT EXISTS idx_ballots_case ON ballots(case_id);
CREATE INDEX IF NOT EXISTS idx_runtime_stage ON case_runtime(current_stage);
CREATE INDEX IF NOT EXISTS idx_transcript_case_seq ON case_transcript_events(case_id, seq_no);
CREATE INDEX IF NOT EXISTS idx_idempotency_expiry ON idempotency_records(expires_at);
CREATE INDEX IF NOT EXISTS idx_activity_agent_time ON agent_case_activity(agent_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_stats_leaderboard ON agent_stats_cache(victory_percent DESC, decided_cases_total DESC, last_active_at DESC);
`;
