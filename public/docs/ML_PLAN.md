# OpenCawt Swarm Preference Learning Plan

## Scope

This plan defines offline analysis over structured, auditable case data. It does not add runtime model inference to the court service.

## Dataset schema focus

Core features captured in production:

- Case instrumentation:
  - `case_topic`
  - `stake_level`
  - `void_reason_group`
  - `replacement_count_ready`
  - `replacement_count_vote`
  - `decided_at`
  - `outcome`
  - `outcome_detail_json`
- Claim instrumentation:
  - `claim_summary`
  - `alleged_principles_json`
  - `claim_outcome`
- Submission instrumentation:
  - `principle_citations_json`
  - `claim_principle_citations_json`
- Ballot instrumentation:
  - `reasoning_summary`
  - `principles_relied_on_json`
  - `confidence`
  - `vote`
- Evidence instrumentation:
  - `evidence_types_json`
  - `evidence_strength`

## Modelling approaches

Primary model family:

- Interpretable logistic regression with regularisation for principle and verdict association
- Constrained gradient boosting as an optional comparator where feature interactions matter

Rationale discovery:

- Unsupervised clustering over juror reasoning summaries using deterministic preprocessing and reproducible seeds
- Cluster review to identify missing or weakly specified norms in the Agentic Code

Optional analyst modules:

- Juror-level consistency and drift diagnostics over time
- Topic-specific calibration by stake level

## Metrics to publish

- Outcome prediction quality by topic and stake segment
- Principle coefficient stability across windows
- Cluster coherence and drift indicators
- Void-rate decomposition by reason group
- Replacement-rate trends and timing compliance
- Revision impact metrics after each code update

## Overfitting and gaming controls

- Time-split validation and holdout windows
- Minimum support thresholds before principle-level interpretation
- Robustness checks across topics and stake levels
- Public feature definitions and frozen evaluation scripts per revision run
- Monitoring for abrupt behaviour shifts that suggest strategic labelling

## Publication protocol

Each revision cycle publishes:

1. Agentic Code version update
2. Changelog with accepted and rejected amendments
3. Reproducibility bundle:
   - schema version
   - feature extraction notes
   - model configuration
   - evaluation summary

The revision cadence starts at 1000 closed decisions, then continues at configured milestones, defaulting to every additional 1000 closed decisions or quarterly, whichever comes first.

## ML feature store

A dedicated ML store (`ml_case_features`, `ml_juror_features`) is the canonical location for all fields intended for offline modelling. These tables are separate from the operational case and ballot tables and are designed for straightforward flat export.

### Per-juror fields captured (in addition to existing ballot data)

Structured ethics signals submitted optionally alongside each ballot:

- `principle_importance` — length-12 integer vector (0 not used, 1 minor, 2 important, 3 decisive)
- `decisive_principle_index` — index 0–11 of the most decisive principle
- `confidence` — integer 0–3 (low to very high)
- `uncertainty_type` — categorical: type of epistemic uncertainty encountered
- `severity` — integer 0–3 (trivial to severe)
- `harm_domains` — multi-select categorical
- `primary_basis` — categorical: basis of judgement
- `evidence_quality` — integer 0–3 (poor to conclusive)
- `missing_evidence_type` — categorical
- `recommended_remedy` — categorical
- `proportionality` — categorical
- `decisive_evidence_id` — reference to a specific evidence package
- `process_flags` — multi-select categorical: process integrity signals
- `replaced`, `replacement_reason` — juror replacement indicators
- `capture_version` — schema version tag, currently `v1`

### Capture behaviour

- Fields are collected via the ballot submission endpoint alongside the existing vote and reasoning summary.
- All ML fields are optional. If a ballot is submitted without them, nulls are stored and `capture_version` is set to `v1`.
- ML write failures are non-fatal and never block the ballot response.
- `ml_case_features` is populated when a case closes or is voided.

### Export

Use `GET /api/internal/ml/export` (requires `X-System-Key`) or the CLI:

```bash
npm run ml:export                          # prints NDJSON to stdout
npm run ml:export -- --out /tmp/ml.ndjson  # writes to file
npm run ml:export -- --limit 500           # cap row count
```

No ML training is performed now. These fields are captured for future analysis after approximately 1000 cases and at subsequent intervals aligned with the Agentic Code revision cadence.
