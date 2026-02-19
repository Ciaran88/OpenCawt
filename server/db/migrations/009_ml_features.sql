-- ML feature store: two dedicated tables for per-case and per-juror signals.
-- All fields are nullable so existing ballot submissions remain valid.
-- Designed for easy flat export after ~1000 cases.

CREATE TABLE IF NOT EXISTS ml_case_features (
  case_id               TEXT PRIMARY KEY,
  agentic_code_version  TEXT NOT NULL DEFAULT 'v1',
  outcome               TEXT,
  void_reason_group     TEXT,
  scheduled_at          TEXT,
  started_at            TEXT,
  ended_at              TEXT,
  case_topic_tags       TEXT,       -- JSON string[], nullable
  capture_version       TEXT NOT NULL DEFAULT 'v1',
  created_at            TEXT NOT NULL,
  FOREIGN KEY(case_id) REFERENCES cases(case_id)
);

CREATE TABLE IF NOT EXISTS ml_juror_features (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id                  TEXT NOT NULL,
  juror_id                 TEXT NOT NULL,
  vote                     TEXT,           -- for_prosecution | for_defence | mixed
  rationale                TEXT,           -- reasoning_summary copy
  principle_importance     TEXT,           -- JSON int[12], scale 0-3
  decisive_principle_index INTEGER,        -- 0-11 or null
  confidence               INTEGER,        -- 0-3 or null
  uncertainty_type         TEXT,           -- enum or null
  severity                 INTEGER,        -- 0-3 or null
  harm_domains             TEXT,           -- JSON string[] or null
  primary_basis            TEXT,           -- enum or null
  evidence_quality         INTEGER,        -- 0-3 or null
  missing_evidence_type    TEXT,           -- enum or null
  recommended_remedy       TEXT,           -- enum or null
  proportionality          TEXT,           -- enum or null
  decisive_evidence_id     TEXT,           -- eg "P-1", "D-2" or null
  process_flags            TEXT,           -- JSON string[] or null
  replaced                 INTEGER NOT NULL DEFAULT 0,   -- 0|1 boolean
  replacement_reason       TEXT,
  capture_version          TEXT NOT NULL DEFAULT 'v1',
  created_at               TEXT NOT NULL,
  UNIQUE(case_id, juror_id),
  FOREIGN KEY(case_id) REFERENCES cases(case_id),
  FOREIGN KEY(juror_id) REFERENCES agents(agent_id)
);

CREATE INDEX IF NOT EXISTS idx_ml_juror_features_case_id ON ml_juror_features(case_id);
CREATE INDEX IF NOT EXISTS idx_ml_juror_features_juror_id ON ml_juror_features(juror_id);
